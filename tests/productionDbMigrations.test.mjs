import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALLOWLISTED_MIGRATIONS,
  PRODUCTION_PROJECT_REF,
  assessMigrationSchema,
  hasOnlyAllowlistedMigrationSql,
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

test("preflight separates allowlisted work from older and newer unrelated pending migrations", () => {
  const scope = migrationScope([
    "20260930190000", "20261002120000", "20261002130000", "20261003120000", "20261101120000",
  ], []);
  assert.deepEqual(scope.pending, ["20260930190000", "20261002120000", "20261002130000", "20261003120000", "20261101120000"]);
  assert.deepEqual(scope.unrelatedPending, ["20261003120000", "20261101120000"]);
  assert.deepEqual(scope.blockingUnrelatedPending, ["20261003120000", "20261101120000"]);
});

test("production database URL is pinned to direct TLS connection for the production project", () => {
  const valid = validateProductionDatabaseUrl(`postgresql://migration:example@db.${PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres?sslmode=require`);
  assert.equal(valid.ok, true);
  assert.equal(valid.host, `db.${PRODUCTION_PROJECT_REF}.supabase.co`);
  assert.equal(validateProductionDatabaseUrl("postgresql://user:pw@db.other.supabase.co/postgres?sslmode=require").ok, false);
  assert.equal(validateProductionDatabaseUrl(`postgresql://user:pw@db.${PRODUCTION_PROJECT_REF}.supabase.co/postgres?sslmode=disable`).ok, false);
  assert.equal(validateProductionDatabaseUrl(`postgresql://user:pw@db.${PRODUCTION_PROJECT_REF}.supabase.co:6543/postgres?sslmode=require`).ok, false);
});

test("read-only preflight rejects effective write privileges and tolerates missing target tables", () => {
  assert.deepEqual(readonlyPrivilegeIssues(), []);
  assert.deepEqual(readonlyPrivilegeIssues({ sales_orders_update: true, ledger_update: true }), ["ledger_update", "sales_orders_update"]);
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
  assert.match(workflow, /uses:\s+actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /uses:\s+actions\/setup-node@[0-9a-f]{40}/);
  assert.match(workflow, /reviewed_commit/);
  assert.match(workflow, /PREVIOUS_PREFLIGHT_RUN_ID/);
  assert.doesNotMatch(workflow, /supabase\s+(db\s+push|migration\s+up)/i);
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ACCESS_TOKEN/);
});

test("exact migration SQL guard refuses destructive/schema-policy operations", () => {
  assert.equal(hasOnlyAllowlistedMigrationSql("ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS request_id uuid;"), true);
  assert.equal(hasOnlyAllowlistedMigrationSql("DROP TABLE public.sales_orders;"), false);
  assert.equal(hasOnlyAllowlistedMigrationSql("CREATE POLICY browser_access ON storage.objects FOR SELECT USING (true);"), false);
  assert.equal(hasOnlyAllowlistedMigrationSql("UPDATE storage.buckets SET public = false;"), false);
});