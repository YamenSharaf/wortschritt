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

### Option A — homelab, from the published image (recommended)

A GitHub Actions pipeline (`.github/workflows/docker-publish.yml`) builds a
multi-arch image (`linux/amd64` + `linux/arm64`) and publishes it to the GitHub
Container Registry on every push to `main` and every `v*` tag. To run it you
only need `docker-compose.prod.yml` and a `.env` — no repo checkout, no build:

```bash
# On your homelab host, in an empty directory:
curl -O https://raw.githubusercontent.com/YamenSharaf/mit-dem-baby/main/docker-compose.prod.yml
cat > .env <<'EOF'
APP_PASSWORD=your-strong-password
SESSION_SECRET=some-long-random-string
EOF

docker compose -f docker-compose.prod.yml up -d
```

Open http://your-host:3000. Update to a newer image later with:

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
cp .env.example .env        # set a real APP_PASSWORD and SESSION_SECRET
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
