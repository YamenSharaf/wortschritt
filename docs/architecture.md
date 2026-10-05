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
- Progress: `attempts` (one row per answered item) → aggregated in
  `services/progress.ts`. Completed runs, resumable in-progress positions and
  cheat-sheet views live in `exercise_runs`, `exercise_progress` and
  `sheet_views` (`services/activity.ts`, `routes/activity.ts`).
- Vocab & flashcards: `vocab`, `vocab_groups`, `vocab_group_members`,
  `vocab_stats` (`services/vocab.ts`). Grammatical forms come from the offline
  dictionary at read time; the AI fills the rest (e.g. the Perfekt auxiliary)
  into `vocab.forms`.
- Notes: `notes` table (`services/notes.ts`), Markdown, auto-saved.
- Offline dictionary: TSVs in `packages/api/assets/` (built by the scripts in
  `packages/api/scripts/`) are loaded by `db/dictSeed.ts` and queried via
  `services/dict.ts` → `/api/dict/:word` (tap-to-gloss).
- Pronunciation: `routes/tts.ts` proxies the Piper sidecar (`TTS_URL`) and
  caches clips; unset → the browser's speech synthesis.
- Settings: single JSON row (`services/settings.ts`).
- Auth: single shared password (`APP_PASSWORD`) → signed cookie
  (`auth/session.ts`). All routes except `/api/config`, `/api/health`,
  `/api/auth/*` require it.
- Schema: versioned migrations, see below.

## API surface

See the README for the grouped list; `/api/docs` has the full typed spec. The
AI endpoints:

```
GET  /api/assistant/status
POST /api/assistant/ask            (SSE stream; task-based — see below)
POST /api/assistant/grade          (JSON verdict for a free-text answer)
POST /api/assistant/generate       (validated new items; never persisted)
POST /api/assistant/word           (vocab lookup: translation, examples, forms)
POST /api/assistant/cleanup-notes  (tidy a note into clean Markdown)
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
`translate_sheet`, plus `chat` (multi-turn), grading, generation, vocab word
lookup and note cleanup.

**AI grading**: text answers are graded locally first (`gradeText`); only on a
miss, and only when the tutor is configured and the `llmGrading` setting is on,
`/api/assistant/grade` judges the answer against `accept` (which then serves as
model answers). This is what makes free-completion sets (e.g.
`content/exercises/infinitiv-zu-frei.json`) work.

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
| `TTS_URL` | Piper sidecar base URL (e.g. `http://piper:5000`) | unset → browser voice |

## Database migrations

`packages/api/src/db/migrations.ts` holds an ordered list of migrations; the
applied version is SQLite's `PRAGMA user_version`. On boot (`ensureSchema` in
`db/client.ts`) every pending migration runs in its own transaction together
with the version bump, so a failure leaves the database at the previous
version. Before migrating a non-empty database the runner writes a consistent
backup with `VACUUM INTO` (`<db>.bak-<timestamp>-v<from>`, newest 5 kept). A
database newer than the app makes it refuse to start.

Migration 1 (`baseline`) is the pre-versioning schema, written idempotently so
existing databases (version 0) and fresh ones converge.

To change the schema:

1. Append `{ version: <last + 1>, name, up(db) }`. Never edit or reorder a
   migration that has shipped.
2. Update `db/schema.ts` (the Drizzle types) to match.
3. Changing a primary key means rebuilding the table inside `up`: create the
   new table, copy rows, drop the old one, rename.
4. Cover it in `db/migrations.test.ts` with a database in the previous shape
   and real-looking rows; `pnpm test` runs it in CI.

## Planned: multi-user

Agreed design, to be built in phases (0 = the migration runner above, done):

| Topic | Decision |
| --- | --- |
| Users | A few people, internet-facing (via Cloudflare Tunnel) |
| Admin | User #1 is `ADMIN_USERNAME` with the current `APP_PASSWORD`; all existing data and settings become theirs |
| Onboarding | Self-registration (users set their own password), off by default; the admin enables it and it auto-closes after 24 h. Rate-limited |
| Auth | `scrypt` password hashes, a revocable sessions table, login rate limiting |
| Content | Exercises and cheat sheets stay a shared library. Imports record their owner; only the owner or admin may overwrite or delete one, and only admin may shadow a git content id |
| Per user | Vocab, groups, flashcard stats, notes, attempts, runs, in-progress position, sheet views, settings |
| AI | Per-user endpoint + key. `https://` only, connections to private/loopback/link-local IPs refused (checked on the resolved address), generic errors to the client, capped timeouts and sizes. Keys encrypted at rest with `ENCRYPTION_KEY`, never returned to the browser. The current `ASSISTANT_*` env becomes the admin's settings |
| Instance (admin) | Branding, TTS, registration switch |

Phases: 1 users + auth + rate limiting · 2 per-user data, Users screen,
registration · 3 per-user AI settings and instance settings.

## Theming

Light/dark is a `.dark` class on `<html>`; accent themes are a `data-accent`
attribute selecting a `--accent` / `--accent-foreground` CSS-variable pair
(defined in `packages/web/src/index.css`, listed in `lib/themes.ts`). Primary/
active UI uses `bg-accent` / `text-accent-foreground` / `text-accent`. Both are
saved per-browser in localStorage and applied pre-paint by an inline script in
`index.html`. Managed by `lib/theme.tsx`; pickers in the navbar and Settings.

## Build & deploy

Production runs the API via `tsx` and serves `packages/web/dist` statically. The
Dockerfile builds a multi-arch image (and `piper/Dockerfile` the TTS sidecar); CI (`.github/workflows/docker-publish.yml`)
pushes to GHCR on `main`/tags and then calls Komodo `CheckStackForUpdate` to
auto-update the deployment. Self-host with `docker-compose.prod.yml`.
