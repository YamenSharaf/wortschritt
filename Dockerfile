# syntax=docker/dockerfile:1

# ---- Build stage: install deps + build the web SPA ----
FROM node:22-slim AS build
WORKDIR /app

RUN corepack enable

# Manifests first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

# Source + build the frontend.
COPY . .
RUN pnpm --filter @mdb/web build

# ---- Runtime stage: API (via tsx) serves the built SPA ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable

# better-sqlite3 ships prebuilt binaries; no compiler needed at runtime.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=build /app/packages ./packages
COPY --from=build /app/content ./content

# The API's CWD must be packages/api so it finds ../web/dist and ./data.
WORKDIR /app/packages/api
ENV DATABASE_PATH=/app/data/app.db
ENV CONTENT_DIR=/app/content
EXPOSE 3000

CMD ["pnpm", "start"]
