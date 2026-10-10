# Deployment

## Backups and Recovery

`.github/workflows/google-drive-backup.yml` schedules PostgreSQL backups every six hours and full database/Storage/Git/configuration backups nightly, encrypted to Google Drive. The workflow is inactive until configured and enabled with repository variable `BACKUP_ENABLED=true` on `main`; production credentials belong only in the protected `production-backup` GitHub environment, never local env files. Recovery archives omit secret values and Android signing material. Cleanup is opt-in and disabled by default. `backup-health.yml` alerts through GitHub issues on failed or overdue exports. Setup, Free-plan quota risks, retention, custody, and the isolated restore drill are documented in `docs/BACKUP_RECOVERY.md`. No database migration or app-runtime behavior change.

## Environments

There is **no permanent cloud staging environment**. Local PC covers development and staging. Cloud is production only.

| Environment | Where | Git | Hosting | Database |
| --- | --- | --- | --- | --- |
| Local / staging | Developer PC | Working / feature / AI branch | `npm run dev` | Local / dev Supabase only |
| Production | Cloud | `main` | Vercel production | Production Supabase |

Never put production Supabase keys in `.env.local` or any local/dev config.

Canonical release path:

```text
local/dev  →  feature or AI branch  →  PR + CI validation  →  main  →  Vercel production
```

1. Develop, test, and stage on the local PC against local/dev Supabase.
2. Push a temporary feature or AI branch and open a pull request into `main`.
3. GitHub Actions job `Build` must pass.
4. Merge into `main`. Vercel deploys production from `main` only.

`Build` (`.github/workflows/build.yml`) runs on pull requests and pushes to `main`: `npm ci` then `npm run build`. Node comes from `.nvmrc` (22). Play Store internal uploads (`.github/workflows/play-store-internal.yml`) are `main`-only. Scheduled cron workflows call the **production** Vercel host (`https://madiba-sfa.vercel.app`); they do not depend on a staging branch.

`NEXT_PUBLIC_APP_ENV` of `local`, `development`, `dev`, or legacy `staging` turns on the yellow `LOCAL / DEV - TEST DATA ONLY` banner and labels the shell `LOCAL` (`app/lib/appEnvironment.js`). Production Vercel must keep `NEXT_PUBLIC_APP_ENV=production` (or unset). Prefer an explicit `APP_ORIGIN` for email links; non-production without `APP_ORIGIN` falls back to `http://localhost:3000`, not a cloud staging host.

## Vercel

- Framework: Next.js. `npm run build` / `npm run start`.
- `vercel.json` registers one cron: `GET/POST` path `/api/cron/inactivity-push` on `*/10 * * * *`. Other schedules are GitHub Actions because Hobby cron limits were a problem for the 8-hour price sync and the KSA midnight jobs.
- Server actions accept bodies up to 20mb (`next.config.mjs`) for uploads.
- Do not set `APP_ORIGIN` to a unique deployment URL (`*.vercel.app` preview host). Inactivity and late-login links use it. Production example in `.env.example` is `https://madiba-sfa.vercel.app`.

Pushing the git repo does **not** apply SQL. Schema changes need a person to run `supabase/migrations` or the matching `sql/` script on that environment’s Supabase project.

Product Catalogue currently needs no migration, image bucket, new environment variables or Android rebuild. The previously proposed photo migration was removed without being applied. Image-storage integration is deferred to the separate receipt/image-storage project. Verify existing products/packing and salesman browse/cart after release; admin/manager image selection is a temporary page-only preview, not an upload. The feature is not live merely because local code and tests are complete.

### Retail price-feed operator step

Git/Vercel deployment does not update Google Apps Script. Copy [the updated price feed](../scripts/google-apps-script/price-feed.gs) into the **existing** Apps Script project, then edit the **existing web-app deployment** to use a new version so its URL stays unchanged. Run the existing admin price sync and verify `/api/pricing/cache` returns positive `retailRegionPriceMaps` for each configured city. Until then, wholesale remains usable, retail is unavailable with an explicit notice, and retail order saves are rejected rather than converted to wholesale.

The private costing spreadsheet ID is `15DFVFiwKkv3rNdHZkxYzOpGdfFgpc7AkyQGUq6QIzJc` (uppercase `I` in `q6QI`); its tab is `2077649997`. Do **not** publish this workbook or change sharing. Retail reads CD/CH/CJ (Riyadh/Dammam/Jeddah), ex-VAT. Packing independently reads the already-public KSA Price Tag Format tab `612911319`, AM descriptions keyed by B product code, and does not require a database migration. Validate Cash/Credit, discount thresholds, nearest customers, never-bought recommendations and retail draft/PDF consistency before promotion. Local completion does not mean these enhancements are deployed.

On 2026-10-09 the operator reported updating Google Apps Script. A read-only check of the existing feed confirmed 268 retail item prices for each city (and 297 Riyadh wholesale prices). Production promotion follows PR/CI; run the existing price sync after deployment to persist retail maps in the cache.

### Production database migration workflow

`.github/workflows/production-db-migrations.yml` is a manually dispatched, audited path for exactly these existing migrations: `20260930190000_sales_order_request_id.sql`, `20261002120000_collection_visit_client_submission_id.sql`, and `20261002130000_attachments.sql`. It does not run on push, pull request, or a schedule. The default `preflight` mode is read-only. This workflow does not use `db push` or `migration up`, and it does not change Storage buckets or policies. The workflow and its runner are committed to the feature branch only until separately reviewed and merged; **no production SQL, GitHub environment, secret, or variable was changed as part of their implementation**.

Before anyone dispatches it, a repository administrator must create the protected GitHub environment `production-db` and configure:

- Required reviewers, prevent self-review, and disable administrator bypass. Restrict deployment branches to `main`; do not allow feature branches.
- Environment secrets `PRODUCTION_DB_READONLY_URL`, `PRODUCTION_DB_MIGRATION_URL`, and `PRODUCTION_DB_ROOT_CA_CERT`. Use separate least-privilege PostgreSQL credentials and direct URLs for `db.ynmtlzyqvmurpmfretji.supabase.co:5432/postgres?sslmode=verify-full`. Set the CA secret to the PEM root certificate downloaded from Supabase Database Settings. The workflow writes it to a permission-restricted runner-temp file and passes only its path as `PGSSLROOTCERT`. Never put either URL or the certificate in the repository, local environment files, logs, or summaries.
- The read-only role must be the direct login identity, not a superuser, `BYPASSRLS`, `CREATEDB`, `CREATEROLE`, replication role, database/schema/object owner, or a member that can `SET ROLE` to a role with protected privileges or any role-membership `ADMIN OPTION`. It must have no database `CREATE`/`TEMP`, no `CREATE` on any non-system schema, and no effective table, column, sequence, trigger, or PostgreSQL 17+ `MAINTAIN` write/delegation privileges anywhere in non-system schemas (including rights inherited from memberships or `PUBLIC`).
- The read-only role needs `USAGE` on `public` and `supabase_migrations`, `SELECT` on the migration ledger's `version`, the inspected preflight columns, and catalog relations used for schema/role/RLS inspection. Schema, privilege, and ledger inspection always use `PRODUCTION_DB_READONLY_URL` only. That role is not expected to see every application row under RLS.
- The migration role must not be a superuser. It needs `CREATE` on `public`, direct ownership of existing `sales_orders`, `collection_visits`, and `customer_documents` tables (and `attachments` if it already exists), and `SELECT`/`INSERT`/`UPDATE` on `supabase_migrations.schema_migrations` for `migration repair`. It must not have `CREATE` on `supabase_migrations`. Grant no broader access than required.
- Preflight also requires `PRODUCTION_DB_MIGRATION_URL` so duplicate/orphan aggregate checks can run with full-row visibility. Those checks use only fixed allowlisted `SELECT count(*)` statements inside `BEGIN READ ONLY` with `statement_timeout`, `lock_timeout`, and `ON_ERROR_STOP`. Before scanning, the runner verifies migration-role table ownership, RLS/`FORCE ROW LEVEL SECURITY` status, and `row_security_active()` for each scanned table. It does not grant `BYPASSRLS`, change policies, or treat SELECT alone as proof of complete visibility. Preflight never runs migration files, DDL/DML, or `migration repair` on that URL; apply remains a separately gated mode.
- Environment variable `PRODUCTION_DB_MIGRATIONS_ENABLED` should remain unset or `false` until a separately approved apply. Apply requires setting it to exactly `true`; `PRODUCTION_DB_PROJECT_REF` may be omitted because the runner pins and checks the production ref, or set to `ynmtlzyqvmurpmfretji`.

Before any DB command, the workflow verifies that `production-db` exists, requires at least one reviewer, disallows administrator bypass, and has exactly one deployment branch policy for `main`. The GitHub read API does not expose the prevent-self-review setting, so administrators must enable and verify that separately in the environment settings.

Operator sequence after the environment is approved and configured:

1. From **Actions → Production DB migrations → Run workflow**, dispatch from `main`, choose `preflight`, and enter the full 40-character current `main` SHA under review. The job verifies the event, checkout, reviewed SHA, and fetched `main` all match before connecting. Both database URLs must be present. Read-only credential checks, migration ledger/catalog checks, migration-role integrity visibility, allowlisted duplicate/orphan counts, and unrelated-pending-migration checks must all pass.
2. Review the sanitized job summary and migration files at that exact SHA. A blocked preflight is a stop condition; resolve the reported schema/history issue through the normal database change review, then run a new preflight. Do not treat an empty ledger or a successful connection alone as approval.
3. Only with separate explicit authorization to apply, dispatch the same workflow at the same current `main` SHA in `apply` mode. Supply the successful matching preflight run ID and type `APPLY ` followed by the exact SHA. The environment approval, enabled repository variable, SHA checks, allowlist, SQL safety checks, and migration-role write checks are independent gates. PostgreSQL client 16 (`psql`) runs each exact allowlisted file with `ON_ERROR_STOP` inside its explicit transaction; Supabase CLI v2.120.0 `db query` uses the extended protocol and rejects multi-statement files. The pinned CLI performs history-only `migration repair` after SQL succeeds. The workflow then repeats schema/ledger verification on the read-only URL and integrity counts on the migration URL.

Preflight verifies that the migration ledger has exactly three columns (`version text NOT NULL`, `name text`, and `statements text[]`), RLS disabled, one non-deferrable primary key on `version`, no other constraints, and no user triggers. This prevents `migration repair` from provisioning ledger DDL or failing its upsert after migration SQL runs. On the read-only URL it checks both the authenticated session identity and effective role, role attributes, ownership dependencies, database/schema privileges, table and column ACLs including grant options, sequence access, catalog access, and scan-column SELECT. It enumerates roles that can create/write/own user objects and rejects membership paths that permit `SET ROLE` or administer role memberships. PostgreSQL 16+ uses `pg_has_role(..., 'SET')`; earlier versions conservatively use `MEMBER`. `NOINHERIT` is not used as a safety assumption. Duplicate/orphan invariants run only on the migration URL after ownership and `row_security_active`/FORCE checks, using fixed allowlisted aggregate SELECTs in a read-only transaction. Preflight keeps a mutation gate closed so migration files, DDL/DML, and `migration repair` cannot run even if an error path is hit.

The job summary records the actor, SHA, project ref, allowlisted versions, preflight, execution and post-verification status, without database URLs or raw CLI output. Any failure after an execution or history-recording attempt is classified as potentially committed; inspect the runner audit and database schema/ledger before retrying. A migration that committed but whose history record failed is reported as schema-present/history-missing; rerunning a reviewed apply records that verified schema in the ledger without re-executing SQL. Conflicts, partial schema, unrelated pending migrations, and untracked applied versions block execution and require separate investigation. Never use `db push`, `migration up`, or manually mark a version applied to bypass a blocker.

Attachment storage privacy is order-sensitive: run `sql/attachment_storage_phase2_step1_drop_browser_policies.sql` any time, but run `sql/attachment_storage_phase2_step2_private_buckets.sql` only after the Phase 2 build is live. Do not promote (Instant Rollback) a pre-Phase-2 Vercel deployment afterwards: those builds call `updateBucket(public: true)` on every collection upload.

### Production database access provisioning

DBA review SQL (discovery + commented provisioning) lives in `sql/production_migration_access_dba_review.sql`. It is **not** a migration and must not be applied until separately authorized. All provisioning DDL in that file stays commented and marked **NOT EXECUTED**.

**Migration identity:** the login used in `PRODUCTION_DB_MIGRATION_URL` must be the **direct owner** of each existing target table (`sales_orders`, `collection_visits`, `customer_documents`, and `attachments` if present), must not be a superuser (so `postgres` fails), and must satisfy `CREATE` on `public` plus ledger `SELECT`/`INSERT`/`UPDATE` for apply. Prefer **reusing** an existing non-superuser table-owner LOGIN when discovery confirms one owner for all existing targets with `rolcanlogin` and not `rolsuper`. Create `madiba_mig_owner` and transfer ownership only when no such login exists. Creating roles alone never grants ownership of existing tables.

**Do not change existing `PUBLIC` privileges** (including database `CONNECT`/`TEMP`/`CREATE` or schema grants) without a separate impact assessment. The review script must not revoke privileges from `PUBLIC`.

Before any ownership transfer, inspect dependent sequences (section A of the review SQL) and record current table/sequence owners for rollback.

| Capability | `madiba_mig_readonly` | Migration owner login (`madiba_mig_owner` or reused owner) |
| --- | --- | --- |
| Login / `session_user = current_user` | Required | Required |
| Superuser / BYPASSRLS / CREATEDB / CREATEROLE / REPLICATION | Forbidden | Forbidden |
| Own database / unrelated schemas / unrelated relations | Forbidden | Forbidden except listed targets |
| DB `TEMP` | Forbidden | Forbidden |
| Schema `USAGE` | `public`, `supabase_migrations` | `public`, `supabase_migrations` |
| Schema `CREATE` | Forbidden | `public` only; never `supabase_migrations` |
| Catalog `SELECT` | Relations listed in the runner `PREFLIGHT_CATALOG_RELATIONS` | Not used on the readonly path |
| Column `SELECT` | Preflight columns in `PREFLIGHT_DATA_COLUMNS` when present | Via table ownership |
| Ledger | `SELECT (version)` only | `SELECT` / `INSERT` / `UPDATE` |
| Direct table ownership | Forbidden | Required for each existing target |
| Preflight use | Catalog, privilege, ledger inspection | Ownership/RLS/FORCE visibility + allowlisted `BEGIN READ ONLY` aggregates |
| Apply use | Post-apply re-verification | Allowlisted migration files + `migration repair` |

Connection secrets (set only in the GitHub `production-db` environment; never commit passwords):

- `PRODUCTION_DB_READONLY_URL` → `postgresql://madiba_mig_readonly:<password>@db.ynmtlzyqvmurpmfretji.supabase.co:5432/postgres?sslmode=verify-full`
- `PRODUCTION_DB_MIGRATION_URL` → same host/db/sslmode with the chosen migration owner login
- `PRODUCTION_DB_ROOT_CA_CERT` → full PEM from Supabase Database Settings

Use direct port **5432**, not the pooler. Keep `PRODUCTION_DB_MIGRATIONS_ENABLED` unset or `false` until a separate apply approval.

**Rollback (authorized DBA only):** restore recorded prior table/sequence owners; revoke only grants that were added for these roles; drop the new roles only after they own nothing and secrets no longer reference them. Do not “fix” `PUBLIC` privileges by guessing.

First preflight with Prevent self-review: a **non-`malik1358`** GitHub account with Actions run permission dispatches from `main` (`mode=preflight`, full current `main` SHA). The job waits on `production-db` environment approval; **`malik1358`** reviews and approves. Do not dispatch until roles/owner login choice, any ownership transfers, and the three secrets are authorized and configured. Do not enable apply until a successful preflight is separately approved.

Authorization blockers before any production DB change or first preflight: nominate the dispatcher account; authorize discovery SQL; decide reuse vs create+transfer for the migration owner; authorize readonly role creation and grants; authorize environment secrets; confirm whether `attachments` already exists.

## Environment variable names

Values belong in Vercel, GitHub Actions secrets, or a local `.env.local` that is gitignored. Names from `.env.example`:

| Name | Role |
| --- | --- |
| `NEXT_PUBLIC_APP_ENV` | `local` / `development` / `production` (legacy `staging` = non-production) |
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
| `DAILY_POTENTIAL_SALES_TARGETS_TO` | Optional comma-separated recipients for the separate daily full target digest, grouped by salesman |
| `DAILY_SALESMAN_RESUME_TO` | Resume digest recipients |
| `MATCHED_RECEIPT_EMAIL_ENABLED` | Set `true` in Vercel production to send daily salesman mail and consolidated hierarchy-boss digests after the preview is approved; remains false by default in local/dev |
| `MISSING_INVOICE_EMAIL_TO`, `MISSING_INVOICE_EMAIL_CC` | Extra invoice-chase addresses |
| `DAILY_SUPPLIER_ORDER_EMAIL_TO`, `DAILY_SUPPLIER_ORDER_EMAIL_CC` | Extra order digest |
| `DAILY_SUPPLIER_ORDER_EMAIL_SEND_TO_USERS` | `false` sends only the combined digest |
| `OUTSTANDING_NO_GPS_EMAIL_TO`, `OUTSTANDING_NO_GPS_EMAIL_CC` | Optional management digest |
| `CUSTOMER_GPS_CHANGE_EMAIL_TO` | Optional GPS-change digest override; defaults to `malik@pinasz.com`, no recipient configuration required |
| `OUTSTANDING_RECONCILE_EMAIL_TO`, `OUTSTANDING_RECONCILE_EMAIL_CC` | Extra Tally vs SFA difference recipients (added to the built-in list) |
| `OUTSTANDING_RECONCILE_EMAIL_TEST_TO` | Send the difference report only to these addresses and skip the dedupe marker |
| `OUTSTANDING_NO_GPS_EMAIL_SEND_TO_USERS` | `false` skips per-salesman mail |
| `NEXT_PUBLIC_SALESMAN_VISIT_PLAN_SALESMAN_ACCESS` | Field access to the visit plan |
| `SALESMAN_VISIT_PLAN_EMAIL_ENABLED` | Default false |
| `SALESMAN_VISIT_PLAN_EMAIL_SEND_TO_USERS` | Default false |
| `SALESMAN_VISIT_PLAN_EMAIL_TO` | Admin digest |
| `MIN_ANDROID_APK_VERSION_CODE` | `0` disables the block |
| `MIN_ANDROID_APK_VERSION_NAME` | Display name for the block |
| `ANDROID_APK_DOWNLOAD_URL` | Where the update prompt sends the user |
| `CAPACITOR_SERVER_URL` | Optional. Android shell target. Default is production Vercel |
| `ATTACHMENT_WRITE_PROVIDER` | Server-only. `supabase` (default) or `r2` |
| `ATTACHMENT_DUAL_WRITE` | Server-only. `1` = best-effort Supabase copy while R2 is primary. Default `0` |
| `ATTACHMENT_FORCE_SUPABASE_READS` | Server-only rollback switch for reads |
| `ATTACHMENT_SIGNED_URL_TTL_SECONDS` | Server-only. Default 300, max 900 |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT` | Server-only Cloudflare R2 S3 API credentials (bucket-scoped token). Never `NEXT_PUBLIC_` |

### Cloudflare R2

- Buckets: `madiba-attachments-dev` (local/dev) and `madiba-attachments-prod` (Vercel production only). Both private: no r2.dev URL, no custom domain. `app/lib/storage/r2Guard.js` blocks the prod bucket unless `VERCEL_ENV=production` **and** `NEXT_PUBLIC_SUPABASE_URL` is the production project, and blocks any non-prod bucket in Vercel production. Preview deployments may only use the dev bucket.
- `R2_ENDPOINT` must be the account S3 endpoint (`https://<account>.r2.cloudflarestorage.com`, or `https://<account>.<jurisdiction>.r2.cloudflarestorage.com` for a jurisdiction bucket).
- **Location / jurisdiction decision (record here when the production bucket is created):** _not decided yet_ — bucket location hint: …, jurisdiction: …, endpoint: …, decided by/date: ….
- Switching production to R2 is a separate, approved step (Phase 4): set `ATTACHMENT_WRITE_PROVIDER=r2` (and `ATTACHMENT_DUAL_WRITE=1` for the verification period) in Vercel production only.

GitHub Actions secrets used by workflows (names only): `CRON_SECRET`, `PRICE_SYNC_URL`, `INACTIVITY_PUSH_URL`, `AUTO_CLOSE_WORKDAYS_URL`, `DAILY_VISIT_REPORT_EMAIL_URL`, `DAILY_SALESMAN_RESUME_EMAIL_URL`, `MATCHED_RECEIPT_EMAIL_URL`, `DAILY_SUPPLIER_ORDER_EMAIL_URL`, `MISSING_INVOICE_EMAIL_URL`, `OUTSTANDING_NO_GPS_EMAIL_URL`, `SALESMAN_VISIT_PLAN_EMAIL_URL`, `MOBILE_SNAPSHOT_URL`. Each workflow falls back to `https://madiba-sfa.vercel.app` plus the matching path if the URL secret is empty or points at the wrong path.

## Schedules

Times below are the intent written in the workflow comments. GitHub cron is UTC. KSA is UTC+3 with no DST.

| Workflow | UTC cron | KSA intent | Endpoint |
| --- | --- | --- | --- |
| `vercel.json` inactivity | `*/10 * * * *` | Every 10 minutes | `/api/cron/inactivity-push` |
| `inactivity-push.yml` | Manual only | Backup trigger | same |
| `auto-close-workdays.yml` | `59 20 * * *` and `5 21 * * *` | 23:59 and 00:05 KSA | `/api/cron/auto-close-workdays` |
| `salesman-visit-plan-email.yml` | `0 21 * * *` | 00:00 KSA, build snapshot then maybe email | `/api/cron/salesman-visit-plan-email` |
| `daily-visit-report-email.yml` | `10 21 * * 0-3,6`; `0 3 * * 6` | 00:10 KSA Mon–Thu and Sunday; Thursday report Saturday 06:00 KSA | `/api/cron/daily-visit-report-email` |
| `daily-salesman-resume-email.yml` | `15 21 * * 0-3,6`; `0 3 * * 6` | 00:15 KSA Mon–Thu and Sunday; Thursday report Saturday 06:00 KSA | `/api/cron/daily-salesman-resume-email` |
| `matched-receipt-email.yml` | `35 21 * * *` | 00:35 KSA daily, catch up yesterday's matched app receipts | `/api/cron/matched-receipt-email` |
| `daily-supplier-order-email.yml` | `20 21 * * 0-3,5,6` | 00:20 KSA, skip Friday | `/api/cron/daily-supplier-order-email` |
| `outstanding-no-gps-email.yml` | `25 21 * * 0-3,5,6` | 00:25 KSA, skip Friday | `/api/cron/outstanding-no-gps-email` |
| `collection-stale-overdue-email.yml` | `35 21 * * 0-3,5,6` | 00:35 KSA, skip Friday | `/api/cron/collection-stale-overdue-email` |
| `customer-gps-change-email.yml` | `40 21 * * *` | 00:40 KSA every day, including Friday; previous completed KSA calendar day | `/api/cron/customer-gps-change-email` |
| `price-sync.yml` | `0 */8 * * *` | Every 8 hours | `/api/admin/price-sync` |
| `mobile-snapshot.yml` | `0 */4 * * *` | Every 4 hours, batched | `/api/cron/mobile-snapshot` |
| `missing-invoice-email.yml` | Every 15 min at :05/:20/:35/:50 UTC | Five-minute-offset backup for pg_cron; supports the 00:05 KSA midnight fallback | `/api/cron/missing-invoice-email` |
| `KPI Targets Email` | Manual dispatch only | Operator-selected month; no scheduled sends | `/api/cron/kpi-targets-email` |

KPI target edits notify affected salespeople after the save and CC their complete reporting chain. To manually send a month to all active KPI-eligible salespeople, run **Actions → KPI Targets Email → Run workflow**, selecting `2026-10` for the October 2026 targets. The workflow uses the existing `CRON_SECRET` and production Vercel host; it adds no secrets or schedule.

Cron requests send header `x-cron-secret`. Price sync is the same header, not a user session.

### Customer GPS digest activation and recovery

Production release preparation is dated **2026-10-06**, pending PR CI and merge; it is not yet a confirmed production deployment. Activation requires the approved merge to `main` and successful Vercel deployment, the existing configured SMTP or Resend transport (including `SMTP_FROM`), and the existing GitHub `CRON_SECRET` for the workflow's POST to `/api/cron/customer-gps-change-email`. No new recipient setting or enable flag is needed; `CUSTOMER_GPS_CHANGE_EMAIL_TO` is optional. The workflow also supports manual dispatch. It sends zero-change summaries and does not skip Friday.

No new schema migration is required. Verify the existing `customer_gps_history` schema is present; if absent, apply `supabase/migrations/20260831153000_customer_gps_history.sql` or `sql/setup_customer_gps_history.sql` separately in Supabase before using history/report/digest. Git deployment does not apply SQL.

Each report date is protected by an atomic `system_settings` key `customer_gps_change_email:<date>`: `sending` with a claim `token` and `claimedAt`, followed after delivery by `sent` with `sentAt` and `changeCount`. Duplicate runs skip existing keys. Provider failure releases only the caller's own claim. An interrupted `sending` claim requires inspection of provider delivery before manual recovery; do not clear it blindly. If email sends but saving the sent marker fails, keep the claim to prevent duplicate delivery. There is no force-send bypass.

## Local development

```bash
npm ci
npm run dev
```

`npm run dev` uses `scripts/dev-server.mjs`. `npm run dev:clean` and `npm run dev:stop` are the other local helpers. Copy `.env.example` to `.env.local` and fill **local/dev Supabase** keys only. Never paste production Supabase URL or service-role keys into `.env.local`.

Local/dev (any non-Vercel **server** runtime) **fail fast** if `NEXT_PUBLIC_SUPABASE_URL` points at the production Supabase project (`ynmtlzyqvmurpmfretji`). The guard lives in `app/lib/supabaseGuard.js`, runs from `instrumentation.js`, `getSupabaseClient()` on the server, `scripts/dev-server.mjs`, and `scripts/import-customer-locations.mjs`. Vercel production and preview deploys are not blocked (`VERCEL` / `VERCEL_ENV`). The browser never enforces this guard: those Vercel vars are not `NEXT_PUBLIC_*`, so they are absent from the client bundle; throwing there crashed production hydration after PR #315. Local next dev is still blocked on the server before pages load. Emergency override only: `MADIBA_ALLOW_PRODUCTION_SUPABASE=1` (do not use casually).

Customer location import: `npm run import:customer-locations` (`scripts/import-customer-locations.mjs`). It requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.

Tests:

```bash
node --test tests/moduleAccess.test.mjs
node --test tests/*.test.mjs
```

Historical salesperson home-location review (read-only, local/dev Supabase only):

```bash
node scripts/audit-salesman-home-locations.mjs
```

The script refuses the production Supabase project, reports candidate clusters on six or more distinct KSA dates, and does not change data. Review candidates before assigning inferred home points.

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

1. Code on `main` after the local → feature/AI branch → PR/CI path above, unless the task is an emergency fix the user explicitly wants on `main`.
2. Vercel env changes, if new names were added, on the **production** project.
3. SQL applied to the **production** Supabase project (and to local/dev when developing the feature).
4. GitHub secret changes only when a new cron URL is introduced. Existing workflows already default to the production host.
5. No service-role key in the client bundle. Only `NEXT_PUBLIC_*` values are public, and those must still not be the service role.
6. In every production-promotion summary, list every user-visible change included in the release and identify the PR, merge commit, and deployed build. Do not report only the latest requested item.
