# Self-hosting Wortschritt

How to run the server, keep it updated and backed up, and connect the
Android app. For working on the code, see [development.md](development.md).

## Docker

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

**Install**: download the APK from the newest `app-…` release and install
it (allow installing from your browser or file manager when Android asks).

**Updates**: each time it opens, the app looks at this repository's
releases for a newer build; when there is one, a card on Home downloads it
and opens Android's installer (the first time, allow installs from
Wortschritt). Turn that off, or check by hand, in Account → App.

Or keep it updated with [Obtainium](https://github.com/ImranR98/Obtainium):
*Add app* with `https://github.com/YamenSharaf/wortschritt` and turn on
*Include prereleases* (each build of `main` is a prerelease, `app-<run>`).

**Connect**: enter your server's address (`https://wort.example.com`; for a
server on your own network over http, turn on *Allow http*), then sign in
in the browser tab that opens, and allow the app. The server must be
reachable from the phone; the app uses OAuth, no extra server settings.

Every build is signed with the same key, so each one installs over the
last. Builds and signing: [architecture.md](architecture.md#the-android-app-packagesapp).

## Configuration

Every environment variable the server reads is listed in
[architecture.md → Configuration](architecture.md#configuration-env-vars).
