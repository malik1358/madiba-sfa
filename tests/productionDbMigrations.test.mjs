import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWLISTED_MIGRATIONS,
  PRODUCTION_PROJECT_REF,
  assessMigrationSchema,
  executionFailureStatus,
  hasOnlyAllowlistedMigrationSql,
  migrationActionForState,
  migrationLedgerRepairIssues,
  migrationRoleIssues,
  migrationScope,
  roleMembershipPrivilegeForVersion,
  readonlySecuritySql,
  readonlyPrivilegeIssues,
  validateProductionDatabaseUrl,
  validateWorkflowContext,
} from "../scripts/productionDbMigrations.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = readFileSync(path.join(repoRoot, ".github/workflows/production-db-migrations.yml"), "utf8");
const runner = readFileSync(path.join(repoRoot, "scripts/productionDbMigrations.mjs"), "utf8");

function emptySchema(overrides = {}) {
  return {
    ledgerVersions: [],
    tables: [
      { table_name: "sales_orders", exists: true, rls_enabled: true },
      { table_name: "collection_visits", exists: true, rls_enabled: true },
      { table_name: "customer_documents", exists: true, rls_enabled: true },
      { table_name: "attachments", exists: false, rls_enabled: false },
    ],
    columns: [],
    indexes: [],
    constraints: [],
    policies: [],
    duplicates: new Map(),
    ...overrides,
  };
}

function safeReadonlyPrivileges() {
  const privileges = {};
  for (const name of [
    "session_superuser", "current_superuser", "session_bypassrls", "current_bypassrls",
    "session_createdb", "current_createdb", "session_createrole", "current_createrole",
    "session_replication", "current_replication",
    "database_create", "database_temp", "public_create", "migration_schema_create", "any_schema_create",
    "owns_database", "owns_public_schema", "owns_migration_schema", "owns_any_schema", "owns_any_relation", "owns_any_database_object",
    "write_any_relation", "write_target_sequences", "ledger_column_write", "ledger_insert", "ledger_update",
    "ledger_delete", "ledger_truncate", "ledger_insert_grant", "ledger_update_grant", "ledger_delete_grant",
    "write_sales_orders", "write_collection_visits", "write_customer_documents", "write_attachments",
    "row_security_active_sales_orders", "row_security_active_collection_visits",
    "row_security_active_customer_documents", "row_security_active_attachments",
    "owns_sales_orders", "owns_collection_visits", "owns_customer_documents", "owns_attachments",
  ]) privileges[name] = false;
  for (const name of [
    "same_login_role", "current_role_safe", "no_settable_privileged_roles", "no_admin_on_privileged_roles", "public_usage",
    "row_security_setting_on", "migration_schema_usage", "ledger_version_select",
  ]) privileges[name] = true;
  for (const relation of ["pg_class", "pg_namespace", "pg_attribute", "pg_type", "pg_constraint", "pg_trigger", "pg_roles", "pg_database", "pg_shdepend", "pg_stat_ssl", "pg_indexes", "pg_policies"]) privileges[`catalog_${relation}_select`] = true;
  for (const [table, column] of [
    ["sales_orders", "request_id"], ["collection_visits", "client_submission_id"],
    ["collection_visits", "receipt_attachment_id"], ["collection_visits", "payment_attachment_id"],
    ["customer_documents", "attachment_id"], ["attachments", "id"],
    ["attachments", "storage_provider"], ["attachments", "object_key"],
  ]) privileges[`select_${table}_${column}`] = true;
  return privileges;
}

test("production project ref and migration allowlist are pinned and exact", () => {
  assert.equal(PRODUCTION_PROJECT_REF, "ynmtlzyqvmurpmfretji");
  assert.deepEqual(ALLOWLISTED_MIGRATIONS.map(({ version }) => version), [
    "20260930190000",
    "20261002120000",
    "20261002130000",
  ]);
  assert.deepEqual(ALLOWLISTED_MIGRATIONS.map(({ file }) => file), [
    "20260930190000_sales_order_request_id.sql",
    "20261002120000_collection_visit_client_submission_id.sql",
    "20261002130000_attachments.sql",
  ]);
});

test("preflight distinguishes absent schema, schema-present history gap, and conflicts", () => {
  const pending = assessMigrationSchema(emptySchema());
  assert.deepEqual(pending.map(({ status }) => status), ["pending", "pending", "pending"]);

  const historyGap = assessMigrationSchema(emptySchema({
    columns: [{ table_name: "sales_orders", column_name: "request_id", data_type: "uuid", is_nullable: "YES" }],
    indexes: [{ table_name: "sales_orders", index_name: "sales_orders_request_id_key", definition: "CREATE UNIQUE INDEX sales_orders_request_id_key ON public.sales_orders USING btree (request_id) WHERE (request_id IS NOT NULL)" }],
  }));
  assert.equal(historyGap[0].status, "schema-present-history-missing");

  const incompatible = assessMigrationSchema(emptySchema({
    columns: [{ table_name: "sales_orders", column_name: "request_id", data_type: "text", is_nullable: "YES" }],
  }));
  assert.equal(incompatible[0].status, "conflict");
  assert.match(incompatible[0].issues.join(" "), /type\/nullability/);
});

test("preflight blocks duplicate non-null UUIDs before unique index creation", () => {
  const states = assessMigrationSchema(emptySchema({
    columns: [{ table_name: "sales_orders", column_name: "request_id", data_type: "uuid", is_nullable: "YES" }],
    duplicates: new Map([["sales_orders.request_id", 1]]),
  }));
  assert.equal(states[0].status, "conflict");
  assert.match(states[0].issues.join(" "), /duplicate/);
});

test("preflight recognizes an applied partial unique index with PostgreSQL parentheses", () => {
  const states = assessMigrationSchema(emptySchema({
    ledgerVersions: ["20260930190000"],
    columns: [{ table_name: "sales_orders", column_name: "request_id", data_type: "uuid", is_nullable: "YES" }],
    indexes: [{ table_name: "sales_orders", index_name: "sales_orders_request_id_key", definition: "CREATE UNIQUE INDEX sales_orders_request_id_key ON public.sales_orders USING btree (request_id) WHERE (request_id IS NOT NULL)" }],
  }));
  assert.equal(states[0].status, "applied");
});

test("a committed migration with failed ledger recording retries history only", () => {
  assert.equal(migrationActionForState("schema-present-history-missing"), "record-history");
  assert.equal(migrationActionForState("applied"), "skip");
  assert.equal(migrationActionForState("pending"), "execute");
  assert.equal(migrationActionForState("conflict"), "block");
});

test("audit marks failures after execution starts as potentially committed", () => {
  assert.equal(executionFailureStatus({ executionStarted: false }), "not executed");
  assert.match(executionFailureStatus({ executionStarted: true }), /potentially committed/);
  assert.equal(executionFailureStatus({ executionStarted: true, execution: "completed; exact allowlist only" }), "completed; exact allowlist only");
  assert.match(runner, /BEGIN;\\nSET LOCAL lock_timeout = '5s';\\nSET LOCAL statement_timeout = '5min';\\n\$\{source\}\\nCOMMIT;/);
  assert.match(runner, /spawnSync\("psql", args/);
  assert.match(runner, /"--no-psqlrc", "--set=ON_ERROR_STOP=1", "--file", tempFile, dbUrl/);
  assert.doesNotMatch(runner, /"db", "query", "--db-url", dbUrl, "--agent", "no", "--output", "json", "--file", tempFile/);
  assert.match(runner, /"migration", "repair", version, "--status", "applied", "--db-url", dbUrl/);
});

test("preflight blocks ledger repair that could require schema DDL or fail its upsert", () => {
  const ready = {
    ledger_exists: true,
    ledger_is_table: true,
    ledger_rls_disabled: true,
    ledger_columns_ready: true,
    ledger_constraints_exact: true,
    ledger_triggers_absent: true,
    ledger_version_unique: true,
  };
  assert.deepEqual(migrationLedgerRepairIssues(ready), []);
  assert.deepEqual(migrationLedgerRepairIssues({ ...ready, ledger_columns_ready: false }), ["migration ledger columns are not repair-ready"]);
  assert.deepEqual(migrationLedgerRepairIssues({ ...ready, ledger_rls_disabled: false }), ["migration ledger RLS is enabled"]);
  assert.deepEqual(migrationLedgerRepairIssues({ ...ready, ledger_constraints_exact: false }), ["migration ledger has unexpected constraints"]);
  assert.deepEqual(migrationLedgerRepairIssues({ ...ready, ledger_triggers_absent: false }), ["migration ledger has user triggers"]);
  assert.deepEqual(migrationLedgerRepairIssues({ ...ready, ledger_version_unique: false }), ["migration ledger version lacks a non-deferrable primary key"]);
  assert.match(runner, /ledger_columns_ready/);
  assert.match(runner, /ledger_version_unique/);
  assert.match(runner, /ledger_constraints_exact/);
  assert.match(runner, /ledger_triggers_absent/);
  assert.match(runner, /can_create_migration_schema/);
  assert.match(runner, /current_user = \(SELECT pg_get_userbyid\(relowner\)/);
  assert.doesNotMatch(runner, /pg_has_role\(current_user, .*'MEMBER'\)/);
  assert.match(runner, /queryPsql\(dbUrl, sql, "direct SQL execution role permissions"\)/);
});

test("migration privileges require direct table ownership and ledger upsert access", () => {
  const role = {
    is_superuser: false,
    can_create_public: true,
    can_create_migration_schema: false,
    can_read_ledger: true,
    can_insert_ledger: true,
    can_update_ledger: true,
    owns_sales_orders: true,
    owns_collection_visits: true,
    owns_customer_documents: true,
    owns_attachments: false,
  };
  assert.deepEqual(migrationRoleIssues(role, emptySchema()), []);
  assert.match(migrationRoleIssues({ ...role, owns_sales_orders: false }, emptySchema()).join(" "), /direct|owner-level DDL/);
  assert.match(migrationRoleIssues({ ...role, can_create_migration_schema: true }, emptySchema()).join(" "), /CREATE on supabase_migrations/);
  assert.match(migrationRoleIssues({ ...role, can_update_ledger: false }, emptySchema()).join(" "), /ledger SELECT\/INSERT\/UPDATE/);
});

test("preflight separates allowlisted work from older and newer unrelated pending migrations", () => {
  const scope = migrationScope([
    "20260930190000", "20261002120000", "20261002130000", "20261003120000", "20261101120000",
  ], []);
  assert.deepEqual(scope.pending, ["20260930190000", "20261002120000", "20261002130000", "20261003120000", "20261101120000"]);
  assert.deepEqual(scope.unrelatedPending, ["20261003120000", "20261101120000"]);
  assert.deepEqual(scope.blockingUnrelatedPending, ["20261003120000", "20261101120000"]);
});

test("production database URL requires verified TLS and is pinned to production", () => {
  const valid = validateProductionDatabaseUrl(`postgresql://migration:example@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres?sslmode=verify-full`);
  assert.equal(valid.ok, true);
  assert.equal(valid.host, `db.${PRODUCTION_PROJECT_REF}.supabase.co`);
  assert.equal(validateProductionDatabaseUrl("postgresql://user:pw@db.other.supabase.co/postgres?sslmode=verify-full").ok, false);
  assert.equal(validateProductionDatabaseUrl(`postgresql://user:pw@db.${PRODUCTION_PROJECT_REF}.supabase.co/postgres?sslmode=require`).ok, false);
  assert.equal(validateProductionDatabaseUrl(`postgresql://user:pw@db.${PRODUCTION_PROJECT_REF}.supabase.co/postgres?sslmode=verify-ca`).ok, false);
  assert.equal(validateProductionDatabaseUrl(`postgresql://user:pw@db.${PRODUCTION_PROJECT_REF}.supabase.co/postgres?sslmode=verify-full&sslmode=require`).ok, false);
  assert.equal(validateProductionDatabaseUrl(`postgresql://user:pw@db.${PRODUCTION_PROJECT_REF}.supabase.co:6543/postgres?sslmode=verify-full`).ok, false);
});

test("read-only preflight rejects effective write privileges and tolerates missing target tables", () => {
  const safe = safeReadonlyPrivileges();
  assert.deepEqual(readonlyPrivilegeIssues(safe), []);
  for (const field of [
    "session_superuser", "current_superuser", "session_bypassrls", "current_bypassrls",
    "session_createdb", "current_createdb", "session_createrole", "current_createrole",
    "session_replication", "current_replication", "database_create", "public_create", "migration_schema_create",
    "database_temp", "any_schema_create", "owns_database", "owns_public_schema", "owns_migration_schema",
    "owns_any_schema", "owns_any_relation", "owns_any_database_object", "write_any_relation", "owns_sales_orders",
    "owns_collection_visits", "owns_customer_documents", "owns_attachments", "no_settable_privileged_roles",
    "ledger_insert", "ledger_update", "ledger_delete", "ledger_truncate", "ledger_insert_grant",
    "ledger_update_grant", "ledger_delete_grant", "ledger_column_write", "write_target_sequences", "write_any_relation", "write_sales_orders",
    "write_collection_visits", "write_customer_documents", "write_attachments",
    "row_security_setting_on", "no_admin_on_privileged_roles", "row_security_active_sales_orders", "row_security_active_collection_visits",
    "row_security_active_customer_documents", "row_security_active_attachments",
    "catalog_pg_attribute_select", "select_sales_orders_request_id",
  ]) {
    assert.notDeepEqual(readonlyPrivilegeIssues({ ...safe, [field]: !safe[field] }).length, 0, `${field} must fail closed`);
  }
  for (const relation of ["pg_class", "pg_namespace", "pg_attribute", "pg_type", "pg_constraint", "pg_trigger", "pg_roles", "pg_database", "pg_shdepend", "pg_stat_ssl", "pg_indexes", "pg_policies"]) {
    assert.ok(readonlyPrivilegeIssues({ ...safe, [`catalog_${relation}_select`]: false }).length > 0, `${relation} catalog visibility must be required`);
  }
  for (const [table, column] of [
    ["sales_orders", "request_id"], ["collection_visits", "client_submission_id"],
    ["collection_visits", "receipt_attachment_id"], ["collection_visits", "payment_attachment_id"],
    ["customer_documents", "attachment_id"], ["attachments", "id"],
    ["attachments", "storage_provider"], ["attachments", "object_key"],
  ]) {
    assert.ok(readonlyPrivilegeIssues({ ...safe, [`select_${table}_${column}`]: false }).length > 0, `${table}.${column} SELECT must be required`);
  }
  assert.ok(readonlyPrivilegeIssues({ same_login_role: true }).length > 0, "missing checks must fail closed");
  assert.equal(roleMembershipPrivilegeForVersion(150000), "MEMBER");
  assert.equal(roleMembershipPrivilegeForVersion(160000), "SET");
  const pg15Sql = readonlySecuritySql("MEMBER", 150000);
  const pg16Sql = readonlySecuritySql("SET", 160000);
  const pg17Sql = readonlySecuritySql("SET", 170000);
  assert.match(pg15Sql, /pg_has_role\(session_user, protected\.oid, 'MEMBER'\)/);
  assert.match(pg16Sql, /pg_has_role\(session_user, protected\.oid, 'SET'\)/);
  assert.doesNotMatch(pg15Sql, /'MAINTAIN/);
  assert.doesNotMatch(pg16Sql, /'MAINTAIN/);
  assert.match(pg17Sql, /'MAINTAIN WITH GRANT OPTION'/);
  assert.match(runner, /pg_has_role\(session_user, protected\.oid, '\$\{membershipPrivilege\}'\)/);
  assert.match(runner, /rolbypassrls/);
  assert.match(runner, /pg_has_role\(session_user, protected\.oid/);
  assert.match(runner, /has_table_privilege\(current_user, relation\.oid, 'UPDATE'\)/);
  assert.match(runner, /has_column_privilege\(current_user, relation\.oid, attribute\.attnum, 'UPDATE'\)/);
  assert.match(runner, /has_database_privilege\(current_user, current_database\(\), 'CREATE'\)/);
  assert.match(runner, /has_database_privilege\(current_user, current_database\(\), 'TEMP'\)/);
  assert.match(runner, /WITH ADMIN OPTION/);
  assert.match(runner, /administered_role\.oid <> pg_roles\.oid/);
  assert.match(runner, /pg_shdepend/);
  assert.match(runner, /ledger_column_write/);
  assert.match(runner, /write_any_relation/);
  assert.match(runner, /current_setting\('row_security'\) = 'on'/);
  assert.match(runner, /row_security_active\(to_regclass\('public\.\$\{table\}'\)\)/);
  assert.doesNotMatch(runner, /rolinherit|NOINHERIT/);
  assert.match(runner, /CASE WHEN to_regclass\('public\.\$\{table\}'\) IS NULL OR NOT EXISTS/);
});

test("read-only preflight is the default and apply fails closed on every missing gate", () => {
  const base = {
    reviewedCommit: "a".repeat(40),
    workflowSha: "a".repeat(40),
    checkedOutSha: "a".repeat(40),
    currentMainSha: "a".repeat(40),
    workflowRef: "refs/heads/main",
  };
  assert.deepEqual(validateWorkflowContext({ mode: "preflight", ...base }), []);
  assert.match(validateWorkflowContext({ mode: "apply", ...base }).join(" "), /apply disabled/);
  assert.match(validateWorkflowContext({ mode: "apply", ...base, migrationsEnabled: "true", confirmation: `APPLY ${"a".repeat(40)}` }).join(" "), /successful preflight/);
  assert.match(validateWorkflowContext({ mode: "apply", ...base, migrationsEnabled: "true", previousPreflightVerified: "true" }).join(" "), /confirmation/);
  assert.match(validateWorkflowContext({ mode: "apply", ...base, migrationsEnabled: "true", confirmation: `APPLY ${"a".repeat(40)}`, previousPreflightVerified: "true" }).join(" "), /^$/);
  assert.match(validateWorkflowContext({ mode: "preflight", ...base, workflowRef: "refs/heads/feature" }).join(" "), /main/);
  assert.match(validateWorkflowContext({ mode: "preflight", ...base, checkedOutSha: "b".repeat(40) }).join(" "), /SHA/);
});

test("workflow is manual-only, protected, pinned and has no unrestricted migration command", () => {
  assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request|schedule):/m);
  assert.match(workflow, /default:\s*preflight/);
  assert.match(workflow, /name:\s*production-db/);
  assert.match(workflow, /PRODUCTION_DB_MIGRATIONS_ENABLED.*false/);
  assert.match(workflow, /can_admins_bypass == false/);
  assert.match(workflow, /required_reviewers/);
  assert.match(workflow, /deployment-branch-policies/);
  assert.match(workflow, /name == "main"/);
  assert.match(workflow, /PRODUCTION_DB_ROOT_CA_CERT/);
  assert.match(workflow, /PGSSLROOTCERT=/);
  assert.match(workflow, /postgresql-client-16/);
  assert.match(runner, /ON_ERROR_STOP=1/);
  assert.match(workflow, /uses:\s+actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /uses:\s+actions\/setup-node@[0-9a-f]{40}/);
  assert.match(workflow, /reviewed_commit/);
  assert.match(workflow, /PREVIOUS_PREFLIGHT_RUN_ID/);
  assert.match(workflow, /PRODUCTION_DB_READONLY_URL/);
  assert.match(workflow, /PRODUCTION_DB_MIGRATION_URL/);
  assert.match(runner, /PGSSLROOTCERT/);
  assert.doesNotMatch(workflow, /supabase\s+(db\s+push|migration\s+up)/i);
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ACCESS_TOKEN/);
  assert.match(workflow, /read-only preflight mode; migration SQL is not executed/);
  assert.match(workflow, /SQL may have committed/);
});

test("exact migration SQL guard refuses destructive/schema-policy operations", () => {
  assert.equal(hasOnlyAllowlistedMigrationSql("ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS request_id uuid;"), true);
  assert.equal(hasOnlyAllowlistedMigrationSql("DROP TABLE public.sales_orders;"), false);
  assert.equal(hasOnlyAllowlistedMigrationSql("CREATE POLICY browser_access ON storage.objects FOR SELECT USING (true);"), false);
  assert.equal(hasOnlyAllowlistedMigrationSql("UPDATE storage.buckets SET public = false;"), false);
});
