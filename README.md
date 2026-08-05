# madiba-sfa
KSA Sales Force Automation System

## Price Cache Sync (Every 8 Hours)

The app now reads price data from Supabase cache instead of calling the live sheet API from the browser.

### 1) Run SQL setup once

Run [sql/setup_price_catalog_cache.sql](sql/setup_price_catalog_cache.sql) in Supabase SQL Editor.

### 2) Add environment variables

- NEXT_PUBLIC_SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- CRON_SECRET

### 3) Automatic schedule

The sync endpoint is scheduled via [vercel.json](vercel.json) to run every 8 hours:

- Path: /api/admin/price-sync
- Cron: 0 */8 * * *

### 4) Manual sync (optional)

You can trigger a manual sync with:

curl -X POST https://YOUR_DOMAIN/api/admin/price-sync \
	-H "Authorization: Bearer YOUR_CRON_SECRET"

### 5) Runtime behavior

- Browser pages use /api/pricing/cache
- /api/pricing/cache reads from public.price_catalog_cache
- /api/admin/price-sync inserts a dump into public.price_catalog_snapshots and updates public.price_catalog_cache
