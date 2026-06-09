"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getConfig, updateConfig } from "@/lib/config";
import { encryptString } from "@/lib/encrypt";
import { getCurrentUser } from "@/lib/get-current-user";
import { auditLog } from "@/lib/audit-log";

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") throw new Error("Forbidden");
  return user;
}

export async function saveAuthSettings(formData: FormData) {
  const user = await requireAdmin();
  const current = await getConfig();

  // Client IDs are public — store as-is
  const googleClientId  = (formData.get("googleClientId")  as string) ?? "";
  const githubClientId  = (formData.get("githubClientId")  as string) ?? "";

  // Client secrets — only update if a new value was typed (redaction pattern)
  const rawGoogleSecret = (formData.get("googleClientSecret") as string) ?? "";
  const googleClientSecret = rawGoogleSecret && rawGoogleSecret !== "__REDACTED__"
    ? encryptString(rawGoogleSecret)
    : (current.auth?.googleClientSecret ?? "");

  const rawGithubSecret = (formData.get("githubClientSecret") as string) ?? "";
  const githubClientSecret = rawGithubSecret && rawGithubSecret !== "__REDACTED__"
    ? encryptString(rawGithubSecret)
    : (current.auth?.githubClientSecret ?? "");

  // OAuth self-provisioning allowlist. Split on commas/newlines, trim, dedupe.
  const parseList = (raw: string): string[] =>
    Array.from(
      new Set(
        raw
          .split(/[\s,]+/)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
    );
  const oauthAllowedEmails = parseList((formData.get("oauthAllowedEmails") as string) ?? "")
    .filter((s) => s.includes("@"));
  const oauthAllowedDomains = parseList((formData.get("oauthAllowedDomains") as string) ?? "")
    .map((s) => s.replace(/^@/, ""));

  await updateConfig({
    ...current,
    auth: {
      googleClientId,
      googleClientSecret,
      githubClientId,
      githubClientSecret,
      oauthAllowedEmails,
      oauthAllowedDomains,
    },
  });

  auditLog({ action: "settings.update", userId: user.id, detail: "oauth providers" });
  revalidatePath("/admin/settings/auth");
  redirect("/admin/settings/auth?toast=saved");
}
