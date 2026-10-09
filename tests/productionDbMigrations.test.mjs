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
  assert.deepEqual(readonlyPrivilegeIssues(), []);
  assert.deepEqual(readonlyPrivilegeIssues({ sales_orders_update: true, ledger_update: true }), ["ledger_update", "sales_orders_update"]);
  assert.deepEqual(readonlyPrivilegeIssues({ can_create_migration_schema: true, ledger_truncate: true }), ["can_create_migration_schema", "ledger_truncate"]);
  assert.deepEqual(readonlyPrivilegeIssues({ is_superuser: true }), ["is_superuser"]);
  assert.match(runner, /CASE WHEN to_regclass\('public\.\$\{table\}'\) IS NULL THEN false ELSE has_table_privilege\(current_user, to_regclass\('public\.\$\{table\}'\), 'INSERT'\) END AS \$\{table\}_insert/);
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
