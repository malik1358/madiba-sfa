# MADIBA SFA — instructions for coding agents

> Part of the AI agent handover package with `AGENTS.md` and `docs/*.md`.

MADIBA SFA is a Next.js 15 (App Router) sales-force app for KSA. Data lives in Supabase. Production deploys from `main` to Vercel. Staging uses a separate branch, Vercel project, and Supabase project.

This repository is developed by **Cursor agents and GitHub Copilot together**. Treat the handover files as living shared memory.

## Start every task

1. Read this file, `AGENTS.md`, and all files under `docs/`.
2. Inspect the real source, SQL, and tests for the area you will touch. Do not guess schema or business rules.
3. Prefer the code when docs and code disagree, then fix the docs in the same change.

## Finish every important task

After any important change to business logic, database structure, reports, authentication, GPS/attendance logic, or architecture:

1. Update the matching `docs/*.md` file.
2. Add a short dated note under “Recent agent notes” in `docs/CHANGELOG_AI.md`.
3. Do not mark the task complete while those docs are stale.

## Do not assume

- `collector` is supported in `app/lib/moduleAccess.js`, but the baseline `profiles_role_check` migration does not allow that role. Confirm `sql/fix_profiles_role_check_collector.sql` was applied before writing collector rows.
- Do not invent Supabase tables, columns, or functions. Docs and the live database can drift.
- Do not assume `supabase/migrations/` alone is the full production schema. Always inspect relevant `/sql` scripts for manual setup/fix steps.
- Do not assume legacy markdown outside `docs/` is current. Files like old setup notes can be stale; verify against code and `docs/`.
- `package.json` requires Node `>=22`. There is no `npm test` or `npm run lint`. Use `node --test`.
- Cron behavior is split across Vercel (`vercel.json`), GitHub Actions, and Supabase `pg_cron`.
- Do not rely on RLS alone when reviewing API security. Service-role routes bypass RLS and require explicit route-level authorization/scope checks.
- Do not assume collections always read from tables. Collection queues can come from uploaded outstanding dataset JSON (`system_settings`) with table fallback.
- Before changing access, activity, KPIs, or Android tracking, read `moduleAccess.js`, `workdayActivity.js`, both `performanceKpis*.js` files, and `nativeFieldTracking.js`.
- Preserve staging/production separation. Prefer incremental changes over rewrites.

## Persistent rules

- Understand existing code before changing it.
- Inspect dependencies before structural changes. Search callers of shared `app/lib/` helpers, routes, setting keys, and status strings.
- Do not invent Supabase tables, columns, or functions. Use `supabase/migrations/`, `sql/`, and current queries only. Many datasets are JSON in `public.system_settings`.
- Preserve staging/production separation. Never use production Supabase credentials on staging.
- Preserve role-based access controls (`app/lib/moduleAccess.js` and API sales-scope checks).
- Preserve existing Android/Capacitor behavior unless explicitly asked (`capacitor.config.js`, `android/`, `ANDROID_APK.md`).
- Preserve existing field functionality (sales, collections, attendance, GPS, orders, settlement, reports).
- Test changes before finishing: `node --test tests/<name>.test.mjs` and `npm run build` when the build may be affected.
- Document any database migration required, and that it must be applied in Supabase separately from the git deploy.
- Update relevant docs when business logic or architecture changes.
- Never expose secrets or environment variable values. `.env.example` lists names only.
- Prefer incremental changes over unnecessary rewrites.

## Where to look

| Topic | File |
| --- | --- |
| Product and modules | `docs/PROJECT_OVERVIEW.md` |
| Architecture, APIs, Capacitor | `docs/ARCHITECTURE.md` |
| Tables, views, settings, storage | `docs/DATABASE.md` |
| Roles, settlement, GPS, reports | `docs/BUSINESS_RULES.md` |
| Vercel, crons, Android, env names | `docs/DEPLOYMENT.md` |
| Decisions, drift, do-not-touch | `docs/CHANGELOG_AI.md` |
| Agent conventions | `AGENTS.md` |

## Non-negotiable behavior

- Business dates and workdays use `Asia/Riyadh` (`app/lib/workdayActivity.js`).
- Customer visibility uses hierarchy, mutual groups, book shares, historical sales, and outstanding ownership — not a single salesman-code filter.
- Settlement Paid/Open follow cash FIFO in `app/lib/paymentBehavior.js`. Do not force them to the outstanding upload. Tally Open is separate.
- Tabular reports stay colorful (`moduleTable`, `moduleBiTable`, up/down/current month cells, Total column/footer). Header teal `#0f4c5c` on white text.
- Do not change application functionality in a documentation-only task.
