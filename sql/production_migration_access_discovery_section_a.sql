-- =============================================================================
-- MADIBA production migration access — Section A ONLY (executable discovery)
-- Project: ynmtlzyqvmurpmfretji
-- STATUS: NOT EXECUTED by agents in this PR; authorized DBA may run locally
--
-- Companion to sql/production_migration_access_dba_review.sql (A1–A12).
-- Contains NO provisioning (no CREATE/ALTER/GRANT/REVOKE/ownership transfer).
-- Never SELECT pg_authid.rolpassword / password hashes.
--
-- Requires: psql with ON_ERROR_STOP, sslmode=verify-full, trusted CA.
-- See docs/DEPLOYMENT.md → Local Windows discovery.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';

-- A1) Version + TLS on this session
SHOW server_version;
SELECT current_setting('server_version_num')::int AS server_version_num;
SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid();
SELECT current_database() AS database,
       inet_server_addr()::text AS server_addr,
       session_user::text AS session_user,
       current_user::text AS current_user;

-- A2) Target table ownership, RLS, FORCE RLS, owner login/superuser attrs
SELECT c.relname AS table_name,
       pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls,
       r.rolsuper AS owner_is_superuser,
       r.rolcanlogin AS owner_can_login,
       r.rolinherit AS owner_rolinherit,
       r.rolbypassrls AS owner_bypassrls,
       r.rolcreatedb AS owner_createdb,
       r.rolcreaterole AS owner_createrole,
       r.rolreplication AS owner_replication
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_roles r ON r.oid = c.relowner
WHERE n.nspname = 'public'
  AND c.relname IN ('sales_orders','collection_visits','customer_documents','attachments')
ORDER BY 1;

-- A3) Sequences owned by or dependent on the target tables (inspect before any OWNER TO)
SELECT c.relname AS table_name,
       s.relname AS sequence_name,
       pg_get_userbyid(s.relowner) AS sequence_owner,
       d.deptype
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_depend d ON d.refobjid = c.oid AND d.refclassid = 'pg_class'::regclass
JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
WHERE n.nspname = 'public'
  AND c.relname IN ('sales_orders','collection_visits','customer_documents','attachments')
ORDER BY 1, 2;

-- A4) Migration ledger existence and structure
SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS ledger_exists;
SELECT a.attname, t.typname, a.attnotnull
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_type t ON t.oid = a.atttypid
WHERE n.nspname = 'supabase_migrations' AND c.relname = 'schema_migrations'
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;

SELECT conname, contype, condeferrable, convalidated
FROM pg_constraint
WHERE conrelid = to_regclass('supabase_migrations.schema_migrations');

SELECT tgname FROM pg_trigger
WHERE tgrelid = to_regclass('supabase_migrations.schema_migrations') AND NOT tgisinternal;

-- A5) Candidate / proposed migration roles: login attrs + rolinherit (no password columns)
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication,
       rolcanlogin, rolinherit
FROM pg_roles
WHERE rolname IN ('madiba_mig_readonly', 'madiba_mig_owner')
   OR oid IN (
     SELECT c.relowner
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('sales_orders','collection_visits','customer_documents','attachments')
   )
ORDER BY 1;

-- A6) Role memberships for owners and proposed mig roles (SET ROLE / admin paths)
SELECT granted.rolname AS granted_role,
       member.rolname AS member_role,
       am.admin_option,
       am.grantor::regrole::text AS grantor
FROM pg_auth_members am
JOIN pg_roles granted ON granted.oid = am.roleid
JOIN pg_roles member ON member.oid = am.member
WHERE granted.rolname IN ('madiba_mig_readonly', 'madiba_mig_owner')
   OR member.rolname IN ('madiba_mig_readonly', 'madiba_mig_owner')
   OR granted.oid IN (
     SELECT c.relowner
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('sales_orders','collection_visits','customer_documents','attachments')
   )
   OR member.oid IN (
     SELECT c.relowner
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('sales_orders','collection_visits','customer_documents','attachments')
   )
ORDER BY 1, 2;

SELECT DISTINCT owner.rolname AS owner_role,
       grantee.rolname AS member_of_owner,
       am.admin_option AS admin_option_on_owner,
       owner.rolinherit AS owner_rolinherit,
       grantee.rolcanlogin AS member_can_login,
       grantee.rolinherit AS member_rolinherit
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_roles owner ON owner.oid = c.relowner
JOIN pg_auth_members am ON am.roleid = owner.oid
JOIN pg_roles grantee ON grantee.oid = am.member
WHERE n.nspname = 'public'
  AND c.relname IN ('sales_orders','collection_visits','customer_documents','attachments')
ORDER BY 1, 2;

-- A7) Database CONNECT / CREATE / TEMP (PUBLIC ACLs: see A12)
SELECT role_name,
       has_database_privilege(role_name, current_database(), 'CONNECT') AS db_connect,
       has_database_privilege(role_name, current_database(), 'CREATE') AS db_create,
       has_database_privilege(role_name, current_database(), 'TEMP') AS db_temp
FROM (
  SELECT unnest(ARRAY[
    current_user,
    'madiba_mig_readonly',
    'madiba_mig_owner'
  ]::text[]) AS role_name
  UNION
  SELECT DISTINCT pg_get_userbyid(c.relowner)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('sales_orders','collection_visits','customer_documents','attachments')
) roles
WHERE role_name IS NOT NULL
  AND EXISTS (SELECT 1 FROM pg_roles pr WHERE pr.rolname = roles.role_name)
ORDER BY 1;

-- A8) Schema USAGE / CREATE
SELECT role_name,
       has_schema_privilege(role_name, 'public', 'USAGE') AS public_usage,
       has_schema_privilege(role_name, 'public', 'CREATE') AS public_create,
       CASE WHEN to_regnamespace('supabase_migrations') IS NULL THEN NULL
            ELSE has_schema_privilege(role_name, 'supabase_migrations', 'USAGE') END AS mig_schema_usage,
       CASE WHEN to_regnamespace('supabase_migrations') IS NULL THEN NULL
            ELSE has_schema_privilege(role_name, 'supabase_migrations', 'CREATE') END AS mig_schema_create
FROM (
  SELECT unnest(ARRAY[
    current_user,
    'madiba_mig_readonly',
    'madiba_mig_owner'
  ]::text[]) AS role_name
  UNION
  SELECT DISTINCT pg_get_userbyid(c.relowner)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('sales_orders','collection_visits','customer_documents','attachments')
) roles
WHERE role_name IS NOT NULL
  AND EXISTS (SELECT 1 FROM pg_roles pr WHERE pr.rolname = roles.role_name)
ORDER BY 1;

-- A9) Table-level privileges on targets
SELECT c.relname AS table_name,
       role_name,
       has_table_privilege(role_name, c.oid, 'SELECT') AS priv_select,
       has_table_privilege(role_name, c.oid, 'INSERT') AS priv_insert,
       has_table_privilege(role_name, c.oid, 'UPDATE') AS priv_update,
       has_table_privilege(role_name, c.oid, 'DELETE') AS priv_delete,
       has_table_privilege(role_name, c.oid, 'TRUNCATE') AS priv_truncate,
       has_table_privilege(role_name, c.oid, 'REFERENCES') AS priv_references,
       has_table_privilege(role_name, c.oid, 'TRIGGER') AS priv_trigger
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (
  SELECT unnest(ARRAY[
    current_user,
    'madiba_mig_readonly',
    'madiba_mig_owner'
  ]::text[]) AS role_name
  UNION
  SELECT DISTINCT pg_get_userbyid(c2.relowner)
  FROM pg_class c2
  JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
  WHERE n2.nspname = 'public'
    AND c2.relname IN ('sales_orders','collection_visits','customer_documents','attachments')
) roles
WHERE n.nspname = 'public'
  AND c.relname IN ('sales_orders','collection_visits','customer_documents','attachments')
  AND role_name IS NOT NULL
  AND EXISTS (SELECT 1 FROM pg_roles pr WHERE pr.rolname = roles.role_name)
ORDER BY 1, 2;

-- A10) Column privileges aligned to runner PREFLIGHT_DATA_COLUMNS
SELECT table_name, column_name, role_name,
       CASE WHEN to_regclass('public.' || table_name) IS NULL THEN NULL
            WHEN NOT EXISTS (
              SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = to_regclass('public.' || table_name)
                AND a.attname = column_name AND a.attnum > 0 AND NOT a.attisdropped
            ) THEN NULL
            ELSE has_column_privilege(role_name, to_regclass('public.' || table_name), column_name, 'SELECT')
       END AS col_select
FROM (VALUES
  ('sales_orders','request_id'),
  ('collection_visits','client_submission_id'),
  ('collection_visits','receipt_attachment_id'),
  ('collection_visits','payment_attachment_id'),
  ('customer_documents','attachment_id'),
  ('attachments','id'),
  ('attachments','storage_provider'),
  ('attachments','object_key')
) AS cols(table_name, column_name)
CROSS JOIN (
  SELECT unnest(ARRAY[
    current_user,
    'madiba_mig_readonly',
    'madiba_mig_owner'
  ]::text[]) AS role_name
) roles
WHERE EXISTS (SELECT 1 FROM pg_roles pr WHERE pr.rolname = roles.role_name)
ORDER BY 1, 2, 3;

-- A11) Migration ledger SELECT / INSERT / UPDATE privileges
SELECT role_name,
       CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN NULL
            ELSE has_table_privilege(role_name, 'supabase_migrations.schema_migrations', 'SELECT') END AS ledger_select,
       CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN NULL
            ELSE has_table_privilege(role_name, 'supabase_migrations.schema_migrations', 'INSERT') END AS ledger_insert,
       CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN NULL
            ELSE has_table_privilege(role_name, 'supabase_migrations.schema_migrations', 'UPDATE') END AS ledger_update,
       CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN NULL
            ELSE has_column_privilege(role_name, 'supabase_migrations.schema_migrations', 'version', 'SELECT') END AS ledger_version_select
FROM (
  SELECT unnest(ARRAY[
    current_user,
    'madiba_mig_readonly',
    'madiba_mig_owner'
  ]::text[]) AS role_name
  UNION
  SELECT DISTINCT pg_get_userbyid(c.relowner)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('sales_orders','collection_visits','customer_documents','attachments')
) roles
WHERE role_name IS NOT NULL
  AND EXISTS (SELECT 1 FROM pg_roles pr WHERE pr.rolname = roles.role_name)
ORDER BY 1;

-- A12) Existing PUBLIC and role ACLs (aclitem explode only — no secrets)
SELECT 'database'::text AS object_kind,
       current_database() AS object_name,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE acl.grantee::regrole::text END AS grantee,
       acl.privilege_type,
       acl.is_grantable
FROM pg_database d
CROSS JOIN LATERAL aclexplode(d.datacl) AS acl
WHERE d.datname = current_database()
  AND d.datacl IS NOT NULL
UNION ALL
SELECT 'schema', n.nspname,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE acl.grantee::regrole::text END,
       acl.privilege_type,
       acl.is_grantable
FROM pg_namespace n
CROSS JOIN LATERAL aclexplode(n.nspacl) AS acl
WHERE n.nspname IN ('public', 'supabase_migrations')
  AND n.nspacl IS NOT NULL
UNION ALL
SELECT 'table', n.nspname || '.' || c.relname,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE acl.grantee::regrole::text END,
       acl.privilege_type,
       acl.is_grantable
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
WHERE (
    (n.nspname = 'public'
     AND c.relname IN ('sales_orders','collection_visits','customer_documents','attachments'))
    OR (n.nspname = 'supabase_migrations' AND c.relname = 'schema_migrations')
  )
  AND c.relacl IS NOT NULL
ORDER BY 1, 2, 3, 4;

ROLLBACK;
