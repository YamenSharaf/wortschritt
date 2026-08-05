# mit dem baby 🍼

A self-hosted, single-user German learning app. Cheat sheets (non-interactive
reference) + exercises (interactive drills), with a clean separation between
**features** (code) and **content** (data) so you can add material with an LLM
without touching the codebase.

## Stack

| Layer      | Choice                                             |
| ---------- | -------------------------------------------------- |
| Monorepo   | pnpm workspaces                                    |
| API        | Fastify + Zod (auto-generated OpenAPI at `/api/docs`) |
| DB         | SQLite via Drizzle ORM (single file)               |
| Web        | Vite + React + Tailwind (SPA)                       |
| Auth       | Single password → signed session cookie            |
| Packaging  | One Docker image (API serves the built SPA)        |

The API is the product; the web app is just its first client. Because routes
are defined with Zod, the OpenAPI spec is generated for free — a future mobile
client can codegen a typed client against it.

## Features vs. content

- **Features (code):** exercise *types* are Zod schemas in
  `packages/shared/src/exercises.ts` (`multiple_choice`, `fill_in_blank`,
  `flashcard`, `sentence_order`) plus one renderer each in
  `packages/web/src/components/ExerciseItemView.tsx`. Adding a new interactive
  type = add a schema + a renderer. That's the only real coding.
- **Content (data):** everything else is JSON validated against those schemas.
  Two sources, merged by id at request time:
  1. **Git-versioned JSON** in `content/exercises/*.json` and
     `content/cheatsheets/*.json`.
  2. **Runtime imports** via the in-app **Import** screen (stored in SQLite).

### Authoring content with an LLM

Open the **Import** page, choose a kind, and click **LLM-Prompt kopieren** to
copy a ready-made prompt describing the exact JSON schema. Paste it into any
LLM, paste the JSON back, and it's validated (client- and server-side) before
being saved. Malformed content is rejected — never stored.

## Project layout

```
packages/
  shared/   Zod schemas + inferred types (the shared contract)
  api/      Fastify server, Drizzle/SQLite, content loader, auth
  web/      React SPA (dashboard, cheat sheets, exercise player, import, settings)
content/    Git-versioned JSON content
```

## Local development

Requires Node 20+ and pnpm 9+ (`corepack enable`).

```bash
pnpm install
cp .env.example .env        # then edit APP_PASSWORD and SESSION_SECRET

# Run API (:3000) and web dev server (:5173) together.
pnpm dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` to the Fastify
server. API docs live at http://localhost:3000/api/docs.

Useful scripts:

```bash
pnpm dev:api        # API only
pnpm dev:web        # web only
pnpm typecheck      # type-check every package
pnpm build          # build the web SPA
```

## Self-hosting with Docker

```bash
cp .env.example .env        # set a real APP_PASSWORD and SESSION_SECRET
docker compose up -d --build
```

Then open http://localhost:3000. The SQLite database persists in `./data`
(mounted volume) and `./content` is mounted read-only so you can edit
git-versioned content without rebuilding.

Backups are trivial — copy `data/app.db`.

## Data model

- `settings` — single JSON row (display name, CEFR level, daily goal, theme).
- `attempts` — one row per answered item; progress stats are derived from it.
- `imported_content` — content added at runtime via the Import screen.

Schema is created on boot (`CREATE TABLE IF NOT EXISTS`). `drizzle-kit` is wired
up (`pnpm --filter @mdb/api db:generate`) for when you want versioned migrations.

## API surface

```
POST /api/auth/login | logout        GET /api/auth/me
GET  /api/exercises  | /:id          GET /api/exercise-types
GET  /api/cheatsheets| /:id
POST /api/attempts                   GET /api/progress
GET  /api/settings   PUT /api/settings
POST /api/import
GET  /api/health     GET /api/docs   (OpenAPI UI)
```
