import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { backupName, listStorageFiles, readBackupConfig, retentionCandidates } from "./backup-policy.mjs";

export class BackupDiagnosticError extends Error {}

export function classifyCommandFailure(stderr) {
  if (/password authentication failed|authentication failed|SASL authentication/i.test(stderr)) {
    return "Database authentication rejected. Check the existing database password and its URL encoding in BACKUP_DATABASE_URL.";
  }
  if (/server version mismatch|server version:.*pg_dump version:|aborting because of server version/i.test(stderr)) {
    return "PostgreSQL server is newer than the backup tools. Update the PostgreSQL backup image to a compatible version.";
  }
  if (/permission denied|must be superuser|insufficient privilege/i.test(stderr)) {
    return "Database export permission denied. Review managed-schema or role-export privileges; do not silently exclude business or Auth data.";
  }
  if (/read-only transaction/i.test(stderr)) {
    return "Database tool attempted an operation blocked by the read-only connection. Review the export command; do not disable the safety guard blindly.";
  }
  if (/could not translate host|name or service not known|no such host/i.test(stderr)) {
    return "Database hostname could not be resolved. Check the session-pooler hostname and provider availability.";
  }
  if (/connection timed out|timeout expired|network is unreachable|connection refused/i.test(stderr)) {
    return "Database connection unavailable. Check pooler availability, network restrictions and port 5432.";
  }
  if (/tenant or user not found/i.test(stderr)) {
    return "Pooler could not identify the project user. Check the session-pooler username and selected project.";
  }
  if (/no space left on device/i.test(stderr)) return "Backup runner ran out of disk space.";
  return "Unclassified command failure. Raw output remains suppressed; no backup was uploaded.";
}

export function safeBackupConfigError(error) {
  const message = error instanceof Error ? error.message : "";
  if (/^Missing required setting: BACKUP_[A-Z0-9_]+$/.test(message)) return message;
  const safeMessages = new Set([
    "Invalid backup mode",
    "Invalid Supabase project reference",
    "Invalid backup connection URL",
    "Storage URL does not match the explicitly selected backup project",
    "Use the selected project's direct or SESSION pooler URL on port 5432 with sslmode=require",
    "Expected an age public recipient, not a private key",
    "Use a dedicated, single-level gdrive backup folder",
    "Rclone configuration must contain only gdrive, with drive.file scope and your own OAuth client",
    "Rclone configuration needs an OAuth refresh token",
    "BACKUP_RECOVERY_INVENTORY_JSON must be valid JSON",
    "Recovery inventory must contain only a vaultReference and a nonempty array of secretNames; never secret values",
  ]);
  return safeMessages.has(message) ? message : null;
}

export async function databaseStage(label, operation) {
  console.log(`Database stage: ${label}`);
  try {
    return await operation();
  } catch (error) {
    const detail = error instanceof BackupDiagnosticError ? error.message : classifyLocalFileFailure(error);
    throw new BackupDiagnosticError(`Database stage failed: ${label}. ${detail}`);
  }
}

export async function backupStage(label, operation) {
  console.log(`Backup stage: ${label}`);
  try {
    return await operation();
  } catch (error) {
    const fileError = ["EACCES", "EPERM", "ENOENT", "ENOSPC"].includes(error?.code);
    const detail = error instanceof BackupDiagnosticError ? error.message
      : fileError ? classifyLocalFileFailure(error) : "Operation failed; raw output remains suppressed.";
    throw new BackupDiagnosticError(`Backup stage failed: ${label}. ${detail}`);
  }
}

export function validateDatabaseArchiveCoverage(toc) {
  const requiredSections = [
    ["business table data", "TABLE DATA public"],
    ["Supabase Auth user data", "TABLE DATA auth users"],
    ["Supabase Storage metadata", "TABLE DATA storage"],
  ];
  const missing = requiredSections.filter(([, marker]) => !toc.includes(marker)).map(([label]) => label);
  if (missing.length) {
    throw new BackupDiagnosticError(`Database archive is missing required sections: ${missing.join(", ")}. No backup was uploaded.`);
  }
}

function classifyLocalFileFailure(error) {
  if (error?.code === "EACCES" || error?.code === "EPERM") {
    return "Runner cannot read or write a private local backup file. Check Docker-created file ownership and runner permissions.";
  }
  if (error?.code === "ENOENT") return "An expected local database dump or roles file is missing.";
  if (error?.code === "ENOSPC") return "Backup runner ran out of disk space while finalizing the archive.";
  return "Local backup file operation failed; raw paths and operating-system details are suppressed.";
}

export async function execute(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd, env: options.env || process.env, shell: false,
      stdio: ["ignore", "pipe", "pipe"], timeout: 90 * 60 * 1000,
    });
    const output = [];
    let length = 0;
    child.stdout.on("data", (chunk) => {
      length += chunk.length;
      if (length > 32 * 1024 * 1024) child.kill();
      else output.push(chunk);
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-65536);
    });
    child.on("error", () => reject(new BackupDiagnosticError("Backup command could not start; verify tool installation.")));
    child.on("close", (code) => code === 0
      ? resolve(Buffer.concat(output).toString("utf8"))
      : reject(new BackupDiagnosticError(`Backup command failed (exit ${code}). ${classifyCommandFailure(stderr)}`)));
  });
}

export async function fileHash(file, algorithm = "sha256") {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function fetchResponse(url, options = {}, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url, { ...options, redirect: "error", signal: AbortSignal.timeout(300000) });
  } catch {
    throw new Error("Backup API connection failed; raw details suppressed");
  }
  if (!response.ok) throw new Error(`Backup API request failed (HTTP ${response.status}); raw details suppressed`);
  return response;
}

export async function fetchJson(url, options = {}, fetchImpl = fetch) {
  const response = await fetchResponse(url, options, fetchImpl);
  try { return await response.json(); }
  catch { throw new Error("Backup API returned invalid JSON"); }
}

export function storageClient(config, fetchImpl = fetch) {
  const headers = { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}` };
  return {
    buckets: () => fetchJson(`${config.supabaseUrl}/storage/v1/bucket`, { headers }, fetchImpl),
    from: (bucket) => ({ list: async (prefix, options) => ({ data: await fetchJson(
      `${config.supabaseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`,
      { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ prefix, ...options }) },
      fetchImpl,
    ) }) }),
    download: (bucket, objectPath) => fetchResponse(
      `${config.supabaseUrl}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`,
      { headers }, fetchImpl,
    ),
  };
}

function storageFingerprint(files) {
  return JSON.stringify(files.map((file) => [file.bucket, file.path, file.updatedAt, file.metadata.size]).sort());
}

export async function exportStorage(config, payload, fetchImpl = fetch) {
  const storage = storageClient(config, fetchImpl);
  const buckets = await storage.buckets();
  if (!Array.isArray(buckets) || !buckets.length) throw new Error("No Storage buckets found; full backup refused");
  await mkdir(path.join(payload, "objects"));
  const files = [];
  for (const bucket of buckets) {
    if (typeof bucket.id !== "string" || !bucket.id) throw new Error("Invalid Storage bucket");
    files.push(...await listStorageFiles(storage, bucket.id));
  }
  for (const file of files) {
    const objectId = createHash("sha256").update(JSON.stringify([file.bucket, file.path])).digest("hex");
    file.archivePath = `objects/${objectId}`;
    const destination = path.join(payload, file.archivePath);
    const response = await storage.download(file.bucket, file.path);
    if (!response.body) throw new Error("Storage download has no body");
    await pipeline(Readable.fromWeb(response.body), createWriteStream(destination, { flags: "wx", mode: 0o600 }));
    file.bytes = (await stat(destination)).size;
    file.sha256 = await fileHash(destination);
    file.contentType = response.headers.get("content-type") || file.metadata.mimetype || "application/octet-stream";
    file.cacheControl = response.headers.get("cache-control") || "max-age=3600";
    if (Number.isFinite(file.metadata.size) && file.bytes !== file.metadata.size) throw new Error("Storage download size mismatch");
  }
  const after = [];
  const latestBuckets = await storage.buckets();
  if (JSON.stringify(buckets) !== JSON.stringify(latestBuckets)) throw new Error("Storage buckets changed during backup; retry");
  for (const bucket of buckets) after.push(...await listStorageFiles(storage, bucket.id));
  if (storageFingerprint(files) !== storageFingerprint(after)) throw new Error("Storage files changed during backup; retry");
  await writeFile(path.join(payload, "storage-manifest.json"), JSON.stringify({ buckets, files }, null, 2), { mode: 0o600 });
  return { buckets: buckets.length, files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
}

export function databaseCommand(workspace, pgEnv, tool, args) {
  return ["run", "--rm", ...Object.keys(pgEnv).flatMap((name) => ["--env", name]),
    "--volume", `${workspace}:/backup`, "postgres:17", tool, ...args];
}

async function exportConfiguration(config, payload, fetchImpl) {
  const auth = await fetchJson(`https://api.supabase.com/v1/projects/${config.projectRef}/config/auth`, {
    headers: { Authorization: `Bearer ${config.supabaseAccessToken}` },
  }, fetchImpl);
  const team = config.vercelTeamId ? `&teamId=${encodeURIComponent(config.vercelTeamId)}` : "";
  const projectPath = encodeURIComponent(config.vercelProjectId);
  const headers = { Authorization: `Bearer ${config.vercelToken}` };
  const project = await fetchJson(`https://api.vercel.com/v9/projects/${projectPath}?${team.slice(1)}`, { headers }, fetchImpl);
  const environments = [];
  let cursor = "";
  const cursors = new Set();
  do {
    const result = await fetchJson(`https://api.vercel.com/v10/projects/${projectPath}/env?decrypt=false${team}${cursor ? `&until=${encodeURIComponent(cursor)}` : ""}`, { headers }, fetchImpl);
    if (!Array.isArray(result.envs) || result.envs.some((entry) => typeof entry.key !== "string")) {
      throw new Error("Vercel environment inventory is incomplete");
    }
    environments.push(...result.envs.map((entry) => ({
      key: entry.key,
      type: entry.type,
      target: Array.isArray(entry.target) ? entry.target : [],
      gitBranch: entry.gitBranch || null,
    })));
    cursor = result.pagination?.next || "";
    if (cursor && cursors.has(cursor)) throw new Error("Vercel environment pagination did not advance");
    cursors.add(cursor);
  } while (cursor);
  if (!environments.some((entry) => entry.key === "NEXT_PUBLIC_SUPABASE_URL"
    && entry.target.includes("production"))) {
    throw new Error("Vercel production environment is missing NEXT_PUBLIC_SUPABASE_URL");
  }
  if (project.id !== config.vercelProjectId) throw new Error("Vercel returned a different project than the configured backup target");
  const sensitiveKey = /(secret|password|token|api.?key|private.?key|credential|smtp)/i;
  function redact(value, key = "") {
    if (sensitiveKey.test(key)) return "[REDACTED]";
    if (Array.isArray(value)) return value.map((item) => redact(item));
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]));
    }
    return value;
  }
  await writeFile(path.join(payload, "recovery-configuration.json"), JSON.stringify({
    supabaseAuth: redact(auth), vercelProject: {
      id: project.id, name: project.name, framework: project.framework,
      nodeVersion: project.nodeVersion, buildCommand: project.buildCommand,
      outputDirectory: project.outputDirectory, installCommand: project.installCommand,
      rootDirectory: project.rootDirectory,
    },
    vercelEnvironmentInventory: environments,
    recoveryInventory: config.recoveryInventory,
  }, null, 2), { mode: 0o600 });
}

export async function runBackup(config, options = {}) {
  const run = options.run || execute;
  const fetchImpl = options.fetchImpl || fetch;
  const date = options.date || new Date();
  const runId = options.runId || `${process.env.GITHUB_RUN_ID || "manual"}-${process.env.GITHUB_RUN_ATTEMPT || "1"}`;
  const repo = options.repo || process.cwd();
  const workspace = await mkdtemp(path.join(options.tempRoot || tmpdir(), "madiba-backup-"));
  const payload = path.join(workspace, "payload");
  await mkdir(payload, { mode: 0o700 });
  const rcloneFile = path.join(workspace, "rclone.conf");
  await writeFile(rcloneFile, config.rcloneConfig, { mode: 0o600 });
  const rclone = (...args) => run("rclone", [...args, "--config", rcloneFile,
    "--log-level", "ERROR", "--retries", "3", "--low-level-retries", "10", "--drive-skip-shortcuts"]);
  try {
    console.log(`Starting ${config.mode} backup. Source access is read-only.`);
    await rclone("mkdir", config.drivePath);
    if (config.mode === "full") {
      console.log("Exporting encrypted recovery configuration inputs.");
      await exportConfiguration(config, payload, fetchImpl);
    }
    console.log("Exporting database and checking Auth/Storage coverage.");
    const pgOptions = { env: { ...process.env, ...config.pgEnv } };
    await databaseStage("database archive (pg_dump)", () => run("docker", databaseCommand(workspace, config.pgEnv, "pg_dump", [
      "--format=custom", "--file=/backup/payload/database.dump", "--lock-wait-timeout=30s",
    ]), pgOptions));
    await databaseStage("roles export (pg_dumpall)", () => run("docker", databaseCommand(workspace, config.pgEnv, "pg_dumpall", [
      "--roles-only", "--no-role-passwords", "--file=/backup/payload/roles.sql",
    ]), pgOptions));
    const toc = await databaseStage("archive validation (pg_restore)", () => run("docker", ["run", "--rm", "--volume", `${workspace}:/backup:ro`,
      "postgres:17", "pg_restore", "--list", "/backup/payload/database.dump"]));
    validateDatabaseArchiveCoverage(toc);
    await databaseStage("archive inventory file", () => writeFile(path.join(payload, "database-toc.txt"), toc, { mode: 0o600 }));
    const manifest = {
      formatVersion: 1, mode: config.mode, startedAt: date.toISOString(), projectRef: config.projectRef,
      postgresTools: "17", databaseIncludes: "All accessible non-system schemas, including public, auth, storage and migration history",
      storageSnapshotAtomicWithDatabase: false,
      limitations: ["Unsynced phone data is not included", "Managed Supabase objects need selective restore", "Custom-role passwords and Supabase encryption root key require separate recovery custody"],
      databaseSha256: await databaseStage("database dump checksum", () => fileHash(path.join(payload, "database.dump"))),
      rolesSha256: await databaseStage("roles dump checksum", () => fileHash(path.join(payload, "roles.sql"))),
    };
    if (config.mode === "full") {
      console.log("Exporting and checking all Storage buckets.");
      manifest.storage = await exportStorage(config, payload, fetchImpl);
      console.log("Archiving source and verifying Git history.");
      await run("git", ["bundle", "create", path.join(payload, "repository.bundle"), "--all"], { cwd: repo });
      await run("git", ["bundle", "verify", path.join(payload, "repository.bundle")], { cwd: repo });
      await run("git", ["archive", "--format=tar.gz", `--output=${path.join(payload, "source.tar.gz")}`, "HEAD"], { cwd: repo });
      manifest.commit = (await run("git", ["rev-parse", "HEAD"], { cwd: repo })).trim();
      manifest.configurationSha256 = await fileHash(path.join(payload, "recovery-configuration.json"));
      manifest.storageManifestSha256 = await fileHash(path.join(payload, "storage-manifest.json"));
      manifest.repositorySha256 = await fileHash(path.join(payload, "repository.bundle"));
      manifest.sourceSha256 = await fileHash(path.join(payload, "source.tar.gz"));
    }
    manifest.finishedAt = new Date().toISOString();
    await backupStage("backup manifest write", () => writeFile(path.join(payload, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 }));
    const archive = path.join(workspace, "backup.tar.gz");
    await backupStage("archive compression (tar)", () => run("tar", ["-czf", archive, "-C", payload, "."]));
    const name = backupName(config.mode, date, runId);
    const encrypted = path.join(workspace, name);
    await backupStage("age encryption", () => run("age", ["--encrypt", "--recipient", config.recipient, "--output", encrypted, archive]));
    const remoteFile = `${config.drivePath}/${name}`;
    await backupStage("Google Drive upload", () => rclone("copyto", encrypted, remoteFile, "--immutable", "--checksum"));
    await backupStage("Google Drive upload verification", async () => {
      const remoteStat = JSON.parse(await rclone("lsjson", remoteFile, "--stat", "--hash"));
      const localSize = (await stat(encrypted)).size;
      const remoteMd5 = Object.entries(remoteStat.Hashes || {})
        .find(([algorithm]) => algorithm.toLowerCase() === "md5")?.[1];
      const sizeMatches = remoteStat.Size === localSize;
      const md5Present = typeof remoteMd5 === "string";
      const md5Matches = md5Present && remoteMd5.toLowerCase() === await fileHash(encrypted, "md5");
      if (!sizeMatches || !md5Matches) {
        throw new BackupDiagnosticError(`Drive upload checksum/size verification failed (size_match=${sizeMatches}, md5_present=${md5Present}, md5_match=${md5Matches}); retention cleanup skipped.`);
      }
    });
    console.log("Encrypted Drive upload verified.");
    const files = JSON.parse(await rclone("lsjson", config.drivePath, "--files-only", "--max-depth", "1"));
    if (!Array.isArray(files)) throw new Error("Invalid Drive listing; retention cleanup refused");
    const expired = retentionCandidates(files.filter((file) => !file.IsDir).map((file) => file.Name), date);
    if (options.prune === true) {
      for (const oldName of expired) await rclone("deletefile", `${config.drivePath}/${oldName}`, "--drive-use-trash=true");
    }
    console.log(`Backup complete: ${name}. ${expired.length} expired backup(s) ${options.prune === true ? "moved to trash" : "eligible for cleanup (disabled)"}.`);
    return { name, manifest, expired };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("Production exports run only in GitHub Actions on main; no local production credentials permitted");
  }
  const mode = process.argv[2];
  const config = readBackupConfig(process.env, mode);
  if (process.argv.includes("--check-config")) {
    console.log("Backup settings validated; no source or Drive requests made.");
    return;
  }
  await runBackup(config, { prune: process.env.BACKUP_PRUNE_ENABLED === "true" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    const safeConfigError = safeBackupConfigError(error);
    console.error(error instanceof BackupDiagnosticError ? error.message
      : safeConfigError || "Backup failed. Review setup and tool/API permissions; sensitive error details are suppressed.");
    process.exitCode = 1;
  });
}