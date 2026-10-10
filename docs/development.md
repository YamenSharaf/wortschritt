# Developing Wortschritt

The tech stack, where things are, how to run it locally, and how the data is
kept. App structure in depth: [architecture.md](architecture.md). The API and
MCP server: [api.md](api.md).

## Stack

| Layer      | Choice                                             |
| ---------- | -------------------------------------------------- |
| Monorepo   | pnpm workspaces                                    |
| API        | Fastify + Zod (auto-generated OpenAPI at `/api/docs`) |
| DB         | SQLite via Drizzle ORM (single file)               |
| Web        | Vite + React + Tailwind (SPA)                       |
| Auth       | Username + password (scrypt) → server-side sessions, rate-limited |
| Packaging  | One Docker image (API serves the built SPA)        |

The API is the product; the web app is just its first client. Because routes
are defined with Zod, the OpenAPI spec is generated for free — a future mobile
client can codegen a typed client against it.

## Project layout

```
packages/
  shared/   Zod schemas + inferred types (the shared contract)
  api/      Fastify server, Drizzle/SQLite, content loader, auth, MCP server
  client/   API client, offline store and sync, React hooks (used by web and app)
  web/      React SPA (dashboard, cheat sheets, exercise player, reader, import, settings)
  app/      Android app (React Native + Expo)
content/    Git-versioned JSON content (built-in exercises and cheat sheets)
docs/       Architecture, self-hosting, API, authoring, design system
```

## Local development

Requires Node 20+ and pnpm 9+ (`corepack enable`).

```bash
pnpm install
cp .env.example .env        # then edit ADMIN_USERNAME, APP_PASSWORD and SESSION_SECRET

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
pnpm test           # run the test suites
pnpm build          # build the web SPA
```

## Features vs. content

- **Features (code):** exercise *types* are Zod schemas in
  `packages/shared/src/exercises.ts` — `multiple_choice`, `cloze`, `flashcard`,
  `sentence_build`, `transform`, `true_false`, `conjugation_table` — plus one
  renderer each in `packages/web/src/components/ExerciseItemView.tsx`. Adding a
  new interactive type = add a schema + a renderer. That's the only real coding.
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

## Data model

All tables live in one SQLite file (`DATABASE_PATH`). Learner data is per
user (a `user_id` column, deleted together with the user); content is shared.

| Table | Holds |
| --- | --- |
| `users` / `sessions` | accounts (scrypt hashes, role, disabled) and server-side sessions |
| `api_tokens` | personal API tokens (SHA-256 only) |
| `oauth_clients`, `oauth_codes`, `oauth_grants` | MCP sign-ins: registered apps, one-time codes, granted access (SHA-256 only) |
| `app_settings` | instance-wide settings, e.g. when self-registration closes |
| `settings` | per user: display name, CEFR level, daily goal, AI grading on/off, "generate more" batch size |
| `attempts` | one row per answered item: right/wrong, what was answered, how it was graded (the log progress and history are derived from) |
| `exercise_runs` | one row per completed pass through an exercise set |
| `exercise_progress` | resumable position + answers for an unfinished set |
| `sheet_views` | last-viewed time per cheat sheet |
| `vocab` | saved words with cached translation, examples and AI-filled forms |
| `vocab_groups` / `vocab_group_members` | named word groups (many-to-many) |
| `vocab_stats` | flashcard know/don't-know tally per word |
| `vocab_reviews` | one row per flashcard answer |
| `notes` | Markdown notes |
| `stories` | private reading texts (validated JSON) with reading progress |
| `dict_cache` | online dictionary (Wiktionary) lookups, shared |
| `series` | books: metadata, story bible and outline (chapters are `stories` rows with `series_id`, `chapter`, `summary`) |
| `story_translations` | English lines per story paragraph (per user, keyed by the paragraph's text) |
| `ai_providers` / `ai_models` | per user: AI providers (encrypted keys) and the model fallback order |
| `imported_content` | shared exercises and cheat sheets added via the Import screen, with who imported them |

The schema is versioned: on boot the API applies any pending migrations from
`packages/api/src/db/migrations.ts`, after first writing a backup next to the
database (`app.db.bak-<timestamp>-v<old version>`, newest 5 kept). To roll back
a bad upgrade, stop the app, copy that backup over `app.db` (and delete
`app.db-wal` / `app.db-shm`), and run the previous image. An app older than the
database refuses to start rather than misread it.
