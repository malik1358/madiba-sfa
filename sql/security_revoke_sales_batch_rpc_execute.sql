-- =============================================================================
-- MADIBA SECURITY REMEDIATION — sales batch RPC EXECUTE lockdown
-- Project: ynmtlzyqvmurpmfretji (production Supabase)
--
-- STATUS: NOT EXECUTED by the preparing agent / PR / CI / Vercel / app startup.
-- Apply only with separate explicit production authorization after PR review.
--
-- Target functions (exact signatures; no overloads in production as of audit):
--   public.merge_sales_batch_by_dates(bigint, date[])
--   public.refresh_import_batch_stats(bigint)
--
-- Finding: both are SECURITY DEFINER, owned by postgres, search_path=public,
-- no auth.uid()/JWT gates, and EXECUTE is granted to PUBLIC (=X), anon,
-- authenticated, and service_role. Unauthenticated PostgREST callers with the
-- publishable key could invoke destructive merge (DELETE/UPDATE sales_raw).
--
-- Application callers: only app/api/import-sales/route.js via
-- createClient(url, SUPABASE_SERVICE_ROLE_KEY).service admin.rpc(...).
-- No GitHub Actions / cron SQL calls these RPCs.
--
-- This script does NOT:
--   - alter function bodies
--   - change RLS, tables, or sales/customer data
--   - write supabase_migrations.schema_migrations
--   - run as part of production-db-migrations.yml allowlist
-- =============================================================================

\set ON_ERROR_STOP on

-- -----------------------------------------------------------------------------
-- 0) OPTIONAL before-state verification (read-only). Run, then inspect output.
-- -----------------------------------------------------------------------------
-- SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--        p.prosecdef AS security_definer, p.proowner::regrole::text AS owner,
--        p.proacl::text AS acl
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname IN ('merge_sales_batch_by_dates', 'refresh_import_batch_stats')
-- ORDER BY 2;
--
-- SELECT r.rolname,
--        has_function_privilege(r.oid, 'public.merge_sales_batch_by_dates(bigint, date[])'::regprocedure, 'EXECUTE') AS merge_exec,
--        has_function_privilege(r.oid, 'public.refresh_import_batch_stats(bigint)'::regprocedure, 'EXECUTE') AS refresh_exec
-- FROM pg_roles r
-- WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
-- ORDER BY 1;
--
-- -- PUBLIC grant shows as empty grantee in ACL explode:
-- SELECT p.proname, e.grantee::regrole::text AS grantee, e.privilege_type
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) e
-- WHERE n.nspname = 'public'
--   AND p.proname IN ('merge_sales_batch_by_dates', 'refresh_import_batch_stats')
-- ORDER BY 1, 2, 3;

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) Remediation — exact schema-qualified signatures only
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.merge_sales_batch_by_dates(bigint, date[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_sales_batch_by_dates(bigint, date[]) FROM anon;
REVOKE ALL ON FUNCTION public.merge_sales_batch_by_dates(bigint, date[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.merge_sales_batch_by_dates(bigint, date[]) TO service_role;

REVOKE ALL ON FUNCTION public.refresh_import_batch_stats(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_import_batch_stats(bigint) FROM anon;
REVOKE ALL ON FUNCTION public.refresh_import_batch_stats(bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_import_batch_stats(bigint) TO service_role;

COMMIT;

-- -----------------------------------------------------------------------------
-- 2) REQUIRED after-state verification (read-only). Expect:
--      service_role EXECUTE = true
--      anon / authenticated EXECUTE = false
--      ACL must not contain =X (PUBLIC) or anon=/authenticated= EXECUTE
-- -----------------------------------------------------------------------------
-- SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args,
--        p.proacl::text AS acl
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname IN ('merge_sales_batch_by_dates', 'refresh_import_batch_stats')
-- ORDER BY 2;
--
-- SELECT r.rolname,
--        has_function_privilege(r.oid, 'public.merge_sales_batch_by_dates(bigint, date[])'::regprocedure, 'EXECUTE') AS merge_exec,
--        has_function_privilege(r.oid, 'public.refresh_import_batch_stats(bigint)'::regprocedure, 'EXECUTE') AS refresh_exec
-- FROM pg_roles r
-- WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
-- ORDER BY 1;

-- -----------------------------------------------------------------------------
-- 3) ROLLBACK (only if authorized to undo the lockdown)
--    Security implication: restores HIGH exposure — anon/authenticated can call
--    SECURITY DEFINER RPCs that mutate sales_raw / import_batches.
-- -----------------------------------------------------------------------------
-- BEGIN;
-- GRANT EXECUTE ON FUNCTION public.merge_sales_batch_by_dates(bigint, date[]) TO PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.merge_sales_batch_by_dates(bigint, date[]) TO anon, authenticated, service_role;
-- GRANT EXECUTE ON FUNCTION public.refresh_import_batch_stats(bigint) TO PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.refresh_import_batch_stats(bigint) TO anon, authenticated, service_role;
-- COMMIT;
