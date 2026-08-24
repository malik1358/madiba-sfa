# MADIBA SFA — Internal Android APK

This repo includes a **Capacitor Android shell** that loads the live MADIBA web app from Vercel. Field UI updates deploy instantly through the website; rebuild and publish to Play Store (or sideload APK) only when native settings or permissions change.

**Production URL (default):** https://madiba-sfa.vercel.app

---

## Build APK without Android Studio (easiest)

Use GitHub Actions — builds in the cloud on Google’s servers. No Android Studio, emulator, or Java needed on your PC.

1. Push this repo to GitHub (or merge the `android/` folder to `main`)
2. Open GitHub → **Actions** → **Android APK** → **Run workflow**
3. When the job finishes, download artifact **madiba-sfa-release-apk**
4. Unzip → share `app-release.apk` with salesmen (same release signing key as Google Play internal testing)

The workflow also runs automatically when `android/` or Capacitor config changes on `main`.

### After installing the APK (required once per phone)

1. **Allow location → All the time** for MADIBA SFA
2. **Allow notifications** when prompted
3. **Battery → Unrestricted** for MADIBA SFA — **required before login**; the app blocks sign-in and morning attendance until this is set
4. Complete **morning attendance** — this starts the native field-tracking notification

While logged in during an active work session, the app will:

- Show a persistent **“MADIBA field tracking active”** notification (Android foreground service)
- Check location every **5 minutes** while the app process is running, and save an **idle GPS ping** once **15 minutes pass with no visit/order/collection activity** (not a fixed ping every 15 minutes on the clock)
- When Soyeb reopens the app after it was minimized, a **catch-up ping** runs immediately if the 15-minute idle threshold was already reached
- Show a **lock-screen alert** if no visit/order/collection is recorded for 45 minutes (repeats every 15 minutes while still idle)

**Important:** Android may pause JavaScript timers when the screen is off or another app is in front. For reliable tracking, keep MADIBA open or return to it periodically, set **Battery → Unrestricted**, and grant **Location → Allow all the time**. Pings are also paused during **lunch break** (between Lunch out and Lunch in).

Active sessions follow attendance logs: **login → lunch break out**, then **lunch break in → logout**. Nothing runs during lunch or after end-of-day. If lunch lasts more than **3 hours**, a one-time reminder push is sent (English or Arabic).

---

## Firebase push notifications (lock screen when app is closed)

Push alerts to salesmen (even when the app is not open) require Firebase Cloud Messaging.

1. Create a Firebase project → add Android app `com.madiba.sfa`
2. Download **`google-services.json`** → place in `android/app/google-services.json`
3. Run these SQL migrations in Supabase:
   - `supabase/migrations/20260822120000_device_push_tokens.sql`
   - `supabase/migrations/20260822153000_push_notification_log.sql`
   - `supabase/migrations/20260822160000_push_notification_reference_key.sql`
4. In Firebase → **Project settings → Service accounts** → **Generate new private key**
5. In Vercel → **Environment variables** → add `FIREBASE_SERVICE_ACCOUNT_JSON` (paste the full JSON on one line)
6. Ensure `CRON_SECRET` is set in Vercel (same value as GitHub Actions secret)
7. Rebuild the APK (Actions → **Android APK** → **Run workflow**)
8. Reinstall on phones — login registers the device token automatically

After deploy, MADIBA automatically sends **45-minute inactivity push alerts**, repeating every **15 minutes** while still idle, during each user's active work session (login → lunch out, lunch in → logout) via `/api/cron/inactivity-push` (GitHub Actions workflow **Inactivity Push**). Alerts use each user's selected language (English or Arabic).

Every field transaction (visit, order, collection, prospect, attendance, etc.) also sends **push alerts up the reporting chain** — each boss in **Salesman Hierarchy** receives the alert, and if that boss also has a head, the alert continues to the top.

Admins can also send a manual push:

```bash
curl -X POST "https://madiba-sfa.vercel.app/api/admin/push-notifications" \
  -H "Authorization: Bearer YOUR_ADMIN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":"USER_UUID","title":"MADIBA SFA","body":"Please check in with your next customer."}'
```

Without `google-services.json` and `FIREBASE_SERVICE_ACCOUNT_JSON`, background GPS and local inactivity alerts still work; **remote push from the server does not**.

---

## What you need on your PC (only if building locally)

1. **Node.js 20+** (already used for this repo)
2. **Android Studio** — https://developer.android.com/studio
   - During setup, install **Android SDK**, **SDK Platform Tools**, and **Android SDK Build-Tools**
3. **Java 17** — usually bundled with Android Studio

After Android Studio installs, set environment variable (Windows PowerShell example):

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path += ";$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\tools"
```

---

## Sync Capacitor after config changes

From the repo root:

```bash
npm run cap:sync
```

This copies web assets and updates the native Android project.

---

## Open the Android project

```bash
npm run cap:open:android
```

Android Studio opens the `android/` folder.

---

## Build a test APK (debug)

In Android Studio:

1. Wait for Gradle sync to finish
2. **Build → Build Bundle(s) / APK(s) → Build APK(s)**
3. When done, click **locate** in the notification

Output file:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

Share this APK internally (Drive, WhatsApp, etc.) for testing.

---

## Build a signed release APK (field rollout)

Do this once to create your company keystore, then reuse it for every release.

### 1. Create keystore (one-time)

In Android Studio: **Build → Generate Signed App Bundle / APK → APK → Create new...**

Or from terminal:

```bash
keytool -genkeypair -v -keystore madiba-sfa-release.keystore -alias madiba -keyalg RSA -keysize 2048 -validity 10000
```

**Store the keystore file and passwords safely.** If lost, you cannot update the same APK install on phones.

### 2. Configure signing

Create `android/keystore.properties` (do **not** commit this file):

```properties
storeFile=../madiba-sfa-release.keystore
storePassword=YOUR_STORE_PASSWORD
keyAlias=madiba
keyPassword=YOUR_KEY_PASSWORD
```

### 3. Build release APK

In Android Studio: **Build → Generate Signed App Bundle / APK → APK → release**

Output:

```
android/app/build/outputs/apk/release/app-release.apk
```

---

## Install on salesman phones

1. Send the APK file (Google Drive link is more reliable than WhatsApp for large APKs)
2. On the phone: download the APK
3. Android may ask to allow **Install unknown apps** for Chrome / Files / Drive — allow once
4. Tap the APK → **Install**
5. Open **MADIBA SFA** from the app drawer (not Chrome)

### If install fails ("Installation failed — Please try again")

| Cause | Fix |
| --- | --- |
| **Different signing key** (old debug APK on phone, new release APK shared) | Uninstall **MADIBA SFA** completely, then install the new APK |
| **Older APK version** (phone already has 1.0.30, shared file is 1.0.28) | Share the **latest** APK from GitHub Actions (higher version number) |
| **Corrupted WhatsApp transfer** | Re-download from Google Drive or GitHub artifact; avoid forwarding APK in chat |
| **Play Store copy already installed** | Use Play Store internal testing update, or uninstall Play copy first then sideload |

Android only shows a generic error for all of these. When in doubt: **uninstall MADIBA SFA → install the newest release APK**.

### Recommended phone settings

| Setting | Value |
| --- | --- |
| Location → MADIBA SFA | **Allow all the time** |
| Battery → MADIBA SFA | **Unrestricted** |
| Notifications | Allow (needed for future push alerts) |

---

## Staging / UAT APK

To point the shell at staging instead of production:

```powershell
$env:CAPACITOR_SERVER_URL = "https://YOUR-STAGING-URL.vercel.app"
npm run cap:sync
npm run cap:open:android
```

Rebuild the APK after changing the URL.

---

## NPM scripts

| Script | Purpose |
| --- | --- |
| `npm run cap:sync` | Sync Capacitor + Android project |
| `npm run cap:open:android` | Open Android Studio |
| `npm run cap:run:android` | Run on connected device/emulator (needs Android Studio + device) |

---

## How it works

```
Android APK (Capacitor)
  └── WebView → https://madiba-sfa.vercel.app
        ├── Same login, My Day, Collections, offline queue
        ├── Native foreground service → GPS pings while logged in
        ├── Local notifications → inactivity alerts on lock screen
        └── Firebase push → remote alerts (after google-services.json)
```

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Blank white screen | Confirm phone has internet on first launch; check Vercel URL opens in Chrome |
| Gradle sync failed | Open SDK Manager in Android Studio; install latest SDK Platform + Build Tools |
| Location/camera blocked | App info → Permissions → allow Location + Camera |
| Old UI after deploy | Force-close app and reopen; web updates come from Vercel automatically |
| APK install failed | Uninstall old MADIBA SFA first; use latest **madiba-sfa-release-apk** (not an old debug build) |

---

## Next phase (optional)

- Boot-time restart of field tracking after phone reboot
- Admin UI button to send push from User Activity screen

---

## Google Play — internal testing (recommended for field rollout)

Use **Google Play internal testing** so salesmen install and update MADIBA from the Play Store instead of sideloading APK files. The app still loads the live Vercel site; Play Store updates only the native Android shell (GPS, push, permissions).

### What updates where

| Change | How salesmen get it |
| --- | --- |
| UI, orders, collections, APIs | Vercel deploy — force-close and reopen the app |
| Native Android (GPS service, push, permissions) | New Play Store internal release |

### One-time setup (about 30–60 minutes)

#### 1. Google Play Developer account

1. Open [Google Play Console](https://play.google.com/console)
2. Pay the **one-time $25** registration fee (company account recommended)
3. Create a new app → name **MADIBA SFA** → default language **English**

#### 2. Create the app listing (minimum for internal testing)

In Play Console, complete these sections (required even for internal track):

| Section | What to enter |
| --- | --- |
| **App access** | All functionality available without special access |
| **Ads** | No, app does not contain ads |
| **Content rating** | Complete the questionnaire (business/productivity app) |
| **Target audience** | 18+ (field staff) |
| **Data safety** | Declare location collection (field tracking), data encrypted in transit |
| **Privacy policy** | Public URL (required because the app uses location) |
| **Store listing** | App name, short description, 512×512 icon, 2+ phone screenshots |

Package name must be **`com.madiba.sfa`** (matches this repo).

#### 3. Create an upload keystore (one-time — keep safe)

From any machine with Java installed:

```bash
keytool -genkeypair -v \
  -keystore madiba-sfa-upload.keystore \
  -alias madiba-upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

Store the `.keystore` file and passwords securely. If lost, you cannot publish updates to the same Play listing.

For local release builds, copy `android/keystore.properties.example` → `android/keystore.properties` and point `storeFile` at your keystore.

#### 4. Link a Google Cloud service account (for GitHub uploads)

1. Play Console → **Setup → API access** → link or create a Google Cloud project
2. **Create new service account** → open Google Cloud Console
3. Grant the service account **Service Account User** (if prompted)
4. Back in Play Console → **Grant access** to the service account → role **Release manager** (or Admin for first setup)
5. In Google Cloud → **IAM → Service account → Keys** → **Add key → JSON** → download the JSON file

#### 5. Add GitHub repository secrets

In GitHub → **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 of `madiba-sfa-upload.keystore` (see below) |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | `madiba-upload` |
| `ANDROID_KEY_PASSWORD` | Key password |
| `PLAY_STORE_SERVICE_ACCOUNT_JSON` | Full contents of the service account JSON file |

Encode the keystore for GitHub (PowerShell):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("madiba-sfa-upload.keystore")) | Set-Clipboard
```

Paste the clipboard into the `ANDROID_KEYSTORE_BASE64` secret.

#### 6. First release to internal testing

1. GitHub → **Actions** → **Play Store Internal** → **Run workflow** (branch `main`, deploy = true)
2. Wait for the job to finish (builds signed AAB + uploads to internal track)
3. In Play Console → **Testing → Internal testing** → confirm the release is active

If the upload fails on the very first release, open Play Console once and accept **Google Play App Signing** when prompted, then re-run the workflow.

### Add salesmen as internal testers

1. Play Console → **Testing → Internal testing → Testers**
2. Create an email list (Google accounts used on their phones)
3. Copy the **opt-in link** and send it to each salesman (WhatsApp / email)
4. Each tester opens the link → **Become a tester** → installs **MADIBA SFA** from the Play Store

They only need the opt-in link **once**. After that, updates arrive through the Play Store like any other app.

### Publishing updates

| Trigger | What happens |
| --- | --- |
| Push to `main` (android / native files change) | Workflow builds AAB and uploads to **internal** automatically |
| Manual | Actions → **Play Store Internal** → **Run workflow** |

Each build gets `versionCode = GitHub run number` and `versionName = 1.0.<run number>`. Play Store requires a higher `versionCode` on every upload — the workflow handles this.

### Require the latest APK before login

The web app can block outdated Android APK builds at login. Set the minimum required build in **either** place:

1. **Supabase** `system_settings` key `android_apk_min_version_v1`:

```json
{
  "minVersionCode": 200,
  "minVersionName": "1.0.200",
  "downloadUrl": "https://your-apk-link.example/app-debug.apk",
  "messageEn": "Install the latest MADIBA APK from admin, then sign in again.",
  "messageAr": "ثبّت أحدث APK من المسؤول ثم سجّل الدخول مرة أخرى."
}
```

2. **Vercel env vars** (optional fallback / override):

- `MIN_ANDROID_APK_VERSION_CODE`
- `MIN_ANDROID_APK_VERSION_NAME`
- `ANDROID_APK_DOWNLOAD_URL`

The server uses the **higher** of the Supabase and env build numbers. Set `minVersionCode` to `0` (or leave unset) to disable the check.

After you publish a new APK, update `minVersionCode` to that build's GitHub run number so older APKs cannot sign in.

Edit release notes before a rollout in:

```
android/play-whatsnew/en-US/whatsnew
```

### Troubleshooting

| Problem | Fix |
| --- | --- |
| Upload failed: version code already used | Re-run workflow (run number increments) |
| Upload failed: package not found | Create the app in Play Console with package `com.madiba.sfa` first |
| Upload failed: API access | Re-check service account has Release manager in Play Console |
| Tester cannot see the app | They must open the opt-in link with the same Google account on their phone |
| App not updating | Play Store → MADIBA SFA → check for update; or wait a few hours for rollout |
