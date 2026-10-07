import { z } from "zod";

/**
 * Treat empty strings as "unset" so a schema's default applies. docker-compose
 * turns an absent `.env` var into an empty string (e.g. `FOO: ${FOO}`), which
 * would otherwise fail validation (an empty URL) and crash the container.
 */
const optionalEnv = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema);

const envSchema = z.object({
  // Initial password of the admin account, used only when the first user is
  // created (see auth/users.ts). Change it in the app afterwards.
  APP_PASSWORD: z.string().min(1, "APP_PASSWORD must be set"),
  // Username of that first admin account.
  ADMIN_USERNAME: optionalEnv(
    z
      .string()
      .regex(/^[a-zA-Z0-9_.-]{2,32}$/, "ADMIN_USERNAME: 2-32 of a-z, 0-9, _ . -")
      .default("admin"),
  ),
  SESSION_SECRET: z.string().min(8, "SESSION_SECRET must be at least 8 chars"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().default("./data/app.db"),
  CONTENT_DIR: z.string().default("./content"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Branding — shown in the header/title and used as the favicon.
  APP_NAME: optionalEnv(z.string().min(1).default("mit dem baby")),
  APP_EMOJI: optionalEnv(z.string().min(1).default("🍼")),

  // Encrypts the API keys users save for their AI tutor (Settings → AI tutor).
  // Generate with `openssl rand -base64 32` and keep a copy: if it's lost or
  // changed, saved AI keys can't be decrypted and must be re-entered. Unset =
  // users can't save AI settings.
  ENCRYPTION_KEY: optionalEnv(
    z.string().min(32, "ENCRYPTION_KEY must be at least 32 characters").optional(),
  ),

  // Legacy single-user AI tutor config. Only read once, to seed the admin's
  // per-user AI settings on first boot (see assistant/config.ts).
  ASSISTANT_BASE_URL: optionalEnv(
    z.string().url().default("https://api.openai.com/v1"),
  ),
  ASSISTANT_API_KEY: optionalEnv(z.string().default("")),
  ASSISTANT_MODEL: optionalEnv(z.string().min(1).default("gpt-4o-mini")),

  // Optional Piper TTS sidecar (base URL, e.g. http://piper:5000). Unset =
  // pronunciation falls back to the browser's built-in speech synthesis.
  TTS_URL: optionalEnv(z.string().url().optional()),

  // The app's public URL (e.g. https://deutsch.example.com), used as the OAuth
  // issuer for MCP connectors. Unset = taken from the request's Host and
  // X-Forwarded-Proto headers (fine behind a Cloudflare tunnel).
  PUBLIC_URL: optionalEnv(z.string().url().optional()),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";

// Whether the legacy env config was set: either a key (hosted APIs) or a
// non-default base URL (local models that need no key).
export const hasLegacyAssistantEnv =
  env.ASSISTANT_API_KEY.length > 0 ||
  env.ASSISTANT_BASE_URL !== "https://api.openai.com/v1";

export const isTtsEnabled = Boolean(env.TTS_URL);
