# AGENTS.md

Core conventions for any AI coding agent working in this repository — **Cursor and GitHub Copilot**. Read this file, `.github/copilot-instructions.md`, and `docs/` before editing. Keep those files updated when you finish. They are the shared memory between both tools.

## What this repo is

MADIBA SFA (`package.json` name `madiba-sfa`) is the KSA sales-force system: field visits, orders, collections, GPS, attendance, and management reports. Stack: Next.js 15 App Router, React 19, Supabase Auth + Postgres, Vercel, optional Capacitor Android shell.

## Rules every AI coding agent must follow

These rules are mandatory for Cursor and Copilot:

1. **Understand existing code before changing it.** Read the module, its callers, related `app/lib/` helpers, and matching tests under `tests/`.
2. **Inspect dependencies before structural changes.** Search for every consumer of a function, table, setting key, status string, route, or role before renaming or removing it.
3. **Do not invent Supabase tables, columns, or functions.** Use only names present in `supabase/migrations/`, `sql/`, or live queries. Many “datasets” are JSON in `public.system_settings`, not tables.
4. **Preserve staging/production separation.** `staging` branch + staging Vercel + staging Supabase. `main` + production Vercel + production Supabase. Never put production credentials on staging.
5. **Preserve role-based access controls.** Screen access is `buildModuleAccess` in `app/lib/moduleAccess.js`. Do not bypass it with client-only hiding. Do not weaken API scope checks.
6. **Preserve existing Android/Capacitor behavior unless explicitly asked.** The shell loads the hosted site (`capacitor.config.js`). Do not change app id, tracking, push, battery gates, or native permissions casually.
7. **Test changes before finishing.** Run related `node --test tests/<file>.test.mjs` files and `npm run build` when the change can affect the Next.js build. There is no `npm test` script.
8. **Document database migrations.** Say which migration to add, what it changes, and that it must be applied in Supabase before the app depends on it. Some production SQL exists only under `sql/`.
9. **Update relevant docs when business logic changes.** After any important change to business logic, database structure, reports, authentication, GPS/attendance logic, or architecture, update the matching `docs/*.md` file and add a dated note to `docs/CHANGELOG_AI.md` **before finishing the task**.
10. **Do not expose secrets or environment variables.** Never print, commit, or paste `.env*` values, service-role keys, `CRON_SECRET`, SMTP passwords, Firebase JSON, or tokens. `.env.example` lists names only.
11. **Prefer incremental changes over unnecessary rewrites.** Large pages and shared libs (`paymentBehavior.js`, collections, pending orders, customer audit, sales import) are easy to break.

## Dual-agent workflow (Cursor + Copilot)

| When | What every agent must do |
| --- | --- |
| Starting a task | Read `.github/copilot-instructions.md`, this file, and all of `docs/`. Then inspect the code for the area you will change. |
| Finishing a task that changes behavior, schema, roles, reports, or deploy | Update the matching `docs/*.md` file and add a short dated note to `docs/CHANGELOG_AI.md` in the same PR or commit when practical. |
| Docs disagree with code | Trust the code, then correct the docs so the next Cursor or Copilot session does not relearn a false rule. |

Do not assume the other tool will update the handover. Leaving docs stale breaks the next agent on either side.

## Mandatory documentation rule

**After any important change to business logic, database structure, reports, authentication, GPS/attendance logic, or architecture, update the relevant documentation before finishing the task.**

- Update the matching file under `docs/` (`BUSINESS_RULES.md`, `DATABASE.md`, `ARCHITECTURE.md`, `DEPLOYMENT.md`, and/or `PROJECT_OVERVIEW.md`).
- Add a short dated note under “Recent agent notes” in `docs/CHANGELOG_AI.md`.
- Do not mark the task complete while those docs are still stale relative to the code you just changed.

## How to work

1. Read the handover docs first, then the existing implementation and its tests before editing.
2. Search callers before changing a shared function, table, setting key, status string, or route.
3. Change only what the task needs. Do not rewrite a page or library because it is large.
4. Do not invent columns, tables, roles, or status values.
5. Keep user-visible behavior unless the task explicitly changes it.
6. After code changes, run the related tests and `npm run build` when needed.
7. If the database must change, add a migration and say so in the summary. Applying SQL in Supabase is a separate production step.
8. Never print or commit secrets.
9. Follow the mandatory documentation rule above.

## Repository map

| Path | Role |
| --- | --- |
| `app/page.js` | Login and role home |
| `app/management/` | Authenticated screens |
| `app/api/` | Route handlers. Most use the service role after checking the user JWT |
| `app/lib/` | Shared business rules. Prefer changing these over duplicating logic in pages |
| `app/lib/moduleAccess.js` | Roles, module keys, nav groups, GPS/attendance gates |
| `app/components/` | Shell: nav, attendance gate, GPS, language |
| `supabase/migrations/` | Schema intended to be applied in order |
| `sql/` | One-off and setup scripts. Not all of them are migrations |
| `tests/` | Node.js built-in test runner (`node:test`) |
| `.github/workflows/` | CI build and scheduled calls into `/api/cron/*` and price sync |
| `android/` | Capacitor shell. The UI is still the Vercel site |
| `ANDROID_APK.md` | Field Android install, push, battery, tracking details |

There is no Next.js `middleware.js`. Auth is enforced in the client shell and in each API route.

## Code conventions

- JavaScript only (no TypeScript). Use ESM `import` in app code. Tests are `.mjs`.
- Keep functions pure when the existing module is pure, and cover rule changes with a test next to the other `tests/*.test.mjs` files.
- Business calendar is `Asia/Riyadh`. Use `getKsaDateString` and `ksaDayBounds` from `app/lib/workdayActivity.js`.
- Roles are normalized with `normalizeAccessRole` (`_` becomes `-`). Do not add a new role only in the UI. The `profiles_role_check` constraint must allow it.
- Access to screens is `buildModuleAccess` in `app/lib/moduleAccess.js`. A new page needs a module key, nav group, and role flags.
- Customer and salesman codes are trimmed and uppercased in most comparisons. Do not compare raw strings.
- Missing-table and missing-column errors are often treated as “feature not migrated yet” (`schemaGuards.js`, `isMissingSchemaColumn`, `isMissingColumnError`). Preserve that fallback unless the task is to require the new column.
- API routes create a Supabase client with `SUPABASE_SERVICE_ROLE_KEY` and `persistSession: false`. They must still check the caller’s bearer token (or `CRON_SECRET` for cron). Do not expose the service role to the browser.
- The browser client is `getSupabaseClient()` and uses only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Reports that look like spreadsheets must use the existing colored table classes. See `.cursor/rules/colorful-tabular-reports.mdc`.
- English and Arabic copy is inlined in pages and `MODULE_LABELS`. Do not drop Arabic strings when editing a screen that already has them.
- Do not add a new dependency unless the task cannot be done with the current stack.

## Data you must not treat as a normal table

`public.system_settings` stores large JSON and small flags by `setting_key`. Examples: `active_sales_batch_id`, `outstanding_customerwise_dataset_v1`, `receipt_register_dataset_v1`, `sales_bi_cube_v1`, `order_invoice_meta:<id>`, `visit_report_latest:<code>`, `customer_meta:<code>`. Read `docs/DATABASE.md` before adding a key or column.

Sales figures used by the app come from the `active_sales` view (the batch id in `system_settings`), not from every row in `sales_raw`.

## Checks

```bash
node --test tests/paymentBehavior.test.mjs
node --test tests/moduleAccess.test.mjs
node --test tests/*.test.mjs
npm run build
```

Run the narrow test file that matches the module you changed. The full suite is large. `npm run build` is what GitHub Actions runs on pull requests to `main` and `staging`.

## Git and environments

- Feature work branches off `main` unless the task says otherwise. Production is `main`. UAT is `staging`.
- Never point a staging deploy at production Supabase keys.
- Do not commit generated Android build output, `.next`, or env files.

## Handover docs

`.github/copilot-instructions.md`, this file, and `docs/PROJECT_OVERVIEW.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/BUSINESS_RULES.md`, `docs/DEPLOYMENT.md`, and `docs/CHANGELOG_AI.md` are the shared source of truth for Cursor and Copilot. Read them before every task. Update them when you change something important. If they disagree with the code, trust the code and record the mismatch.
