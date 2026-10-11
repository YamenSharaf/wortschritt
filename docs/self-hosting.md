# Self-hosting Wortschritt

Wortschritt runs as one Docker container: the server, the web app and the
built-in exercises and cheat sheets, with everyone's data in a single SQLite
file in a folder next to it. The Android app and AI agents connect to the same
server. For working on the code, see [development.md](development.md).

## Quick start

You need a machine with Docker and Docker Compose (x86-64 or ARM64, such as
a mini PC, a NAS or a Raspberry Pi 4/5).

1. Make a folder for it and download the compose file:

   ```bash
   mkdir wortschritt && cd wortschritt
   curl -O https://raw.githubusercontent.com/YamenSharaf/wortschritt/main/docker-compose.prod.yml
   ```

2. Create a `.env` next to it. The two secrets are generated here; change the
   name and the password:

   ```bash
   cat > .env <<EOF
   ADMIN_USERNAME=yourname
   APP_PASSWORD=choose-a-strong-password
   SESSION_SECRET=$(openssl rand -base64 32)
   ENCRYPTION_KEY=$(openssl rand -base64 32)
   EOF
   ```

   Keep a copy of `ENCRYPTION_KEY` somewhere safe (see
   [Configuration](#configuration)).

3. Start it:

   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

4. Open `http://<your-server>:3000` and sign in with `ADMIN_USERNAME` and
   `APP_PASSWORD`. Then change the password under Settings → Account:
   `APP_PASSWORD` is only used to create this first account.

`docker compose -f docker-compose.prod.yml ps` should show the container as
`healthy` after a few seconds. If it keeps restarting, see
[Troubleshooting](#troubleshooting).

To serve it on another port, change the left side of `ports` in the compose
file (`"8080:3000"`), not `PORT`.

## What's in the folder

| Path | What it is |
| --- | --- |
| `docker-compose.prod.yml` | The service: image, port, settings, the data folder |
| `.env` | Your settings (below); the compose file reads it |
| `data/app.db` | The database: accounts, progress, vocab, notes, stories, imported content. Next to it SQLite keeps `app.db-wal` and `app.db-shm` while it runs |
| `data/app.db.bak-…` | Copies the server makes itself before a database upgrade (the newest 5 are kept) |

The built-in exercises and cheat sheets are part of the image, so they update
with it.

## Configuration

The server reads these environment variables. The compose file passes each one
from `.env`; to set one it doesn't list (such as `TZ`), add it under
`environment:` in the compose file. An empty value counts as unset.

### Required

| Variable | What it does |
| --- | --- |
| `APP_PASSWORD` | Password of the first admin account. Only read when that account is created, on the first start; change it in the app afterwards. |
| `SESSION_SECRET` | Signs the sign-in cookies. At least 8 characters; use a long random string (`openssl rand -base64 32`). |

### Recommended

| Variable | What it does | Default |
| --- | --- | --- |
| `ADMIN_USERNAME` | Username of the first admin account: 2–32 letters, digits, `_`, `.` or `-`. | `admin` |
| `ENCRYPTION_KEY` | Encrypts the API keys people save for the AI tutor, and the Azure voice key. At least 32 characters (`openssl rand -base64 32`). Without it, those keys can't be saved. If it's lost or changed, the saved keys must be entered again; nothing else is affected. | unset |
| `TZ` | The time zone days are counted in ("answered today", activity), e.g. `Europe/Berlin`. The admin can also set it under Administration → Server, which wins. Not in the compose file: add it under `environment:`. | `UTC` |

### Optional

| Variable | What it does | Default |
| --- | --- | --- |
| `PUBLIC_URL` | The server's public address, e.g. `https://deutsch.example.com`. Used when an AI agent signs in over MCP. Only needed if the address the server sees in requests isn't the one people use; behind a Cloudflare Tunnel or a usual reverse proxy it works out on its own. | from the request |
| `DICTIONARY_API_URL` | Where tapped words get their English definitions, pronunciation and examples (Wiktionary data). Results are cached in the database. `off` keeps lookups fully offline: just the built-in short glosses. | `https://freedictionaryapi.com/api/v1` |
| `APP_ORIGINS` | Comma-separated origins allowed to call the API with a token from inside an app's own pages (CORS, never with cookies). The default covers the apps; there's no need to change it. | `capacitor://localhost,https://localhost,http://localhost` |

### Legacy AI tutor settings

Before each person set up their own AI tutor in the app, it was configured
here. If set, these are copied once into the admin's AI settings on the first
start and then ignored; change them in the app instead (Settings →
Connections).

| Variable | Default |
| --- | --- |
| `ASSISTANT_BASE_URL` | `https://api.openai.com/v1` |
| `ASSISTANT_API_KEY` | unset |
| `ASSISTANT_MODEL` | `gpt-4o-mini` |

### Set by the image

The image and the compose file set these; leave them as they are.

| Variable | Value in the container |
| --- | --- |
| `NODE_ENV` | `production` (serves the web app) |
| `PORT` | `3000` |
| `DATABASE_PATH` | `/app/data/app.db` (the `data` folder) |
| `CONTENT_DIR` | `/app/content` (the built-in content) |

## Accounts

The first account is the admin. Under Administration → Users the admin can:

- add people, or open self-registration (it closes by itself after 24 hours);
- set a temporary password for someone who forgot theirs (it signs them out
  everywhere);
- delete accounts (with their vocab, notes and progress; content they imported
  stays).

What's shared and what's private:

- **Shared by everyone**: the exercise sets and cheat sheets. The built-in ones
  can't be changed; imported ones can be replaced or deleted by whoever
  imported them, and by the admin.
- **Private to each person**: stories and books, vocab and flashcards, notes,
  progress and history, settings, and their AI tutor.

## Optional features

### AI tutor

Each person connects their own OpenAI-compatible provider under Settings →
Connections (OpenAI, OpenRouter or another service with an `https://` address; for safety the server won't call addresses on your own network). It
explains mistakes, translates, writes stories and makes more questions. The
server makes the calls, so keys never reach the browser or the phone. Needs
`ENCRYPTION_KEY`.

### Voices

Without setup, the app reads aloud with the device's own German voice. For
natural voices, the admin turns one on under Administration → Server:

- **Azure Speech**: a key and region from an Azure Speech resource (the free
  tier is plenty). Needs `ENCRYPTION_KEY` to store the key.
- **Edge "Read aloud"**: Microsoft's voices through an unofficial endpoint, no
  account needed. It can stop working without notice.

The server caches each spoken clip, and the Android app keeps the ones it has
played for offline use.

### Your own content

To use your own copy of the built-in exercises and cheat sheets, uncomment this
line under `volumes:` in the compose file and put the files in `./content` (the
layout is the repository's `content/` folder):

```yaml
      - ./content:/app/content:ro
```

For adding sets and sheets, importing in the app (or through an AI agent) is
usually easier: see [authoring-content.md](authoring-content.md).

## Android app

Download the APK from [wortschritt.yamen.dev](https://wortschritt.yamen.dev)
and install it (allow installs from your browser when Android asks). In the
app, enter your server's address and sign in.

- The phone must be able to reach the server. For an address on your home
  network over http (`http://192.168.1.10:3000`), turn on *Allow http* on the
  connect screen.
- It works offline and syncs when it can, also in the background.
- It checks for a new version each time it opens and offers to install it
  (Account → App to turn that off). Or keep it updated with
  [Obtainium](https://github.com/ImranR98/Obtainium): add
  `https://github.com/YamenSharaf/wortschritt` and turn on *Include
  prereleases*.

## AI agents (MCP)

Agents such as Claude can read and add to your Wortschritt over MCP, at
`https://<your-server>/mcp`: they sign in as you, with your permission. Setup
and the full API: [api.md](api.md).

## Updating

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

The `latest` image follows the main branch. When a new version changes the
database, the server upgrades it on start, after saving a copy
(`data/app.db.bak-…`). A database from a newer version than the image makes the
server refuse to start, rather than damage it.

To stay on a particular build, replace `latest` in the compose file with
`sha-<commit>` (the short commit hash; the image tags are listed on the
repository's Packages page).

## Backups

Back up the `data` folder. The database is written to while the server runs,
so stop it for the copy (a few seconds):

```bash
docker compose -f docker-compose.prod.yml stop
cp -a data "data-backup-$(date +%F)"
docker compose -f docker-compose.prod.yml start
```

To restore, stop the server, put the backed-up `app.db` in `data/` (and delete
any `app.db-wal` and `app.db-shm` there), and start it again. Keep `.env` with
the backup: without the same `ENCRYPTION_KEY`, saved AI and voice keys can't be
read.

## Troubleshooting

**The container keeps restarting.** Look at the log:

```bash
docker compose -f docker-compose.prod.yml logs --tail 50
```

A line like `Invalid environment configuration` lists each setting that's
missing or wrong, for example a `SESSION_SECRET` that's too short.

**`docker compose pull` is denied.** The image has to be public on GitHub (the
repository's Packages page → the image → Package settings → visibility), or
the server has to `docker login ghcr.io` with a token that can read packages.

**I forgot the admin password.** `APP_PASSWORD` won't help after the first
start. Another admin can set a temporary password for you under
Administration → Users. If you're the only admin, there's no way to reset it
from outside the app yet.

**The Android app can't connect.** Open the same address in the phone's
browser first. For a plain `http://` address, turn on *Allow http*; addresses
on your home network only work on that network (or over a VPN).

**Read-aloud uses the robot voice.** No server voice is set up (see
[Voices](#voices)), or the person picked the device voice in their settings.
