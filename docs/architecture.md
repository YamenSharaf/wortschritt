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
  client/   What every frontend shares: the API client (endpoints, SSE
            streaming, media URLs), the speech logic, per-device preferences
            and plain helpers (describeItem, formChips, timeAgo). No DOM or
            Node APIs — the platform passes in fetch, auth headers, a device
            voice, a clip player and a key-value store. `@mdb/client/react`
            holds the screens' state as hooks (sign-in, an exercise set, the
            tutor chat, the story reader, vocab and flashcards, notes, story
            generation, …) under a `ClientProvider`; web and app render them
            their own way.
  web/      Vite + React + Tailwind SPA. One client of the API.
  app/      The Android app: Expo (SDK 57) + expo-router, native components.
            Another client of the API, on the same @mdb/client (see below).
content/    Git-versioned JSON content (exercises + cheatsheets).
docs/       This documentation.
```

Package names: `@mdb/shared`, `@mdb/client`, `@mdb/api`, `@mdb/web`, `@mdb/app`.
Root scripts: `pnpm dev` (api :3000 + web :5173), `pnpm dev:app` (Expo),
`pnpm typecheck`, `pnpm build` (web). The monorepo has **one React** (19.2.3,
the version the Expo SDK pins): two in one app break at runtime, so upgrade
React for every package together, with the Expo SDK.

## The Android app (`packages/app`)

Issue #2 is the plan. The app renders natively what `@mdb/client/react`
computes, like the web does with HTML; it keeps no business logic.

- `src/app/` (expo-router): `connect` (the server's address, checked at
  `/api/version`) → `sign-in` → the `(tabs)` sections with the dock, and the
  `account` sheet. Which ones exist follows `useServer().status`
  (`Stack.Protected`).
- `src/lib/server.tsx`: the server, its OAuth endpoints and the sign-in. A
  fresh client registration per sign-in (the server prunes unused ones), the
  browser step with expo-auth-session (PKCE, redirect
  `eu.yamen.wortschritt:/oauth/callback`), tokens in `createTokenSession`
  (expo-secure-store), and `createApi` with `expo/fetch`, the bearer header
  and refresh-on-401. Sign-out revokes the grant and clears the image cache.
- `src/lib/theme.tsx`: `nativeTheme(display, scheme)` from the tokens, with
  this device's choices (`usePreference`) and the OS's reduce-motion; screens
  read colours, radii, elevation, effects and motion from `useTheme()` only.
- `src/ui/`: Text, Button, Card, Screen, the Dock; sections not built yet
  (`Soon`) open the web.
- **Offline-first** (issue #2, phase 2): screens get `createOfflineApi` from
  `@mdb/client` (`src/offline/`), which has `createApi`'s shape, so the
  hooks don't change. The web keeps the plain API.
  - **Store**: an `OfflineStore` (documents by collection and id as the
    change feed sends them, plus the outbox in order). The app uses
    `sqliteOfflineStore` on expo-sqlite (`src/lib/offlineStore.native.ts`);
    the web preview keeps it in memory.
  - **Sync** (`createSync`): push the outbox (`/api/sync/push`, each op once
    by its id), then pull `/api/sync/changes` from the cursor (tombstones,
    full snapshots, the library by version, the server's stats every time).
    One at a time. `SyncProvider` (`src/lib/sync.tsx`) runs it on start,
    when the app comes back to the front, every 10 minutes while open, after
    local changes, and on pull-to-refresh; Home shows its status (synced
    when, offline, changes waiting). While the app is closed,
    `src/lib/backgroundSync.native.ts` (expo-background-task, Android's
    WorkManager, about hourly at best) builds the API from the saved server
    and tokens and runs one sync; it does nothing while the app is open,
    signed out, or before a first sync.
  - **Reads** come from the store once a first sync filled it. **Writes**
    the feed covers (answers, finishing and resuming a set, sheet views,
    reading progress, read / read again, vocab save / remove / study, notes)
    go straight to the server when it's reachable and nothing is queued,
    otherwise they're applied locally and queued. An offline answer gets a
    provisional verdict (`gradeItem` + `withoutTutor`); the server grades it
    again on push. Notes made offline are folded into their queued create;
    edits to one note are merged from the same base (a conflict on the
    server keeps the app's version as a copy). Everything else (the tutor,
    word lookups, history, settings, groups) needs the server.
  - **Whose data**: the store belongs to the signed-in user; signing out or
    changing server clears it (after a last sync), and another account
    starts from a clean store.
  - **Tests**: `packages/api/src/routes/offline.test.ts` runs the layer
    against the real server on SQLite (better-sqlite3 in the shape of
    expo-sqlite); `offlineStore.test.ts` holds both stores to one contract.
  - **pnpm**: `drizzle-orm>expo-sqlite: "-"` (root `package.json`) keeps the
    app's expo-sqlite out of the server's dependencies (an optional peer of
    drizzle-orm); without it the server's Docker image installs React
    Native.
- **Reader** (issue #2, phases 1 and 4): `src/app/reader/[id].tsx`, the
  layout in `src/reader/`. React Native text: a spike tried a Jetpack Compose
  engine side by side and dropped it (slightly nicer text flow, not worth a
  native module).
  - **What it reads**: the same hooks as the web (`useStory`,
    `useReaderSettings` (the account's text settings), `useStoryTranslations`,
    `useReadingProgress`, `useStoryLemmas`, `useVocabState`). `pieces.ts`
    turns a story into what's laid out: the header, each paragraph's German
    and, when English line by line is on, its English (under each sentence
    when sentences and lines match one to one, else under the paragraph;
    "peek" is blurred until tapped, a grey bar on e-ink).
  - **Pages**: each piece's lines are measured off screen (`onTextLayout`)
    and packed into pages; a re-layout (size, font, English lines) keeps the
    first paragraph on the page; it opens at the server's `resumeAt`; after
    the last page comes the end (finished / read again / chapters). Scroll
    is one ScrollView. The web preview has no `onTextLayout`, so pages stay
    blank there (scroll works).
  - **Turning**: the outer quarters (unless "Turn pages by tapping the sides" is off, this device), swipes (a gesture-handler pan, long or
    quick enough), and the volume keys when on (this device: "Turn pages
    with volume keys", "Invert"), all without animation; the middle shows
    or hides the bars, as do the margins above and below the text. Volume keys: a local Expo module
    (`modules/volume-keys`, Android) wraps the window's callback while the
    reader is open with the option on, so the keys turn pages and leave the
    volume alone; everywhere else they're the volume.
  - **Fonts**: Literata, Lato, Atkinson Hyperlegible (expo-google-fonts) and
    Libron (the release's TTFs, unmodified, `assets/fonts/libron`); Android
    picks faces by name, so each font has a regular and a title face
    (`style.ts`). Themes come from `readerPalettes` (sepia isn't offered on
    e-ink, which has greys only).
  - **Screen**: full screen by default (system bars hidden; "Full screen" on
    this device to keep them), the screen kept on, Back closes a sheet first.
  - **Words**: `WordSheet`: the offline dictionary's gloss and Wiktionary at
    once, "Translate" (the AI, with the sentence) and saving to vocab and
    groups. Saved words are underlined (dotted).
  - **Questions**: after the text, a card offers the story's questions
    (`StoryQuiz.tsx`); they open on their own screen
    (`src/app/quiz/[id].tsx`, `useStoryQuiz`), one card at a time as the
    exercises (swipe, Prev / Next, skip any, the score at the end). Going
    on to the next chapter skips them.
  - **Reading aloud** (phase 5): the speaker in the bar reads from the first
    paragraph on screen, marks the one being read and turns the page (or
    scrolls) to follow; speed is in the text settings. `src/lib/speech.ts`
    gives `createSpeech` the phone's voice (expo-speech) and server clips
    (expo-audio) when the account chose a server voice; clips are kept in
    the app's files (`tts/`, newest 600) once heard or fetched ahead, so
    they play offline, and are removed on sign-out. Speak buttons sit on
    the word popup, vocab words and examples, and flashcards. The
    expo-audio plugin is set to ask for no microphone and no background
    playback.
- **Practice** (issue #2, phase 3): the tab lists the sets (recent or A–Z,
  search past three sets, the last run's score); `src/app/practice/[id].tsx`
  runs one with `useExerciseRunner`, as the web's player: the score, a
  question navigator (this run and the last), progress, Prev / Skip / Next,
  moving on by itself after a right answer, and the end (score, "Generate N
  more", remove the extras). `src/practice/ItemView.tsx` renders all seven
  item types (same verdicts and wording as the web's `ExerciseItemView`);
  `TutorHelp.tsx` is the tutor (hint, translate, why was I wrong, follow-up
  questions; it needs the server). Answers given offline get the
  provisional verdict and are queued (see Offline-first).
- **Sheets, Vocab, Notes, Account** (issue #2, phase 3), each as on the web
  with the same hooks:
  - **Sheets**: the list (recent / A–Z, search) and a sheet
    (`src/app/sheet/[id].tsx`): each word tappable (the word popup), each
    section translatable by the tutor. `ui/Markdown.tsx` draws the Markdown
    sheets and notes use (headings, lists, quotes, tables that scroll
    sideways, emphasis, code).
  - **Vocab**: search, groups (tap to filter, long-press to delete), add a
    word (dictionary or AI fill), each word's details, groups, score and
    regenerate; flashcards in `src/app/vocab/study.tsx` (`useFlashcards`).
  - **Notes**: the list (categories, search) and the editor
    (`src/app/note/[id].tsx`): write / preview with tappable words, text
    size, AI clean-up, save as a cheat sheet. `useNoteEditor` also saves an
    unsaved change when the editor closes (leaving right after typing).
  - **Account**: the learning settings (name, level, daily goal, batch
    size, AI grading; saved at once, merged into the latest), appearance on
    this device, Import (`src/app/import.tsx`: paste JSON, checked against
    the schema; "Share LLM prompt" uses the share sheet), and the web's
    settings for the rest (password, AI tutor, voices, connected apps).
- **Motion and feedback** (not on e-ink, nor with the system's reduced
  motion; Reanimated and gesture-handler):
  - Reader pages slide and follow the finger: every page sits at its own
    place in a strip (page n at n × width) and the strip moves, so a
    finished slide needs no jump back; taps and the volume keys slide too.
  - Flashcards and exercises fill the screen between the header and the
    buttons (at thumb height): the flashcard is centred, the question is a
    raised sheet that scrolls inside and swipes anywhere, with Prev / Next
    in a bar at the bottom.
  - Cards: Home leads with a frosted-glass card (`ui/GlassCard.tsx`, its own
    soft colour fields blurred); list cards spring a little when pressed
    (`ui/PressCard.tsx`), carry their section's icon on a tinted tile
    (`ui/IconTile.tsx`) and, in light mode, a faint bright top edge.
    Buttons spring too, and primary ones have a glossy edge, a soft brand
    glow and a light haptic tap. All plain on e-ink.
  - Sheets over the reader (word, text, glossary): the shade fades in place
    and only the panel slides up, and back down on closing.
  - Flashcards (`src/vocab/SwipeCard.tsx`): a frosted-glass card (expo-blur;
    on Android it blurs a `BlurTargetView` of soft colour fields), a 3D flip
    on tap, swipe right for know and left for don't know (it tilts, a stamp
    shows), the buttons fling it.
  - Exercises (`src/practice/QuestionSlide.tsx`): swipe left for the next
    question (skips an unanswered one, as Skip does) and right for the
    previous; questions slide in, pop when right, shake when wrong.
  - `src/lib/feedback.ts`: a chime when right and a soft tone when wrong
    (the app's own sounds, `assets/sounds`, made for it) and haptics
    (expo-haptics). This device's settings (Account → Practice): move on
    after a right answer, sounds, vibration; all on by default.
- **Stories**: books as a shelf of covers or a list (`shelfView`, this
  device) and short stories; `src/app/series/[id].tsx` is a book's page.
  Covers (`ui/Cover.tsx`) are PNGs the server renders from the cover's SVG
  (`cover.png?w=`, 128/256/512 px, cached in memory): Android drew the SVGs
  black and decoded them slowly while scrolling. They load with the bearer
  token through expo-image and stay in its disk cache, so they're there
  offline once seen.
- Run: `pnpm dev:app` (a development build, not Expo Go). A **web preview**
  (`pnpm --filter @mdb/app web`, or `expo export --platform web`) shows the
  screens in a browser; the server must allow its origin
  (`APP_ORIGINS=http://localhost:8081`). `pnpm --filter @mdb/app bundle`
  checks that the Android bundle builds. The server's Docker image leaves the
  app out (`.dockerignore`).
- APK: `.github/workflows/android.yml` builds an installable APK on every push
  to main that touches the app, client or shared (and on demand): `expo
  prebuild` (Continuous Native Generation; `android/` is never committed),
  then a Gradle release build for arm64, re-signed with `apksigner` using
  the app's own key (secrets `ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`; keep the keystore safe,
  losing it means no build can update an installed app) so each build
  installs over the last (the version code is the
  run number, via `app.config.ts`). Download it from the run's Artifacts.
  Builds of main are also published as GitHub pre-releases (tag
  `app-<run>`, version `0.1.<run>`, the newest 10 kept). The app updates
  itself from them (`src/lib/updates.native.ts`: the public releases API,
  the APK downloaded to the cache, Android's installer through
  `expo-intent-launcher` and the `REQUEST_INSTALL_PACKAGES` permission);
  Obtainium can use them too.
  `usesCleartextTraffic` is on so the "Allow http" switch works for a LAN
  server; the app itself refuses http unless that switch is on.

## Data flow

- Content: `content/*.json` (git) **+** `imported_content` (SQLite, via the
  Import screen) → validated by `@mdb/shared` schemas in
  `packages/api/src/content/loader.ts` → served by `routes/content.ts`.
- Answers are graded on the server (`services/answers.ts`): the client sends
  `POST /api/answers { setId, itemId, response }` (an `ItemResponse`), the
  server finds the item (a library set plus the learner's generated items, or
  a story's questions as `story:<id>`), grades it with `gradeItem` from
  `@mdb/shared`, asks the learner's AI tutor about a free-text miss when
  `llmGrading` is on (`assistant/grade.ts`), applies `withoutTutor` otherwise,
  and records it. Clients never send a verdict.
- Progress: `attempts` (one row per answered item, with the response and how
  it was graded: `auto`, `ai`, `self` for flashcards, or `ungraded` for an open
  answer nobody could judge — those count for the daily goal, not accuracy) →
  aggregated in `services/progress.ts`. Each set has one session in
  `exercise_progress` (position, results, which answers are ungraded); every
  graded answer joins it, `PUT /api/exercise-progress` only moves the
  position, and `POST /api/runs { setId, done }` turns the session into an
  `exercise_runs` row scored by the server (graded answers only; once per
  change) and clears it when done. Cheat-sheet views live in `sheet_views`
  (`services/activity.ts`, `routes/activity.ts`).
- Display rules the server decides once for every client: the progress
  summary carries `goalLeft`, `goalPercent`, `accuracy` and `continue` (the
  most recently touched of an unfinished set, resumed, and the last finished
  run's set; a tie goes to the unfinished set); runs carry `kind` (exercise
  or story) and `tier` (good ≥ 80%, ok ≥ 50%, weak); stories and chapters
  carry `minutes` (about 120 words a minute). Thresholds live in
  `services/rules.ts`; clients only render them.
- "Generate more" (`services/generated.ts`): `POST /api/exercises/:id/generate`
  writes items with the learner's tutor (their mistakes in the set first as
  examples), validates them and keeps them in `generated_items` for that
  learner; the shared set never changes. `GET|DELETE
  /api/exercises/:id/generated` lists or removes them (`DELETE
  …/generated/:itemId` just one; `GET /api/exercises/generated-counts` counts
  them per set for the lists); they're graded, synced and listed in mistakes
  like the set's own items.
- History (`services/history.ts`, `routes/history.ts`, MCP `get_mistakes` /
  `get_activity` / `get_set_history`): read from those logs plus `vocab`,
  `vocab_reviews` and `notes`. Mistakes are grouped per item, "resolved" once
  the latest graded attempt is correct, and come with the item as it is in the
  current content (null if it's gone). Notes and sheet views keep only their
  latest edit / view.
- Days ("answered today", the activity timeline) are counted in the
  server-wide time zone (`services/timezone.ts`; Administration → Server,
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
  progress is the furthest page / scroll position. The server owns the read
  rules (`services/stories.ts`): progress only moves forward
  (`PUT /api/stories/:id/progress`), `POST|DELETE /api/stories/:id/read` mark
  read (progress to the end) or "Read again" (unread, back to 0: the only way
  back), finishing a story's questions marks it read, and every story,
  chapter and book comes with a `status` (unread / reading past 2% / read)
  and stories with `resumeAt` (where to reopen, or null for the top).
  `stories.read_state_at` orders read-state changes, so the app's older
  queued actions come back `stale`. Its settings are
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
  Administration → Server, key encrypted like AI keys, called through the egress
  guard), or the unofficial Edge "Read aloud" endpoint (`edge:…`, admin
  opt-in, `tts/edge.ts` WebSocket protocol as in edge-tts). Cloud voices are
  limited to `serverVoices()` (`@mdb/shared`: the neural voices, plus Azure's
  HD voices on Azure). Clips are cached on disk by voice + text
  (`tts/cache.ts`); no server voice → the device's speech synthesis. Two voice
  settings: `ttsVoice` for words, `readerVoice` for a story's read-aloud
  ("" = the same, "device" = the device's own).
- Listening (`services/storyAudio.ts`, `routes/storyAudio.ts`): when the
  reading voice is a server voice, a story is one MP3, made on demand (POST
  starts it in the background, GET polls progress) from the same cached clips,
  joined frame by frame (`tts/mp3.ts`, which also times them) with each
  paragraph's start time; named by a hash of voice + text and served with
  Range. Web: `lib/listening.ts` (an <audio> element, Media Session); app:
  `lib/listening.tsx` (expo-audio with background playback and lock-screen
  controls; files kept in the app's documents as "Download for listening").
  Both highlight the paragraph by time and go on to the next chapter of a book.
- Settings: single JSON row (`services/settings.ts`), including the account
  icon (`avatar`: a pixel pattern from the username and a shuffle seed, or the
  initial; drawn by `@mdb/client`'s `avatarFor` on web and app alike).
- Favourites (`services/favorites.ts`): starred exercise sets and cheat
  sheets per learner, listed first on Home. Unstarring keeps the row off with
  its time, so the later of two changes wins (the app's offline `favorite`
  op is stale when older); the change feed sends the whole list when it
  changed.
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
  on `/mcp`) and `mdbo_rt_…` (30 days, sliding, rotated on each refresh;
  the replaced one still works for 2 minutes — a lost response, two
  refreshes at once — and used later it ends the grant, since a reused
  refresh token means a leak); one `oauth_grants` row per approval, which
  Settings → Connections lists and deletes. Disabling or deleting the user,
  or a password change (own or by an admin), ends access; so does
  `POST /api/auth/logout` with that connection's access token (an app's
  sign-out, besides `/oauth/revoke`). Browser sessions last 30 days after
  their last use (extended at most once a day, cookie re-sent). The issuer is
  `PUBLIC_URL` or the request's forwarded origin. All responses send
  `X-Frame-Options: DENY` so the consent page can't be framed.
- Native app (`routes/native.ts`, registered on the root instance): CORS on
  `/api/*` for `APP_ORIGINS` (browser-hosted clients such as the app's web
  preview; the Android app's own requests carry no Origin and need none),
  bearer tokens only (never `allow-credentials`); public `GET /api/version`
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
  90 days) gives a full snapshot. Pages of 1000 items (`more`). Every
  response also carries `stats`, computed by the server on each pull: the
  progress summary, latest run per set, recent sheet views and where the
  learner stopped in each set (the same DTOs as the REST routes), so the app
  shows them offline and keeps no stats logic of its own.
  `POST /api/sync/push` replays offline actions (answers, runs, sheet views,
  reading progress — max-merged — vocab, notes, set positions) once per
  `opId` (`sync_ops`, 30 days); a note edited on two devices keeps both
  (conflict copy); a set position carries its time (`at`, capped at now) and
  is skipped as `stale` when the server's is newer. `sync_log` holds ids only and has no FK (triggers fire while a
  user's rows cascade away); `pruneSync` drops deleted users' entries.
- Brute-force protection: password routes are limited per client IP
  (`@fastify/rate-limit`, 10/min, keyed on `CF-Connecting-IP` when present) and
  per username (10 failures / 15 min lock that name, `auth/loginGuard.ts`).
- Schema: versioned migrations, see below.

## API surface

See [api.md](api.md) for the grouped list; `/api/docs` has the full typed spec. The
AI endpoints:

```
GET  /api/assistant/status
POST /api/assistant/ask            (SSE stream; task-based — see below)
POST /api/assistant/word           (vocab lookup: translation, examples, forms)
POST /api/assistant/cleanup-notes  (tidy a note into clean Markdown)
```

## Adding a new exercise type

This is the one place a new *feature* is coded. Steps:

1. **Schema** — add a Zod object to the discriminated union in
   `packages/shared/src/exercises.ts` (with `type: z.literal("your_type")`), add
   it to `exerciseItem` and `EXERCISE_TYPES`. Add any cross-field checks to
   `exerciseSet`'s `superRefine`.
2. **Grading** — add the response shape to `itemResponse` and a case to
   `gradeItem` and `responseText` in `packages/shared/src/answers.ts` (the
   server grades with it; the app can too, offline). Add a case to
   `content/answers.test.ts`.
3. **Renderer** — add a `case "your_type"` + component in
   `packages/web/src/components/ExerciseItemView.tsx`. It receives the item,
   calls `submit(response)` once and renders the verdict it resolves to.
4. **Describe** — add a branch to `packages/client/src/describeItem.ts` so the
   tutor (hint/translate/why-wrong) and generation get a readable label +
   expected answers. **Never put the answer in `label`** — it's used for
   translate, which must not reveal the solution.
5. **LLM guide** — add a valid example to `EXAMPLE_ITEMS` (and a rule line to
   `ITEM_RULES`) in `packages/shared/src/authoring.ts`. That one guide feeds both
   the Import page's "Copy LLM prompt" and the tutor's "generate more", and
   `content/content.test.ts` checks every example against the schemas.

Grading for text answers lives in `packages/shared/src/grading.ts` (`gradeText`,
lenient by default) — reuse it, don't reinvent; `gradeItem` builds on it.

## The AI tutor (prompt registry)

All tutor system prompts live in **one registry**:
`packages/api/src/assistant/prompts.ts`. Every task inherits a shared preamble
(explain in English, keep German in German, be concise, level-aware, light
Markdown allowed). Tasks: `highlight`, `hint`, `why_wrong`, `translate_exercise`,
`translate_sheet`, plus `chat` (multi-turn), grading, generation, vocab word
lookup and note cleanup.

**AI grading**: the server grades text answers by the item's rules first
(`gradeItem`); only on a miss, and only when the tutor is configured and the
`llmGrading` setting is on, `judgeAnswer` (`assistant/grade.ts`, prompt
`buildGradeMessages`) judges the answer against `accept` (which then serves as
model answers). Answers replayed from the app's offline queue are graded
without the tutor. This is what makes free-completion sets (e.g.
`content/exercises/infinitiv-zu-frei.json`) work.

**To add an AI button**: add a task to `buildMessages` (or a builder like
`buildChatSystem`), thread it through `routes/assistant.ts` (`/ask` streams via
SSE; grading and generation run inside `/api/answers` and
`/api/exercises/:id/generate`), add a client call in
`packages/client/src/api.ts`, and a button. That's the whole pattern.

**Per-user providers and fallback.** Each user adds **OpenAI-compatible**
providers (base URL + one key; presets for OpenRouter and OpenAI) and an ordered
list of provider + model entries under Settings → Connections (`ai_providers` /
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

`packages/api/src/env.ts` validates them (empty strings count as unset). Every
variable, what it does and its default is in
[self-hosting.md → Configuration](self-hosting.md#configuration); keep that
table in step when adding one.

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

## Theming and navigation

Design tokens live in `packages/client/src/tokens.ts` (colours, shadows,
effects, motion, radii, fonts, reader themes) for the web and the app alike.
`pnpm --filter @mdb/web tokens` writes them to `packages/web/src/tokens.css` as
CSS variables; never edit that file, and `pnpm test` fails when it is stale.
`tailwind.config.js` maps the colours (`bg-surface`, `text-ink-muted`,
`bg-brand`, …) to those variables, so Tailwind opacity modifiers don't work on
them; use `color-mix` in CSS instead. Component styles in `index.css` use the
variables only (blurs, glass mixes and durations too). Two attributes on `<html>`
pick the values: `data-scheme` (`light`/`dark`; absent follows the device) and
`data-display="eink"`. Both are per-device preferences (Settings →
Appearance, `lib/appearance.ts`); an inline script in `index.html` applies them
before the first paint. Don't use Tailwind `dark:` variants (they follow the
device only): theme-dependent styles go through tokens. The glass styles (`ws-bar` header, `ws-tabs`/`ws-tab` pills, `ws-dock`,
`ws-glass-icon`, glass primary buttons, `ws-sheet`) live there too. Icons are
Lucide through the wrappers in `components/icons.tsx` (1.75 stroke). The
rules, every token and the components are in
[design-system.md](design-system.md).

Navigation: the section links (header on wide screens, the dock on phones) and
the account menu (`components/AccountMenu.tsx`, the initial at the top right),
which leads to Settings (`/settings/learning`, `/settings/account`,
`/settings/connections`), Administration for admins (`/admin/users`,
`/admin/server`) and log out. Import (`/import`) is a button on Practice and
Cheat sheets.

## Build & deploy

Production runs the API via `tsx` and serves `packages/web/dist` statically. The
Dockerfile builds a multi-arch image; CI (`.github/workflows/docker-publish.yml`)
pushes to GHCR on `main`/tags and then runs Komodo `DeployStack` (it pulls
first, then `compose up`), waiting for the result so a failed deploy fails the
job. Self-host with `docker-compose.prod.yml`.
