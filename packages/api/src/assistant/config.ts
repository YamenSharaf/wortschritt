import { and, asc, eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type {
  AiSettingsView,
  SaveAiModelsBody,
  SaveAiProviderBody,
} from "@mdb/shared";
import { db, schema } from "../db/client";
import { env, hasLegacyAssistantEnv } from "../env";
import { checkAiUrl } from "./egress";
import { decryptSecret, encryptSecret, isEncryptionAvailable } from "./secrets";

/**
 * Each user has AI providers (an OpenAI-compatible base URL + one encrypted
 * key) and an ordered list of provider + model entries. Requests try the
 * entries in order (see client.ts), so "try A, then B" is just the order.
 */

/** One usable entry, key decrypted — for server-side calls only. */
export interface AiConfig {
  entryId: number;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string | null;
}

/** The user's entries in order, or null when none is usable. Entries whose
 *  key can't be decrypted any more are skipped. */
export function getAiChain(userId: number): AiConfig[] | null {
  const rows = db
    .select({
      entryId: schema.aiModels.id,
      model: schema.aiModels.model,
      provider: schema.aiProviders.name,
      baseUrl: schema.aiProviders.baseUrl,
      apiKeyEnc: schema.aiProviders.apiKeyEnc,
    })
    .from(schema.aiModels)
    .innerJoin(schema.aiProviders, eq(schema.aiProviders.id, schema.aiModels.providerId))
    .where(eq(schema.aiModels.userId, userId))
    .orderBy(asc(schema.aiModels.position))
    .all();
  const chain: AiConfig[] = [];
  for (const r of rows) {
    const apiKey = r.apiKeyEnc ? decryptSecret(r.apiKeyEnc) : null;
    if (r.apiKeyEnc && apiKey === null) continue;
    chain.push({ entryId: r.entryId, provider: r.provider, baseUrl: r.baseUrl, model: r.model, apiKey });
  }
  return chain.length ? chain : null;
}

/** What the settings page shows — never a key. */
export function getAiSettingsView(userId: number): AiSettingsView {
  const providers = db
    .select()
    .from(schema.aiProviders)
    .where(eq(schema.aiProviders.userId, userId))
    .orderBy(asc(schema.aiProviders.id))
    .all()
    .map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      hasKey: Boolean(p.apiKeyEnc),
      keyUnreadable: Boolean(p.apiKeyEnc && decryptSecret(p.apiKeyEnc) === null),
    }));
  const models = db
    .select({
      id: schema.aiModels.id,
      providerId: schema.aiModels.providerId,
      model: schema.aiModels.model,
    })
    .from(schema.aiModels)
    .where(eq(schema.aiModels.userId, userId))
    .orderBy(asc(schema.aiModels.position))
    .all();
  return { encryptionAvailable: isEncryptionAvailable, providers, models };
}

function ownProvider(userId: number, id: number) {
  return db
    .select()
    .from(schema.aiProviders)
    .where(and(eq(schema.aiProviders.id, id), eq(schema.aiProviders.userId, userId)))
    .get();
}

/** The provider with its key decrypted (for listing models), if it's the user's. */
export function getProviderConfig(userId: number, id: number) {
  const p = ownProvider(userId, id);
  if (!p) return null;
  const apiKey = p.apiKeyEnc ? decryptSecret(p.apiKeyEnc) : null;
  return { name: p.name, baseUrl: p.baseUrl, apiKey, keyUnreadable: Boolean(p.apiKeyEnc) && apiKey === null };
}

/**
 * Create (id undefined) or update a provider. `apiKey`: a string replaces the
 * stored key, null removes it, undefined keeps it. Returns false if `id`
 * isn't the user's. Throws EgressError for a disallowed URL.
 */
export function saveAiProvider(userId: number, body: SaveAiProviderBody, id?: number): boolean {
  const baseUrl = checkAiUrl(body.baseUrl);
  const existing = id === undefined ? undefined : ownProvider(userId, id);
  if (id !== undefined && !existing) return false;
  let apiKeyEnc = existing?.apiKeyEnc ?? null;
  if (body.apiKey === null) apiKeyEnc = null;
  else if (typeof body.apiKey === "string") apiKeyEnc = encryptSecret(body.apiKey);
  const values = { name: body.name, baseUrl, apiKeyEnc };
  if (existing) {
    db.update(schema.aiProviders).set(values).where(eq(schema.aiProviders.id, existing.id)).run();
  } else {
    db.insert(schema.aiProviders).values({ userId, ...values }).run();
  }
  return true;
}

/** Removes the provider and its model entries. */
export function deleteAiProvider(userId: number, id: number): void {
  db.delete(schema.aiProviders)
    .where(and(eq(schema.aiProviders.id, id), eq(schema.aiProviders.userId, userId)))
    .run();
}

/** Replace the ordered model list. Returns false if a provider isn't the user's. */
export function saveAiModels(userId: number, body: SaveAiModelsBody): boolean {
  if (!body.models.every((m) => ownProvider(userId, m.providerId))) return false;
  db.transaction((tx) => {
    tx.delete(schema.aiModels).where(eq(schema.aiModels.userId, userId)).run();
    body.models.forEach((m, position) => {
      tx.insert(schema.aiModels)
        .values({ userId, providerId: m.providerId, model: m.model, position })
        .run();
    });
  });
  return true;
}

/** Turn the tutor off: remove all providers and models. */
export function deleteAllAiSettings(userId: number): void {
  db.delete(schema.aiProviders).where(eq(schema.aiProviders.userId, userId)).run();
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

  const hasAny = db
    .select({ id: schema.aiProviders.id })
    .from(schema.aiProviders)
    .where(eq(schema.aiProviders.userId, admin.id))
    .get();
  if (!hasAny) {
    let baseUrl = env.ASSISTANT_BASE_URL.replace(/\/$/, "");
    try {
      baseUrl = checkAiUrl(baseUrl);
    } catch (err) {
      // Keep it so the admin sees and fixes it in Settings → Connections.
      log.warn({ baseUrl, reason: (err as Error).message }, "seeded AI URL isn't allowed");
    }
    const provider = db
      .insert(schema.aiProviders)
      .values({
        userId: admin.id,
        name: "My endpoint",
        baseUrl,
        apiKeyEnc: env.ASSISTANT_API_KEY ? encryptSecret(env.ASSISTANT_API_KEY) : null,
      })
      .returning({ id: schema.aiProviders.id })
      .get();
    db.insert(schema.aiModels)
      .values({ userId: admin.id, providerId: provider.id, model: env.ASSISTANT_MODEL, position: 0 })
      .run();
    log.info({ username: admin.username }, "copied ASSISTANT_* env into the admin's AI settings");
  }
  db.insert(schema.appSettings).values({ key: SEEDED_KEY, value: "1" }).run();
}
