import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PRODUCTION_PROJECT_REF, validateProductionDatabaseUrl } from "./productionDbMigrations.mjs";

/**
 * One-shot column SELECT for collection_visits.client_submission_id.
 * The SQL below is the only statement batch this process can run.
 * Remove this file and .github/workflows/grant-client-submission-select.yml
 * after the successful production run.
 */
const GRANT_SQL = `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $client_submission_pre$
DECLARE
  authenticated_role oid := (SELECT oid FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  IF current_user <> 'madiba_mig_owner' OR session_user::text <> 'madiba_mig_owner' THEN
    RAISE EXCEPTION 'connected role is not madiba_mig_owner';
  END IF;
  IF COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) THEN
    RAISE EXCEPTION 'migration owner must not be superuser';
  END IF;
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'connected database is not postgres';
  END IF;
  IF (
    SELECT count(*) FROM pg_attribute AS attribute
    JOIN pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_type AS type ON type.oid = attribute.atttypid
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'collection_visits'
      AND attribute.attname = 'client_submission_id'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND type.typname = 'uuid'
      AND NOT attribute.attnotnull
  ) <> 1 THEN
    RAISE EXCEPTION 'client_submission_id is not a nullable uuid';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index AS index_row
    JOIN pg_class AS index_relation ON index_relation.oid = index_row.indexrelid
    JOIN pg_class AS table_relation ON table_relation.oid = index_row.indrelid
    JOIN pg_namespace AS namespace ON namespace.oid = table_relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND table_relation.relname = 'collection_visits'
      AND index_relation.relname = 'collection_visits_client_submission_id_key'
      AND index_row.indisunique
      AND index_row.indisvalid
      AND index_row.indisready
      AND pg_get_expr(index_row.indpred, index_row.indrelid) = '(client_submission_id IS NOT NULL)'
  ) THEN
    RAISE EXCEPTION 'client submission unique index baseline mismatch';
  END IF;
  IF has_column_privilege('madiba_mig_readonly', 'public.collection_visits', 'client_submission_id', 'SELECT') THEN
    RAISE EXCEPTION 'column SELECT is already present';
  END IF;
  IF has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'SELECT')
     OR has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'INSERT')
     OR has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'UPDATE')
     OR has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'DELETE') THEN
    RAISE EXCEPTION 'table-level or DML privilege is already present';
  END IF;
  IF authenticated_role IS NULL THEN
    RAISE EXCEPTION 'authenticated role is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'collection_visits'
      AND relation.relkind = 'r'
      AND pg_get_userbyid(relation.relowner) = 'madiba_mig_owner'
      AND relation.relrowsecurity
      AND NOT relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'ownership or RLS baseline mismatch';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_policy AS policy
    JOIN pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'collection_visits'
  ) <> 2
  OR NOT EXISTS (
    SELECT 1 FROM pg_policy AS policy
    JOIN pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'collection_visits'
      AND policy.polname = 'collection_visits_insert_own'
      AND policy.polcmd = 'a'
      AND policy.polpermissive
      AND policy.polroles = ARRAY[authenticated_role]
  )
  OR NOT EXISTS (
    SELECT 1 FROM pg_policy AS policy
    JOIN pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'collection_visits'
      AND policy.polname = 'collection_visits_select_own_or_management'
      AND policy.polcmd = 'r'
      AND policy.polpermissive
      AND policy.polroles = ARRAY[authenticated_role]
  ) THEN
    RAISE EXCEPTION 'collection_visits policy baseline mismatch';
  END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260930190000') <> 1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20261002120000') <> 1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20261002130000') <> 1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260816000001') <> 0 THEN
    RAISE EXCEPTION 'approved ledger baseline mismatch';
  END IF;
END
$client_submission_pre$;

GRANT SELECT (client_submission_id)
ON public.collection_visits TO madiba_mig_readonly;

DO $client_submission_post$
DECLARE
  authenticated_role oid := (SELECT oid FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  IF NOT has_column_privilege('madiba_mig_readonly', 'public.collection_visits', 'client_submission_id', 'SELECT') THEN
    RAISE EXCEPTION 'column SELECT was not granted';
  END IF;
  IF has_column_privilege('madiba_mig_readonly', 'public.collection_visits', 'client_submission_id', 'SELECT WITH GRANT OPTION')
     OR has_column_privilege('madiba_mig_readonly', 'public.collection_visits', 'id', 'SELECT') THEN
    RAISE EXCEPTION 'SELECT extends beyond client_submission_id';
  END IF;
  IF has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'SELECT')
     OR has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'INSERT')
     OR has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'UPDATE')
     OR has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'DELETE') THEN
    RAISE EXCEPTION 'table-level or DML privilege was not authorized';
  END IF;
  IF authenticated_role IS NULL THEN
    RAISE EXCEPTION 'authenticated role is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'collection_visits'
      AND relation.relkind = 'r'
      AND pg_get_userbyid(relation.relowner) = 'madiba_mig_owner'
      AND relation.relrowsecurity
      AND NOT relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'ownership or RLS changed';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_policy AS policy
    JOIN pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'collection_visits'
  ) <> 2 THEN
    RAISE EXCEPTION 'RLS policy count changed';
  END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260930190000') <> 1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20261002120000') <> 1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20261002130000') <> 1 THEN
    RAISE EXCEPTION 'ledger changed';
  END IF;
END
$client_submission_post$;

COMMIT;
`;

const GRANT_SQL_SHA256 = "6abbb44d9794a810cd227a08102395fc243cb10804cd3ff46a8515ec299c2143";
const COLUMN_GRANT = "GRANT SELECT (client_submission_id)\nON public.collection_visits TO madiba_mig_readonly;";
const BACKUP_THRESHOLDS_HOURS = Object.freeze({ database: 9, full: 30 });

const STATUS_SQL = `SELECT json_build_object(
  'current_user', current_user,
  'session_user', session_user::text,
  'database', current_database(),
  'superuser', COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false),
  'tls', CASE
    WHEN lower(COALESCE(current_setting('ssl', true), '')) IN ('on', 'true', '1') THEN true
    ELSE COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false)
  END,
  'client_submission_select', has_column_privilege('madiba_mig_readonly', 'public.collection_visits', 'client_submission_id', 'SELECT'),
  'client_submission_grant_option', has_column_privilege('madiba_mig_readonly', 'public.collection_visits', 'client_submission_id', 'SELECT WITH GRANT OPTION'),
  'visits_id_select', has_column_privilege('madiba_mig_readonly', 'public.collection_visits', 'id', 'SELECT'),
  'visits_table_select', has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'SELECT'),
  'visits_insert', has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'INSERT'),
  'visits_update', has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'UPDATE'),
  'visits_delete', has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'DELETE'),
  'owner_rls_ok', EXISTS (
    SELECT 1 FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'collection_visits'
      AND relation.relkind = 'r'
      AND pg_get_userbyid(relation.relowner) = 'madiba_mig_owner'
      AND relation.relrowsecurity
      AND NOT relation.relforcerowsecurity
  ),
  'policy_count_ok', (
    SELECT count(*)
    FROM pg_policy AS policy
    JOIN pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'collection_visits'
  ) = 2,
  'ledger_ok', (
    (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260930190000') = 1
    AND (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20261002120000') = 1
    AND (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20261002130000') = 1
    AND (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20260816000001') = 0
  )
)::text;`;

function grantSqlSha256() {
  return createHash("sha256").update(GRANT_SQL).digest("hex");
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let from = 0;
  while (from <= haystack.length) {
    const found = haystack.indexOf(needle, from);
    if (found < 0) break;
    count += 1;
    from = found + needle.length;
  }
  return count;
}

export function assertGrantSqlContract(sql = GRANT_SQL) {
  const errors = [];
  if (countOccurrences(sql, COLUMN_GRANT) !== 1) errors.push("client_submission_id grant must appear once");
  if (sql.includes("\r")) errors.push("grant SQL must use LF line endings");
  if (!sql.startsWith("BEGIN;\n") || !sql.endsWith("COMMIT;\n")) errors.push("SQL must be one BEGIN/COMMIT batch");
  if (countOccurrences(sql, "\nCOMMIT;") !== 1) errors.push("SQL must contain one COMMIT");
  const withoutGrant = sql.replace(COLUMN_GRANT, "");
  const withoutQuotes = withoutGrant.replace(/'(?:[^']|'')*'/g, "''");
  if (/\b(drop|alter|truncate|revoke|create|copy|delete|update|insert|grant)\b/i.test(withoutQuotes)) {
    errors.push("SQL contains a statement outside the column grant");
  }
  if (/\bset\s+role\b/i.test(withoutQuotes)) errors.push("SQL must not change role");
  if (/\bpostgres\b/i.test(withoutQuotes)) errors.push("SQL must not target the postgres role");
  if (!sql.includes("RAISE EXCEPTION 'column SELECT was not granted'")) errors.push("post-check must abort before COMMIT");
  if (grantSqlSha256() !== GRANT_SQL_SHA256) errors.push("grant SQL hash does not match the reviewed constant");
  if (errors.length) throw new Error(errors.join("; "));
}

function redact(value) {
  return String(value || "")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted-database-url]")
    .replace(/\bpassword=\S+/gi, "password=[redacted]");
}

function fail(message) {
  throw new Error(redact(message));
}

function migrationRole(parsed) {
  if (parsed.mode === "session-pooler") {
    const suffix = `.${PRODUCTION_PROJECT_REF}`;
    return parsed.username.slice(0, -suffix.length);
  }
  return parsed.username;
}

function connectionEnv(rawUrl) {
  const parsed = validateProductionDatabaseUrl(rawUrl);
  if (!parsed.ok) fail(parsed.reason);
  if (migrationRole(parsed) !== "madiba_mig_owner") fail("migration URL role is not madiba_mig_owner");
  const url = new URL(rawUrl);
  const { PRODUCTION_DB_MIGRATION_URL: _ignored, ...parent } = process.env;
  return {
    env: {
      ...parent,
      PGHOST: url.hostname,
      PGPORT: url.port || "5432",
      PGDATABASE: url.pathname.slice(1),
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGSSLMODE: "verify-full",
      PGCONNECT_TIMEOUT: "15",
      PGAPPNAME: "madiba-client-submission-select",
    },
    mode: parsed.mode,
  };
}

function runPsql(env, args, stage) {
  const result = spawnSync("psql", ["--no-psqlrc", "--quiet", "--no-password", "--set=ON_ERROR_STOP=1", ...args], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) fail(`${stage} failed (exit ${result.status ?? "unavailable"})`);
  return String(result.stdout || "").trim();
}

function queryStatus(env) {
  const stdout = runPsql(env, ["--no-align", "--tuples-only", "--command", STATUS_SQL], "privilege status");
  try {
    return JSON.parse(stdout);
  } catch {
    fail("privilege status returned an unreadable result");
  }
  return null;
}

function assertIdentity(status) {
  if (status.current_user !== "madiba_mig_owner" || status.session_user !== "madiba_mig_owner") {
    fail("connected role is not madiba_mig_owner");
  }
  if (status.database !== "postgres") fail("connected database is not postgres");
  if (status.superuser) fail("migration owner must not be superuser");
  if (!status.tls) fail("database session is not TLS encrypted");
}

function baselineMatches(status) {
  return status.client_submission_select === false
    && status.visits_table_select === false
    && status.visits_insert === false
    && status.visits_update === false
    && status.visits_delete === false
    && status.owner_rls_ok === true
    && status.policy_count_ok === true
    && status.ledger_ok === true;
}

function grantMatches(status) {
  return status.client_submission_select === true
    && status.client_submission_grant_option === false
    && status.visits_id_select === false
    && status.visits_table_select === false
    && status.visits_insert === false
    && status.visits_update === false
    && status.visits_delete === false
    && status.owner_rls_ok === true
    && status.policy_count_ok === true
    && status.ledger_ok === true;
}

async function github(pathname) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) fail("GH_TOKEN is required");
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "madiba-client-submission-select",
    },
  });
  if (!response.ok) fail(`GitHub API request failed (${response.status})`);
  return response.json();
}

async function assertBackupsFresh() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository || !repository.includes("/")) fail("GITHUB_REPOSITORY is required");
  const latest = {};
  const now = Date.now();
  for (let page = 1; page <= 10 && (!latest.database || !latest.full); page += 1) {
    const data = await github(`/repos/${repository}/actions/workflows/google-drive-backup.yml/runs?branch=main&per_page=100&page=${page}`);
    const runs = data.workflow_runs || [];
    for (const run of runs) {
      if (run.conclusion !== "success" || !["schedule", "workflow_dispatch"].includes(run.event)) continue;
      const mode = /\((database|full)\)/.exec(run.display_title || "")?.[1];
      if (!mode || latest[mode]) continue;
      const jobs = await github(`/repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`);
      const verified = (jobs.jobs || []).some((job) => (job.steps || []).some((step) => step.name === "Export, encrypt, upload and verify" && step.conclusion === "success"));
      if (verified) latest[mode] = run;
    }
    if (!runs.length) break;
    const oldest = Date.parse(runs.at(-1).created_at);
    if (Number.isFinite(oldest) && now - oldest > 45 * 86400000) break;
  }
  const failures = [];
  for (const [mode, hours] of Object.entries(BACKUP_THRESHOLDS_HOURS)) {
    const run = latest[mode];
    if (!run || now - Date.parse(run.updated_at) > hours * 3600000) failures.push(`${mode} backup is missing or older than ${hours} hours`);
  }
  if (failures.length) fail(failures.join("; "));
  return {
    databaseRunId: latest.database.id,
    databaseUpdatedAt: latest.database.updated_at,
    fullRunId: latest.full.id,
    fullUpdatedAt: latest.full.updated_at,
  };
}

async function assertNoConcurrentMigrations() {
  const repository = process.env.GITHUB_REPOSITORY;
  const statuses = ["queued", "in_progress", "waiting", "pending", "requested"];
  for (const status of statuses) {
    const data = await github(`/repos/${repository}/actions/workflows/production-db-migrations.yml/runs?status=${status}&per_page=20`);
    const runs = data.workflow_runs || [];
    if (runs.length) fail(`production migration workflow is ${status}: ${runs.map((run) => run.id).join(",")}`);
  }
}

function executeGrant(env) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "madiba-client-submission-select-"));
  const file = path.join(directory, "grant.sql");
  try {
    writeFileSync(file, GRANT_SQL, { mode: 0o600 });
    runPsql(env, ["--file", file], "column grant transaction");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function writeSummary(lines) {
  console.log(lines.join("\n"));
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, { flag: "a" });
}

let grantCommitted = false;

async function main() {
  if (process.argv.length > 3 || (process.argv.length === 3 && process.argv[2] !== "--self-check")) {
    fail("this script accepts no SQL input");
  }
  assertGrantSqlContract();
  if (process.argv[2] === "--self-check") {
    const rejected = validateProductionDatabaseUrl("postgres://postgres:secret@example.supabase.co:5432/postgres?sslmode=verify-full");
    if (rejected.ok) fail("project host check failed open");
    console.log(`self-check ok ${GRANT_SQL_SHA256}`);
    return;
  }
  if (process.env.GITHUB_REF !== "refs/heads/main") fail("workflow must be dispatched from main");
  if (process.env.PRODUCTION_DB_PROJECT_REF !== PRODUCTION_PROJECT_REF) fail("configured project ref differs from the pinned production project");
  if (!process.env.PGSSLROOTCERT) fail("production database root CA is not configured");
  const backups = await assertBackupsFresh();
  await assertNoConcurrentMigrations();
  const rawUrl = process.env.PRODUCTION_DB_MIGRATION_URL;
  delete process.env.PRODUCTION_DB_MIGRATION_URL;
  const { env, mode } = connectionEnv(rawUrl);
  const before = queryStatus(env);
  assertIdentity(before);
  if (!baselineMatches(before)) fail("pre-grant privilege, RLS, or ledger baseline did not match");
  executeGrant(env);
  grantCommitted = true;
  const after = queryStatus(env);
  assertIdentity(after);
  if (!grantMatches(after)) fail("post-grant verification failed; inspect privileges before any retry");
  writeSummary([
    "## Client submission column grant",
    "",
    `- Project ref: ${PRODUCTION_PROJECT_REF}`,
    `- Connection mode: ${mode}`,
    `- Database role: madiba_mig_owner`,
    `- client_submission_id SELECT: ${after.client_submission_select}`,
    "- Table SELECT and DML remain absent: true",
    "- Ownership, RLS, and ledger unchanged: true",
    `- Database backup: ${backups.databaseRunId} at ${backups.databaseUpdatedAt}`,
    `- Full backup: ${backups.fullRunId} at ${backups.fullUpdatedAt}`,
    "- Execution: committed",
    "- Remove this workflow and script after this successful run.",
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    const suffix = grantCommitted ? " Grant transaction already finished; inspect privileges before any retry." : "";
    console.error(redact(`${error.message || "client submission grant failed"}${suffix}`));
    process.exitCode = 1;
  });
}
