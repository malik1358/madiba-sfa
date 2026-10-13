import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const remediationPath = path.join(repoRoot, "sql", "security_revoke_sales_batch_rpc_execute.sql");
const setupPath = path.join(repoRoot, "sql", "merge_sales_batch_by_dates.sql");
const importSalesPath = path.join(repoRoot, "app", "api", "import-sales", "route.js");
const workflowPath = path.join(repoRoot, ".github", "workflows", "production-db-migrations.yml");
const migrationsDir = path.join(repoRoot, "supabase", "migrations");

const MERGE_SIG = "public.merge_sales_batch_by_dates(bigint, date[])";
const REFRESH_SIG = "public.refresh_import_batch_stats(bigint)";

test("remediation SQL is manual-only under sql/ and not a supabase migration", () => {
  assert.equal(existsSync(remediationPath), true);
  const migrations = readdirSync(migrationsDir);
  assert.equal(migrations.some((name) => name.includes("security_revoke_sales_batch")), false);
  const sql = readFileSync(remediationPath, "utf8");
  assert.match(sql, /STATUS:\s*NOT EXECUTED/i);
  assert.match(sql, /separate explicit production authorization/i);
});

test("remediation targets exact signatures and revokes PUBLIC/anon/authenticated", () => {
  const sql = readFileSync(remediationPath, "utf8");
  for (const line of [
    `REVOKE ALL ON FUNCTION ${MERGE_SIG} FROM PUBLIC;`,
    `REVOKE ALL ON FUNCTION ${MERGE_SIG} FROM anon;`,
    `REVOKE ALL ON FUNCTION ${MERGE_SIG} FROM authenticated;`,
    `GRANT EXECUTE ON FUNCTION ${MERGE_SIG} TO service_role;`,
    `REVOKE ALL ON FUNCTION ${REFRESH_SIG} FROM PUBLIC;`,
    `REVOKE ALL ON FUNCTION ${REFRESH_SIG} FROM anon;`,
    `REVOKE ALL ON FUNCTION ${REFRESH_SIG} FROM authenticated;`,
    `GRANT EXECUTE ON FUNCTION ${REFRESH_SIG} TO service_role;`,
  ]) {
    assert.equal(sql.includes(line), true, line);
  }
  assert.doesNotMatch(sql, /DROP FUNCTION/i);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION/i);
  // Remediation must not touch sales/customer data or the migration ledger;
  // comments may mention them. Active statements are privilege-only.
  const active = sql
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("--") && !trimmed.startsWith("\\");
    })
    .join("\n");
  assert.doesNotMatch(active, /schema_migrations/i);
  assert.doesNotMatch(active, /\bUPDATE\b/i);
  assert.doesNotMatch(active, /\bDELETE\b/i);
  assert.doesNotMatch(active, /\bINSERT\b/i);
  assert.match(active, /\bREVOKE\b/);
  assert.match(active, /\bGRANT\b/);
});

test("setup script documents the same least-privilege grants for future installs", () => {
  const sql = readFileSync(setupPath, "utf8");
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.merge_sales_batch_by_dates\(bigint, date\[\]\) FROM PUBLIC;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.merge_sales_batch_by_dates\(bigint, date\[\]\) TO service_role;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.refresh_import_batch_stats\(bigint\) FROM PUBLIC;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.refresh_import_batch_stats\(bigint\) TO service_role;/);
});

test("import-sales calls both RPCs only through the service-role admin client", () => {
  const source = readFileSync(importSalesPath, "utf8");
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /const serviceKey = process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /createClient\(\s*supabaseUrl,\s*serviceKey/);
  assert.match(source, /admin\.rpc\(\s*"merge_sales_batch_by_dates"/);
  assert.match(source, /admin\.rpc\(\s*"refresh_import_batch_stats"/);
  assert.equal((source.match(/\.rpc\(\s*"merge_sales_batch_by_dates"/g) || []).length, 1);
  assert.equal((source.match(/\.rpc\(\s*"refresh_import_batch_stats"/g) || []).length, 1);
  assert.doesNotMatch(source, /getSupabaseClient\(\)[\s\S]{0,200}merge_sales_batch_by_dates/);
});

test("production DB migration workflow does not auto-apply the remediation SQL", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const runner = readFileSync(path.join(repoRoot, "scripts", "productionDbMigrations.mjs"), "utf8");
  assert.match(workflow, /workflow_dispatch/);
  assert.doesNotMatch(workflow, /security_revoke_sales_batch_rpc_execute/);
  assert.doesNotMatch(runner, /security_revoke_sales_batch_rpc_execute/);
  assert.match(runner, /ALLOWLISTED_MIGRATIONS/);
  assert.match(runner, /20260930190000/);
  assert.doesNotMatch(runner, /20260819000000/);
  assert.match(workflow, /PRODUCTION_DB_MIGRATIONS_ENABLED/);
});

test("historical migration already intended PUBLIC revoke (production drifted)", () => {
  const migration = readFileSync(
    path.join(migrationsDir, "20260819000000_merge_sales_batch_by_dates.sql"),
    "utf8",
  );
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.merge_sales_batch_by_dates\(bigint, date\[\]\) FROM PUBLIC;/);
  assert.match(migration, /GRANT ALL ON FUNCTION public\.merge_sales_batch_by_dates\(bigint, date\[\]\) TO service_role;/);
});
