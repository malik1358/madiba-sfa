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
    child.stderr.resume();
    child.on("error", () => reject(new Error(`${command} could not start; verify tool installation`)));
    child.on("close", (code) => code === 0
      ? resolve(Buffer.concat(output).toString("utf8"))
      : reject(new Error(`${command} failed (exit ${code}); raw output suppressed to protect credentials`)));
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
    await run("docker", databaseCommand(workspace, config.pgEnv, "pg_dump", [
      "--format=custom", "--file=/backup/payload/database.dump", "--lock-wait-timeout=30s",
    ]), pgOptions);
    await run("docker", databaseCommand(workspace, config.pgEnv, "pg_dumpall", [
      "--roles-only", "--no-role-passwords", "--file=/backup/payload/roles.sql",
    ]), pgOptions);
    const toc = await run("docker", ["run", "--rm", "--volume", `${workspace}:/backup:ro`,
      "postgres:17", "pg_restore", "--list", "/backup/payload/database.dump"]);
    for (const marker of ["TABLE DATA public", "TABLE DATA auth users", "TABLE DATA storage"]) {
      if (!toc.includes(marker)) throw new Error("Database archive lacks required business/Auth/Storage data");
    }
    await writeFile(path.join(payload, "database-toc.txt"), toc, { mode: 0o600 });
    const manifest = {
      formatVersion: 1, mode: config.mode, startedAt: date.toISOString(), projectRef: config.projectRef,
      postgresTools: "17", databaseIncludes: "All accessible non-system schemas, including public, auth, storage and migration history",
      storageSnapshotAtomicWithDatabase: false,
      limitations: ["Unsynced phone data is not included", "Managed Supabase objects need selective restore", "Custom-role passwords and Supabase encryption root key require separate recovery custody"],
      databaseSha256: await fileHash(path.join(payload, "database.dump")),
      rolesSha256: await fileHash(path.join(payload, "roles.sql")),
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
    await writeFile(path.join(payload, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    const archive = path.join(workspace, "backup.tar.gz");
    await run("tar", ["-czf", archive, "-C", payload, "."]);
    const name = backupName(config.mode, date, runId);
    const encrypted = path.join(workspace, name);
    await run("age", ["--encrypt", "--recipient", config.recipient, "--output", encrypted, archive]);
    const remoteFile = `${config.drivePath}/${name}`;
    await rclone("copyto", encrypted, remoteFile, "--immutable", "--checksum");
    const remoteStat = JSON.parse(await rclone("lsjson", remoteFile, "--stat", "--hash"));
    if (remoteStat.Size !== (await stat(encrypted)).size
      || remoteStat.Hashes?.MD5?.toLowerCase() !== await fileHash(encrypted, "md5")) {
      throw new Error("Drive upload checksum/size verification failed; retention cleanup skipped");
    }
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
    console.error(error.message.startsWith("Missing required setting:") ? error.message : "Backup failed. Review setup and tool/API permissions; sensitive error details are suppressed.");
    process.exitCode = 1;
  });
}