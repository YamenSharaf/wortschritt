# Architecture (for agents & contributors)

A small multi-user, self-hosted German-learning app. Core principle: **features are
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
- Progress: `attempts` (one row per answered item, with the response and how
  it was graded: `auto`, `ai`, `self` for flashcards, or `ungraded` for an open
  answer nobody could judge — those count for the daily goal, not accuracy) →
  aggregated in `services/progress.ts`. Completed runs, resumable in-progress positions and
  cheat-sheet views live in `exercise_runs`, `exercise_progress` and
  `sheet_views` (`services/activity.ts`, `routes/activity.ts`).
- History (`services/history.ts`, `routes/history.ts`, MCP `get_mistakes` /
  `get_activity` / `get_set_history`): read from those logs plus `vocab`,
  `vocab_reviews` and `notes`. Mistakes are grouped per item, "resolved" once
  the latest graded attempt is correct, and come with the item as it is in the
  current content (null if it's gone). Notes and sheet views keep only their
  latest edit / view.
- Days ("answered today", the activity timeline) are counted in the
  server-wide time zone (`services/timezone.ts`; admin → Settings → Users,
  stored in `app_settings`; default `TZ` or UTC).
- Vocab & flashcards: `vocab`, `vocab_groups`, `vocab_group_members`,
  `vocab_stats` (running tally), `vocab_reviews` (one row per flashcard
  answer) (`services/vocab.ts`). Grammatical forms come from the offline
  dictionary at read time; the AI fills the rest (e.g. the Perfekt auxiliary)
  into `vocab.forms`.
- Notes: `notes` table (`services/notes.ts`), Markdown, auto-saved.
- Stories: `stories` table (`services/stories.ts`, `routes/stories.ts`),
  private per user; `data` is a validated `story` (Markdown body, glossary,
  questions as exercise items — `checkItems` gives them the exercise-set
  checks). Reader: `pages/StoryReader.tsx`, full screen (App drops its
  header and tab bar on `/stories/:id`). `reader.layout` "pages" lays the
  text out in CSS columns inside a clipped box and translates it per page
  (edge taps, swipes, arrow keys; the questions follow on an end page);
  "scroll" uses the reader's own scroll container. Both keep an anchor (the
  paragraph at the top of the screen) across re-flows and mode switches;
  progress is the furthest page / scroll position. Its settings are
  `settings.reader` (per account). Paragraphs (blank-line blocks) are the
  read-aloud units (`speakSequence` in `lib/tts.ts`). Saved words are
  underlined with the CSS Custom Highlight API (no DOM changes), matching base
  forms via `POST /api/dict/lemmas`. Question answers are attempts/runs with
  set id `story:<id>`, so history and `get_mistakes` include them.
- Series (`services/series.ts`, `routes/series.ts`, `pages/SeriesPage.tsx`):
  a book is a `series` row (validated `series`: metadata, Markdown story
  bible, outline) and its chapters are ordinary stories with `series_id`,
  `chapter` and a continuity `summary` (unique per series and number), so
  the reader, translations, questions and history work per chapter. Chapter
  ids are derived (`chapterStoryId`: "<series>-01"); chapters may be saved
  in any order and gaps show as planned (outline) chapters. Deleting a
  series deletes its chapters in the service (SQLite can't add the composite
  FK). Book progress counts finished chapters fully and others by scroll
  position. Writing is for agents only (MCP `get_series` returns the
  continuity bundle; `get_authoring_guide` kind "series" explains the
  workflow); the web UI reads.
- EPUB export (`services/epub.ts`): `GET /api/stories/:id/epub` and
  `/api/series/:id/epub` (written chapters only) build an EPUB 3 (+ EPUB 2
  NCX) in memory with fflate: title page, nav, one XHTML file per chapter
  marked `xml:lang="de"`, and the glossary as a `<dl>` after each chapter —
  no translations or questions. Markdown goes through markdown-to-jsx's
  `compiler` + React's `renderToStaticMarkup` (well-formed XHTML; images
  and heading ids dropped). The book id is derived from the learner and
  item, so re-exports replace the book on a device. Output was checked with
  W3C EPUBCheck 5.1 (0 errors/warnings); tests check the container rules.
- Covers (`@mdb/shared` cover.ts, `services/covers.ts`, `routes/covers.ts`, `components/Bookshelf.tsx`):
  an SVG illustration per story/chapter or series, in a `cover` column (not in the
  content JSON, so re-saving a text keeps it). `checkCoverSvg` allowlists filters plus
  shapes, text and gradients (no scripts, styles, images, links or outside
  `href`/`url()`); covers are served from `GET …/:id/cover.svg` with a
  sandboxing CSP and shown as `<img>`. Without art, `fallbackCover` draws one
  from the title. Set via `PUT …/:id/cover` (the book page uploads an SVG file for the book and each chapter) or MCP `set_cover`
  (`get_authoring_guide` kind "cover"). EPUBs get the cover as a PNG
  (resvg; generic font families are mapped to the DejaVu fonts the Docker
  image installs) plus drawn chapter art at each chapter's start. On the
  Stories page books show as a grid of covers, or as a list.
- Story translations (`services/storyTranslations.ts`): English lines per
  paragraph, one per sentence as `splitSentences` (`@mdb/shared` reading.ts,
  shared with the reader) cuts it, or one line for the whole paragraph when
  the AI's count doesn't match. Stored in `story_translations`, keyed by a
  hash of the paragraph's text (an edit prunes changed paragraphs; FK
  cascades on story and user delete). The reader (setting
  `reader.translations`: off / peek / always) loads stored lines, then asks
  the AI for paragraphs as they scroll into view, a few per request. English
  lines carry `data-translation` (skipped by read-aloud and saved-word
  underlines) and `data-no-tap`. Agents can provide lines via MCP
  `save_story_translations` (`get_story` lists the sentences).
- Story generation (`services/storyGen.ts`, prompt `buildStoryMessages` in
  `assistant/prompts.ts`): `POST /api/stories/generate` streams SSE progress
  (a long story can outlast a proxy's idle timeout) and saves the result.
  `buildStoryContext` picks what the learner opted into — unresolved
  mistakes (task, right answer, their answer), saved words (weakest
  flashcards first), recent set titles — and is also the preview
  (`GET /api/story-context`) and the MCP tool `get_story_context`, so what
  is shown is what is sent. The server sets id (free slug of the title) and
  level; invalid JSON gets one repair round with the exact problems, and if
  only the questions are still broken the story is kept without them.
- Offline dictionary: TSVs in `packages/api/assets/` (built by the scripts in
  `packages/api/scripts/`) are loaded by `db/dictSeed.ts` and queried via
  `services/dict.ts` → `/api/dict/:word` (tap-to-gloss).
- Online dictionary (`services/wiktionary.ts`): `/api/dict/:word/details`
  asks freedictionaryapi.com (Wiktionary, CC BY-SA — the popup credits it)
  for the offline base form, follows one "form of" hop, trims the answer and
  caches it in `dict_cache` (hits forever, misses a week, errors never). It
  goes through the egress guard with a timeout and size cap; any failure
  just leaves the offline gloss. `DICTIONARY_API_URL=off` disables it. MCP:
  `lookup_word`.
- Pronunciation / read-aloud: `routes/tts.ts` + `tts/providers.ts`. A voice
  id names its provider: Azure Speech neural voices (`azure:de-DE-KatjaNeural`; the admin stores region + key in
  Settings → Users, key encrypted like AI keys, called through the egress
  guard), or the unofficial Edge "Read aloud" endpoint (`edge:…`, admin
  opt-in, `tts/edge.ts` WebSocket protocol as in edge-tts). Cloud voices are
  limited to `NEURAL_VOICES` (`@mdb/shared`). Clips are cached on disk by
  voice + text; no server voice → the browser's speech synthesis.
- Settings: single JSON row (`services/settings.ts`).
- Auth: `users` + `sessions` tables (`auth/`). Login checks a scrypt hash
  (`auth/password.ts`) and creates a server-side session; the cookie holds a
  random token, the database only its SHA-256. `requireAuth` (`auth/session.ts`)
  401s without a valid session and sets `req.user`. All routes except
  `/api/health`, `/api/version`, `/api/auth/*` require it. The first boot after
  the `users` table exists creates the admin from `ADMIN_USERNAME` /
  `APP_PASSWORD` (`auth/users.ts`).
- Users: learner tables carry `user_id` (FK to `users`, `ON DELETE CASCADE`);
  every service function takes the `userId` first and every query filters on
  it, so routes pass `req.user!.id`. Content (`content/`, `imported_content`)
  is a shared library: imports record `created_by`, only their importer or an
  admin may overwrite them, and only an admin may reuse a built-in id
  (`routes/import.ts`).
- Admin: `requireAdmin` guards `/api/admin/*` (users list, enable/disable,
  role, temporary password, delete; registration window) and voice downloads.
  The last active admin can't be demoted, disabled or deleted.
- Registration: closed by default; the admin opens it for 24 h
  (`services/registration.ts`, stored in `app_settings`), after which
  `/api/auth/register` refuses until reopened. Rate-limited to 5/h per IP.
- API tokens (`auth/tokens.ts`): `Authorization: Bearer mdb_…`, stored as
  SHA-256, ≤10 per user. `authenticate()` in `auth/session.ts` accepts a token
  (no fallback to the cookie if the header is present but wrong) or the
  session cookie, so every `requireAuth` / `requireAdmin` route works for both.
  `requireSession` (cookie only) guards token management and the password
  change. `/api/docs` (UI and spec) is behind `requireAuth`.
- Model quirks (`assistant/client.ts`): when a provider answers 400 naming
  `temperature` (e.g. recent Claude models, where it's deprecated) or
  `max_tokens` (OpenAI reasoning models want `max_completion_tokens`), the
  request is retried with that parameter dropped / renamed, and the fix is
  remembered per endpoint + model until restart. Other 400s aren't retried.
- MCP (`routes/mcp.ts`, `mcp/server.ts`): `POST /mcp`, Streamable HTTP in
  stateless JSON mode. Accepts an OAuth access token or an API token, never
  the cookie; a 401 carries `WWW-Authenticate: Bearer resource_metadata=…`,
  which starts a client's OAuth sign-in. Each request builds
  a fresh `McpServer` bound to the token's user; tools call the same services
  as the routes (`services/library.ts` holds the import ownership rules for
  both). Adding a feature that agents should use = a service function + a
  route + a tool there, with a test in `mcp/mcp.test.ts`.
- OAuth (`auth/oauth.ts`, `routes/oauth.ts`): the app is its own authorization
  server per the MCP authorization spec. Clients register via DCR
  (`/oauth/register`) or a Client ID Metadata Document (an https `client_id`,
  fetched through the egress guard and cached 24 h). `/oauth/authorize` is a
  SPA page (`pages/OAuthConsent.tsx`): sign-in (`/login?next=`), then
  Allow/Deny via `/api/oauth/authorize` (session only), which re-validates the
  request and returns the redirect. Codes: 10 min, single use, PKCE S256, exact
  redirect_uri. Two scopes, one resource each: `mcp` (resource `/mcp`, the
  default) and `app` (resource `/api`, for the native app; its redirect is a
  reverse-DNS private-use scheme such as `eu.yamen.wortschritt:/oauth/callback`,
  RFC 8252). Tokens: `mdbo_at_…` (1 h, valid only on their resource — an
  `app` token works with `authenticate()` on the REST API, an `mcp` one only
  on `/mcp`) and `mdbo_rt_…` (30 days, rotated on each refresh); one
  `oauth_grants` row per approval, which Settings → Connected apps lists and
  deletes. Disabling or deleting the user ends access. The issuer is
  `PUBLIC_URL` or the request's forwarded origin. All responses send
  `X-Frame-Options: DENY` so the consent page can't be framed.
- Native app (`routes/native.ts`, registered on the root instance): CORS on
  `/api/*` for the app's built-in origins (`APP_ORIGINS`, default
  `capacitor://localhost`, `https://localhost`, `http://localhost`), bearer
  tokens only (never `allow-credentials`); public `GET /api/version`
  (`{ api, minClient, appName }`) for the app's compatibility check. See
  issue #2 for the app itself.
- Sync for the native app (`services/sync.ts`, `routes/sync.ts`, migration 14):
  SQLite triggers on a learner's tables (stories, translations, series,
  vocab + stats + group members, groups, notes, settings) append
  `(user_id, kind, item_id)` to `sync_log`, so every write path counts.
  `GET /api/sync/changes?since=<seq>&library=<version>` returns the current
  state of each item changed since the cursor (or its id under `deleted`),
  a book whenever one of its chapters changed, and the whole shared library
  when its hash differs; no `since` (or one older than the pruned horizon,
  90 days) gives a full snapshot. Pages of 1000 items (`more`).
  `POST /api/sync/push` replays offline actions (answers, runs, sheet views,
  reading progress — max-merged — vocab, notes) once per `opId`
  (`sync_ops`, 30 days); a note edited on two devices keeps both (conflict
  copy). `sync_log` holds ids only and has no FK (triggers fire while a
  user's rows cascade away); `pruneSync` drops deleted users' entries.
- Brute-force protection: password routes are limited per client IP
  (`@fastify/rate-limit`, 10/min, keyed on `CF-Connecting-IP` when present) and
  per username (10 failures / 15 min lock that name, `auth/loginGuard.ts`).
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
4. **LLM guide** — add a valid example to `EXAMPLE_ITEMS` (and a rule line to
   `ITEM_RULES`) in `packages/shared/src/authoring.ts`. That one guide feeds both
   the Import page's "Copy LLM prompt" and the tutor's "generate more", and
   `content/content.test.ts` checks every example against the schemas.

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

**Per-user providers and fallback.** Each user adds **OpenAI-compatible**
providers (base URL + one key; presets for OpenRouter and OpenAI) and an ordered
list of provider + model entries under Settings → AI tutor (`ai_providers` /
`ai_models`, `assistant/config.ts`); without one, their tutor UI stays hidden.
Every request tries the entries in order (`streamCompletion` in
`assistant/client.ts`): if one fails before any text arrives, the next is tried
and the fallback is logged; once text has started there is no switch. "Load
models" reads the provider's `GET /models` (OpenRouter's names, prices and
pagination included). Keys are
encrypted at rest with AES-256-GCM under a key derived from `ENCRYPTION_KEY`
(`assistant/secrets.ts`), are write-only in the API and never reach the browser.
On first boot the legacy `ASSISTANT_*` env config is copied once into the first
admin's settings.

**Every upstream AI request goes through `assistant/client.ts`**
(`streamCompletion` / `collectCompletion`), which uses the egress guard in
`assistant/egress.ts`: `https://` only, no credentials in the URL, no
redirects, and connections only to public IPs — enforced in the socket's DNS
lookup, so hostnames that resolve privately (or re-resolve) are refused. It also
applies a timeout and a response-size cap. Errors reach the user only as
`AiRequestError.publicMessage` (e.g. "The AI provider answered 401."); details
go to the server log. Never call `fetch` on a user-supplied URL directly.

## Configuration (env vars)

`packages/api/src/env.ts` validates these (empty strings are treated as unset):

| Var | Purpose | Default |
| --- | --- | --- |
| `APP_PASSWORD` | initial password of the admin account (required; only read when the first user is created) | — |
| `ADMIN_USERNAME` | username of that admin account | admin |
| `SESSION_SECRET` | cookie signing key (required, ≥8) | — |
| `PORT` / `DATABASE_PATH` / `CONTENT_DIR` | runtime paths | 3000 / ./data/app.db / ./content |
| `ENCRYPTION_KEY` | encrypts users' saved AI keys (≥32 chars, e.g. `openssl rand -base64 32`; keep a copy — if it changes, saved keys must be re-entered) | unset → AI keys can't be saved |
| `ASSISTANT_BASE_URL` / `ASSISTANT_API_KEY` / `ASSISTANT_MODEL` | legacy single-user AI config; copied once into the admin's AI settings, then unused | OpenAI defaults |

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

Agreed design, built in phases (0 = the migration runner above; 1 = accounts,
sessions and rate limiting; 2 = per-user data, Users screen and registration;
3 = per-user AI settings — see Data flow → Auth / Users and The AI tutor).
The name and icon are fixed (`APP_NAME` in `@mdb/shared`, `brand/`).

| Topic | Decision |
| --- | --- |
| Users | A few people, internet-facing (via Cloudflare Tunnel) |
| Admin | User #1 is `ADMIN_USERNAME` with the current `APP_PASSWORD`; all existing data and settings become theirs |
| Onboarding | Self-registration (users set their own password), off by default; the admin enables it and it auto-closes after 24 h. Rate-limited |
| Auth | `scrypt` password hashes, a revocable sessions table, login rate limiting |
| Content | Exercises and cheat sheets stay a shared library. Imports record their owner; only the owner or admin may overwrite or delete one, and only admin may shadow a git content id |
| Per user | Vocab, groups, flashcard stats, notes, attempts, runs, in-progress position, sheet views, settings |
| AI | Per-user endpoint + key. `https://` only, connections to private/loopback/link-local IPs refused (checked on the resolved address), generic errors to the client, capped timeouts and sizes. Keys encrypted at rest with `ENCRYPTION_KEY`, never returned to the browser. The current `ASSISTANT_*` env becomes the admin's settings |
| Instance (admin) | Registration switch, time zone, read-aloud providers (Azure key, Edge on/off) |

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
Dockerfile builds a multi-arch image; CI (`.github/workflows/docker-publish.yml`)
pushes to GHCR on `main`/tags and then calls Komodo `CheckStackForUpdate` to
auto-update the deployment. Self-host with `docker-compose.prod.yml`.
