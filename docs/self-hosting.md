# Self-hosting Wortschritt

Wortschritt runs as one Docker container: the server, the web app and the
built-in exercises and cheat sheets, with everyone's data in a SQLite database
in one folder. The Android app and AI agents connect to the same server. For
working on the code, see [development.md](development.md).

## Quick start

Save this as `compose.yml`, with your own password and a long random secret:

```yaml
services:
  wortschritt:
    image: ghcr.io/yamensharaf/wortschritt:latest
    ports:
      - "3000:3000"
    environment:
      APP_PASSWORD: choose-a-strong-password
      SESSION_SECRET: a-long-random-string
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

Start it with `docker compose up -d`, open `http://<your-server>:3000` and sign
in as `admin` with that password. Change the password under Settings → Account:
`APP_PASSWORD` only sets it the first time.

The `data` folder holds the database; back it up to keep everyone's progress.

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `APP_PASSWORD` | required | Password of the first admin account, only read when that account is created. |
| `SESSION_SECRET` | required | Signs sign-in cookies. At least 8 characters; `openssl rand -base64 32` makes a good one. |
| `ADMIN_USERNAME` | `admin` | Username of the first admin account: 2–32 letters, digits, `_`, `.` or `-`. |
| `ENCRYPTION_KEY` | unset | Encrypts the AI tutor and Azure voice keys people save. At least 32 characters (`openssl rand -base64 32`). Unset, those keys can't be saved. Keep a copy: if it changes, saved keys must be entered again. |
| `PUBLIC_URL` | from the request | The server's public address, e.g. `https://deutsch.example.com`, for AI agents signing in over MCP. Only needed when the address the server sees isn't the one people use. |
| `DICTIONARY_API_URL` | `https://freedictionaryapi.com/api/v1` | Where tapped words get definitions and examples (Wiktionary data, cached). `off` keeps lookups offline. |
| `APP_ORIGINS` | `capacitor://localhost,https://localhost,http://localhost` | Origins allowed to call the API with a token from an app's own pages. No need to change. |
| `PORT` | `3000` | Port inside the container. To serve on another port, change the left side of `ports` instead. |
| `DATABASE_PATH` | `/app/data/app.db` | The database file inside the container. |
| `CONTENT_DIR` | `/app/content` | The built-in exercises and cheat sheets. Mount your own copy over it to replace them. |

`ASSISTANT_BASE_URL`, `ASSISTANT_API_KEY` and `ASSISTANT_MODEL` are deprecated:
everyone sets up their own AI tutor in the app now.

## After you sign in

As the admin, under Administration:

- **Users**: add people, or open self-registration (it closes by itself after
  24 hours); set a temporary password for someone who forgot theirs.
- **Server**: the time zone days are counted in, and natural read-aloud voices
  (Azure Speech with a key, or Microsoft Edge's voices).

Everyone sets up their own AI tutor under Settings → Connections, with any
OpenAI-compatible provider. Exercise sets and cheat sheets are shared;
stories, vocab, notes and progress are private to each person.

## Android app

Download it from [wortschritt.yamen.dev](https://wortschritt.yamen.dev),
enter your server's address and sign in. For an `http://` address on your home
network, turn on *Allow http*. The app works offline and syncs when it can.

## AI agents

Agents such as Claude can use Wortschritt over MCP at
`https://<your-server>/mcp`, signing in as you. See [api.md](api.md).
