# Architecture (for agents & contributors)

A single-user, self-hosted German-learning app. Core principle: **features are
code, content is data.** Coded exercise *types* + renderers; everything else is
JSON validated against Zod schemas.

## Monorepo layout

```
packages/
  shared/   Zod schemas + inferred types + grading. The shared contract.
  api/      Fastify server (TS via tsx), Drizzle + SQLite, content loader, auth,
            AI proxy. Also serves the built SPA in production.
  web/      Vite + React + Tailwind SPA. One client of the API.
content/    Git-versioned JSON content (exercises + cheatsheets).
docs/       This documentation.
```

Package names: `@mdb/shared`, `@mdb/api`, `@mdb/web`. Root scripts: `pnpm dev`
(api :3000 + web :5173), `pnpm typecheck`, `pnpm build` (web).

## Data flow

- Content: `content/*.json` (git) **+** `imported_content` (SQLite, via the
  Import screen) → validated by `@mdb/shared` schemas in
  `packages/api/src/content/loader.ts` → served by `routes/content.ts`.
- Progress: `attempts` table (one row per answered item) → aggregated in
  `services/progress.ts`.
- Settings: single JSON row (`services/settings.ts`).
- Auth: single shared password (`APP_PASSWORD`) → signed cookie
  (`auth/session.ts`). All routes except `/api/config`, `/api/health`,
  `/api/auth/*` require it.

## API surface (selected)

```
GET  /api/config                       branding {appName, appEmoji}  (public)
POST /api/auth/login|logout  GET /api/auth/me
GET  /api/exercises|/:id  GET /api/exercise-types
GET  /api/cheatsheets|/:id
POST /api/attempts        GET /api/progress
GET  /api/settings        PUT /api/settings
POST /api/import
GET  /api/assistant/status
POST /api/assistant/ask       (SSE stream; task-based — see below)
POST /api/assistant/grade     (JSON verdict)
POST /api/assistant/generate  (validated new items)
GET  /api/docs                (OpenAPI UI)
```

## Adding a new exercise type

This is the one place a new *feature* is coded. Steps:

1. **Schema** — add a Zod object to the discriminated union in
   `packages/shared/src/exercises.ts` (with `type: z.literal("your_type")`), add
   it to `exerciseItem` and `EXERCISE_TYPES`. Add any cross-field checks to
   `exerciseSet`'s `superRefine`.
2. **Renderer** — add a `case "your_type"` + component in
   `packages/web/src/components/ExerciseItemView.tsx`. It receives the item and
   calls `onAnswered(correct, response?)`.
3. **Describe** — add a branch to `packages/web/src/lib/describeItem.ts` so the
   tutor (hint/translate/why-wrong) and generation get a readable label +
   expected answers. **Never put the answer in `label`** — it's used for
   translate, which must not reveal the solution.
4. **Generation** — add the JSON shape to `ITEM_SCHEMA_REF` in
   `packages/api/src/assistant/prompts.ts` so "generate more" can produce it.

Grading for text answers lives in `packages/shared/src/grading.ts` (`gradeText`,
lenient by default) — reuse it, don't reinvent.

## The AI tutor (prompt registry)

All tutor system prompts live in **one registry**:
`packages/api/src/assistant/prompts.ts`. Every task inherits a shared preamble
(explain in English, keep German in German, be concise, level-aware, light
Markdown allowed). Tasks: `highlight`, `hint`, `why_wrong`, `translate_exercise`,
`translate_sheet`, plus `chat` (multi-turn) and generation.

**To add an AI button**: add a task to `buildMessages` (or a builder like
`buildChatSystem`), thread it through `routes/assistant.ts` (`/ask` streams via
SSE; `/grade` and `/generate` return JSON), add a client call in
`packages/web/src/lib/api.ts`, and a button. That's the whole pattern.

The server proxies an **OpenAI-compatible** endpoint; the API key never reaches
the browser. Enabled when `ASSISTANT_API_KEY` is set or `ASSISTANT_BASE_URL` is
non-default (local models).

## Configuration (env vars)

`packages/api/src/env.ts` validates these (empty strings are treated as unset):

| Var | Purpose | Default |
| --- | --- | --- |
| `APP_PASSWORD` | login password (required) | — |
| `SESSION_SECRET` | cookie signing key (required, ≥8) | — |
| `PORT` / `DATABASE_PATH` / `CONTENT_DIR` | runtime paths | 3000 / ./data/app.db / ./content |
| `APP_NAME` / `APP_EMOJI` | branding + favicon | mit dem baby / 🍼 |
| `ASSISTANT_BASE_URL` / `ASSISTANT_API_KEY` / `ASSISTANT_MODEL` | AI tutor | OpenAI defaults |

## Theming

Light/dark is a `.dark` class on `<html>`; accent themes are a `data-accent`
attribute selecting a `--accent` / `--accent-foreground` CSS-variable pair
(defined in `packages/web/src/index.css`, listed in `lib/themes.ts`). Primary/
active UI uses `bg-accent` / `text-accent-foreground` / `text-accent`. Both are
saved per-browser in localStorage and applied pre-paint by an inline script in
`index.html`. Managed by `lib/theme.tsx`; pickers in the navbar and Settings.

## Build & deploy

Production runs the API via `tsx` and serves `packages/web/dist` statically. The
Dockerfile builds a multi-arch image; CI (`.github/workflows/docker-publish.yml`)
pushes to GHCR on `main`/tags and then calls Komodo `CheckStackForUpdate` to
auto-update the deployment. Self-host with `docker-compose.prod.yml`.
