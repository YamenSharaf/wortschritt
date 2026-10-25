# The iOS app (iPhone and iPad) on TestFlight

The app in `packages/app` builds for iOS too. GitHub Actions does it
(`.github/workflows/ios.yml`) on a macOS runner, so no Mac is needed:

- **Every change to the app** compiles an unsigned simulator build: it only
  checks that the iOS app still builds.
- **Run by hand** (Actions → iOS → Run workflow, "Upload to TestFlight"
  ticked), it builds a signed release and uploads it to App Store Connect.
  After Apple has processed it (usually 5–30 minutes) it's in TestFlight.

## One-time setup (on the Apple developer account)

This needs someone with an Apple Developer Program membership (the account
holder or an Admin of the team). Nobody else pays anything.

1. **The app's bundle ID.** In the [developer portal](https://developer.apple.com/account/resources/identifiers/list),
   Identifiers → `+` → App IDs → App: description *Wortschritt*, explicit
   bundle ID **`eu.yamen.wortschritt`**. No capabilities need ticking.
2. **The app record.** In [App Store Connect](https://appstoreconnect.apple.com/apps), Apps → `+` → New App:
   platform iOS, name *Wortschritt* (any free name works), primary language,
   the bundle ID above, an SKU (anything, e.g. `wortschritt`). It stays
   private: TestFlight builds go to testers only.
3. **An API key for the upload.** App Store Connect → Users and Access →
   Integrations → App Store Connect API → Team Keys → `+`: name *GitHub
   Actions*, access **App Manager**. Download the key file
   (`AuthKey_XXXXXXXXXX.p8`; it can be downloaded only once), and note the
   **Key ID** and the **Issuer ID** (shown above the list).
4. **The team ID.** Developer portal → Membership details → Team ID (10
   characters).
5. **The repository's secrets.** GitHub → the repo → Settings → Secrets and
   variables → Actions → New repository secret, four of them:

   | Secret | Value |
   |---|---|
   | `APPLE_TEAM_ID` | the team ID |
   | `APP_STORE_CONNECT_KEY_ID` | the key's ID |
   | `APP_STORE_CONNECT_ISSUER_ID` | the issuer ID |
   | `APP_STORE_CONNECT_KEY` | the whole contents of the `.p8` file, `-----BEGIN PRIVATE KEY-----` to `-----END PRIVATE KEY-----` |

   The key can only upload and manage apps; it can be revoked in App Store
   Connect at any time.

## Testers

- **Internal testers** (no review by Apple, up to 100): people who are users
  on the team in App Store Connect (Users and Access → `+`, a free Apple ID
  is enough, role e.g. *App Manager* or *Developer*). In the app's TestFlight
  tab → Internal Testing → a group → add them; they get an email, install
  the TestFlight app and accept.
- **External testers** (anyone, by email or a public link) need Apple's beta
  review first, which asks for a way to sign in: a demo server and account.
  Internal testing avoids that.

Each build can be tested for 90 days; a new build replaces it.

## What's different on iOS

- No self-update from GitHub (TestFlight and later the App Store deliver
  updates) and no page turning with the volume keys (iOS doesn't allow it);
  both settings don't show there.
- Background sync runs when iOS decides (less often than on Android).
- Listening keeps playing in the background, with the cover and controls on
  the lock screen and in Control Center.
- Servers on plain `http` (a home server without https) are allowed, as on
  Android.
- On Apple silicon Macs the iPad app can be installed from TestFlight too.
