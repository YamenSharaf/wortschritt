import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { env } from "../env";

/**
 * AES-256-GCM for secrets at rest (users' AI API keys). The cipher key is
 * derived from ENCRYPTION_KEY, so the database alone never reveals a key.
 * Format: `v1.<iv>.<tag>.<ciphertext>` (base64url).
 */
const key = env.ENCRYPTION_KEY
  ? Buffer.from(hkdfSync("sha256", env.ENCRYPTION_KEY, "mit-dem-baby", "ai-api-keys-v1", 32))
  : null;

export const isEncryptionAvailable = key !== null;

export function encryptSecret(plain: string): string {
  if (!key) throw new Error("ENCRYPTION_KEY is not set");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const b64 = (b: Buffer) => b.toString("base64url");
  return `v1.${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(ct)}`;
}

/** The plaintext, or null when it can't be decrypted (no/changed key). */
export function decryptSecret(stored: string): string | null {
  if (!key) return null;
  const [v, iv, tag, ct] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !ct) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
