# madiba-sfa
KSA Sales Force Automation System

## Environments

There is **no permanent cloud staging environment**. Local PC is development and staging. Cloud is production only.

| Environment | Where | Git | Hosting | Database |
| --- | --- | --- | --- | --- |
| Local / staging | Developer PC | Any working branch | `npm run dev` | Local / dev Supabase only |
| Production | Cloud | `main` | Vercel production | Production Supabase |

Never put production Supabase credentials in `.env.local` or any local/dev config.

### Release flow

```text
local/dev  →  feature or AI branch  →  PR + CI validation  →  main  →  Vercel production
```

1. Develop, test, and stage on your local PC against local/dev Supabase.
2. Push a temporary feature or AI branch and open a pull request into `main`.
3. Merge only after the GitHub `Build` check passes.
4. Vercel deploys production from `main` only.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for env names, crons, and Android notes. AI agents: start with [AGENTS.md](AGENTS.md) and [docs/](docs/).

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
- Price sync also records changed item prices into public.item_price_history (see [sql/setup_item_price_history.sql](sql/setup_item_price_history.sql))
- Field users can open **Item Price History** under Management to view at least the last 5 catalog prices with dates for an item
