import { eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { AiSettingsView, SaveAiSettingsBody } from "@mdb/shared";
import { db, schema } from "../db/client";
import { env, hasLegacyAssistantEnv } from "../env";
import { checkAiUrl } from "./egress";
import { decryptSecret, encryptSecret, isEncryptionAvailable } from "./secrets";

/** A user's usable AI endpoint (key decrypted), for server-side calls only. */
export interface AiConfig {
  baseUrl: string;
  model: string;
  apiKey: string | null;
}

function row(userId: number) {
  return db.select().from(schema.aiSettings).where(eq(schema.aiSettings.userId, userId)).get();
}

/** The user's AI config, or null if they haven't set one up (or its key can't
 *  be decrypted any more — then they need to re-enter it). */
export function getAiConfig(userId: number): AiConfig | null {
  const r = row(userId);
  if (!r) return null;
  let apiKey: string | null = null;
  if (r.apiKeyEnc) {
    apiKey = decryptSecret(r.apiKeyEnc);
    if (apiKey === null) return null;
  }
  return { baseUrl: r.baseUrl, model: r.model, apiKey };
}

/** What the settings page shows — never the key itself. */
export function getAiSettingsView(userId: number): AiSettingsView {
  const r = row(userId);
  const keyUnreadable = Boolean(r?.apiKeyEnc && decryptSecret(r.apiKeyEnc) === null);
  return {
    encryptionAvailable: isEncryptionAvailable,
    configured: Boolean(r) && !keyUnreadable,
    baseUrl: r?.baseUrl ?? "",
    model: r?.model ?? "",
    hasKey: Boolean(r?.apiKeyEnc),
    keyUnreadable,
  };
}

/**
 * Save the user's endpoint. `apiKey`: a string replaces the stored key, null
 * removes it, undefined keeps it. Throws EgressError for a disallowed URL.
 */
export function saveAiSettings(userId: number, body: SaveAiSettingsBody): AiSettingsView {
  const baseUrl = checkAiUrl(body.baseUrl);
  const existing = row(userId);
  let apiKeyEnc = existing?.apiKeyEnc ?? null;
  if (body.apiKey === null) apiKeyEnc = null;
  else if (typeof body.apiKey === "string") apiKeyEnc = encryptSecret(body.apiKey.trim());

  const values = { baseUrl, model: body.model.trim(), apiKeyEnc };
  db.insert(schema.aiSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({
      target: schema.aiSettings.userId,
      set: { ...values, updatedAt: Math.floor(Date.now() / 1000) },
    })
    .run();
  return getAiSettingsView(userId);
}

export function deleteAiSettings(userId: number): void {
  db.delete(schema.aiSettings).where(eq(schema.aiSettings.userId, userId)).run();
}

const SEEDED_KEY = "ai_env_seeded";

/**
 * One-time upgrade path from the single-user env config: copy ASSISTANT_* into
 * the first admin's AI settings so their tutor keeps working. Marked done in
 * app_settings, so removing those settings later doesn't bring them back.
 */
export function seedAdminAiFromEnv(log: FastifyBaseLogger): void {
  if (!hasLegacyAssistantEnv) return;
  const done = db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, SEEDED_KEY))
    .get();
  if (done) return;
  if (env.ASSISTANT_API_KEY && !isEncryptionAvailable) {
    log.warn("ASSISTANT_API_KEY is set but ENCRYPTION_KEY isn't: not copying it into the admin's AI settings yet");
    return;
  }
  const admin = db
    .select({ id: schema.users.id, username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.role, "admin"))
    .orderBy(schema.users.id)
    .get();
  if (!admin) return;

  if (!row(admin.id)) {
    let baseUrl = env.ASSISTANT_BASE_URL.replace(/\/$/, "");
    try {
      baseUrl = checkAiUrl(baseUrl);
    } catch (err) {
      // Keep it so the admin sees and fixes it in Settings → AI tutor.
      log.warn({ baseUrl, reason: (err as Error).message }, "seeded AI URL isn't allowed");
    }
    db.insert(schema.aiSettings)
      .values({
        userId: admin.id,
        baseUrl,
        model: env.ASSISTANT_MODEL,
        apiKeyEnc: env.ASSISTANT_API_KEY ? encryptSecret(env.ASSISTANT_API_KEY) : null,
      })
      .run();
    log.info({ username: admin.username }, "copied ASSISTANT_* env into the admin's AI settings");
  }
  db.insert(schema.appSettings).values({ key: SEEDED_KEY, value: "1" }).run();
}
