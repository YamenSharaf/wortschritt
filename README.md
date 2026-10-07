# mit dem baby 🍼

A self-hosted German learning app for a few people. Cheat sheets (non-interactive
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
| Auth       | Username + password (scrypt) → server-side sessions, rate-limited |
| Packaging  | One Docker image (API serves the built SPA) + optional Piper TTS sidecar |

The API is the product; the web app is just its first client. Because routes
are defined with Zod, the OpenAPI spec is generated for free — a future mobile
client can codegen a typed client against it.

## What's in the app

- **Cheat sheets** — non-interactive grammar reference, with optional
  AI translation.
- **Exercises** — interactive drills with resumable runs and per-set history.
- **Vocab** — saved words with translations, examples and grammatical forms
  (article/plural, Partizip II, Perfekt auxiliary), organized into groups.
- **Flashcards** — built from a vocab group, with a know/don't-know score kept
  per word.
- **Notes** — free-form, categorized Markdown notes, auto-saved.
- **Accounts** — a few people can share one instance: each has their own
  vocab, notes, progress and settings, while exercises and cheat sheets are a
  shared library. The admin manages accounts under Settings → Users and can open
  self-registration for 24 hours at a time.
- **Tap-to-gloss** — tap a German word for an instant translation from a bundled
  offline dictionary (see `packages/api/assets/ATTRIBUTION.md`).
- **AI tutor (optional)** — explain a highlighted passage, hints, "why was I
  wrong", translations, chat, AI grading of free-text answers, "generate more"
  items, vocab lookups, and tidying rough notes into clean Markdown. Each user
  connects their own OpenAI-compatible providers (e.g. OpenRouter) under
  Settings → AI tutor and orders models for fallback (https, publicly
  reachable); keys are stored encrypted (`ENCRYPTION_KEY`).
- **Pronunciation (optional)** — 🔊 buttons backed by a Piper TTS sidecar, falling
  back to the browser's voice.
- **Dashboard** — progress, recent activity and a daily goal.

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

## Docs (for humans & agents)

- [AGENTS.md](AGENTS.md) — orientation for AI agents.
- [docs/authoring-content.md](docs/authoring-content.md) — generate exercises & cheat sheets.
- [docs/architecture.md](docs/architecture.md) — app structure, adding features, deploy.

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

## Self-hosting with Docker

### Option A — homelab, from the published image (recommended)

A GitHub Actions pipeline (`.github/workflows/docker-publish.yml`) builds a
multi-arch image (`linux/amd64` + `linux/arm64`) and publishes it to the GitHub
Container Registry on every push to `main` and every `v*` tag. To run it you
only need `docker-compose.prod.yml` and a `.env` — no repo checkout, no build:

```bash
# On your homelab host, in an empty directory:
curl -O https://raw.githubusercontent.com/YamenSharaf/mit-dem-baby/main/docker-compose.prod.yml
cat > .env <<'EOF'
ADMIN_USERNAME=your-name
APP_PASSWORD=your-strong-password
SESSION_SECRET=some-long-random-string
# Encrypts users' AI keys. `openssl rand -base64 32`; keep a copy.
ENCRYPTION_KEY=...
EOF

docker compose -f docker-compose.prod.yml up -d
```

Open http://your-host:3000 and log in as `ADMIN_USERNAME` with `APP_PASSWORD`
(both are only used to create that first account; change the password under
Settings → Account). Behind a Cloudflare Tunnel, login rate limits key on the
`CF-Connecting-IP` header, so each visitor is limited separately.

Update to a newer image later with:

```bash
docker compose -f docker-compose.prod.yml pull && \
docker compose -f docker-compose.prod.yml up -d
```

Image tags: `latest` (default branch), `vX.Y.Z` / `vX.Y` (git tags), the branch
name, and a short commit sha. Pin to a version tag in `docker-compose.prod.yml`
if you'd rather not track `latest`.

> First publish: the GHCR package defaults to private. Either make it public
> (repo → Packages → the image → Package settings → Change visibility), or
> `docker login ghcr.io` on the host with a token that has `read:packages`.
> Cutting a release is just a tag: `git tag v0.1.0 && git push origin v0.1.0`.

### Option B — build from source

```bash
cp .env.example .env        # set ADMIN_USERNAME, a real APP_PASSWORD and SESSION_SECRET
docker compose up -d --build
```

Both options serve on port 3000. The SQLite database persists in `./data`
(mounted volume). In the build-from-source compose, `./content` is also mounted
read-only so you can edit git-versioned content without rebuilding; from the
published image, content is baked in (uncomment the mount to override it).

Backups are trivial — copy `data/app.db`.

### Pronunciation (optional)

Both compose files include a **Piper** TTS sidecar for neural German
pronunciation (the 🔊 buttons on words and examples). It's internal-only (no
published port); the app proxies to it and caches clips. A few German voices
ship in the image; download more from **Settings → Pronunciation**. To turn it
off, drop the `piper` service and set `TTS_URL=` (empty) — the app then falls
back to the browser's built-in voice.

## Data model

All tables live in one SQLite file (`DATABASE_PATH`). Learner data is per
user (a `user_id` column, deleted together with the user); content is shared.

| Table | Holds |
| --- | --- |
| `users` / `sessions` | accounts (scrypt hashes, role, disabled) and server-side sessions |
| `app_settings` | instance-wide settings, e.g. when self-registration closes |
| `settings` | per user: display name, CEFR level, daily goal, theme, AI grading on/off, "generate more" batch size |
| `attempts` | one row per answered item (the event log progress is derived from) |
| `exercise_runs` | one row per completed pass through an exercise set |
| `exercise_progress` | resumable position + answers for an unfinished set |
| `sheet_views` | last-viewed time per cheat sheet |
| `vocab` | saved words with cached translation, examples and AI-filled forms |
| `vocab_groups` / `vocab_group_members` | named word groups (many-to-many) |
| `vocab_stats` | flashcard know/don't-know tally per word |
| `notes` | Markdown notes |
| `ai_providers` / `ai_models` | per user: AI providers (encrypted keys) and the model fallback order |
| `imported_content` | shared exercises and cheat sheets added via the Import screen, with who imported them |

The schema is versioned: on boot the API applies any pending migrations from
`packages/api/src/db/migrations.ts`, after first writing a backup next to the
database (`app.db.bak-<timestamp>-v<old version>`, newest 5 kept). To roll back
a bad upgrade, stop the app, copy that backup over `app.db` (and delete
`app.db-wal` / `app.db-shm`), and run the previous image. An app older than the
database refuses to start rather than misread it.

## API surface

The full, typed spec is at `/api/docs` (OpenAPI UI). Everything except
`/api/config`, `/api/health` and `/api/auth/*` requires the session cookie.

```
Auth        POST /api/auth/login | /api/auth/logout | /api/auth/password
            GET  /api/auth/me    GET /api/auth/registration
            POST /api/auth/register      (only while registration is open)
Admin       GET  /api/admin/users        PATCH|DELETE /api/admin/users/:id
            POST /api/admin/users/:id/password
            GET|PUT /api/admin/registration
Public      GET  /api/config  /api/health  /api/docs
Content     GET  /api/exercises[/:id]  /api/cheatsheets[/:id]  /api/exercise-types
            POST /api/import
Progress    POST /api/attempts                          GET /api/progress
            POST /api/runs        GET /api/runs[/:setId]
            GET|PUT|DELETE /api/exercise-progress/:setId
            POST /api/sheet-views GET /api/sheet-views
Settings    GET|PUT /api/settings
Vocab       GET|POST /api/vocab    GET|DELETE /api/vocab/:word
            POST|DELETE /api/vocab/:word/study
            GET|POST /api/vocab-groups    DELETE /api/vocab-groups/:id
            POST /api/vocab-groups/:id/words
            DELETE /api/vocab-groups/:id/words/:word
Notes       GET|POST /api/notes    GET|PUT|DELETE /api/notes/:id
Dictionary  GET /api/dict/status   GET /api/dict/:word
TTS         GET /api/tts/status    GET /api/tts    POST /api/tts/download
Assistant   GET /api/assistant/status
            POST /api/assistant/ask (SSE) | grade | generate | word | cleanup-notes | test
            GET|DELETE /api/assistant/settings   PUT /api/assistant/models (fallback order)
            POST /api/assistant/providers   PUT|DELETE /api/assistant/providers/:id
            GET  /api/assistant/providers/:id/models     (keys are write-only)
```
