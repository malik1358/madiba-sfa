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

const SQL = {
  identity: `SELECT current_database() AS database,
    current_user AS role_name,
    current_setting('server_version') AS server_version,
    COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS tls,
    COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS is_superuser,
    to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS ledger_exists,
    COALESCE((SELECT relkind IN ('r', 'p') FROM pg_class WHERE oid = to_regclass('supabase_migrations.schema_migrations')), false) AS ledger_is_table,
    COALESCE((SELECT NOT relrowsecurity FROM pg_class WHERE oid = to_regclass('supabase_migrations.schema_migrations')), false) AS ledger_rls_disabled,
    (SELECT count(*) = 3
        AND count(*) FILTER (WHERE column_name = 'version' AND data_type = 'text' AND is_nullable = 'NO') = 1
        AND count(*) FILTER (WHERE column_name = 'name' AND data_type = 'text') = 1
        AND count(*) FILTER (WHERE column_name = 'statements' AND data_type = 'ARRAY' AND udt_name = '_text') = 1
      FROM information_schema.columns
      WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations') AS ledger_columns_ready,
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
    COALESCE(relation.relrowsecurity, false) AS rls_enabled,
    COALESCE(pg_get_userbyid(relation.relowner), '') AS owner
    FROM (VALUES ('sales_orders'), ('collection_visits'), ('customer_documents'), ('attachments')) AS expected(table_name)
    LEFT JOIN pg_class AS relation ON relation.oid = to_regclass('public.' || expected.table_name)
    ORDER BY expected.table_name;`,
  columns: `SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY (ARRAY['sales_orders','collection_visits','customer_documents','attachments'])
    ORDER BY table_name, ordinal_position;`,
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
  const writeCapabilities = [
    "is_superuser", "can_create_public", "can_create_migration_schema",
    "ledger_insert", "ledger_update", "ledger_delete", "ledger_truncate",
    ...TARGET_TABLES.flatMap((table) => [`${table}_insert`, `${table}_update`, `${table}_delete`, `${table}_truncate`]),
  ];
  return writeCapabilities.filter((name) => bool(privileges[name]));
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

function countQuery(dbUrl, sql, stage) {
  return Number(query(dbUrl, sql, stage)[0]?.count ?? 0);
}

function collectPreflight(dbUrl) {
  const identity = query(dbUrl, SQL.identity, "database identity")[0];
  if (!identity) throw new Error("database identity query returned no row");
  if (identity.database !== "postgres") throw new Error("connected database is not postgres");
  if (!bool(identity.tls)) throw new Error("database session is not TLS encrypted");
  if (bool(identity.is_superuser)) throw new Error("read-only preflight must not use a superuser connection");
  const ledgerIssues = migrationLedgerRepairIssues(identity);
  if (ledgerIssues.length) throw new Error(`migration ledger is not repair-ready: ${ledgerIssues.join("; ")}`);
  const readonlyPermissions = query(dbUrl, `
    SELECT COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS is_superuser,
           has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_public,
      has_schema_privilege(current_user, 'supabase_migrations', 'CREATE') AS can_create_migration_schema,
           has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'INSERT') AS ledger_insert,
           has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'UPDATE') AS ledger_update,
           has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'DELETE') AS ledger_delete,
       has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'TRUNCATE') AS ledger_truncate,
           ${TARGET_TABLES.flatMap((table) => [
             `CASE WHEN to_regclass('public.${table}') IS NULL THEN false ELSE has_table_privilege(current_user, to_regclass('public.${table}'), 'INSERT') END AS ${table}_insert`,
             `CASE WHEN to_regclass('public.${table}') IS NULL THEN false ELSE has_table_privilege(current_user, to_regclass('public.${table}'), 'UPDATE') END AS ${table}_update`,
             `CASE WHEN to_regclass('public.${table}') IS NULL THEN false ELSE has_table_privilege(current_user, to_regclass('public.${table}'), 'DELETE') END AS ${table}_delete`,
             `CASE WHEN to_regclass('public.${table}') IS NULL THEN false ELSE has_table_privilege(current_user, to_regclass('public.${table}'), 'TRUNCATE') END AS ${table}_truncate`,
           ]).join(",")};
  `, "read-only credential permissions")[0] || {};
  const writeAccess = readonlyPrivilegeIssues(readonlyPermissions);
  if (writeAccess.length) throw new Error(`read-only credential has write/DDL privileges: ${writeAccess.join(", ")}`);

  const ledgerVersions = query(dbUrl, SQL.ledger, "migration ledger").map((row) => String(row.version));
  const tables = query(dbUrl, SQL.tables, "table catalog");
  const columns = query(dbUrl, SQL.columns, "column catalog");
  const indexes = query(dbUrl, SQL.indexes, "index catalog");
  const constraints = query(dbUrl, SQL.constraints, "constraint catalog");
  const policies = query(dbUrl, SQL.policies, "attachment policies");
  const tableSet = new Set(tables.filter((row) => bool(row.exists)).map((row) => row.table_name));
  const columnSet = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
  for (const table of ["sales_orders", "collection_visits", "customer_documents"]) if (!tableSet.has(table)) throw new Error(`required public.${table} base table is missing`);

  const duplicates = new Map();
  const uuidChecks = [
    ["sales_orders.request_id", "sales_orders.request_id", "SELECT count(*)::int AS count FROM (SELECT request_id FROM public.sales_orders WHERE request_id IS NOT NULL GROUP BY request_id HAVING count(*) > 1) AS duplicate_values"],
    ["collection_visits.client_submission_id", "collection_visits.client_submission_id", "SELECT count(*)::int AS count FROM (SELECT client_submission_id FROM public.collection_visits WHERE client_submission_id IS NOT NULL GROUP BY client_submission_id HAVING count(*) > 1) AS duplicate_values"],
  ];
  for (const [key, column, sql] of uuidChecks) if (columnSet.has(column)) duplicates.set(key, countQuery(dbUrl, sql, `duplicate check ${key}`));
  if (tableSet.has("attachments")) {
    duplicates.set("attachments.storage_provider,object_key", countQuery(dbUrl,
      "SELECT count(*)::int AS count FROM (SELECT storage_provider, object_key FROM public.attachments GROUP BY storage_provider, object_key HAVING count(*) > 1) AS duplicate_values",
      "attachment duplicate check"));
    for (const [table, column] of [["collection_visits", "receipt_attachment_id"], ["collection_visits", "payment_attachment_id"], ["customer_documents", "attachment_id"]]) {
      if (!columnSet.has(`${table}.${column}`)) continue;
      duplicates.set(`orphan:${table}.${column}`, countQuery(dbUrl,
        `SELECT count(*)::int AS count FROM public.${table} AS source WHERE source.${column} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.attachments AS target WHERE target.id = source.${column})`,
        `orphan reference check ${table}.${column}`));
    }
  }
  const repoVersions = readdirSync(path.join(ROOT, "supabase", "migrations"))
    .map((file) => /^([0-9]{14})_.+\.sql$/.exec(file)?.[1]).filter(Boolean).sort();
  return { identity, ledgerVersions, repoVersions, tables, columns, indexes, constraints, policies, duplicates };
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
    const schema = collectPreflight(env.PRODUCTION_DB_READONLY_URL);
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

    const migrationUrl = validateProductionDatabaseUrl(env.PRODUCTION_DB_MIGRATION_URL);
    if (!migrationUrl.ok) throw new Error(`migration connection rejected: ${migrationUrl.reason}`);
    const privilegeErrors = checkMigrationRole(env.PRODUCTION_DB_MIGRATION_URL, schema);
    if (privilegeErrors.length) throw new Error(`migration-role check failed: ${privilegeErrors.join("; ")}`);

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
    const postSchema = collectPreflight(env.PRODUCTION_DB_READONLY_URL);
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