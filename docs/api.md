# API and MCP server

Wortschritt's server is an HTTP API (the web and Android apps are its
clients) and an MCP server for AI agents.

## Overview

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
            DELETE /api/exercises/:id/generated/:itemId  GET /api/exercises/generated-counts
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
