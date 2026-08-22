# MADIBA SFA — Internal Android APK

This repo includes a **Capacitor Android shell** that loads the live MADIBA web app from Vercel. Field UI updates deploy instantly through the website; rebuild the APK only when native settings or permissions change.

**Production URL (default):** https://madiba-sfa.vercel.app

---

## Build APK without Android Studio (easiest)

Use GitHub Actions — builds in the cloud on Google’s servers. No Android Studio, emulator, or Java needed on your PC.

1. Push this repo to GitHub (or merge the `android/` folder to `main`)
2. Open GitHub → **Actions** → **Android APK** → **Run workflow**
3. When the job finishes, download artifact **madiba-sfa-debug-apk**
4. Unzip → share `app-debug.apk` with salesmen

The workflow also runs automatically when `android/` or Capacitor config changes on `main`.

### After installing the APK (required once per phone)

1. **Allow location → All the time** for MADIBA SFA
2. **Allow notifications** when prompted
3. **Battery → Unrestricted** for MADIBA SFA
4. Complete **morning attendance** — this starts the native field-tracking notification

While logged in during work hours (6:00–22:00 KSA), the app will:

- Show a persistent **“MADIBA field tracking active”** notification (Android foreground service)
- Send **GPS pings every 15 minutes** after 15 minutes of inactivity
- Show a **lock-screen alert** if no visit/order/collection is recorded for 45 minutes

---

## Firebase push notifications (lock screen when app is closed)

Push alerts to salesmen (even when the app is not open) require Firebase Cloud Messaging.

1. Create a Firebase project → add Android app `com.madiba.sfa`
2. Download **`google-services.json`** → place in `android/app/google-services.json`
3. Run the SQL migration `supabase/migrations/20260822120000_device_push_tokens.sql` in Supabase
4. Rebuild the APK (Actions → **Android APK** → **Run workflow**)
5. Reinstall on phones — login registers the device token automatically

Without `google-services.json`, background GPS and local inactivity alerts still work; **remote push from the server does not**.

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

1. Send the APK file (Drive / WhatsApp / email)
2. On the phone: download the APK
3. Android may ask to allow **Install unknown apps** for Chrome / Files / Drive — allow once
4. Tap the APK → **Install**
5. Open **MADIBA SFA** from the app drawer (not Chrome)

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

---

## Next phase (optional)

- Server-triggered push campaigns (boss alerts) via Firebase Admin SDK
- Boot-time restart of field tracking after phone reboot

These require Firebase credentials on Vercel plus optional cron/worker setup.
