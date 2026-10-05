# AGENTS.md — orientation for AI agents

A single-user, self-hosted German-learning app. **Read the docs before working:**

- **[docs/authoring-content.md](docs/authoring-content.md)** — how to generate
  new exercises and cheat sheets (the JSON schemas, every item type, grading).
- **[docs/architecture.md](docs/architecture.md)** — app structure, how to add a
  new exercise type or AI feature, config, theming, deploy.

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
  it. Grading lives in `packages/shared/src/grading.ts`; reuse `gradeText`.
- **All tutor prompts** live in `packages/api/src/assistant/prompts.ts`. Adding
  an AI use-case = a task there + a button.
- **Never leak answers**: `describeItem` labels (used by translate) must not
  contain the accepted answer.
- **Self-contained**: the server proxies the LLM; the API key never reaches the
  browser.
- **Schema changes are migrations**: append one to
  `packages/api/src/db/migrations.ts` (never edit a shipped one) and update
  `db/schema.ts` to match. See docs/architecture.md.

## Layout

```
packages/shared  Zod schemas + types + grading (the contract)
packages/api     Fastify + SQLite + AI proxy; serves the SPA in prod
packages/web     React + Tailwind SPA
content/         git-versioned exercises + cheatsheets (JSON)
docs/            the two guides above
```
