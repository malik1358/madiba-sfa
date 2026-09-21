# MADIBA SFA — instructions for coding agents

MADIBA SFA is a Next.js 15 (App Router) sales-force app for KSA. Data lives in Supabase. Production deploys from `main` to Vercel.

This repository is developed by **Cursor agents and GitHub Copilot together**. The files below are the shared handover. Every agent, Cursor or Copilot, must treat them as living documentation.

## Shared handover (read and update)

**At the start of every task (before editing):**

1. Read this file, `AGENTS.md`, and all files under `docs/`.
2. Inspect the real source, SQL, and tests for the area you will touch. Do not guess schema or business rules.
3. Prefer the code when docs and code disagree, then fix the docs in the same change.

**At the end of every task that changes behavior, schema, roles, reporting, or deployment:**

1. Update the matching `docs/*.md` file so the next agent (Cursor or Copilot) inherits the truth.
2. Add a short dated note at the top of `docs/CHANGELOG_AI.md`.
3. If you only fixed a docs/code inconsistency, still update the docs. Do not leave drift for the other tool.

Do not skip the read or the update because “the other agent will handle docs.” Both tools must keep these files current.

## Persistent rules

- Understand the existing implementation before changing code. Read the module, its callers, and the matching tests under `tests/`.
- Search for all dependent code before making structural changes. Shared logic lives in `app/lib/`. API routes, pages, cron jobs, WhatsApp text, PDFs, and emails often share the same helper.
- Do not invent database columns or tables. Use only names that exist in `supabase/migrations/`, `sql/`, or current queries. Many datasets are JSON in `public.system_settings`, not new tables.
- Preserve existing functionality. Field sales, collections, attendance, GPS, orders, settlement, and reports are in daily use.
- Run the appropriate checks after changes. There is no `npm test` script. Use `node --test tests/<name>.test.mjs` for touched logic and `npm run build` before considering a change done.
- Explain any database migration required. Say which file to add under `supabase/migrations/`, what it changes, and that it must be applied in Supabase (SQL Editor or migration runner) before the app depends on it. Some production changes exist only as one-off scripts in `sql/` and are not in `supabase/migrations/`.
- Never expose secrets or environment variable values. Do not print, commit, or paste `.env*`, service-role keys, `CRON_SECRET`, SMTP passwords, Firebase JSON, or tokens. `.env.example` lists names only.
- Prefer incremental changes rather than unnecessary rewrites. Large pages (`customer-audit`, `payment-collections`, `pending-orders`, `new-order`) and `paymentBehavior.js` are easy to break.
- Update documentation when an important business rule or architecture decision changes. Update the matching file under `docs/` and add a short note to `docs/CHANGELOG_AI.md`.

## Where to look

- Product and module map: `docs/PROJECT_OVERVIEW.md`
- App structure and request flow: `docs/ARCHITECTURE.md`
- Tables, views, settings keys, storage: `docs/DATABASE.md`
- Roles, sales, attendance, GPS, settlement, reports: `docs/BUSINESS_RULES.md`
- Environments, crons, Android: `docs/DEPLOYMENT.md`
- Prior decisions and do-not-touch areas: `docs/CHANGELOG_AI.md`

## Non-negotiable behavior

- Business dates and workdays use `Asia/Riyadh` (`app/lib/workdayActivity.js`). Do not switch reports to UTC calendar days.
- Customer visibility is not “one salesman code equals one column.” Scope includes hierarchy metadata, mutual groups, book shares, historical sales, and outstanding ownership. Start at `app/lib/salesHierarchy.js`, `customerAccess.js`, and `mutualSalesmanGroups.js`.
- Paid and Open on settlement follow cash FIFO in `app/lib/paymentBehavior.js`. Do not force those figures to the outstanding upload. Tally Open is a separate comparison.
- Tabular reports stay colorful. Reuse `moduleTable`, `moduleBiTable`, `moduleBiMonthCell--up`, `moduleBiMonthCell--down`, `moduleBiMonthCell--current`, and `moduleBiTotalCol`. Header row is teal `#0f4c5c` with white text. Green means up versus the prior period, red means down, and the current MTD/QTD/YTD period uses its own tone. Add a Total column or footer when amounts can be cross-checked.
- Do not commit application behavior changes inside a documentation-only task.
