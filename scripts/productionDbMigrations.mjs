import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PRODUCTION_PROJECT_REF = "ynmtlzyqvmurpmfretji";
export const SUPABASE_CLI_VERSION = "2.120.0";
export const ALLOWLISTED_MIGRATIONS = Object.freeze([
  { version: "20260930190000", file: "20260930190000_sales_order_request_id.sql" },
  { version: "20261002120000", file: "20261002120000_collection_visit_client_submission_id.sql" },
  { version: "20261002130000", file: "20261002130000_attachments.sql" },
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET_TABLES = ["sales_orders", "collection_visits", "customer_documents", "attachments"];
const PREFLIGHT_DATA_COLUMNS = Object.freeze([
  ["sales_orders", "request_id"],
  ["collection_visits", "client_submission_id"],
  ["collection_visits", "receipt_attachment_id"],
  ["collection_visits", "payment_attachment_id"],
  ["customer_documents", "attachment_id"],
  ["attachments", "id"],
  ["attachments", "storage_provider"],
  ["attachments", "object_key"],
]);
const PREFLIGHT_CATALOG_RELATIONS = Object.freeze([
  "pg_catalog.pg_class", "pg_catalog.pg_namespace", "pg_catalog.pg_attribute", "pg_catalog.pg_type",
  "pg_catalog.pg_constraint", "pg_catalog.pg_trigger", "pg_catalog.pg_roles", "pg_catalog.pg_database",
  "pg_catalog.pg_shdepend", "pg_catalog.pg_stat_ssl", "pg_catalog.pg_indexes", "pg_catalog.pg_policies",
]);

/** Fixed duplicate/orphan aggregate SELECTs only. Never accept caller SQL, paths, or templates. */
export const INTEGRITY_SCANS = Object.freeze([
  {
    key: "sales_orders.request_id",
    tables: Object.freeze(["sales_orders"]),
    requiresColumns: Object.freeze(["sales_orders.request_id"]),
    sql: "SELECT count(*)::int AS count FROM (SELECT request_id FROM public.sales_orders WHERE request_id IS NOT NULL GROUP BY request_id HAVING count(*) > 1) AS duplicate_values",
  },
  {
    key: "collection_visits.client_submission_id",
    tables: Object.freeze(["collection_visits"]),
    requiresColumns: Object.freeze(["collection_visits.client_submission_id"]),
    sql: "SELECT count(*)::int AS count FROM (SELECT client_submission_id FROM public.collection_visits WHERE client_submission_id IS NOT NULL GROUP BY client_submission_id HAVING count(*) > 1) AS duplicate_values",
  },
  {
    key: "attachments.storage_provider,object_key",
    tables: Object.freeze(["attachments"]),
    requiresTables: Object.freeze(["attachments"]),
    requiresColumns: Object.freeze(["attachments.storage_provider", "attachments.object_key"]),
    sql: "SELECT count(*)::int AS count FROM (SELECT storage_provider, object_key FROM public.attachments GROUP BY storage_provider, object_key HAVING count(*) > 1) AS duplicate_values",
  },
  {
    key: "orphan:collection_visits.receipt_attachment_id",
    tables: Object.freeze(["collection_visits", "attachments"]),
    requiresTables: Object.freeze(["attachments"]),
    requiresColumns: Object.freeze(["collection_visits.receipt_attachment_id", "attachments.id"]),
    sql: "SELECT count(*)::int AS count FROM public.collection_visits AS source WHERE source.receipt_attachment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.attachments AS target WHERE target.id = source.receipt_attachment_id)",
  },
  {
    key: "orphan:collection_visits.payment_attachment_id",
    tables: Object.freeze(["collection_visits", "attachments"]),
    requiresTables: Object.freeze(["attachments"]),
    requiresColumns: Object.freeze(["collection_visits.payment_attachment_id", "attachments.id"]),
    sql: "SELECT count(*)::int AS count FROM public.collection_visits AS source WHERE source.payment_attachment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.attachments AS target WHERE target.id = source.payment_attachment_id)",
  },
  {
    key: "orphan:customer_documents.attachment_id",
    tables: Object.freeze(["customer_documents", "attachments"]),
    requiresTables: Object.freeze(["attachments"]),
    requiresColumns: Object.freeze(["customer_documents.attachment_id", "attachments.id"]),
    sql: "SELECT count(*)::int AS count FROM public.customer_documents AS source WHERE source.attachment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.attachments AS target WHERE target.id = source.attachment_id)",
  },
]);

const INTEGRITY_SCAN_BY_KEY = Object.freeze(Object.fromEntries(INTEGRITY_SCANS.map((scan) => [scan.key, scan])));

let mutationGate = "closed";

const SQL = {
  identity: `SELECT current_database() AS database,
    session_user::text AS session_role_name,
    current_user AS role_name,
    current_setting('server_version') AS server_version,
    current_setting('server_version_num')::int AS server_version_num,
    COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS tls,
    COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS is_superuser,
    to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS ledger_exists,
    COALESCE((SELECT relkind IN ('r', 'p') FROM pg_class WHERE oid = to_regclass('supabase_migrations.schema_migrations')), false) AS ledger_is_table,
    COALESCE((SELECT NOT relrowsecurity FROM pg_class WHERE oid = to_regclass('supabase_migrations.schema_migrations')), false) AS ledger_rls_disabled,
    (SELECT count(*) = 3
        AND count(*) FILTER (WHERE attribute.attname = 'version' AND type.typname = 'text' AND attribute.attnotnull) = 1
        AND count(*) FILTER (WHERE attribute.attname = 'name' AND type.typname = 'text') = 1
        AND count(*) FILTER (WHERE attribute.attname = 'statements' AND type.typname = '_text') = 1
      FROM pg_attribute AS attribute
      JOIN pg_class AS relation ON relation.oid = attribute.attrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      JOIN pg_type AS type ON type.oid = attribute.atttypid
      WHERE namespace.nspname = 'supabase_migrations' AND relation.relname = 'schema_migrations'
        AND attribute.attnum > 0 AND NOT attribute.attisdropped) AS ledger_columns_ready,
    (SELECT count(*) = 1 FROM pg_constraint
      WHERE conrelid = to_regclass('supabase_migrations.schema_migrations')) AS ledger_constraints_exact,
    NOT EXISTS (SELECT 1 FROM pg_trigger
      WHERE tgrelid = to_regclass('supabase_migrations.schema_migrations') AND NOT tgisinternal) AS ledger_triggers_absent,
    EXISTS (SELECT 1 FROM pg_constraint AS constraint_row
      JOIN pg_attribute AS attribute ON attribute.attrelid = constraint_row.conrelid
        AND attribute.attname = 'version' AND NOT attribute.attisdropped
      WHERE constraint_row.conrelid = to_regclass('supabase_migrations.schema_migrations')
        AND constraint_row.contype = 'p' AND constraint_row.convalidated
        AND NOT constraint_row.condeferrable AND array_length(constraint_row.conkey, 1) = 1
        AND constraint_row.conkey[1] = attribute.attnum) AS ledger_version_unique;`,
  ledger: `SELECT version::text AS version FROM supabase_migrations.schema_migrations ORDER BY version;`,
  tables: `SELECT expected.table_name, relation.oid IS NOT NULL AS exists,
    COALESCE(relation.relkind IN ('r', 'p'), false) AS is_table,
    COALESCE(relation.relrowsecurity, false) AS rls_enabled,
    COALESCE(relation.relforcerowsecurity, false) AS force_rls,
    COALESCE(pg_get_userbyid(relation.relowner), '') AS owner
    FROM (VALUES ('sales_orders'), ('collection_visits'), ('customer_documents'), ('attachments')) AS expected(table_name)
    LEFT JOIN pg_class AS relation ON relation.oid = to_regclass('public.' || expected.table_name)
    ORDER BY expected.table_name;`,
  columns: `SELECT relation.relname AS table_name, attribute.attname AS column_name,
    CASE WHEN type.typname = 'int8' THEN 'bigint'
      WHEN type.typname = 'timestamptz' THEN 'timestamp with time zone'
      WHEN type.typname = '_text' THEN 'ARRAY'
      ELSE type.typname END AS data_type,
    CASE WHEN attribute.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
    type.typname AS udt_name
    FROM pg_attribute AS attribute
    JOIN pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_type AS type ON type.oid = attribute.atttypid
    WHERE namespace.nspname = 'public'
      AND relation.relname = ANY (ARRAY['sales_orders','collection_visits','customer_documents','attachments'])
      AND attribute.attnum > 0 AND NOT attribute.attisdropped
    ORDER BY relation.relname, attribute.attnum;`,
  indexes: `SELECT tablename AS table_name, indexname AS index_name, indexdef AS definition
    FROM pg_indexes WHERE schemaname = 'public'
    AND tablename = ANY (ARRAY['sales_orders','collection_visits','customer_documents','attachments'])
    ORDER BY tablename, indexname;`,
  constraints: `SELECT relation.relname AS table_name, constraint_row.conname AS constraint_name,
    constraint_row.contype::text AS constraint_type, constraint_row.convalidated AS validated,
    pg_get_constraintdef(constraint_row.oid) AS definition
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
    AND relation.relname = ANY (ARRAY['sales_orders','collection_visits','customer_documents','attachments'])
    ORDER BY relation.relname, constraint_row.conname;`,
  policies: `SELECT policyname AS policy_name, cmd FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'attachments' ORDER BY policyname;`,
};

export function roleMembershipPrivilegeForVersion(serverVersionNum) {
  return Number(serverVersionNum) >= 160000 ? "SET" : "MEMBER";
}

export function readonlySecuritySql(membershipPrivilege, serverVersionNum) {
  const hasMaintainPrivilege = Number(serverVersionNum) >= 170000;
  const currentMaintainCheck = hasMaintainPrivilege
    ? "OR has_table_privilege(current_user, relation.oid, 'MAINTAIN') OR has_table_privilege(current_user, relation.oid, 'MAINTAIN WITH GRANT OPTION')"
    : "";
  const memberMaintainCheck = hasMaintainPrivilege
    ? "OR has_table_privilege(pg_roles.oid, relation.oid, 'MAINTAIN') OR has_table_privilege(pg_roles.oid, relation.oid, 'MAINTAIN WITH GRANT OPTION')"
    : "";
  const identityFlags = [
    ["superuser", "rolsuper"], ["bypassrls", "rolbypassrls"], ["createdb", "rolcreatedb"],
    ["createrole", "rolcreaterole"], ["replication", "rolreplication"],
  ];
  const attrs = identityFlags.flatMap(([label, column]) => [
    `COALESCE((SELECT ${column} FROM pg_roles WHERE rolname = session_user), true) AS session_${label}`,
    `COALESCE((SELECT ${column} FROM pg_roles WHERE rolname = current_user), true) AS current_${label}`,
  ]);
  const catalogChecks = PREFLIGHT_CATALOG_RELATIONS.map((relation) =>
    `has_table_privilege(current_user, '${relation}', 'SELECT') AS catalog_${relation.split(".").at(-1)}_select`);
  const dataColumnChecks = PREFLIGHT_DATA_COLUMNS.map(([table, column]) =>
    `CASE WHEN to_regclass('public.${table}') IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_attribute AS attribute
      WHERE attribute.attrelid = to_regclass('public.${table}') AND attribute.attname = '${column}'
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
    ) THEN true ELSE has_column_privilege(current_user, to_regclass('public.${table}'), '${column}', 'SELECT') END AS select_${table}_${column}`);
  const targetOwnerChecks = TARGET_TABLES.map((table) =>
    `current_user = (SELECT pg_get_userbyid(relation.relowner) FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname = '${table}') AS owns_${table}`);
  const targetWriteChecks = TARGET_TABLES.map((table) => `EXISTS (
      SELECT 1 FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname = '${table}'
        AND (
          has_table_privilege(current_user, relation.oid, 'INSERT') OR
          has_table_privilege(current_user, relation.oid, 'UPDATE') OR
          has_table_privilege(current_user, relation.oid, 'DELETE') OR
          has_table_privilege(current_user, relation.oid, 'TRUNCATE') OR
          has_table_privilege(current_user, relation.oid, 'TRIGGER') OR
          has_table_privilege(current_user, relation.oid, 'TRIGGER WITH GRANT OPTION') OR
          has_table_privilege(current_user, relation.oid, 'INSERT WITH GRANT OPTION') OR
          has_table_privilege(current_user, relation.oid, 'UPDATE WITH GRANT OPTION') OR
          has_table_privilege(current_user, relation.oid, 'DELETE WITH GRANT OPTION') OR
          EXISTS (SELECT 1 FROM pg_attribute AS attribute
            WHERE attribute.attrelid = relation.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
              AND (has_column_privilege(current_user, relation.oid, attribute.attnum, 'INSERT')
                OR has_column_privilege(current_user, relation.oid, attribute.attnum, 'UPDATE')
                OR has_column_privilege(current_user, relation.oid, attribute.attnum, 'INSERT WITH GRANT OPTION')
                OR has_column_privilege(current_user, relation.oid, attribute.attnum, 'UPDATE WITH GRANT OPTION')))
        )
    ) AS write_${table}`);
  const sequenceWriteCheck = `EXISTS (
      SELECT 1 FROM pg_class AS sequence
      JOIN pg_depend AS dependency ON dependency.objid = sequence.oid AND dependency.classid = 'pg_class'::regclass
        AND dependency.refclassid = 'pg_class'::regclass AND dependency.deptype = 'a'
      JOIN pg_class AS relation ON relation.oid = dependency.refobjid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE sequence.relkind = 'S' AND namespace.nspname <> 'information_schema' AND namespace.nspname !~ '^pg_'
        AND (has_sequence_privilege(current_user, sequence.oid, 'USAGE')
          OR has_sequence_privilege(current_user, sequence.oid, 'UPDATE')
          OR has_sequence_privilege(current_user, sequence.oid, 'USAGE WITH GRANT OPTION')
          OR has_sequence_privilege(current_user, sequence.oid, 'UPDATE WITH GRANT OPTION'))
    ) AS write_target_sequences`;
  const anyRelationWriteCheck = `EXISTS (
      SELECT 1 FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname <> 'information_schema' AND namespace.nspname !~ '^pg_'
        AND (has_table_privilege(current_user, relation.oid, 'INSERT')
          OR has_table_privilege(current_user, relation.oid, 'UPDATE')
          OR has_table_privilege(current_user, relation.oid, 'DELETE')
          OR has_table_privilege(current_user, relation.oid, 'TRUNCATE')
          OR has_table_privilege(current_user, relation.oid, 'TRIGGER')
          OR has_table_privilege(current_user, relation.oid, 'TRIGGER WITH GRANT OPTION')
          OR has_table_privilege(current_user, relation.oid, 'INSERT WITH GRANT OPTION')
          OR has_table_privilege(current_user, relation.oid, 'UPDATE WITH GRANT OPTION')
          OR has_table_privilege(current_user, relation.oid, 'DELETE WITH GRANT OPTION')
          ${currentMaintainCheck}
          OR EXISTS (SELECT 1 FROM pg_attribute AS attribute
            WHERE attribute.attrelid = relation.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
              AND (has_column_privilege(current_user, relation.oid, attribute.attnum, 'INSERT')
                OR has_column_privilege(current_user, relation.oid, attribute.attnum, 'UPDATE')
                OR has_column_privilege(current_user, relation.oid, attribute.attnum, 'INSERT WITH GRANT OPTION')
                OR has_column_privilege(current_user, relation.oid, attribute.attnum, 'UPDATE WITH GRANT OPTION'))))
    ) AS write_any_relation`;
  return `WITH protected_roles AS (
      SELECT oid FROM pg_roles
      WHERE rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication
        OR EXISTS (SELECT 1 FROM pg_roles AS administered_role
          WHERE administered_role.oid <> pg_roles.oid
            AND pg_has_role(pg_roles.oid, administered_role.oid, 'MEMBER WITH ADMIN OPTION'))
        OR has_database_privilege(oid, current_database(), 'CREATE')
        OR has_database_privilege(oid, current_database(), 'TEMP')
        OR EXISTS (SELECT 1 FROM pg_namespace AS namespace
          WHERE namespace.nspname <> 'information_schema' AND namespace.nspname !~ '^pg_'
            AND has_schema_privilege(pg_roles.oid, namespace.oid, 'CREATE'))
        OR oid = (SELECT datdba FROM pg_database WHERE datname = current_database())
        OR EXISTS (SELECT 1 FROM pg_namespace AS namespace
          WHERE namespace.nspname <> 'information_schema' AND namespace.nspname !~ '^pg_'
            AND namespace.nspowner = pg_roles.oid)
        OR EXISTS (SELECT 1 FROM pg_class AS relation
          JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname <> 'information_schema' AND namespace.nspname !~ '^pg_'
            AND relation.relowner = pg_roles.oid)
        OR EXISTS (SELECT 1 FROM pg_shdepend AS dependency
          WHERE dependency.dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND dependency.refclassid = 'pg_authid'::regclass
            AND dependency.refobjid = pg_roles.oid AND dependency.deptype = 'o')
        OR EXISTS (SELECT 1 FROM pg_class AS relation
          JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname <> 'information_schema' AND namespace.nspname !~ '^pg_'
            AND (has_table_privilege(pg_roles.oid, relation.oid, 'INSERT')
              OR has_table_privilege(pg_roles.oid, relation.oid, 'UPDATE')
              OR has_table_privilege(pg_roles.oid, relation.oid, 'DELETE')
              OR has_table_privilege(pg_roles.oid, relation.oid, 'TRUNCATE')
              OR has_table_privilege(pg_roles.oid, relation.oid, 'TRIGGER')
              OR has_table_privilege(pg_roles.oid, relation.oid, 'TRIGGER WITH GRANT OPTION')
              OR has_table_privilege(pg_roles.oid, relation.oid, 'INSERT WITH GRANT OPTION')
              OR has_table_privilege(pg_roles.oid, relation.oid, 'UPDATE WITH GRANT OPTION')
              OR has_table_privilege(pg_roles.oid, relation.oid, 'DELETE WITH GRANT OPTION')
              ${memberMaintainCheck}
              OR EXISTS (SELECT 1 FROM pg_attribute AS attribute
                WHERE attribute.attrelid = relation.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
                  AND (has_column_privilege(pg_roles.oid, relation.oid, attribute.attnum, 'INSERT')
                    OR has_column_privilege(pg_roles.oid, relation.oid, attribute.attnum, 'UPDATE')
                    OR has_column_privilege(pg_roles.oid, relation.oid, attribute.attnum, 'INSERT WITH GRANT OPTION')
                    OR has_column_privilege(pg_roles.oid, relation.oid, attribute.attnum, 'UPDATE WITH GRANT OPTION')))))
        OR EXISTS (SELECT 1 FROM pg_class AS sequence
          JOIN pg_depend AS dependency ON dependency.objid = sequence.oid AND dependency.classid = 'pg_class'::regclass
            AND dependency.refclassid = 'pg_class'::regclass AND dependency.deptype = 'a'
          JOIN pg_namespace AS namespace ON namespace.oid = sequence.relnamespace
          WHERE sequence.relkind = 'S' AND namespace.nspname <> 'information_schema' AND namespace.nspname !~ '^pg_'
            AND (has_sequence_privilege(pg_roles.oid, sequence.oid, 'USAGE')
              OR has_sequence_privilege(pg_roles.oid, sequence.oid, 'UPDATE')
              OR has_sequence_privilege(pg_roles.oid, sequence.oid, 'USAGE WITH GRANT OPTION')
              OR has_sequence_privilege(pg_roles.oid, sequence.oid, 'UPDATE WITH GRANT OPTION')))
    )
    SELECT current_user = session_user AS same_login_role,
      ${attrs.join(",\n      ")},
      COALESCE((SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication
        FROM pg_roles WHERE rolname = current_user), false) AS current_role_safe,
      has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
      has_database_privilege(current_user, current_database(), 'TEMP') AS database_temp,
      has_schema_privilege(current_user, 'public', 'CREATE') AS public_create,
      has_schema_privilege(current_user, 'supabase_migrations', 'CREATE') AS migration_schema_create,
      EXISTS (SELECT 1 FROM pg_namespace AS namespace
        WHERE namespace.nspname <> 'information_schema' AND namespace.nspname !~ '^pg_'
          AND has_schema_privilege(current_user, namespace.oid, 'CREATE')) AS any_schema_create,
      current_user = (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) AS owns_database,
      current_user = (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'public') AS owns_public_schema,
      current_user = (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'supabase_migrations') AS owns_migration_schema,
      EXISTS (SELECT 1 FROM pg_namespace AS namespace
        WHERE namespace.nspname <> 'information_schema' AND namespace.nspname !~ '^pg_'
          AND namespace.nspowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)) AS owns_any_schema,
      EXISTS (SELECT 1 FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname <> 'information_schema' AND namespace.nspname !~ '^pg_'
          AND relation.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)) AS owns_any_relation,
      EXISTS (SELECT 1 FROM pg_shdepend AS dependency
        WHERE dependency.dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND dependency.refclassid = 'pg_authid'::regclass
          AND dependency.refobjid = (SELECT oid FROM pg_roles WHERE rolname = current_user)
          AND dependency.deptype = 'o') AS owns_any_database_object,
      ${anyRelationWriteCheck},
      NOT EXISTS (SELECT 1 FROM protected_roles AS protected
        WHERE protected.oid <> (SELECT oid FROM pg_roles WHERE rolname = session_user)
          AND pg_has_role(session_user, protected.oid, '${membershipPrivilege}')) AS no_settable_privileged_roles,
      NOT EXISTS (SELECT 1 FROM protected_roles AS protected
        WHERE protected.oid <> (SELECT oid FROM pg_roles WHERE rolname = session_user)
          AND pg_has_role(session_user, protected.oid, '${membershipPrivilege} WITH ADMIN OPTION')) AS no_admin_on_privileged_roles,
      current_setting('row_security') = 'on' AS row_security_setting_on,
      has_schema_privilege(current_user, 'public', 'USAGE') AS public_usage,
      has_schema_privilege(current_user, 'supabase_migrations', 'USAGE') AS migration_schema_usage,
      has_column_privilege(current_user, 'supabase_migrations.schema_migrations', 'version', 'SELECT') AS ledger_version_select,
      ${targetOwnerChecks.join(",\n      ")},
      ${catalogChecks.join(",\n      ")},
      ${dataColumnChecks.join(",\n      ")},
      ${targetWriteChecks.join(",\n      ")},
      ${sequenceWriteCheck},
      has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'INSERT') AS ledger_insert,
      has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'UPDATE') AS ledger_update,
      has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'DELETE') AS ledger_delete,
      has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'TRUNCATE') AS ledger_truncate,
      has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'INSERT WITH GRANT OPTION') AS ledger_insert_grant,
      has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'UPDATE WITH GRANT OPTION') AS ledger_update_grant,
      has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'DELETE WITH GRANT OPTION') AS ledger_delete_grant,
      EXISTS (SELECT 1 FROM pg_attribute AS attribute
        WHERE attribute.attrelid = to_regclass('supabase_migrations.schema_migrations')
          AND attribute.attnum > 0 AND NOT attribute.attisdropped
          AND (has_column_privilege(current_user, attribute.attrelid, attribute.attnum, 'INSERT')
            OR has_column_privilege(current_user, attribute.attrelid, attribute.attnum, 'UPDATE')
            OR has_column_privilege(current_user, attribute.attrelid, attribute.attnum, 'INSERT WITH GRANT OPTION')
            OR has_column_privilege(current_user, attribute.attrelid, attribute.attnum, 'UPDATE WITH GRANT OPTION'))) AS ledger_column_write;`;
}

const bool = (value) => value === true || ["true", "t", "1"].includes(String(value).toLowerCase());
const normalizeSql = (value) => String(value || "").toLowerCase().replaceAll('"', "").replace(/\s+/g, "");
const hasColumn = (schema, table, column) => schema.columns.some((row) => row.table_name === table && row.column_name === column);

export function validateWorkflowContext({ mode, reviewedCommit, workflowSha, checkedOutSha, currentMainSha, workflowRef, migrationsEnabled, confirmation, previousPreflightVerified }) {
  const errors = [];
  if (!new Set(["preflight", "apply"]).has(mode)) errors.push("mode must be preflight or apply");
  if (workflowRef !== "refs/heads/main") errors.push("workflow must be dispatched from main");
  if (!/^[0-9a-f]{40}$/i.test(String(reviewedCommit || ""))) errors.push("reviewed commit must be a full SHA");
  if (reviewedCommit !== workflowSha || reviewedCommit !== checkedOutSha || reviewedCommit !== currentMainSha) errors.push("reviewed, workflow, checkout, and current main SHAs must match");
  if (mode === "apply") {
    if (migrationsEnabled !== "true") errors.push("apply disabled: PRODUCTION_DB_MIGRATIONS_ENABLED is not true");
    if (confirmation !== `APPLY ${reviewedCommit}`) errors.push("execution confirmation must exactly match APPLY <reviewed SHA>");
    if (previousPreflightVerified !== "true") errors.push("apply requires a successful preflight run for this commit");
  }
  return errors;
}

export function validateProductionDatabaseUrl(raw) {
  let url;
  try { url = new URL(raw || ""); } catch { return { ok: false, reason: "database URL missing or malformed" }; }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) return { ok: false, reason: "URL must use PostgreSQL" };
  if (url.hostname.toLowerCase() !== `db.${PRODUCTION_PROJECT_REF}.supabase.co`) return { ok: false, reason: "host does not match the pinned production project" };
  if (url.port && url.port !== "5432") return { ok: false, reason: "must use direct PostgreSQL port 5432" };
  if (url.pathname !== "/postgres") return { ok: false, reason: "database name must be postgres" };
  if (!url.username || !url.password) return { ok: false, reason: "database URL must include credentials" };
  const sslModes = url.searchParams.getAll("sslmode");
  if (sslModes.length !== 1 || sslModes[0] !== "verify-full") return { ok: false, reason: "database URL must use sslmode=verify-full" };
  return { ok: true, host: url.hostname, database: url.pathname.slice(1) };
}

export function migrationLedgerRepairIssues(identity = {}) {
  const issues = [];
  if (!bool(identity.ledger_exists)) issues.push("migration ledger is missing");
  if (!bool(identity.ledger_is_table)) issues.push("migration ledger is not a table");
  if (!bool(identity.ledger_rls_disabled)) issues.push("migration ledger RLS is enabled");
  if (!bool(identity.ledger_columns_ready)) issues.push("migration ledger columns are not repair-ready");
  if (!bool(identity.ledger_constraints_exact)) issues.push("migration ledger has unexpected constraints");
  if (!bool(identity.ledger_triggers_absent)) issues.push("migration ledger has user triggers");
  if (!bool(identity.ledger_version_unique)) issues.push("migration ledger version lacks a non-deferrable primary key");
  return issues;
}

export function readonlyPrivilegeIssues(privileges = {}) {
  const mustBeFalse = [
    "session_superuser", "current_superuser", "session_bypassrls", "current_bypassrls",
    "session_createdb", "current_createdb", "session_createrole", "current_createrole",
    "session_replication", "current_replication",
    "database_create", "public_create", "migration_schema_create", "owns_database",
    "database_temp", "any_schema_create", "owns_any_schema", "owns_any_relation", "owns_any_database_object", "write_any_relation",
    "write_target_sequences", "ledger_column_write",
    "owns_public_schema", "owns_migration_schema", "ledger_insert", "ledger_update",
    "ledger_delete", "ledger_truncate", "ledger_insert_grant", "ledger_update_grant", "ledger_delete_grant",
    ...TARGET_TABLES.flatMap((table) => [`owns_${table}`, `write_${table}`]),
  ];
  const mustBeTrue = [
    "same_login_role", "current_role_safe", "no_settable_privileged_roles", "no_admin_on_privileged_roles",
    "row_security_setting_on", "public_usage",
    "migration_schema_usage", "ledger_version_select",
    ...PREFLIGHT_CATALOG_RELATIONS.map((relation) => `catalog_${relation.split(".").at(-1)}_select`),
    ...PREFLIGHT_DATA_COLUMNS.map(([table, column]) => `select_${table}_${column}`),
  ];
  const issues = [];
  for (const name of mustBeFalse) {
    if (!Object.hasOwn(privileges, name)) issues.push(`${name} was not verified`);
    else if (bool(privileges[name])) issues.push(`${name} must be false`);
  }
  for (const name of mustBeTrue) {
    if (!Object.hasOwn(privileges, name)) issues.push(`${name} was not verified`);
    else if (!bool(privileges[name])) issues.push(`${name} is required`);
  }
  return issues;
}

export function selectIntegrityScanKeys(tableSet, columnSet) {
  return INTEGRITY_SCANS
    .filter((scan) => {
      if ((scan.requiresTables || []).some((table) => !tableSet.has(table))) return false;
      return scan.requiresColumns.every((column) => columnSet.has(column));
    })
    .map((scan) => scan.key);
}

export function tablesForIntegrityScans(keys) {
  const tables = new Set();
  for (const key of keys) {
    const scan = INTEGRITY_SCAN_BY_KEY[key];
    if (!scan) throw new Error(`integrity scan key is not allowlisted: ${key}`);
    for (const table of scan.tables) tables.add(table);
  }
  return [...tables].sort();
}

export function integrityVisibilitySql(tables) {
  if (!Array.isArray(tables) || tables.some((table) => !TARGET_TABLES.includes(table))) {
    throw new Error("integrity visibility tables must be an allowlisted target subset");
  }
  if (!tables.length) return "SELECT true AS integrity_visibility_ready";
  const checks = tables.flatMap((table) => [
    `(to_regclass('public.${table}') IS NOT NULL) AS exists_${table}`,
    `(current_user = (SELECT pg_get_userbyid(relation.relowner) FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname = '${table}')) AS owns_${table}`,
    `COALESCE((SELECT relation.relrowsecurity FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname = '${table}'), false) AS rls_enabled_${table}`,
    `COALESCE((SELECT relation.relforcerowsecurity FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname = '${table}'), false) AS force_rls_${table}`,
    `CASE WHEN to_regclass('public.${table}') IS NULL THEN false
      ELSE row_security_active(to_regclass('public.${table}')) END AS row_security_active_${table}`,
    `has_table_privilege(current_user, to_regclass('public.${table}'), 'SELECT') AS select_${table}`,
  ]);
  return `SELECT ${checks.join(",\n      ")};`;
}

export function integrityVisibilityIssues(privileges = {}, tables = []) {
  const issues = [];
  for (const table of tables) {
    if (!TARGET_TABLES.includes(table)) {
      issues.push(`integrity visibility table is not allowlisted: ${table}`);
      continue;
    }
    for (const name of [`exists_${table}`, `owns_${table}`, `rls_enabled_${table}`, `force_rls_${table}`, `row_security_active_${table}`, `select_${table}`]) {
      if (!Object.hasOwn(privileges, name)) issues.push(`${name} was not verified`);
    }
    if (Object.hasOwn(privileges, `exists_${table}`) && !bool(privileges[`exists_${table}`])) {
      issues.push(`public.${table} is missing for integrity scan visibility`);
      continue;
    }
    if (Object.hasOwn(privileges, `owns_${table}`) && !bool(privileges[`owns_${table}`])) {
      issues.push(`migration role must own public.${table} for full-row integrity visibility`);
    }
    if (Object.hasOwn(privileges, `force_rls_${table}`) && bool(privileges[`force_rls_${table}`])) {
      issues.push(`public.${table} has FORCE ROW LEVEL SECURITY; owner visibility cannot be assumed`);
    }
    if (Object.hasOwn(privileges, `row_security_active_${table}`) && bool(privileges[`row_security_active_${table}`])) {
      issues.push(`row_security_active is true for public.${table}; integrity scans would be filtered`);
    }
    if (Object.hasOwn(privileges, `select_${table}`) && !bool(privileges[`select_${table}`])) {
      issues.push(`SELECT on public.${table} is required for integrity scans`);
    }
  }
  return issues;
}

export function assertIntegrityScanSql(sql) {
  const text = String(sql || "");
  if (!/^\s*SELECT\b/i.test(text)) throw new Error("integrity scan SQL must be a SELECT");
  if (/\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|CALL|DO|COPY|REINDEX|VACUUM|CLUSTER|REFRESH|SECURITY\s+LABEL|LISTEN|NOTIFY|LOAD|RESET|SET\b|BEGIN|COMMIT|ROLLBACK|repair)\b/i.test(text)) {
    throw new Error("integrity scan SQL contains disallowed statements");
  }
  return text;
}

export function buildIntegrityScanScript(keys) {
  if (!Array.isArray(keys)) throw new Error("integrity scan keys must be an allowlisted array");
  const unique = new Set(keys);
  if (unique.size !== keys.length) throw new Error("integrity scan keys must not contain duplicates");
  for (const key of keys) {
    if (!INTEGRITY_SCAN_BY_KEY[key]) throw new Error(`integrity scan key is not allowlisted: ${key}`);
  }
  const statements = keys.map((key) => assertIntegrityScanSql(INTEGRITY_SCAN_BY_KEY[key].sql));
  return `BEGIN READ ONLY;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '5min';\n${statements.join(";\n")};\nCOMMIT;\n`;
}

export function parseIntegrityScanCounts(stdout, keys) {
  const lines = String(stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== keys.length) throw new Error(`integrity scan returned ${lines.length} rows; expected ${keys.length}`);
  const duplicates = new Map();
  for (let index = 0; index < keys.length; index += 1) {
    const count = Number(lines[index]);
    if (!Number.isInteger(count) || count < 0) throw new Error(`integrity scan count for ${keys[index]} is invalid`);
    duplicates.set(keys[index], count);
  }
  return duplicates;
}

export function assertMutationAllowed(stage) {
  if (mutationGate !== "apply") throw new Error(`preflight mode forbids mutation: ${stage}`);
}

export function migrationScope(repoVersions, ledgerVersions) {
  const ledger = new Set(ledgerVersions);
  const allowlist = new Set(ALLOWLISTED_MIGRATIONS.map((migration) => migration.version));
  const pending = repoVersions.filter((version) => !ledger.has(version));
  const unrelatedPending = pending.filter((version) => !allowlist.has(version));
  const latestAllowed = ALLOWLISTED_MIGRATIONS.at(-1).version;
  return {
    pending,
    unrelatedPending,
    blockingUnrelatedPending: unrelatedPending,
    untrackedApplied: ledgerVersions.filter((version) => !repoVersions.includes(version)),
  };
}

function indexMatches(schema, name, table, columns, { unique = false, partialColumn = null } = {}) {
  const row = schema.indexes.find((item) => item.index_name === name);
  if (!row) return false;
  const def = normalizeSql(row.definition);
  return def.includes(`onpublic.${table}`)
    && def.includes(`(${columns.join(",")})`)
    && (!unique || def.includes("createuniqueindex"))
    && (!partialColumn || (def.includes("where") && def.includes(partialColumn) && def.includes("isnotnull")));
}

function singleColumnMigration(schema, version, table, column, indexName) {
  const issues = [];
  const tableExists = schema.tables.some((row) => row.table_name === table && bool(row.exists));
  const col = schema.columns.find((row) => row.table_name === table && row.column_name === column);
  const index = schema.indexes.some((row) => row.index_name === indexName);
  if (!tableExists) issues.push(`public.${table} is missing`);
  if (col && (col.data_type !== "uuid" || col.is_nullable !== "YES")) issues.push(`${table}.${column} type/nullability mismatch`);
  if (index && !indexMatches(schema, indexName, table, [column], { unique: true, partialColumn: column })) issues.push(`${indexName} definition mismatch`);
  if ((schema.duplicates.get(`${table}.${column}`) || 0) > 0) issues.push(`${table}.${column} has duplicate non-null values`);
  if (issues.length) return { version, status: "conflict", issues };
  const complete = Boolean(col && index);
  const ledgerApplied = schema.ledgerVersions.includes(version);
  if (ledgerApplied) return complete ? { version, status: "applied", issues: [] } : { version, status: "conflict", issues: [`ledger says applied but ${table}.${column}/index is incomplete`] };
  if (!col && !index) return { version, status: "pending", issues: [] };
  if (complete) return { version, status: "schema-present-history-missing", issues: [] };
  return { version, status: "conflict", issues: [`partial ${table}.${column} schema exists`] };
}

export function assessMigrationSchema(schema) {
  const states = [
    singleColumnMigration(schema, "20260930190000", "sales_orders", "request_id", "sales_orders_request_id_key"),
    singleColumnMigration(schema, "20261002120000", "collection_visits", "client_submission_id", "collection_visits_client_submission_id_key"),
  ];
  const version = "20261002130000";
  const issues = [];
  const tables = new Map(schema.tables.map((row) => [row.table_name, { ...row, exists: bool(row.exists), rls_enabled: bool(row.rls_enabled) }]));
  for (const name of ["collection_visits", "customer_documents"]) if (!tables.get(name)?.exists) issues.push(`public.${name} is missing`);
  const attachmentsExist = tables.get("attachments")?.exists ?? false;
  const linkColumns = [["collection_visits", "receipt_attachment_id"], ["collection_visits", "payment_attachment_id"], ["customer_documents", "attachment_id"]];
  const presentLinks = linkColumns.filter(([table, column]) => hasColumn(schema, table, column));
  const indexSpecs = [
    ["attachments_entity_idx", "attachments", ["entity_type", "entity_id"]],
    ["attachments_customer_code_idx", "attachments", ["customer_code"]],
    ["collection_visits_receipt_attachment_id_idx", "collection_visits", ["receipt_attachment_id"], "receipt_attachment_id"],
    ["collection_visits_payment_attachment_id_idx", "collection_visits", ["payment_attachment_id"], "payment_attachment_id"],
    ["customer_documents_attachment_id_idx", "customer_documents", ["attachment_id"], "attachment_id"],
  ];
  const presentIndexes = schema.indexes.filter((row) => indexSpecs.some(([name]) => name === row.index_name));
  const fkSpecs = [["collection_visits", "receipt_attachment_id", "collection_visits_receipt_attachment_id_fkey"], ["collection_visits", "payment_attachment_id", "collection_visits_payment_attachment_id_fkey"], ["customer_documents", "attachment_id", "customer_documents_attachment_id_fkey"]];
  const presentFks = schema.constraints.filter((row) => fkSpecs.some(([table, , name]) => table === row.table_name && name === row.constraint_name));
  const absent = !attachmentsExist && presentLinks.length === 0 && presentIndexes.length === 0 && presentFks.length === 0;
  if (attachmentsExist) {
    const expectedColumns = [
      ["id", "uuid", "NO"], ["category", "text", "NO"], ["storage_provider", "text", "NO"], ["object_key", "text", "NO"],
      ["content_type", "text", "YES"], ["size_bytes", "bigint", "YES"], ["sha256", "text", "YES"], ["md5", "text", "YES"],
      ["original_file_name", "text", "YES"], ["customer_code", "text", "YES"], ["entity_type", "text", "YES"], ["entity_id", "text", "YES"],
      ["uploaded_by", "uuid", "YES"], ["legacy_bucket", "text", "YES"], ["legacy_path", "text", "YES"],
      ["verified_at", "timestamp with time zone", "YES"], ["created_at", "timestamp with time zone", "NO"],
    ];
    for (const [column, type, nullable] of expectedColumns) {
      if (!schema.columns.some((row) => row.table_name === "attachments" && row.column_name === column && row.data_type === type && row.is_nullable === nullable)) issues.push(`attachments.${column} missing or incompatible`);
    }
    if (!tables.get("attachments")?.rls_enabled) issues.push("attachments RLS is not enabled");
    if ((schema.policies || []).length) issues.push("attachments has policies; expected no browser policies");
    const tableChecks = schema.constraints.filter((row) => row.table_name === "attachments").map((row) => normalizeSql(row.definition));
    if (!tableChecks.some((def) => def.includes("primarykey(id)"))) issues.push("attachments primary key is missing or incompatible");
    if (!tableChecks.some((def) => def.includes("unique(storage_provider,object_key)"))) issues.push("attachments provider/object_key uniqueness is missing");
    if (!tableChecks.some((def) => def.includes("check") && def.includes("receipt_copy") && def.includes("customer_document"))) issues.push("attachments category check is missing or incompatible");
    if (!tableChecks.some((def) => def.includes("check") && def.includes("supabase") && def.includes("r2"))) issues.push("attachments provider check is missing or incompatible");
    for (const [name, table, columns, partialColumn] of indexSpecs) {
      if (!indexMatches(schema, name, table, columns, { partialColumn: partialColumn || null })) issues.push(`${name} is missing or incompatible`);
    }
    for (const [table, column, name] of fkSpecs) {
      const fk = schema.constraints.find((row) => row.table_name === table && row.constraint_name === name && row.constraint_type === "f");
      const def = normalizeSql(fk?.definition);
      if (!fk || !bool(fk.validated) || !def.includes(`foreignkey(${column})`) || !(def.includes("referencesattachments(id)") || def.includes("referencespublic.attachments(id)"))) issues.push(`${name} is missing, unvalidated or incompatible`);
      if (!hasColumn(schema, table, column) || !schema.columns.some((row) => row.table_name === table && row.column_name === column && row.data_type === "uuid" && row.is_nullable === "YES")) issues.push(`${table}.${column} is not nullable uuid`);
      if ((schema.duplicates.get(`orphan:${table}.${column}`) || 0) > 0) issues.push(`${table}.${column} has orphan attachment references`);
    }
    if ((schema.duplicates.get("attachments.storage_provider,object_key") || 0) > 0) issues.push("attachments has duplicate provider/object_key pairs");
  } else if (!absent) {
    issues.push("partial attachment schema exists without attachments table");
  }
  const ledgerApplied = schema.ledgerVersions.includes(version);
  const status = issues.length ? "conflict" : ledgerApplied ? (attachmentsExist ? "applied" : "conflict") : absent ? "pending" : "schema-present-history-missing";
  states.push({ version, status, issues });
  return states;
}

export function hasOnlyAllowlistedMigrationSql(sql) {
  return !/\b(DROP|TRUNCATE|DELETE|UPDATE|CREATE\s+POLICY|DROP\s+POLICY)\b/i.test(sql)
    && !/\bALTER\s+TABLE\b[\s\S]*?\bDROP\b/i.test(sql)
    && !/\bstorage\.(buckets|objects)\b/i.test(sql);
}

function runCli(args, stage, parseRows = true) {
  const result = spawnSync("supabase", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "true" },
  });
  if (result.error || result.status !== 0) throw new Error(`${stage} failed (exit ${result.status ?? "unavailable"}); raw CLI output suppressed`);
  if (!parseRows) return [];
  let parsed;
  try { parsed = JSON.parse(String(result.stdout || "").trim() || "[]"); }
  catch { throw new Error(`${stage} returned an unexpected format; raw output suppressed`); }
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.rows)) return parsed.rows;
  throw new Error(`${stage} returned no result rows`);
}

function runPsql(args, stage) {
  const result = spawnSync("psql", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env },
  });
  if (result.error || result.status !== 0) throw new Error(`${stage} failed (exit ${result.status ?? "unavailable"}); raw psql output suppressed`);
}

function queryPsql(dbUrl, sql, stage) {
  const result = spawnSync("psql", ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "--no-align", "--tuples-only", "--field-separator=,", "--command", sql, dbUrl], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env },
  });
  if (result.error || result.status !== 0) throw new Error(`${stage} failed (exit ${result.status ?? "unavailable"}); raw psql output suppressed`);
  const values = String(result.stdout || "").trim().split(",");
  if (!values.length) throw new Error(`${stage} returned no result row`);
  return values;
}

function query(dbUrl, sql, stage) {
  return runCli(["db", "query", "--db-url", dbUrl, "--agent", "no", "--output", "json", sql], stage);
}

function collectReadonlyPreflight(dbUrl) {
  const identity = query(dbUrl, SQL.identity, "database identity")[0];
  if (!identity) throw new Error("database identity query returned no row");
  if (identity.database !== "postgres") throw new Error("connected database is not postgres");
  if (!bool(identity.tls)) throw new Error("database session is not TLS encrypted");
  if (bool(identity.is_superuser)) throw new Error("read-only preflight must not use a superuser connection");
  const ledgerIssues = migrationLedgerRepairIssues(identity);
  if (ledgerIssues.length) throw new Error(`migration ledger is not repair-ready: ${ledgerIssues.join("; ")}`);
  const membershipPrivilege = roleMembershipPrivilegeForVersion(identity.server_version_num);
  const readonlyPermissions = query(dbUrl, readonlySecuritySql(membershipPrivilege, identity.server_version_num), "read-only identity and effective permissions")[0] || {};
  const writeAccess = readonlyPrivilegeIssues(readonlyPermissions);
  if (writeAccess.length) throw new Error(`read-only credential is unsafe or preflight visibility is insufficient: ${writeAccess.join(", ")}`);

  const ledgerVersions = query(dbUrl, SQL.ledger, "migration ledger").map((row) => String(row.version));
  const tables = query(dbUrl, SQL.tables, "table catalog");
  const columns = query(dbUrl, SQL.columns, "column catalog");
  const indexes = query(dbUrl, SQL.indexes, "index catalog");
  const constraints = query(dbUrl, SQL.constraints, "constraint catalog");
  const policies = query(dbUrl, SQL.policies, "attachment policies");
  const tableSet = new Set(tables.filter((row) => bool(row.exists)).map((row) => row.table_name));
  const columnSet = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
  for (const row of tables) {
    if (bool(row.exists) && !bool(row.is_table)) throw new Error(`public.${row.table_name} is not a regular or partitioned table`);
  }
  for (const table of ["sales_orders", "collection_visits", "customer_documents"]) if (!tableSet.has(table)) throw new Error(`required public.${table} base table is missing`);

  const repoVersions = readdirSync(path.join(ROOT, "supabase", "migrations"))
    .map((file) => /^([0-9]{14})_.+\.sql$/.exec(file)?.[1]).filter(Boolean).sort();
  return { identity, ledgerVersions, repoVersions, tables, columns, indexes, constraints, policies, tableSet, columnSet, duplicates: new Map() };
}

function assertIntegrityVisibility(dbUrl, tables) {
  if (!tables.length) return {};
  const sql = integrityVisibilitySql(tables);
  const privileges = query(dbUrl, sql, "integrity scan visibility")[0] || {};
  const issues = integrityVisibilityIssues(privileges, tables);
  if (issues.length) throw new Error(`integrity visibility check failed: ${issues.join("; ")}`);
  return privileges;
}

function collectIntegrityCounts(dbUrl, tableSet, columnSet) {
  const keys = selectIntegrityScanKeys(tableSet, columnSet);
  const tables = tablesForIntegrityScans(keys);
  assertIntegrityVisibility(dbUrl, tables);
  if (!keys.length) return new Map();
  const script = buildIntegrityScanScript(keys);
  if (!script.startsWith("BEGIN READ ONLY;")) throw new Error("integrity scan script must begin with BEGIN READ ONLY");
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "madiba-production-integrity-"));
  const tempFile = path.join(tempDirectory, "integrity-scans.sql");
  try {
    writeFileSync(tempFile, script, { flag: "wx" });
    const result = spawnSync("psql", ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "--no-align", "--tuples-only", "--file", tempFile, dbUrl], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env },
    });
    if (result.error || result.status !== 0) throw new Error(`integrity scan failed (exit ${result.status ?? "unavailable"}); raw psql output suppressed`);
    return parseIntegrityScanCounts(result.stdout, keys);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

function collectPreflight(readUrl, migrationUrl) {
  const schema = collectReadonlyPreflight(readUrl);
  schema.duplicates = collectIntegrityCounts(migrationUrl, schema.tableSet, schema.columnSet);
  return schema;
}

function blockersFor(schema) {
  const scope = migrationScope(schema.repoVersions, schema.ledgerVersions);
  const states = assessMigrationSchema(schema);
  const blockers = [
    ...states.flatMap((state) => state.issues.map((issue) => `${state.version}: ${issue}`)),
    ...scope.unrelatedPending.map((version) => `unrelated pending migration ${version}`),
    ...scope.untrackedApplied.map((version) => `applied migration ${version} is absent from current main`),
    ...[...schema.duplicates.entries()].filter(([, count]) => count > 0).map(([key, count]) => `${key}: ${count} duplicate/orphan groups`),
  ];
  return { scope, states, blockers };
}

function schemaInventory(schema) {
  return `${schema.tables.filter((row) => bool(row.exists)).length}/${TARGET_TABLES.length} target tables; ${schema.columns.length} columns; ${schema.indexes.length} indexes; ${schema.constraints.length} constraints/FKs; ${schema.policies.length} attachments policies`;
}

function integritySummary(schema) {
  return [...schema.duplicates.entries()].map(([key, count]) => `${key}=${count}`).join(", ") || "no relevant duplicate/orphan checks";
}

function migrationRoleSql() {
  return `SELECT COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS is_superuser,
      has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public,
  has_schema_privilege(current_user, 'supabase_migrations', 'CREATE') AS can_create_migration_schema,
      has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'SELECT') AS can_read_ledger,
      has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'INSERT') AS can_insert_ledger,
  has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'UPDATE') AS can_update_ledger,
      ${TARGET_TABLES.map((table) => `(current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = to_regclass('public.${table}'))) AS owns_${table}`).join(",")};`;
}

export function migrationRoleIssues(row, schema) {
  const issues = [];
  if (bool(row.is_superuser)) issues.push("migration connection is superuser");
  if (!bool(row.can_create_public)) issues.push("migration role lacks CREATE on public");
  if (bool(row.can_create_migration_schema)) issues.push("migration role must not have CREATE on supabase_migrations");
  if (!bool(row.can_read_ledger) || !bool(row.can_insert_ledger) || !bool(row.can_update_ledger)) issues.push("migration role lacks migration-ledger SELECT/INSERT/UPDATE");
  for (const table of ["sales_orders", "collection_visits", "customer_documents"]) {
    if (schema.tables.some((item) => item.table_name === table && bool(item.exists)) && !bool(row[`owns_${table}`])) issues.push(`migration role lacks owner-level DDL on public.${table}`);
  }
  if (schema.tables.some((item) => item.table_name === "attachments" && bool(item.exists)) && !bool(row.owns_attachments)) issues.push("migration role lacks owner-level DDL on public.attachments");
  return issues;
}

function checkMigrationRole(dbUrl, schema) {
  const sql = migrationRoleSql();
  const cliRow = query(dbUrl, sql, "migration role permissions")[0] || {};
  const values = queryPsql(dbUrl, sql, "direct SQL execution role permissions");
  const columns = ["is_superuser", "can_create_public", "can_create_migration_schema", "can_read_ledger", "can_insert_ledger", "can_update_ledger", ...TARGET_TABLES.map((table) => `owns_${table}`)];
  const psqlRow = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
  return [
    ...migrationRoleIssues(cliRow, schema).map((issue) => `Supabase CLI ${issue}`),
    ...migrationRoleIssues(psqlRow, schema).map((issue) => `psql ${issue}`),
  ];
}

export function migrationActionForState(status) {
  if (status === "applied") return "skip";
  if (status === "schema-present-history-missing") return "record-history";
  if (status === "pending") return "execute";
  return "block";
}

export function executionFailureStatus(report) {
  if (report.execution === "completed; exact allowlist only") return report.execution;
  if (report.executionStarted) return "potentially committed; verify schema and migration history before retrying";
  return "not executed";
}

function executeExactMigration(dbUrl, migration) {
  assertMutationAllowed(`execute migration file ${migration.file}`);
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "madiba-production-migration-"));
  const tempFile = path.join(tempDirectory, migration.file);
  try {
    const source = readFileSync(path.join(ROOT, "supabase", "migrations", migration.file), "utf8");
    if (!hasOnlyAllowlistedMigrationSql(source)) throw new Error(`${migration.version} contains disallowed destructive or storage-policy SQL`);
    writeFileSync(tempFile, `BEGIN;\nSET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '5min';\n${source}\nCOMMIT;\n`, { flag: "wx" });
    runPsql(["--no-psqlrc", "--set=ON_ERROR_STOP=1", "--file", tempFile, dbUrl], `execute ${migration.version}`);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

function markVersionApplied(dbUrl, version) {
  assertMutationAllowed(`migration repair ${version}`);
  runCli(["migration", "repair", version, "--status", "applied", "--db-url", dbUrl], `record ${version}`, false);
}

function writeAudit(report) {
  const rows = ALLOWLISTED_MIGRATIONS.map((migration) => {
    const state = report.states?.find((item) => item.version === migration.version);
    return `| \`${migration.version}\` | \`${migration.file}\` | ${state?.status || "not checked"} |`;
  });
  const lines = [
    "## Production database migration workflow",
    "",
    `- Triggering GitHub user: \`${report.actor || "unknown"}\``,
    `- Reviewed commit SHA: \`${report.commit || "unknown"}\``,
    `- Target Supabase project: \`${PRODUCTION_PROJECT_REF}\``,
    `- Mode: \`${report.mode || "unknown"}\``,
    `- Schema preflight: **${report.preflight || "not run"}**`,
    `- Catalog inventory: ${report.inventory || "not collected"}`,
    `- Duplicate/orphan checks: ${report.integrity || "not collected"}`,
    "",
    "| Migration version | Exact file | Status |",
    "| --- | --- | --- |",
    ...rows,
    "",
    `- Older/unrelated pending migrations: ${report.unrelatedPending?.length ? report.unrelatedPending.map((version) => `\`${version}\``).join(", ") : "none"}`,
    `- Execution status: **${report.execution || "not run"}**`,
    `- Post-execution verification: **${report.postVerification || "not run"}**`,
  ];
  if (report.failure) lines.push(`- Failure: ${report.failure}`);
  const summary = `${lines.join("\n")}\n`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
}

export async function runMigrationWorkflow(env = process.env) {
  const mode = env.PRODUCTION_DB_MIGRATION_MODE || "preflight";
  mutationGate = "closed";
  const report = { actor: env.GITHUB_ACTOR, commit: env.REVIEWED_COMMIT, mode, preflight: "running", execution: mode === "preflight" ? "not requested (read-only)" : "not started", executionStarted: false, postVerification: "not run" };
  try {
    const contextErrors = validateWorkflowContext({
      mode, reviewedCommit: env.REVIEWED_COMMIT, workflowSha: env.GITHUB_SHA,
      checkedOutSha: env.CHECKED_OUT_SHA, currentMainSha: env.CURRENT_MAIN_SHA,
      workflowRef: env.GITHUB_REF, migrationsEnabled: env.PRODUCTION_DB_MIGRATIONS_ENABLED,
      confirmation: env.EXECUTION_CONFIRMATION, previousPreflightVerified: env.PREVIOUS_PREFLIGHT_VERIFIED,
    });
    if (contextErrors.length) throw new Error(contextErrors.join("; "));
    if (env.PRODUCTION_DB_PROJECT_REF !== PRODUCTION_PROJECT_REF) throw new Error("configured project ref differs from the pinned production project");
    if (!env.PGSSLROOTCERT) throw new Error("PGSSLROOTCERT must point to the trusted Supabase root CA certificate");
    const readUrl = validateProductionDatabaseUrl(env.PRODUCTION_DB_READONLY_URL);
    if (!readUrl.ok) throw new Error(`read-only connection rejected: ${readUrl.reason}`);
    const migrationUrl = validateProductionDatabaseUrl(env.PRODUCTION_DB_MIGRATION_URL);
    if (!migrationUrl.ok) throw new Error(`migration connection rejected: ${migrationUrl.reason}`);
    const schema = collectPreflight(env.PRODUCTION_DB_READONLY_URL, env.PRODUCTION_DB_MIGRATION_URL);
    const { scope, states, blockers } = blockersFor(schema);
    report.database = schema.identity.database;
    report.tls = bool(schema.identity.tls);
    report.states = states;
    report.unrelatedPending = scope.unrelatedPending;
    report.inventory = schemaInventory(schema);
    report.integrity = integritySummary(schema);
    if (blockers.length) {
      report.preflight = "BLOCKED";
      throw new Error(blockers.join("; "));
    }
    report.preflight = "PASS";
    if (mode === "preflight") return report;

    const privilegeErrors = checkMigrationRole(env.PRODUCTION_DB_MIGRATION_URL, schema);
    if (privilegeErrors.length) throw new Error(`migration-role check failed: ${privilegeErrors.join("; ")}`);

    mutationGate = "apply";
    report.execution = "in progress; allowlisted versions only";
    for (const migration of ALLOWLISTED_MIGRATIONS) {
      const state = report.states.find((item) => item.version === migration.version);
      const action = migrationActionForState(state.status);
      if (action === "skip") continue;
      if (action === "record-history") {
        report.executionStarted = true;
        report.execution = `recording history for ${migration.version}; prior SQL is verified in schema`;
        markVersionApplied(env.PRODUCTION_DB_MIGRATION_URL, migration.version);
        state.status = "history recorded for verified schema";
        continue;
      }
      if (action !== "execute") throw new Error(`${migration.version} is not in a safe pending state`);
      report.executionStarted = true;
      report.execution = `executing ${migration.version}; outcome unknown`;
      executeExactMigration(env.PRODUCTION_DB_MIGRATION_URL, migration);
      report.execution = `${migration.version} SQL transaction committed; recording history`;
      markVersionApplied(env.PRODUCTION_DB_MIGRATION_URL, migration.version);
      state.status = "executed exact file and recorded";
    }
    report.execution = "completed; exact allowlist only";
    mutationGate = "closed";
    const postSchema = collectPreflight(env.PRODUCTION_DB_READONLY_URL, env.PRODUCTION_DB_MIGRATION_URL);
    const postStates = assessMigrationSchema(postSchema);
    report.states = postStates.map((state) => ({ ...state, status: state.status === "applied" ? "verified applied" : state.status }));
    report.postVerification = postStates.every((state) => state.status === "applied") ? "PASS" : "FAILED";
    if (postStates.some((state) => state.status !== "applied")) throw new Error("post-execution schema/ledger verification failed");
    return report;
  } catch (error) {
    report.failure = error.message || "operation failed; sensitive output suppressed";
    if (report.preflight === "running") report.preflight = "FAILED";
    report.execution = executionFailureStatus(report);
    report.error = true;
    return report;
  } finally {
    mutationGate = "closed";
    writeAudit(report);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runMigrationWorkflow().then((report) => {
    if (report.error) process.exitCode = 1;
  }).catch(() => {
    console.error("Production DB migration workflow failed before preflight; sensitive details suppressed.");
    process.exitCode = 1;
  });
}