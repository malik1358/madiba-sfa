# madiba-sfa
KSA Sales Force Automation System

## Environments

The application uses two isolated environments:

| Environment | Git branch | Vercel project | Database |
| --- | --- | --- | --- |
| Staging / UAT | `staging` | Separate staging project | Separate staging Supabase project |
| Production | `main` | Existing production project | Production Supabase project |

Never configure the staging Vercel project with production Supabase credentials.

### Release flow

1. Develop and test changes on a feature branch.
2. Open a pull request into `staging`.
3. Merge after the `Build` check passes; developers and UAT test the staging URL.
4. After UAT approval, open a pull request from `staging` into `main`.
5. Merge only after the `Build` check passes. Vercel then deploys production.

### One-time staging setup

1. Create a new Supabase project for staging and apply the same schema as production. Use sanitized test data only.
2. In Vercel, create a second project by importing this GitHub repository.
3. Name it `madiba-sfa-staging` and set its Production Branch to `staging`.
4. Add the variables from [.env.example](.env.example) to the staging Vercel project. Use staging Supabase values and set `NEXT_PUBLIC_APP_ENV=staging`.
5. Keep the existing production Vercel project on `main`, with `NEXT_PUBLIC_APP_ENV=production`.
6. In GitHub branch protection, require pull requests and the `Build` status check for both `staging` and `main`.

The staging deployment displays a yellow `STAGING / UAT - TEST DATA ONLY` banner on every page.

## Internal Android app

See [ANDROID_APK.md](ANDROID_APK.md) for the Capacitor Android shell (GPS tracking, push, field notifications).

| Method | Best for |
| --- | --- |
| **Google Play internal testing** (recommended) | Field rollout — install and update from Play Store |
| **Debug APK** (GitHub Actions → Android APK) | Quick testing before Play is set up |

Quick start after installing Android Studio:

```bash
npm run cap:open:android
```

Or from PowerShell:

```bash
npm run cap:build:apk
```

## Price Cache Sync (Every 8 Hours)

The app now reads price data from Supabase cache instead of calling the live sheet API from the browser.

### 1) Run SQL setup once

Run [sql/setup_price_catalog_cache.sql](sql/setup_price_catalog_cache.sql) in Supabase SQL Editor.

### 2) Add environment variables

- NEXT_PUBLIC_SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- CRON_SECRET
- FIREBASE_SERVICE_ACCOUNT_JSON (Firebase service account JSON for server push)

### 3) Automatic schedule

For Vercel Hobby plans, use GitHub Actions for 8-hour scheduling:

- Workflow: [.github/workflows/price-sync.yml](.github/workflows/price-sync.yml)
- Cron: 0 */8 * * *
- Required GitHub repository secrets:
	- PRICE_SYNC_URL (example: https://madiba-sfa.vercel.app/api/admin/price-sync)
	- CRON_SECRET (same value as Vercel env var CRON_SECRET)

### 4) Manual sync (optional)

You can trigger a manual sync with:

curl -X POST https://YOUR_DOMAIN/api/admin/price-sync \
	-H "Authorization: Bearer YOUR_CRON_SECRET"

### 5) Runtime behavior

- Browser pages use /api/pricing/cache
- /api/pricing/cache reads from public.price_catalog_cache
- /api/admin/price-sync inserts a dump into public.price_catalog_snapshots and updates public.price_catalog_cache
