import { z } from "zod";

const envSchema = z.object({
  APP_PASSWORD: z.string().min(1, "APP_PASSWORD must be set"),
  SESSION_SECRET: z.string().min(8, "SESSION_SECRET must be at least 8 chars"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().default("./data/app.db"),
  CONTENT_DIR: z.string().default("./content"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Optional AI tutor. OpenAI-compatible endpoint (OpenAI, Ollama, LM Studio,
  // OpenRouter, vLLM, …). Leave unset to disable the feature entirely.
  ASSISTANT_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  ASSISTANT_API_KEY: z.string().default(""),
  ASSISTANT_MODEL: z.string().default("gpt-4o-mini"),
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

// The tutor is enabled once you point it somewhere: either a key (hosted APIs)
// or a non-default base URL (local models that need no key).
export const isAssistantEnabled =
  env.ASSISTANT_API_KEY.length > 0 ||
  env.ASSISTANT_BASE_URL !== "https://api.openai.com/v1";
