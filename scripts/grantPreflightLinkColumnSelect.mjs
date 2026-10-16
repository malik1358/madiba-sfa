import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { PRODUCTION_PROJECT_REF, validateProductionDatabaseUrl } from "./productionDbMigrations.mjs";

/**
 * One-shot production grant for the three preflight link columns.
 * The SQL below is the only statement batch this process can run.
 * Remove this file and .github/workflows/grant-preflight-link-column-select.yml
 * after the successful production run.
 */
const GRANT_SQL = `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight_grant_pre$
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
  IF EXISTS (
    SELECT 1 FROM pg_stat_activity
    WHERE usename IN ('madiba_mig_owner', 'madiba_mig_readonly')
      AND pid <> pg_backend_pid()
      AND state <> 'idle'
  ) THEN
    RAISE EXCEPTION 'another migration database session is active';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_locks AS granted_lock
    JOIN pg_class AS relation ON relation.oid = granted_lock.relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN ('collection_visits', 'customer_documents')
      AND granted_lock.mode = 'AccessExclusiveLock'
      AND granted_lock.pid <> pg_backend_pid()
  ) THEN
    RAISE EXCEPTION 'exclusive lock is already held';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_attribute AS attribute
    JOIN pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_type AS type ON type.oid = attribute.atttypid
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'collection_visits'
      AND attribute.attname IN ('receipt_attachment_id', 'payment_attachment_id')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND type.typname = 'uuid'
      AND NOT attribute.attnotnull
  ) <> 2 THEN
    RAISE EXCEPTION 'collection_visits link columns are not both nullable uuid';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_attribute AS attribute
    JOIN pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_type AS type ON type.oid = attribute.atttypid
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'customer_documents'
      AND attribute.attname = 'attachment_id'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND type.typname = 'uuid'
      AND NOT attribute.attnotnull
  ) <> 1 THEN
    RAISE EXCEPTION 'customer_documents.attachment_id is not a nullable uuid';
  END IF;
  IF has_column_privilege('madiba_mig_readonly', 'public.collection_visits', 'receipt_attachment_id', 'SELECT')
     OR has_column_privilege('madiba_mig_readonly', 'public.collection_visits', 'payment_attachment_id', 'SELECT')
     OR has_column_privilege('madiba_mig_readonly', 'public.customer_documents', 'attachment_id', 'SELECT') THEN
    RAISE EXCEPTION 'column SELECT is already present';
  END IF;
  IF has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'SELECT')
     OR has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'INSERT')
     OR has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'UPDATE')
     OR has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'DELETE')
     OR has_table_privilege('madiba_mig_readonly', 'public.customer_documents', 'SELECT')
     OR has_table_privilege('madiba_mig_readonly', 'public.customer_documents', 'INSERT')
     OR has_table_privilege('madiba_mig_readonly', 'public.customer_documents', 'UPDATE')
     OR has_table_privilege('madiba_mig_readonly', 'public.customer_documents', 'DELETE') THEN
    RAISE EXCEPTION 'table-level or DML privilege is already present';
  END IF;
  IF authenticated_role IS NULL THEN
    RAISE EXCEPTION 'authenticated role is missing';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN ('collection_visits', 'customer_documents')
      AND relation.relkind = 'r'
      AND pg_get_userbyid(relation.relowner) = 'madiba_mig_owner'
      AND relation.relrowsecurity
      AND NOT relation.relforcerowsecurity
  ) <> 2 THEN
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
  IF (
    SELECT count(*)
    FROM pg_policy AS policy
    JOIN pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'customer_documents'
  ) <> 2
  OR NOT EXISTS (
    SELECT 1 FROM pg_policy AS policy
    JOIN pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'customer_documents'
      AND policy.polname = 'documents_insert'
      AND policy.polcmd = 'a'
      AND policy.polpermissive
      AND policy.polroles = ARRAY[authenticated_role]
  )
  OR NOT EXISTS (
    SELECT 1 FROM pg_policy AS policy
    JOIN pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'customer_documents'
      AND policy.polname = 'documents_select'
      AND policy.polcmd = 'r'
      AND policy.polpermissive
      AND policy.polroles = ARRAY[authenticated_role]
  ) THEN
    RAISE EXCEPTION 'customer_documents policy baseline mismatch';
  END IF;
END
$preflight_grant_pre$;

GRANT SELECT (receipt_attachment_id, payment_attachment_id)
ON public.collection_visits TO madiba_mig_readonly;

GRANT SELECT (attachment_id)
ON public.customer_documents TO madiba_mig_readonly;

DO $preflight_grant_post$
DECLARE
  authenticated_role oid := (SELECT oid FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  IF NOT has_column_privilege('madiba_mig_readonly', 'public.collection_visits', 'receipt_attachment_id', 'SELECT')
     OR NOT has_column_privilege('madiba_mig_readonly', 'public.collection_visits', 'payment_attachment_id', 'SELECT')
     OR NOT has_column_privilege('madiba_mig_readonly', 'public.customer_documents', 'attachment_id', 'SELECT') THEN
    RAISE EXCEPTION 'column SELECT was not granted';
  END IF;
  IF has_column_privilege('madiba_mig_readonly', 'public.collection_visits', 'receipt_attachment_id', 'SELECT WITH GRANT OPTION')
     OR has_column_privilege('madiba_mig_readonly', 'public.collection_visits', 'payment_attachment_id', 'SELECT WITH GRANT OPTION')
     OR has_column_privilege('madiba_mig_readonly', 'public.customer_documents', 'attachment_id', 'SELECT WITH GRANT OPTION')
     OR has_column_privilege('madiba_mig_readonly', 'public.collection_visits', 'id', 'SELECT')
     OR has_column_privilege('madiba_mig_readonly', 'public.customer_documents', 'id', 'SELECT') THEN
    RAISE EXCEPTION 'SELECT extends beyond the three link columns';
  END IF;
  IF has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'SELECT')
     OR has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'INSERT')
     OR has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'UPDATE')
     OR has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'DELETE')
     OR has_table_privilege('madiba_mig_readonly', 'public.customer_documents', 'SELECT')
     OR has_table_privilege('madiba_mig_readonly', 'public.customer_documents', 'INSERT')
     OR has_table_privilege('madiba_mig_readonly', 'public.customer_documents', 'UPDATE')
     OR has_table_privilege('madiba_mig_readonly', 'public.customer_documents', 'DELETE') THEN
    RAISE EXCEPTION 'table-level or DML privilege was not authorized';
  END IF;
  IF authenticated_role IS NULL THEN
    RAISE EXCEPTION 'authenticated role is missing';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN ('collection_visits', 'customer_documents')
      AND relation.relkind = 'r'
      AND pg_get_userbyid(relation.relowner) = 'madiba_mig_owner'
      AND relation.relrowsecurity
      AND NOT relation.relforcerowsecurity
  ) <> 2 THEN
    RAISE EXCEPTION 'ownership or RLS changed';
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
  )
  OR (
    SELECT count(*)
    FROM pg_policy AS policy
    JOIN pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname = 'customer_documents'
  ) <> 2
  OR NOT EXISTS (
    SELECT 1 FROM pg_policy AS policy
    JOIN pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'customer_documents'
      AND policy.polname = 'documents_insert'
      AND policy.polcmd = 'a'
      AND policy.polpermissive
      AND policy.polroles = ARRAY[authenticated_role]
  )
  OR NOT EXISTS (
    SELECT 1 FROM pg_policy AS policy
    JOIN pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'customer_documents'
      AND policy.polname = 'documents_select'
      AND policy.polcmd = 'r'
      AND policy.polpermissive
      AND policy.polroles = ARRAY[authenticated_role]
  ) THEN
    RAISE EXCEPTION 'RLS policies changed';
  END IF;
END
$preflight_grant_post$;

COMMIT;
`;

const GRANT_SQL_SHA256 = "4285a03b81780bfed269a2867af56ea698b35f4522896005462c7938a8929130";

const VISIT_GRANTS = "GRANT SELECT (receipt_attachment_id, payment_attachment_id)\nON public.collection_visits TO madiba_mig_readonly;";
const DOCUMENT_GRANT = "GRANT SELECT (attachment_id)\nON public.customer_documents TO madiba_mig_readonly;";
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
  'receipt_select', has_column_privilege('madiba_mig_readonly', 'public.collection_visits', 'receipt_attachment_id', 'SELECT'),
  'payment_select', has_column_privilege('madiba_mig_readonly', 'public.collection_visits', 'payment_attachment_id', 'SELECT'),
  'document_select', has_column_privilege('madiba_mig_readonly', 'public.customer_documents', 'attachment_id', 'SELECT'),
  'receipt_grant_option', has_column_privilege('madiba_mig_readonly', 'public.collection_visits', 'receipt_attachment_id', 'SELECT WITH GRANT OPTION'),
  'payment_grant_option', has_column_privilege('madiba_mig_readonly', 'public.collection_visits', 'payment_attachment_id', 'SELECT WITH GRANT OPTION'),
  'document_grant_option', has_column_privilege('madiba_mig_readonly', 'public.customer_documents', 'attachment_id', 'SELECT WITH GRANT OPTION'),
  'visits_id_select', has_column_privilege('madiba_mig_readonly', 'public.collection_visits', 'id', 'SELECT'),
  'documents_id_select', has_column_privilege('madiba_mig_readonly', 'public.customer_documents', 'id', 'SELECT'),
  'visits_table_select', has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'SELECT'),
  'visits_insert', has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'INSERT'),
  'visits_update', has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'UPDATE'),
  'visits_delete', has_table_privilege('madiba_mig_readonly', 'public.collection_visits', 'DELETE'),
  'documents_table_select', has_table_privilege('madiba_mig_readonly', 'public.customer_documents', 'SELECT'),
  'documents_insert', has_table_privilege('madiba_mig_readonly', 'public.customer_documents', 'INSERT'),
  'documents_update', has_table_privilege('madiba_mig_readonly', 'public.customer_documents', 'UPDATE'),
  'documents_delete', has_table_privilege('madiba_mig_readonly', 'public.customer_documents', 'DELETE'),
  'owner_rls_ok', (
    SELECT count(*)
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN ('collection_visits', 'customer_documents')
      AND relation.relkind = 'r'
      AND pg_get_userbyid(relation.relowner) = 'madiba_mig_owner'
      AND relation.relrowsecurity
      AND NOT relation.relforcerowsecurity
  ) = 2,
  'policy_count_ok', (
    SELECT count(*)
    FROM pg_policy AS policy
    JOIN pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN ('collection_visits', 'customer_documents')
  ) = 4
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
  if (countOccurrences(sql, VISIT_GRANTS) !== 1) errors.push("collection_visits grant must appear once");
  if (countOccurrences(sql, DOCUMENT_GRANT) !== 1) errors.push("customer_documents grant must appear once");
  if (sql.includes("\r")) errors.push("grant SQL must use LF line endings");
  if (!sql.startsWith("BEGIN;\n") || !sql.endsWith("COMMIT;\n")) errors.push("SQL must be one BEGIN/COMMIT batch");
  if (countOccurrences(sql, "\nCOMMIT;") !== 1) errors.push("SQL must contain one COMMIT");
  const withoutGrants = sql.replace(VISIT_GRANTS, "").replace(DOCUMENT_GRANT, "");
  const withoutQuotes = withoutGrants.replace(/'(?:[^']|'')*'/g, "''");
  if (/\b(drop|alter|truncate|revoke|create|copy|delete|update|insert|grant)\b/i.test(withoutQuotes)) {
    errors.push("SQL contains a statement outside the two column grants");
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
      PGAPPNAME: "madiba-preflight-link-grants",
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

function privilegesAreAbsent(status) {
  return status.receipt_select === false
    && status.payment_select === false
    && status.document_select === false
    && status.visits_table_select === false
    && status.documents_table_select === false
    && status.visits_insert === false
    && status.visits_update === false
    && status.visits_delete === false
    && status.documents_insert === false
    && status.documents_update === false
    && status.documents_delete === false
    && status.owner_rls_ok === true
    && status.policy_count_ok === true;
}

function privilegesAreGranted(status) {
  return status.receipt_select === true
    && status.payment_select === true
    && status.document_select === true
    && status.receipt_grant_option === false
    && status.payment_grant_option === false
    && status.document_grant_option === false
    && status.visits_id_select === false
    && status.documents_id_select === false
    && status.visits_table_select === false
    && status.documents_table_select === false
    && status.visits_insert === false
    && status.visits_update === false
    && status.visits_delete === false
    && status.documents_insert === false
    && status.documents_update === false
    && status.documents_delete === false
    && status.owner_rls_ok === true
    && status.policy_count_ok === true;
}

async function github(pathname) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) fail("GH_TOKEN is required");
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "madiba-preflight-link-grants",
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
  const directory = mkdtempSync(path.join(os.tmpdir(), "madiba-link-grants-"));
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
  if (!privilegesAreAbsent(before)) fail("pre-grant privilege or RLS baseline did not match");
  executeGrant(env);
  grantCommitted = true;
  const after = queryStatus(env);
  assertIdentity(after);
  if (!privilegesAreGranted(after)) fail("post-grant verification failed; inspect privileges before any retry");
  writeSummary([
    "## Preflight link-column grants",
    "",
    `- Project ref: ${PRODUCTION_PROJECT_REF}`,
    `- Connection mode: ${mode}`,
    `- Database role: madiba_mig_owner`,
    `- receipt_attachment_id SELECT: ${after.receipt_select}`,
    `- payment_attachment_id SELECT: ${after.payment_select}`,
    `- attachment_id SELECT: ${after.document_select}`,
    `- Table SELECT and DML remain absent: true`,
    `- Ownership and RLS unchanged: true`,
    `- Database backup: ${backups.databaseRunId} at ${backups.databaseUpdatedAt}`,
    `- Full backup: ${backups.fullRunId} at ${backups.fullUpdatedAt}`,
    "- Execution: committed",
    "- Remove this workflow and script after this successful run.",
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    const suffix = grantCommitted ? " Grant transaction already finished; inspect privileges before any retry." : "";
    console.error(redact(`${error.message || "link-column grant failed"}${suffix}`));
    process.exitCode = 1;
  });
}
