/**
 * AES-256-GCM encryption helpers for sensitive config values (e.g. AI API keys).
 *
 * Requires AI_ENCRYPTION_KEY env var: a 64-character lowercase hex string (32 bytes).
 * Generate one with:  openssl rand -hex 32
 *
 * Stored format:  "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 * If AI_ENCRYPTION_KEY is not set, values are stored/returned as plaintext
 * with a server-side warning (CMS remains functional, just without encryption).
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const ENCRYPTED_PATTERN = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;

function getKey(): Buffer | null {
  const hex = process.env.AI_ENCRYPTION_KEY;
  if (!hex) return null;
  if (hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) {
    console.warn(
      "[Pugmill] AI_ENCRYPTION_KEY must be a 64-character hex string. " +
      "Generate one with: openssl rand -hex 32"
    );
    return null;
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypt a plaintext string. Returns the ciphertext in "<iv>:<authTag>:<ciphertext>" hex format.
 * Returns the original string unchanged if AI_ENCRYPTION_KEY is not set.
 */
export function encryptString(plain: string): string {
  const key = getKey();
  if (!key) {
    // In production, refuse to persist a secret in plaintext — fail closed so a
    // missing/invalid AI_ENCRYPTION_KEY is a loud configuration error rather than
    // a silent at-rest exposure. Local dev keeps the plaintext convenience path.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AI_ENCRYPTION_KEY is not set (or not a 64-char hex string). It is required to store secrets. " +
        "Generate one with: openssl rand -hex 32",
      );
    }
    console.warn("[Pugmill] AI_ENCRYPTION_KEY not set — storing secret as plaintext (dev only).");
    return plain;
  }

  const iv = randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/**
 * Decrypt a ciphertext produced by encryptString.
 * If the value is not in the expected encrypted format (e.g. a legacy plaintext key),
 * it is returned as-is to allow seamless migration.
 */
export function decryptString(value: string): string {
  if (!value) return value;

  // Not in encrypted format — treat as plaintext (migration path)
  if (!ENCRYPTED_PATTERN.test(value)) return value;

  const key = getKey();
  if (!key) {
    // Key not configured but value looks encrypted — we can't decrypt
    console.error("[Pugmill] AI_ENCRYPTION_KEY is required to decrypt the stored API key.");
    return "";
  }

  const parts = value.split(":");
  if (parts.length !== 3) return value;

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}
