import { z } from "zod";

const envSchema = z.object({
  APP_PASSWORD: z.string().min(1, "APP_PASSWORD must be set"),
  SESSION_SECRET: z.string().min(8, "SESSION_SECRET must be at least 8 chars"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().default("./data/app.db"),
  CONTENT_DIR: z.string().default("./content"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
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
