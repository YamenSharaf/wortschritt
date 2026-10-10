# Wortschritt

<img src="brand/wortschritt-icon-rounded.svg" alt="" width="96" />

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
| Packaging  | One Docker image (API serves the built SPA)        |

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
  shared library. The admin manages accounts under Administration → Users (account menu) and can open
  self-registration for 24 hours at a time.
- **Tap-to-gloss** — tap a German word for an instant translation from a bundled
  offline dictionary (see `packages/api/assets/ATTRIBUTION.md`), then fuller
  definitions, pronunciation and examples from
  [Wiktionary](https://en.wiktionary.org) (CC BY-SA, via
  [freedictionaryapi.com](https://freedictionaryapi.com); cached;
  `DICTIONARY_API_URL=off` to stay offline).
- **Stories** — private reading texts in a full-screen reader that turns pages
  like a book (or scrolls), with fonts, size, spacing, width, sepia/dark,
  read-aloud, saved words underlined and an optional true full screen, and
  comprehension questions, plus English line by line (off, blurred until
  tapped, or always shown). Generate one from a sentence with your AI tutor,
  optionally keeping your recent mistakes, the words you're learning and
  recent topics in mind. **Books** (series) group stories as chapters, with
  book-level progress, "Continue reading" and "Next chapter"; they're written
  by AI agents over MCP (a story bible, an outline, and per-chapter summaries
  keep sub-agents consistent). Stories and books download as **EPUB** for
  e-readers (German text, table of contents, each chapter's word list).
- **AI tutor (optional)** — explain a highlighted passage, hints, "why was I
  wrong", translations, chat, AI grading of free-text answers, "generate more"
  items, vocab lookups, and tidying rough notes into clean Markdown. Each user
  connects their own OpenAI-compatible providers (e.g. OpenRouter) under
  Settings → Connections and orders models for fallback (https, publicly
  reachable); keys are stored encrypted (`ENCRYPTION_KEY`).
- **Pronunciation & read-aloud** — 🔊 buttons and the reader's read-aloud, with
  Azure Speech or Edge neural voices (set up by the admin), falling back to the
  browser's voice.
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
curl -O https://raw.githubusercontent.com/YamenSharaf/Wortschritt/main/docker-compose.prod.yml
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

Neural German voices come from **Azure Speech** (free tier; the admin enters a
key + region under Administration → Server) or the unofficial **Edge "Read aloud"**
endpoint (admin opt-in). The app proxies and caches clips; with neither set up
it falls back to the browser's built-in voice.

## Android app

An Android app (`packages/app`, React Native with Expo) talks to your server.
It works offline (the data syncs, also in the background now and then) and
has the reader with page turning by volume keys, practice, cheat sheets,
vocab with flashcards, notes and read-aloud.

**Install with [Obtainium](https://github.com/ImranR98/Obtainium)** (keeps it updated):

1. In Obtainium, *Add app* with `https://github.com/YamenSharaf/wortschritt`.
2. Turn on *Include prereleases* (each build of `main` is a prerelease,
   `app-<run>`), then *Add*, and install. If the repository is private,
   give Obtainium a GitHub token (its settings, GitHub source) that can
   read it.

Or download the APK from the newest `app-…` release and install it (allow
installing from your browser or file manager when Android asks).

**Connect**: enter your server's address (`https://wort.example.com`; for a
server on your own network over http, turn on *Allow http*), then sign in
in the browser tab that opens, and allow the app. The server must be
reachable from the phone; the app uses OAuth, no extra server settings.

Every build is signed with the same key, so each one installs over the
last. Builds and signing: [docs/architecture.md](docs/architecture.md#the-android-app-packagesapp).

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

## API surface

The full, typed spec is at `/api/docs` (OpenAPI UI and `/api/docs/json`; needs
a sign-in or a token). Everything except `/api/health`, `/api/version` and the
login/registration routes requires authentication.

### Using the API from scripts

Create a personal token under **Settings → Connections → API tokens** (shown once),
then send it as a Bearer token:

```bash
curl -H "Authorization: Bearer mdb_…" https://your-host/api/notes
curl -H "Authorization: Bearer mdb_…" -H "content-type: application/json" \
     -d '{"word":"Baum","translation":"tree"}' https://your-host/api/vocab
```

A token acts as its user (same private data, same role), except that it can't
manage tokens or change the password. Revoking it, or disabling/deleting the
user, stops it immediately.

### MCP server (AI agents)

The app is also an MCP server at `/mcp` (Streamable HTTP, stateless). Add it as
a custom connector in Claude (or any MCP client) with the URL
`https://your-host/mcp`. Two ways to sign in:

- **OAuth (no setup):** the client opens the app's sign-in page, the user
  allows access, and the browser returns to the client. Each user connects as
  themselves; **Settings → Connections → Connected apps** lists and disconnects
  them. The app is its own authorization server (discovery under
  `/.well-known/`, Dynamic Client Registration and Client ID Metadata
  Documents, PKCE S256, 1 h access tokens that only work on `/mcp`, rotating
  30-day refresh tokens). Changing your password disconnects them all. Set `PUBLIC_URL` if the issuer URL can't be derived
  from the request's `Host` / `X-Forwarded-Proto`.
- **API token:** clients that take a header instead send
  `Authorization: Bearer mdb_…`.

Either way the connection acts as that user. Tools cover everything above that
a learner does:

| Area | Tools |
|------|-------|
| Library (shared) | `list_exercise_sets`, `get_exercise_set`, `list_cheatsheets`, `get_cheatsheet`, `get_authoring_guide`, `validate_content`, `save_exercise_set`, `save_cheatsheet`, `delete_content` |
| Vocabulary (private) | `list_vocab`, `get_vocab`, `save_vocab`, `delete_vocab`, `list_vocab_groups`, `create_vocab_group`, `delete_vocab_group`, `add_words_to_group`, `remove_word_from_group` |
| Notes (private) | `list_notes`, `get_note`, `create_note`, `update_note`, `delete_note` |
| Books (private) | `list_series`, `get_series` (bible, outline, chapter summaries, end of the latest chapter), `save_series`, `save_chapter`, `delete_series` |
| Stories (private) | `list_stories`, `get_story`, `save_story`, `delete_story`, `get_story_context`, `save_story_translations` (+ `validate_content` / `get_authoring_guide` with kind `story`) |
| History (private) | `get_progress`, `get_mistakes`, `get_activity`, `get_set_history` |
| Other | `lookup_word`, `whoami` |

Agents get the content format the app enforces: the server's instructions point
them to `get_authoring_guide` (the same guide as Import's "Copy LLM prompt"),
the save tools take the real schemas as input schemas, `validate_content` is a
dry run that lists every problem by path, and saving never replaces an existing
id unless asked (`overwrite: true`). Only an item's importer or an admin can
replace or delete it; built-in items can't be deleted.

```
Auth        POST /api/auth/login | /api/auth/logout | /api/auth/password
            GET  /api/auth/me    GET /api/auth/registration
            GET|POST /api/auth/tokens   DELETE /api/auth/tokens/:id  (session only)
            POST /api/auth/register      (only while registration is open)
Admin       GET  /api/admin/users        PATCH|DELETE /api/admin/users/:id
            POST /api/admin/users/:id/password
            GET|PUT /api/admin/registration   GET|PUT /api/admin/timezone
Public      GET  /api/health  /api/version
MCP         POST /mcp            (OAuth or API token; see above)
OAuth       GET  /.well-known/oauth-protected-resource[/mcp]  /.well-known/oauth-authorization-server
            POST /oauth/register  /oauth/token  /oauth/revoke   (page: /oauth/authorize)
            GET|POST /api/oauth/authorize   GET /api/oauth/grants   DELETE /api/oauth/grants/:id
Content     GET  /api/exercises[/:id]  /api/cheatsheets[/:id]  /api/exercise-types
            POST /api/import   GET /api/imports   DELETE /api/imports/:id
Progress    POST /api/answers (server grades)             GET /api/progress
            POST /api/runs { setId, done }  GET /api/runs[/:setId]
            GET|PUT|DELETE /api/exercise-progress/:setId
            POST /api/exercises/:id/generate  GET|DELETE /api/exercises/:id/generated
            POST /api/sheet-views GET /api/sheet-views
History     GET  /api/history/mistakes  /api/history/activity  /api/history/sets/:setId
Settings    GET|PUT /api/settings
Vocab       GET|POST /api/vocab    GET|DELETE /api/vocab/:word
            POST|DELETE /api/vocab/:word/study
            GET|POST /api/vocab-groups    DELETE /api/vocab-groups/:id
            POST /api/vocab-groups/:id/words
            DELETE /api/vocab-groups/:id/words/:word
Notes       GET|POST /api/notes    GET|PUT|DELETE /api/notes/:id
Stories     GET|POST /api/stories  GET|PUT|DELETE /api/stories/:id
            PUT /api/stories/:id/progress   POST|DELETE /api/stories/:id/read
            GET /api/story-context   GET /api/stories/:id/epub
            GET|POST|PUT /api/stories/:id/translations  (read / translate with AI / provide)
Series      GET|POST /api/series   GET|DELETE /api/series/:id   PUT /api/series/:id/chapters/:n
            GET /api/series/:id/epub
            POST /api/stories/generate (SSE: progress, then the new story's id)
Dictionary  GET /api/dict/status   GET /api/dict/:word[/details]   POST /api/dict/lemmas
TTS         GET /api/tts/status    GET /api/tts    POST /api/tts/download
Assistant   GET /api/assistant/status
            POST /api/assistant/ask (SSE) | word | cleanup-notes | test
            GET|DELETE /api/assistant/settings   PUT /api/assistant/models (fallback order)
            POST /api/assistant/providers   PUT|DELETE /api/assistant/providers/:id
            GET  /api/assistant/providers/:id/models     (keys are write-only)
```

## License

MIT, see [LICENSE](LICENSE). Bundled fonts and dictionary data keep their own licences (see [packages/api/assets/ATTRIBUTION.md](packages/api/assets/ATTRIBUTION.md) and the font folders).
