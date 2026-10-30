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
- **Production only.** There is no cloud staging and no Vercel Preview usage. `vercel.json` → `git.deploymentEnabled` keeps automatic Git deployments on `main` only (`"**": false`, `"main": true`). Feature branches, PRs, and legacy `staging` branches must not create Vercel builds. GitHub Actions `Build` remains the PR validation path.
- `vercel.json` also registers one cron: `GET/POST` path `/api/cron/inactivity-push` on `*/10 * * * *`. Other schedules are GitHub Actions because Hobby cron limits were a problem for the 8-hour price sync and the KSA midnight jobs.
- Server actions accept bodies up to 20mb (`next.config.mjs`) for uploads.
- Do not set `APP_ORIGIN` to a unique deployment URL (`*.vercel.app` preview host). Inactivity and late-login links use it. Production example in `.env.example` is `https://madiba-sfa.vercel.app`.

### Disable preview deployments (operator checklist)

Repo config alone is not enough until every open branch carries the new `vercel.json`, and project settings apply immediately to all Git events. Do both.

**Already applied (2026-10-10) via Vercel API (no production env vars changed):**

| Project | Action |
| --- | --- |
| `madiba-sfa` (`prj_IQgqkii5oWNqViDVpAndqua1lLdI`) | Production Branch already `main`. Ignored Build Step set to only build production: `if [ "$VERCEL_ENV" == "production" ]; then exit 1; else exit 0; fi`. Prioritize production builds already on. Elastic Standard (4 vCPU). No deploy hooks. Retention (2026-10-12): pre-prod/canceled 30 days, production/errored 90 days, keep 10 production deployments. |
| `madiba-sfa-staging` (`prj_Wc51ggmzgJNLHWsI098gpqVtgxm3`) | Not Git-linked. Ignored Build Step set to always skip (`exit 0`). Project paused. |

**Verified again on 2026-10-23** against the live team `maliks-projects-c6b39514`: `madiba-sfa` production branch is `main`, the ignore step still builds production only, retention is still 30/90 days with 10 production deployments kept, and `madiba-sfa-staging` is still paused and unlinked. `vercel.json` on `main` already has `git.deploymentEnabled` for `main` only. Observability for this billing cycle showed production invocations only.

**Still required:**

1. Optional: Deployments → filter Preview → delete stale preview deployments to reduce Function Storage.
2. Verify after the next feature-branch push: GitHub Actions `Build` only — no successful Vercel Preview. Merging to `main` should still create one Production deployment.
3. Do **not** change production environment variables, Supabase URLs/keys, or `APP_ORIGIN` as part of this cost control.

### Build CPU cost notes

Vercel bills **Build CPU Minutes** ≈ wall-clock build minutes × assigned vCPUs (Elastic often 4+). Preview builds for every PR push were the dominant cost when the team opened hundreds of PRs per month. After preview shutdown, expect roughly one production build per merge to `main`, plus rare redeploys. GitHub Actions `npm run build` on PRs does not bill Vercel Build CPU.

Open tabs used to call `/api/build-info` with a unique query and `Cache-Control: no-cache`, so every poll was a function invocation. The route now allows the CDN to reuse one response for 60 seconds. Role access and the login-as user list are no longer refreshed on every auth event. Offline snapshot freshness still comes from the Realtime subscription; the backup poll is two minutes.

Pushing the git repo does **not** apply SQL. Schema changes need a person to run `supabase/migrations` or the matching `sql/` script on that environment’s Supabase project.

Product Catalogue photos use the receipt attachment path. Migration file `20261015084023_product_catalogue_photos_attachments.sql` is already applied on production under ledger stamp `20261015084804` (alias; do not replay). No new environment variables or Android rebuild; file bytes follow the existing `ATTACHMENT_WRITE_PROVIDER` / R2 settings used by receipt copies. After this app release, admin/manager upload and remove persist; salesmen see the carousel read-only. Git/Vercel deploy does not apply SQL.

### Retail price-feed operator step

Git/Vercel deployment does not update Google Apps Script. Copy [the updated price feed](../scripts/google-apps-script/price-feed.gs) into the **existing** Apps Script project, then edit the **existing web-app deployment** to use a new version so its URL stays unchanged. Run the existing admin price sync and verify `/api/pricing/cache` returns positive `retailRegionPriceMaps` for each configured city. Until then, wholesale remains usable, retail is unavailable with an explicit notice, and retail order saves are rejected rather than converted to wholesale.

The private costing spreadsheet ID is `15DFVFiwKkv3rNdHZkxYzOpGdfFgpc7AkyQGUq6QIzJc` (uppercase `I` in `q6QI`); its tab is `2077649997`. Do **not** publish this workbook or change sharing. Retail reads CD/CH/CJ (Riyadh/Dammam/Jeddah), ex-VAT. Packing independently reads the already-public KSA Price Tag Format tab `612911319`, AM descriptions keyed by B product code, and does not require a database migration. Validate Cash/Credit, discount thresholds, nearest customers, never-bought recommendations and retail draft/PDF consistency before promotion. Local completion does not mean these enhancements are deployed.

On 2026-10-09 the operator reported updating Google Apps Script. A read-only check of the existing feed confirmed 268 retail item prices for each city (and 297 Riyadh wholesale prices). Production promotion follows PR/CI; run the existing price sync after deployment to persist retail maps in the cache.

### Production database migration workflow

`.github/workflows/production-db-migrations.yml` is a manually dispatched, audited path for exactly these existing migrations: `20260930190000_sales_order_request_id.sql`, `20261002120000_collection_visit_client_submission_id.sql`, and `20261002130000_attachments.sql`. It does not run on push, pull request, or a schedule. The default `preflight` mode is read-only. This workflow does not use `db push` or `migration up`, and it does not change Storage buckets or policies. The workflow and its runner are committed to the feature branch only until separately reviewed and merged; **no production SQL, GitHub environment, secret, or variable was changed as part of their implementation**.

Before anyone dispatches it, a repository administrator must create the protected GitHub environment `production-db` and configure:

- Required reviewers, prevent self-review, and disable administrator bypass. Restrict deployment branches to `main`; do not allow feature branches.
- Environment secrets `PRODUCTION_DB_READONLY_URL`, `PRODUCTION_DB_MIGRATION_URL`, and `PRODUCTION_DB_ROOT_CA_CERT`. Use separate least-privilege PostgreSQL credentials with `sslmode=verify-full` on port **5432** only (never transaction pooler **6543**). Allowed hosts: direct `db.ynmtlzyqvmurpmfretji.supabase.co`, or the pinned Session Pooler `aws-0-ap-southeast-2.pooler.supabase.com` (IPv4 path for GitHub Actions). Session Pooler usernames must be `role.ynmtlzyqvmurpmfretji` (for example `madiba_mig_readonly.ynmtlzyqvmurpmfretji`). Set `PRODUCTION_DB_ROOT_CA_CERT` to the Supabase Database Settings **Download certificate** PEM (`prod-ca-2021`); Session Pooler verify-full requires that Supabase CA (the AWS RDS regional bundle alone fails pooler hostname verification). A combined PEM that also includes the RDS regional CA is acceptable when keeping both connection modes. The workflow writes the CA to a permission-restricted runner-temp file and passes only its path as `PGSSLROOTCERT`. Never put either URL or the certificate in the repository, local environment files, logs, or summaries.
- The read-only role must be the direct login identity, not a superuser, `BYPASSRLS`, `CREATEDB`, `CREATEROLE`, replication role, database/schema/object owner, or a member that can `SET ROLE` to a role with protected privileges or any role-membership `ADMIN OPTION`. It must have no database `CREATE`, no `CREATE` on any non-system schema, and no effective table, column, sequence, trigger, or PostgreSQL 17+ `MAINTAIN` write/delegation privileges in `public`/`supabase_migrations` (including rights inherited from memberships or `PUBLIC`). Default Supabase `PUBLIC` database `TEMP` and extension-schema grants (`net`/`cron`/etc.) are tolerated so preflight does not require revoking `PUBLIC`.
- The read-only role needs `USAGE` on `public` and `supabase_migrations`, `SELECT` on the migration ledger's `version`, the inspected preflight columns, and catalog relations used for schema/role/RLS inspection. Schema, privilege, and ledger inspection always use `PRODUCTION_DB_READONLY_URL` only. That role is not expected to see every application row under RLS.
- The migration role must not be a superuser. It needs `CREATE` on `public`, direct ownership of existing `sales_orders`, `collection_visits`, and `customer_documents` tables (and `attachments` if it already exists), and `SELECT`/`INSERT`/`UPDATE` on `supabase_migrations.schema_migrations` for `migration repair`. It must not have `CREATE` on `supabase_migrations`. Grant no broader access than required.
- Preflight also requires `PRODUCTION_DB_MIGRATION_URL` so duplicate/orphan aggregate checks can run with full-row visibility. Those checks use only fixed allowlisted `SELECT count(*)` statements inside `BEGIN READ ONLY` with `statement_timeout`, `lock_timeout`, and `ON_ERROR_STOP`. Before scanning, the runner verifies migration-role table ownership, RLS/`FORCE ROW LEVEL SECURITY` status, and `row_security_active()` for each scanned table. It does not grant `BYPASSRLS`, change policies, or treat SELECT alone as proof of complete visibility. Preflight never runs migration files, DDL/DML, or `migration repair` on that URL; apply remains a separately gated mode.
- Environment variable `PRODUCTION_DB_MIGRATIONS_ENABLED` should remain unset or `false` until a separately approved apply. Apply requires setting it to exactly `true`; `PRODUCTION_DB_PROJECT_REF` may be omitted because the runner pins and checks the production ref, or set to `ynmtlzyqvmurpmfretji`.

Before any DB command, the workflow verifies that `production-db` exists, requires at least one reviewer, disallows administrator bypass, and has exactly one deployment branch policy for `main`. The GitHub read API does not expose the prevent-self-review setting, so administrators must enable and verify that separately in the environment settings.

Operator sequence after the environment is approved and configured:

1. From **Actions → Production DB migrations → Run workflow**, dispatch from `main`, choose `preflight`, and enter the full 40-character current `main` SHA under review. The job verifies the event, checkout, reviewed SHA, and fetched `main` all match before connecting. Both database URLs must be present. Read-only credential checks, migration ledger/catalog checks, migration-role integrity visibility, allowlisted duplicate/orphan counts, and unrelated-pending-migration checks must all pass.
2. Review the sanitized job summary and migration files at that exact SHA. A blocked preflight is a stop condition; resolve the reported schema/history issue through the normal database change review, then run a new preflight. Do not treat an empty ledger or a successful connection alone as approval.
3. Only with separate explicit authorization to apply, dispatch the same workflow at the same current `main` SHA in `apply` mode. Supply the successful matching preflight run ID and type `APPLY ` followed by the exact SHA. The environment approval, enabled repository variable, SHA checks, allowlist, SQL safety checks, and migration-role write checks are independent gates. PostgreSQL client 16 (`psql`) runs each exact allowlisted file with `ON_ERROR_STOP` inside its explicit transaction; Supabase CLI v2.120.0 `db query` uses the extended protocol and rejects multi-statement files. The pinned CLI performs history-only `migration repair` after SQL succeeds. The workflow then repeats schema/ledger verification on the read-only URL and integrity counts on the migration URL.

Preflight verifies that the migration ledger has the required repair columns (`version text NOT NULL`, `name text`, and `statements text[]`; extra Supabase columns such as `idempotency_key`/`rollback` are allowed), RLS disabled, a non-deferrable primary key on `version`, only PRIMARY/UNIQUE constraints (no FK/CHECK/EXCLUDE), and no user triggers. This prevents `migration repair` from provisioning ledger DDL or failing its upsert after migration SQL runs. On the read-only URL it checks both the authenticated session identity and effective role, role attributes, ownership dependencies, database/schema privileges, table and column ACLs including grant options, sequence access, catalog access, and scan-column SELECT. It enumerates roles that can create/write/own user objects and rejects membership paths that permit `SET ROLE` or administer role memberships. PostgreSQL 16+ uses `pg_has_role(..., 'SET')`; earlier versions conservatively use `MEMBER`. `NOINHERIT` is not used as a safety assumption. Duplicate/orphan invariants run only on the migration URL after ownership and `row_security_active`/FORCE checks, using fixed allowlisted aggregate SELECTs in a read-only transaction. Preflight keeps a mutation gate closed so migration files, DDL/DML, and `migration repair` cannot run even if an error path is hit.

The job summary records the actor, SHA, project ref, allowlisted versions, preflight, execution and post-verification status, without database URLs or raw CLI output. Any failure after an execution or history-recording attempt is classified as potentially committed; inspect the runner audit and database schema/ledger before retrying. A migration that committed but whose history record failed is reported as schema-present/history-missing; rerunning a reviewed apply records that verified schema in the ledger without re-executing SQL. Conflicts, partial schema, unrelated pending migrations, and untracked applied versions block execution and require separate investigation. Never use `db push`, `migration up`, or manually mark a version applied to bypass a blocker.

**Migration history reconciliation (runner-side, no ledger writes):** Preflight classifies repo vs `supabase_migrations.schema_migrations` using frozen tables in `scripts/productionDbMigrations.mjs`:

- `MIGRATION_VERSION_ALIASES` — dashboard timestamp ↔ repo filename timestamp for the same migration `name`. The ledger row stays authoritative; the repo timestamp is treated as covered only when the migration-role ledger query returns the expected name. This does **not** insert a second ledger row. Includes `20261014070840` ↔ `20261014120000` (`one_morning_attendance_per_ksa_day`): production applied the SQL under the apply-time stamp shortly after PR #552 while the repo file keeps `20261014120000`; unique index `daily_activity_logs_one_morning_per_ksa_day` is already present — do **not** replay the DELETE/index SQL or repair a second ledger row. Also includes `20261015071140` ↔ `20261015120000` (`customer_shares`): same apply-time vs filename stamp pattern after PR #556; table/indexes/RLS already present — do **not** replay or duplicate the ledger row. Also includes `20261015081431` ↔ `20261015080745` (`product_catalogue_photos`): production applied under apply-time stamp while the repo file keeps `20261015080745`; table/index/RLS/service-role grants and private `product-catalogue` bucket already present — do **not** replay or duplicate the ledger row. Also includes `20261015084804` ↔ `20261015084023` (`product_catalogue_photos_attachments`): catalogue photos now use `attachments.category = product_catalogue_photo`; schema already present — do **not** replay or duplicate the ledger row. Also includes `20261016080833` ↔ `20261016120000` (`single_platform_session`): production function `enforce_single_platform_session` is already present — do **not** replay or duplicate the ledger row.
- `LEDGER_ONLY_HISTORY` — production-only ledger rows with no `supabase/migrations/` file (for example `add_sales_profit_amount`, `restore_junaid_activity_reminders_after_leave`). Recognized as historical; do **not** add empty stub migration files that could later be mistaken for applied DDL.
- `ATTESTED_SCHEMA_PRESENT_HISTORY_MISSING` — repo versions attested present in the production schema but absent from the ledger. Clears unrelated-pending blockers only; does **not** run SQL or call `migration repair`. Includes Phase 1 (2026-10-13) attestations: `20260819000000` (sales-batch RPCs + locked EXECUTE), `20260824163000` (**key-only** `android_apk_min_version_v1` — do not replay UPSERT; live `minVersionCode` is ops-managed), `20260831120000` (previous salesman column/index/policy), `20260914190000` (dirty customer-code cleanup scope empty by aggregate counts).
- `PRODUCTION_QUARANTINED_MIGRATIONS` — currently `20260816000001_populate_test_invoices` (test-data seed). Remains pending in classification but never blocks allowlisted work and must never be executed or history-repaired as applied on production.

Readonly credentials keep `SELECT` on ledger `version` only. Named ledger rows (for alias / ledger-only verification) are loaded on `PRODUCTION_DB_MIGRATION_URL` and must match the readonly version set exactly; name mismatches, duplicate alias pairs, and unknown ledger/repo versions fail closed. Allowlisted states stay distinct: `20260930190000` may be schema-present/history-missing; `20261002120000` and `20261002130000` stay genuinely pending until a separately authorized apply. Migrations omitted from the attested list continue to block.

Historical receipt and payment copies can be backed up with Actions **Historical collection copy backup** on `main`. That job only reads R2 and Supabase, encrypts the archive, and uploads it to the private Google Drive backup folder. Receipt and payment-copy reads and new uploads stay on R2; the Supabase rollback flag does not open those files.

Actions **Delete historical collection copies** is the only approved way to remove those Supabase originals. It runs on `main` in the `production-backup` environment, checks the encrypted Drive archive and R2 checksums, then deletes the exact approved keys in batches of 20. Resume mode only continues when every remaining object is still on that allowlist. It does not delete the Drive archive or the R2 originals.

Attachment storage privacy is order-sensitive: run `sql/attachment_storage_phase2_step1_drop_browser_policies.sql` any time, but run `sql/attachment_storage_phase2_step2_private_buckets.sql` only after the Phase 2 build is live. Do not promote (Instant Rollback) a pre-Phase-2 Vercel deployment afterwards: those builds call `updateBucket(public: true)` on every collection upload.

### Production database access provisioning

DBA review SQL (discovery + commented provisioning) lives in `sql/production_migration_access_dba_review.sql`. It is **not** a migration and must not be applied until separately authorized. All provisioning DDL in that file stays commented and marked **NOT EXECUTED**.

Sales-batch RPC EXECUTE lockdown (`sql/security_revoke_sales_batch_rpc_execute.sql`) is likewise **not** a migration and is **not** on the production-db-migrations allowlist. It revokes `EXECUTE` on `merge_sales_batch_by_dates` / `refresh_import_batch_stats` from `PUBLIC`/`anon`/`authenticated` and grants `EXECUTE` to `service_role`. Production was authorized and applied separately; do **not** re-run unless privileges drift. CI/Vercel/app startup never apply `sql/*.sql` automatically.

**Section A coverage (read-only):** PostgreSQL version/TLS; target table ownership + RLS/FORCE RLS; owner login/`rolinherit`/admin attrs; sequence ownership/deps; migration ledger existence/structure; `pg_auth_members` memberships and SET/admin paths for owners and proposed `madiba_mig_*` roles; database `CONNECT`/`CREATE`/`TEMP`; schema `USAGE`/`CREATE` on `public` and `supabase_migrations`; table and preflight column privileges; ledger `SELECT`/`INSERT`/`UPDATE`; exploded database/schema/table ACLs including `PUBLIC` (OID 0). Never selects password hashes. Run **only** the reviewed file `sql/production_migration_access_discovery_section_a.sql` (A1–A12 with `\set ON_ERROR_STOP on`, `BEGIN READ ONLY`, `statement_timeout`/`lock_timeout`, `ROLLBACK`). Do not paste the full DBA review file into `psql` (it also contains commented provisioning).

**Migration identity:** the login used in `PRODUCTION_DB_MIGRATION_URL` must be the **direct owner** of each existing target table (`sales_orders`, `collection_visits`, `customer_documents`, and `attachments` if present), must not be a superuser (so `postgres` fails), and must satisfy `CREATE` on `public` plus ledger `SELECT`/`INSERT`/`UPDATE` for apply. Prefer **reusing** an existing non-superuser table-owner LOGIN when discovery confirms one owner for all existing targets with `rolcanlogin` and not `rolsuper`. Create `madiba_mig_owner` and transfer ownership only when no such login exists. Creating roles alone never grants ownership of existing tables.

**Do not change existing `PUBLIC` privileges** (including database `CONNECT`/`TEMP`/`CREATE` or schema grants) without a separate impact assessment. The review script must not revoke privileges from `PUBLIC`.

Before any ownership transfer, inspect dependent sequences (section A of the review SQL) and record current table/sequence owners for rollback.

| Capability | `madiba_mig_readonly` | Migration owner login (`madiba_mig_owner` or reused owner) |
| --- | --- | --- |
| Login / `session_user = current_user` | Required | Required |
| Superuser / BYPASSRLS / CREATEDB / CREATEROLE / REPLICATION | Forbidden | Forbidden |
| Own database / unrelated schemas / unrelated relations | Forbidden | Forbidden except listed targets |
| DB `TEMP` | Tolerated if from default `PUBLIC` (not revoked) | Tolerated if from default `PUBLIC` (not revoked) |
| Schema `USAGE` | `public`, `supabase_migrations` | `public`, `supabase_migrations` |
| Schema `CREATE` | Forbidden | `public` only; never `supabase_migrations` |
| Catalog `SELECT` | Relations listed in the runner `PREFLIGHT_CATALOG_RELATIONS` | Not used on the readonly path |
| Column `SELECT` | Preflight columns in `PREFLIGHT_DATA_COLUMNS` when present | Via table ownership |
| Ledger | `SELECT (version)` only | `SELECT` / `INSERT` / `UPDATE` |
| Direct table ownership | Forbidden | Required for each existing target |
| Preflight use | Catalog, privilege, ledger inspection | Ownership/RLS/FORCE visibility + allowlisted `BEGIN READ ONLY` aggregates |
| Apply use | Post-apply re-verification | Allowlisted migration files + `migration repair` |

Connection secrets (set only in the GitHub `production-db` environment; never commit passwords):

- Direct (IPv6 / Dedicated IPv4): `postgresql://madiba_mig_readonly:<password>@db.ynmtlzyqvmurpmfretji.supabase.co:5432/postgres?sslmode=verify-full`
- Session Pooler (free IPv4; preferred for GitHub-hosted runners without IPv6): `postgresql://madiba_mig_readonly.ynmtlzyqvmurpmfretji:<password>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=verify-full`
- `PRODUCTION_DB_MIGRATION_URL` → same mode/host/db/sslmode with the chosen migration owner login (`madiba_mig_owner` or `madiba_mig_owner.ynmtlzyqvmurpmfretji` on the pooler)
- `PRODUCTION_DB_ROOT_CA_CERT` → Supabase Database Settings download (`prod-ca-2021`); include the RDS regional CA as well if you also keep direct URLs

Both URLs must use port **5432** and `sslmode=verify-full`. Reject transaction pooler port **6543**. Keep `PRODUCTION_DB_MIGRATIONS_ENABLED` unset or `false` until a separate apply approval. Preflight proves the live session is TLS-encrypted via `current_setting('ssl')` (with `pg_stat_ssl` only as fallback), because least-privilege mig roles often cannot read `pg_stat_ssl` on Session Pooler even when verify-full succeeded.

**Rollback (authorized DBA only):** restore recorded prior table/sequence owners; revoke only grants that were added for these roles; drop the new roles only after they own nothing and secrets no longer reference them. Do not “fix” `PUBLIC` privileges by guessing.

First preflight with Prevent self-review: a **non-`malik1358`** GitHub account with Actions run permission dispatches from `main` (`mode=preflight`, full current `main` SHA). The job waits on `production-db` environment approval; **`malik1358`** reviews and approves. Do not dispatch until roles/owner login choice, any ownership transfers, and the three secrets are authorized and configured. Do not enable apply until a successful preflight is separately approved.

Authorization blockers before any production DB change or first preflight: nominate the dispatcher account; authorize discovery SQL; decide reuse vs create+transfer for the migration owner; authorize readonly role creation and grants; authorize environment secrets; confirm whether `attachments` already exists.

**Local Windows discovery (authorized DBA only; not run by agents without a secure `verify-full` session):**

1. Install PostgreSQL client tools (or locate `psql.exe`).
2. Download the project SSL root certificate from Supabase Database Settings → save outside the repo (e.g. `%USERPROFILE%\madiba-dba\prod-root.crt`).
3. From a repo checkout of this branch/main:
   ```powershell
   New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\madiba-dba" | Out-Null
   $env:PGSSLMODE = 'verify-full'
   $env:PGSSLROOTCERT = "$env:USERPROFILE\madiba-dba\prod-root.crt"
   $out = "$env:USERPROFILE\madiba-dba\discovery-$(Get-Date -Format 'yyyyMMdd-HHmmss').txt"
   psql "host=db.ynmtlzyqvmurpmfretji.supabase.co port=5432 dbname=postgres user=<dba_login> sslmode=verify-full" `
     -v ON_ERROR_STOP=1 `
     -f "sql/production_migration_access_discovery_section_a.sql" `
     -o $out
   ```
4. Password is prompted by `psql` (do not paste passwords into chat, commit them, or put them in the connection string).
5. Review `$out` under `%USERPROFILE%\madiba-dba\` only (not in the git tree). Stop without B/C/D. On any SQL error, `ON_ERROR_STOP` aborts and the read-only transaction ends via `ROLLBACK` in the script (or client disconnect).

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
| `MISSING_INVOICE_EMAIL_TO`, `MISSING_INVOICE_EMAIL_CC`, `MISSING_INVOICE_EMAIL_DAILY_SUMMARY` | Extra invoice-chase To/CC (15-minute list) and optional extra end-of-day summary addresses (defaults Soyeb + Fazlur) |
| `INVOICE_UPLOAD_EMAIL_TO`, `INVOICE_UPLOAD_EMAIL_CC` | Optional extra To/CC when an invoice PDF is uploaded (always includes uploader, salesman, direct boss, and `iliyas.belliyaru@noorshukran.com`) |
| `DAILY_SUPPLIER_ORDER_EMAIL_TO`, `DAILY_SUPPLIER_ORDER_EMAIL_CC` | Extra company order digest (invoice-ops); hierarchy bosses get separate team digests |
| `DAILY_SUPPLIER_ORDER_EMAIL_SEND_TO_USERS` | `false` skips salesman and hierarchy-boss digests; sends only the company digest |
| `OUTSTANDING_NO_GPS_EMAIL_TO`, `OUTSTANDING_NO_GPS_EMAIL_CC` | Optional management digest |
| `CUSTOMER_GPS_CHANGE_EMAIL_TO` | Optional GPS-change digest override; defaults to `malik@pinasz.com`, no recipient configuration required |
| `OUTSTANDING_RECONCILE_EMAIL_TO`, `OUTSTANDING_RECONCILE_EMAIL_CC` | Extra Tally vs SFA difference recipients (added to the built-in To / CC lists; default CC includes `kelwani@noorshukran.com`) |
| `OUTSTANDING_RECONCILE_EMAIL_TEST_TO` | Send the difference report only to these addresses and skip the dedupe marker (CC omitted on test-to sends) |
| `KPI_UPLOAD_SUMMARY_EMAIL_TO`, `KPI_UPLOAD_SUMMARY_EMAIL_CC` | Optional extras for the post-upload KPI Targets footer summary (default To `malik@pinasz.com`) |
| `KPI_UPLOAD_SUMMARY_EMAIL_TEST_TO` | Send the KPI upload summary only here and skip the unchanged dedupe marker |
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
| `salesman-visit-plan-email.yml` | `0 21 * * *` | 00:00 KSA build snapshot. Email, if enabled, waits for 08:30–22:00 KSA Sat–Thu | `/api/cron/salesman-visit-plan-email` |
| `daily-visit-report-email.yml` | `30 5 * * 0-4,6` | 08:30 KSA Sat–Thu; Thursday report Saturday morning | `/api/cron/daily-visit-report-email` (manual `date` + optional `digestOnlyTo` for company-digest-only resend) |
| `daily-salesman-resume-email.yml` | `30 5 * * 0-4,6` | 08:30 KSA Sat–Thu; Thursday report Saturday morning | `/api/cron/daily-salesman-resume-email` |
| `daily-supplier-order-email.yml` | `30 5 * * 0-4,6` | 08:30 KSA Sat–Thu | `/api/cron/daily-supplier-order-email` |
| `outstanding-no-gps-email.yml` | `30 5 * * 0-4,6` | 08:30 KSA Sat–Thu | `/api/cron/outstanding-no-gps-email` |
| `collection-stale-overdue-email.yml` | `30 5 * * 0-4,6` | 08:30 KSA Sat–Thu | `/api/cron/collection-stale-overdue-email` |
| `daily-receipt-email.yml` | `30 5 * * 0-4,6` | 08:30 KSA Sat–Thu. Saturday also sends Thursday | `/api/cron/daily-receipt-email` |
| `matched-receipt-email.yml` | `30 5 * * 0-4,6` | 08:30 KSA Sat–Thu. Saturday also sends Thursday. `maxDuration` 300s; workflow curl `--max-time` 360 | `/api/cron/matched-receipt-email` |
| `receipts-not-in-tally-email.yml` | `30 5 * * 0-4,6` | 08:30 KSA Sat–Thu | `/api/cron/receipts-not-in-tally-email` |
| `customer-gps-change-email.yml` | `30 5 * * 0-4,6` | 08:30 KSA Sat–Thu. Saturday sends Thursday and Friday | `/api/cron/customer-gps-change-email` |
| `missing-catalogue-photos-email.yml` | `30 5 * * 0-4,6` | 08:30 KSA Sat–Thu. Default To `malik@pinasz.com` and `swami@pinasz.com`. Optional `MISSING_CATALOGUE_PHOTOS_EMAIL_TO`. | `/api/cron/missing-catalogue-photos-email` |
| `bad-debt-report-email.yml` | `30 5 * * 0-4,6` | 08:30 KSA Sat–Thu. Default To Malik, Fazlur, and Soyeb. Optional `BAD_DEBT_REPORT_EMAIL_TO`. | `/api/cron/bad-debt-report-email` |
| `items-sold-at-loss-email.yml` | `30 5 * * 0-4,6` | 08:30 KSA Sat–Thu. Previous KSA day negative-GP sales. Default To `malik@pinasz.com`. Optional `ITEMS_SOLD_AT_LOSS_EMAIL_TO`. | `/api/cron/items-sold-at-loss-email` |
| `kpi-upload-summary-email.yml` | manual | Force-send the transposed KPI Targets footer summary (Total sales + Collection + Total cash collected). Normal sends are scheduled 18 minutes after sales/receipt uploads and flushed by `/api/cron/inactivity-push`. | `/api/cron/kpi-upload-summary-email` |
| `price-sync.yml` | `0 */8 * * *` | Every 8 hours | `/api/admin/price-sync` |
| `catalogue-drive-photos.yml` | `0 */8 * * *` | Every 8 hours (03:00, 11:00, 19:00 KSA). Uses existing `CRON_SECRET`. Optional `CATALOGUE_DRIVE_PHOTOS_URL`. | `/api/cron/catalogue-drive-photos` |
| `mobile-snapshot.yml` | `0 */4 * * *` | Every 4 hours, batched | `/api/cron/mobile-snapshot` |
| `missing-invoice-email.yml` | Every 15 min at :05/:20/:35/:50 UTC | Five-minute-offset backup for pg_cron; supports the 00:05 KSA midnight fallback | `/api/cron/missing-invoice-email` |
| `KPI Targets Email` | Manual dispatch only | Operator-selected month; no scheduled sends | `/api/cron/kpi-targets-email` |
| `app-performance.yml` | `0 6,9,12,15 * * *` | 09:00, 12:00, 15:00 and 18:00 KSA every day. The check runs on Friday; the alert email does not. Cron prefers Vercel `syd1` (near production Supabase). Emails `malik@pinasz.com` when a run is slower or a probe fails inside the team email window. | `/api/cron/app-performance` |

KPI target edits notify affected salespeople after the save and CC their complete reporting chain. To manually send a month to all active KPI-eligible salespeople, run **Actions → KPI Targets Email → Run workflow**, selecting `2026-10` for the October 2026 targets. The workflow uses the existing `CRON_SECRET` and production Vercel host; it adds no secrets or schedule.

Cron requests send header `x-cron-secret`. Price sync is the same header, not a user session.

The Missing Invoice Email backup retries the observed pre-delivery HTTP 500 (`success: false`, `error: "Internal server error."`, no `failedCount`) up to twice, waiting 10 seconds between attempts and retaining the 180-second per-attempt limit. It does not retry ambiguous gateway/transport failures or reported delivery failures: the latter include `failedCount` and may mean mail was sent but saving its marker failed. URL fallback also stops on reported delivery failures. Existing recent-send/midnight markers remain unchanged; persistent failures still fail the job and print the final response. If failures persist, inspect the production function/database logs—the generic HTTP 500 response alone does not identify the failing dependency. No migration or secret changes are required.

### Customer GPS digest activation and recovery

Production release preparation is dated **2026-10-06**, pending PR CI and merge; it is not yet a confirmed production deployment. Activation requires the approved merge to `main` and successful Vercel deployment, the existing configured SMTP or Resend transport (including `SMTP_FROM`), and the existing GitHub `CRON_SECRET` for the workflow's POST to `/api/cron/customer-gps-change-email`. No new recipient setting or enable flag is needed; `CUSTOMER_GPS_CHANGE_EMAIL_TO` is optional. The workflow also supports manual dispatch. It sends zero-change summaries. Scheduled delivery is 08:30 KSA, Saturday–Thursday, with the other morning emails. Saturday sends Thursday and Friday. An operator `to` or `force` test can send outside that window.

No new schema migration is required. Verify the existing `customer_gps_history` schema is present; if absent, apply `supabase/migrations/20260831153000_customer_gps_history.sql` or `sql/setup_customer_gps_history.sql` separately in Supabase before using history/report/digest. Git deployment does not apply SQL.

Each report date is protected by an atomic `system_settings` key `customer_gps_change_email:<date>`: `sending` with a claim `token` and `claimedAt`, followed after delivery by `sent` with `sentAt` and `changeCount`. Duplicate runs skip existing keys. Provider failure releases only the caller's own claim. An interrupted `sending` claim requires inspection of provider delivery before manual recovery; do not clear it blindly. If email sends but saving the sent marker fails, keep the claim to prevent duplicate delivery. Manual workflow dispatch may pass `date`, `force=true`, and optional `to=` for a `[TEST]` resend that skips the claim marker and does not rewrite it.

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
