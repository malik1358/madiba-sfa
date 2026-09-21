# Deployment

> AI agent handover — staging vs production, Vercel, GitHub Actions crons, Android, Node 22+.

## Environments

From `README.md`:

| Environment | Git branch | Vercel | Database |
| --- | --- | --- | --- |
| Staging / UAT | `staging` | Separate project, production branch `staging` | Separate Supabase project |
| Production | `main` | Existing production project | Production Supabase |

Never put production Supabase keys on the staging Vercel project. Staging must set `NEXT_PUBLIC_APP_ENV=staging`. That value turns on the yellow `STAGING / UAT - TEST DATA ONLY` banner in `app/layout.js`. Any other value (including unset) is treated as production in the banner logic and the shell label.

Release path used by the team:

1. Feature branch to pull request into `staging`.
2. GitHub Actions job `Build` must pass.
3. UAT on the staging URL.
4. Pull request from `staging` into `main`.
5. Merge only after `Build` passes. Vercel deploys production from `main`.

`Build` (`.github/workflows/build.yml`) runs on pull requests and pushes to `main` and `staging`: `npm ci` then `npm run build`. Node comes from `.nvmrc` (22).

## Vercel

- Framework: Next.js. `npm run build` / `npm run start`.
- `vercel.json` registers one cron: `GET/POST` path `/api/cron/inactivity-push` on `*/10 * * * *`. Other schedules are GitHub Actions because Hobby cron limits were a problem for the 8-hour price sync and the KSA midnight jobs.
- Server actions accept bodies up to 20mb (`next.config.mjs`) for uploads.
- Do not set `APP_ORIGIN` to a unique deployment URL (`*.vercel.app` preview host). Inactivity and late-login links use it. Production example in `.env.example` is `https://madiba-sfa.vercel.app`.

Pushing the git repo does **not** apply SQL. Schema changes need a person to run `supabase/migrations` or the matching `sql/` script on that environment’s Supabase project.

## Environment variable names

Values belong in Vercel, GitHub Actions secrets, or a local `.env.local` that is gitignored. Names from `.env.example`:

| Name | Role |
| --- | --- |
| `NEXT_PUBLIC_APP_ENV` | `staging` or `production` |
| `APP_ORIGIN` | Stable public URL for email links |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser and server |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser only |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Bypasses RLS |
| `CRON_SECRET` | Cron and price-sync auth. Different per environment |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Single-line service account for FCM |
| `PRICE_SOURCE_URL` | Optional upstream price sheet. The app has a fallback if omitted |
| `NEXT_PUBLIC_COLLECTION_WHATSAPP_NUMBER` | Optional pre-filled WhatsApp number |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | SMTP. `SMTP_FROM` is required for SMTP and Resend |
| `RESEND_API_KEY` | Alternative mail transport |
| `DAILY_VISIT_REPORT_TO` | Extra visit-report inbox |
| `DAILY_VISIT_REPORT_SEND_TO_USERS` | `false` sends only the extra inbox |
| `DAILY_SALESMAN_RESUME_TO` | Resume digest recipients |
| `MISSING_INVOICE_EMAIL_TO`, `MISSING_INVOICE_EMAIL_CC` | Extra invoice-chase addresses |
| `DAILY_SUPPLIER_ORDER_EMAIL_TO`, `DAILY_SUPPLIER_ORDER_EMAIL_CC` | Extra order digest |
| `DAILY_SUPPLIER_ORDER_EMAIL_SEND_TO_USERS` | `false` sends only the combined digest |
| `OUTSTANDING_NO_GPS_EMAIL_TO`, `OUTSTANDING_NO_GPS_EMAIL_CC` | Optional management digest |
| `OUTSTANDING_NO_GPS_EMAIL_SEND_TO_USERS` | `false` skips per-salesman mail |
| `NEXT_PUBLIC_SALESMAN_VISIT_PLAN_SALESMAN_ACCESS` | Field access to the visit plan |
| `SALESMAN_VISIT_PLAN_EMAIL_ENABLED` | Default false |
| `SALESMAN_VISIT_PLAN_EMAIL_SEND_TO_USERS` | Default false |
| `SALESMAN_VISIT_PLAN_EMAIL_TO` | Admin digest |
| `MIN_ANDROID_APK_VERSION_CODE` | `0` disables the block |
| `MIN_ANDROID_APK_VERSION_NAME` | Display name for the block |
| `ANDROID_APK_DOWNLOAD_URL` | Where the update prompt sends the user |
| `CAPACITOR_SERVER_URL` | Optional. Android shell target. Default is production Vercel |

GitHub Actions secrets used by workflows (names only): `CRON_SECRET`, `PRICE_SYNC_URL`, `INACTIVITY_PUSH_URL`, `AUTO_CLOSE_WORKDAYS_URL`, `DAILY_VISIT_REPORT_EMAIL_URL`, `DAILY_SALESMAN_RESUME_EMAIL_URL`, `DAILY_SUPPLIER_ORDER_EMAIL_URL`, `MISSING_INVOICE_EMAIL_URL`, `OUTSTANDING_NO_GPS_EMAIL_URL`, `SALESMAN_VISIT_PLAN_EMAIL_URL`, `MOBILE_SNAPSHOT_URL`. Each workflow falls back to `https://madiba-sfa.vercel.app` plus the matching path if the URL secret is empty or points at the wrong path.

## Schedules

Times below are the intent written in the workflow comments. GitHub cron is UTC. KSA is UTC+3 with no DST.

| Workflow | UTC cron | KSA intent | Endpoint |
| --- | --- | --- | --- |
| `vercel.json` inactivity | `*/10 * * * *` | Every 10 minutes | `/api/cron/inactivity-push` |
| `inactivity-push.yml` | Manual only | Backup trigger | same |
| `auto-close-workdays.yml` | `59 20 * * *` and `5 21 * * *` | 23:59 and 00:05 KSA | `/api/cron/auto-close-workdays` |
| `salesman-visit-plan-email.yml` | `0 21 * * *` | 00:00 KSA, build snapshot then maybe email | `/api/cron/salesman-visit-plan-email` |
| `daily-visit-report-email.yml` | `10 21 * * 0-3,5,6` | 00:10 KSA, skip Friday | `/api/cron/daily-visit-report-email` |
| `daily-salesman-resume-email.yml` | `15 21 * * *` | 00:15 KSA previous day | `/api/cron/daily-salesman-resume-email` |
| `daily-supplier-order-email.yml` | `20 21 * * 0-3,5,6` | 00:20 KSA, skip Friday | `/api/cron/daily-supplier-order-email` |
| `outstanding-no-gps-email.yml` | `25 21 * * 0-3,5,6` | 00:25 KSA, skip Friday | `/api/cron/outstanding-no-gps-email` |
| `price-sync.yml` | `0 */8 * * *` | Every 8 hours | `/api/admin/price-sync` |
| `mobile-snapshot.yml` | `0 */4 * * *` | Every 4 hours, batched | `/api/cron/mobile-snapshot` |
| `missing-invoice-email.yml` | Every 15 min, 03:30–14:30 UTC, days `0-4,6` | 09:00–20:00 IST, Saturday–Thursday. Backup for pg_cron | `/api/cron/missing-invoice-email` |

Cron requests send header `x-cron-secret`. Price sync is the same header, not a user session.

## Local development

```bash
npm ci
npm run dev
```

`npm run dev` uses `scripts/dev-server.mjs`. `npm run dev:clean` and `npm run dev:stop` are the other local helpers. Copy `.env.example` to `.env.local` and fill staging keys only.

Customer location import: `npm run import:customer-locations` (`scripts/import-customer-locations.mjs`). It requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.

Tests:

```bash
node --test tests/moduleAccess.test.mjs
node --test tests/*.test.mjs
```

There is no `npm test` script.

## Android

See `ANDROID_APK.md` for the full operator guide. Architecture summary is in `docs/ARCHITECTURE.md` under “Android / Capacitor”.

Short version:

- App id `com.madiba.sfa`. The WebView loads the hosted site (`CAPACITOR_SERVER_URL` or production Vercel).
- Play internal testing is the field rollout path (`.github/workflows/play-store-internal.yml`).
- Debug/release APK: `.github/workflows/android-apk.yml` or `npm run cap:build:apk` (PowerShell script).
- `npm run cap:sync` / `cap:open:android` need Android Studio.
- Minimum version is enforced at login via env and `system_settings.android_apk_min_version_v1`.
- Phones need Location → All the time, notifications, and Battery → Unrestricted before login/morning attendance.
- Native idle GPS: every 5 minutes while running; save idle ping after 15 minutes without visit/order/collection. Inactivity lock-screen alert at 45 minutes, repeats every 15 minutes. Pauses during lunch.
- Preserve this behavior unless the task explicitly changes Android/Capacitor.

Do not commit keystores, `android/keystore.properties`, or paste server private keys into `google-services.json`. `android/app/google-services.json` is currently tracked as Firebase client config.

## Supabase pg_cron

`supabase/migrations/20260910120000_missing_invoice_pg_cron.sql` schedules the missing-invoice email from Postgres. It expects the app URL and a Vault secret. Read that file before changing the cron expression or the endpoint path. GitHub Actions remains the backup if pg_cron is not installed on the project.

## What a production change needs

1. Code on `main` after the staging PR path above, unless the task is an emergency fix the user explicitly wants on `main`.
2. Vercel env changes, if new names were added, on **both** projects when both environments should run the feature.
3. SQL applied to the matching Supabase project.
4. GitHub secret changes only when a new cron URL is introduced. Existing workflows already default to the production host.
5. No service-role key in the client bundle. Only `NEXT_PUBLIC_*` values are public, and those must still not be the service role.
