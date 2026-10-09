# AGENTS.md — orientation for AI agents

A small multi-user, self-hosted German-learning app. **Read the docs before working:**

- **[docs/authoring-content.md](docs/authoring-content.md)** — how to generate
  new exercises and cheat sheets (the JSON schemas, every item type, grading).
- **[docs/architecture.md](docs/architecture.md)** — app structure, how to add a
  new exercise type or AI feature, config, theming, deploy.
- **[docs/design-system.md](docs/design-system.md)** — the visual language:
  tokens, type, icons, layout and every component. Read it before UI work and
  keep it in step with the tokens (`packages/client/src/tokens.ts`, generated
  into `packages/web/src/tokens.css`) and `packages/web/src/index.css`.

## Core principle

**Features are code, content is data.** Coded exercise *types* (Zod schema +
renderer) are the only thing you change to add a feature; everything else is JSON
validated against the schemas in `packages/shared/src/exercises.ts`.

## Working rules

- **Verify before you commit**: `pnpm typecheck`, `pnpm test` and `pnpm build`
  must pass (CI runs all three).
  Content changes: validate by loading the app or importing (the loader rejects
  malformed content with a clear message).
- **One source of truth for schemas** (`@mdb/shared`) — API and web both import
  it. Grading lives in `packages/shared` (`gradeText` in grading.ts, `gradeItem`
  per item type in answers.ts) and runs on the server (`services/answers.ts`):
  clients send what was answered, never a verdict.
- **All tutor prompts** live in `packages/api/src/assistant/prompts.ts`. Adding
  an AI use-case = a task there + a button. The content-format guide given to
  LLMs (Import's "Copy LLM prompt" and "generate more") is one module,
  `packages/shared/src/authoring.ts`; a new exercise type needs an example there.
- **Never leak answers**: `describeItem` labels (used by translate) must not
  contain the accepted answer.
- **Self-contained**: the server proxies the LLM; API keys never reach the
  browser. Every request to a user's AI endpoint goes through
  `packages/api/src/assistant/client.ts` (the egress guard: https, public IPs
  only, no redirects, size/time caps). Never `fetch` a user-supplied URL directly.
- **Learner data is per user**: a new table holding someone's data needs a
  `user_id` column (FK to `users`, `ON DELETE CASCADE`), its service functions
  take `userId` first and filter on it in every query, and the route passes
  `req.user!.id`. Cover it in `routes/multiuser.test.ts` (another user can't
  read or change it).
- **MCP tools mirror the API**: `packages/api/src/mcp/server.ts` exposes the
  app to agents via the same services as the routes. A new learner-facing
  feature gets a tool there too (input schemas from `@mdb/shared`, per-user
  like its route); content tools must keep using the shared schemas and the
  authoring guide so agents can't save malformed content.
- **Schema changes are migrations**: append one to
  `packages/api/src/db/migrations.ts` (never edit a shipped one) and update
  `db/schema.ts` to match. See docs/architecture.md.

## Layout

```
packages/shared  Zod schemas + types + grading (the contract)
packages/api     Fastify + SQLite + AI proxy; serves the SPA in prod
packages/client  API client + speech logic for every frontend (no DOM)
packages/web     React + Tailwind SPA
content/         git-versioned exercises + cheatsheets (JSON)
docs/            the guides above
```
