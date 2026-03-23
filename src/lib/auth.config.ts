import type { NextAuthConfig } from "next-auth";

/**
 * Edge-compatible NextAuth config subset.
 * Used exclusively by src/proxy.ts (Edge Runtime).
 *
 * Must NOT import anything that depends on Node.js built-ins:
 *   - No database / Drizzle / postgres
 *   - No bcryptjs / crypto
 *   - No DrizzleAdapter
 *
 * JWT callbacks here only read from the token — no DB lookups.
 * The full auth config (with adapter, providers, signIn callback) lives in auth.ts.
 */
const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/admin/login",
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role ?? "editor";
        token.id = user.id!;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.role = token.role;
        session.user.id = token.id;
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const { pathname } = nextUrl;
      // Protect all /admin/* routes except the login page itself.
      if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
        return !!auth; // false → NextAuth redirects to pages.signIn
      }
      return true;
    },
  },
  providers: [],
};

export default authConfig;
