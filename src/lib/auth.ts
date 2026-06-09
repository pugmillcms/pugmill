import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { db } from "@/lib/db";
import { adminUsers, accounts, sessions, verificationTokens } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { loginLimiter, ipLoginLimiter } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/get-client-ip";
import { getConfig } from "@/lib/config";
import authConfig from "@/lib/auth.config";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// A valid bcrypt hash (cost 12) of a random throwaway string. Compared against
// on the unknown-account path so that "no such user" takes the same time as
// "wrong password", closing the login timing/enumeration oracle.
const DUMMY_PASSWORD_HASH = "$2b$12$RoAH5723buxUZ1XwcpPHpu0/R29WiA4NTDMvyiDIXgMF1d8yjqpWy";

/**
 * Whether a brand-new OAuth identity is allowed to be provisioned.
 * Returns true only when the email (or its domain) is on the admin-managed
 * allowlist in Settings > OAuth. Without this, configuring GitHub/Google OAuth
 * would let anyone on the internet self-register as an editor.
 */
async function isOAuthEmailAllowed(email: string): Promise<boolean> {
  try {
    const cfg = await getConfig();
    const emails = (cfg.auth?.oauthAllowedEmails ?? []).map((e) => e.toLowerCase().trim());
    if (emails.includes(email)) return true;
    const domains = (cfg.auth?.oauthAllowedDomains ?? []).map((d) =>
      d.toLowerCase().trim().replace(/^@/, ""),
    );
    const domain = email.split("@")[1] ?? "";
    return !!domain && domains.includes(domain);
  } catch {
    // Fail closed — if config can't be read, do not auto-provision.
    return false;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: adminUsers,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      // On initial sign-in, stamp the refresh timestamp.
      if (user) {
        token.role = (user.role ?? "editor") as "admin" | "editor";
        token.id = user.id!;
        token.roleRefreshedAt = Date.now();
        return token;
      }

      // Periodically re-fetch the role from the DB so that privilege changes
      // (e.g. admin demotes a user) propagate within 5 minutes rather than
      // waiting until the full session expires.
      const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
      const due = !token.roleRefreshedAt || Date.now() - token.roleRefreshedAt > REFRESH_INTERVAL_MS;
      if (due && token.id) {
        const dbUser = await db.query.adminUsers.findFirst({
          where: eq(adminUsers.id, String(token.id)),
          columns: { role: true },
        });
        if (!dbUser) {
          // User deleted — return null to invalidate the session.
          return null;
        }
        token.role = dbUser.role as "admin" | "editor";
        token.roleRefreshedAt = Date.now();
      }

      return token;
    },
    async signIn({ user, account }) {
      // For OAuth providers, auto-provision the user in adminUsers if not already there.
      // The DrizzleAdapter handles this, but we ensure role is set.
      if (account?.provider === "github" || account?.provider === "google") {
        if (!user.email) return false;
        const email = user.email.toLowerCase();
        const existing = await db.query.adminUsers.findFirst({
          where: eq(adminUsers.email, email),
        });
        if (!existing) {
          // Acquire a transaction-level advisory lock before counting users.
          // pg_advisory_xact_lock() serialises concurrent callers — only one
          // transaction can hold lock 8675309 at a time, so two simultaneous
          // first-time OAuth signins cannot both see count=0 and both become
          // admin. The lock is released automatically when the transaction ends.
          let allowed = true;
          await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(8675309)`);
            const [{ count }] = await tx
              .select({ count: sql<number>`count(*)::int` })
              .from(adminUsers);

            // Provisioning gate: only the very first account on an empty install
            // (bootstrap) or an explicitly allowlisted email may be created.
            // Everyone else is rejected — no open self-registration.
            const isBootstrap = count === 0;
            if (!isBootstrap && !(await isOAuthEmailAllowed(email))) {
              allowed = false;
              return;
            }

            const role = isBootstrap ? "admin" : "editor";
            await tx.insert(adminUsers).values({
              id: user.id!,
              name: user.name,
              email,
              image: user.image,
              role,
            } as typeof adminUsers.$inferInsert).onConflictDoNothing();
          });
          if (!allowed) return false;
        }
      }
      return true;
    },
  },
  providers: [
    // OAuth providers are only registered when credentials are present.
    // On Replit: replit-init.ts bridges admin-UI-saved credentials into
    // .env.local before the server starts, so these checks work correctly.
    // On other platforms: set the env vars in your host's secrets panel.
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? [GitHub({
          clientId: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
        })]
      : []
    ),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [Google({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        })]
      : []
    ),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        const email = credentials?.email as string;
        const ip = getClientIp((req as Request).headers);

        // Rate limiting
        const ipCheck = ipLoginLimiter.check(String(ip), 20);
        if (!ipCheck.success) {
          throw new Error("Too many login attempts from this IP. Please try again later.");
        }
        if (email) {
          const emailCheck = loginLimiter.check(email.toLowerCase(), 5);
          if (!emailCheck.success) {
            throw new Error("Too many login attempts for this account. Please wait 15 minutes.");
          }
        }

        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await db.query.adminUsers.findFirst({
          where: eq(adminUsers.email, parsed.data.email),
        });
        if (!user || !user.passwordHash) {
          // Run one bcrypt comparison anyway so an unknown account is
          // indistinguishable (by timing) from a wrong password.
          await bcrypt.compare(parsed.data.password, DUMMY_PASSWORD_HASH);
          return null;
        }

        const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!valid) return null;

        loginLimiter.reset(parsed.data.email.toLowerCase());
        return { id: user.id, name: user.name ?? null, email: user.email ?? null, role: user.role as "admin" | "editor" };
      },
    }),
  ],
});
