import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { required } from "./backup-policy.mjs";
import {
  HISTORICAL_COLLECTION_COUNTS,
  HISTORICAL_R2_BUCKET,
  SIGN_BATCH_LIMIT,
  restorationInstructions,
  verifyDownloadedObject,
} from "../../app/lib/storage/historicalCollectionBackup.js";

const ENDPOINT = "https://madiba-sfa.vercel.app/api/cron/historical-collection-backup";

export function readHistoricalBackupConfig(env = process.env) {
  const projectRef = required(env, "BACKUP_SUPABASE_PROJECT_REF");
  if (projectRef !== "ynmtlzyqvmurpmfretji") {
    throw new Error("Historical collection backup is limited to the production project");
  }
  const recipient = required(env, "BACKUP_AGE_RECIPIENT");
  if (!/^age1[0-9a-z]{58}$/.test(recipient)) throw new Error("Expected an age public recipient, not a private key");
  const drivePath = env.BACKUP_DRIVE_PATH?.trim() || "gdrive:MADIBA-SFA-Backups";
  if (!/^gdrive:[A-Za-z0-9_-]+$/.test(drivePath)) throw new Error("Use a dedicated, single-level gdrive backup folder");
  const rcloneConfig = required(env, "BACKUP_RCLONE_CONFIG");
  if (!/^\[gdrive\]\s*$/m.test(rcloneConfig)
    || (rcloneConfig.match(/^\[[^\]]+\]\s*$/gm) || []).length !== 1
    || !/^type\s*=\s*drive\s*$/m.test(rcloneConfig)
    || !/^scope\s*=\s*drive\.file\s*$/m.test(rcloneConfig)
    || !/^client_id\s*=\s*\S+\s*$/m.test(rcloneConfig)
    || !/^client_secret\s*=\s*\S+\s*$/m.test(rcloneConfig)) {
    throw new Error("Rclone configuration must contain only gdrive, with drive.file scope and your own OAuth client");
  }
  try {
    const token = JSON.parse(rcloneConfig.match(/^token\s*=\s*(.+)$/m)?.[1] || "{}");
    if (!token.refresh_token) throw new Error();
  } catch {
    throw new Error("Rclone configuration needs an OAuth refresh token");
  }
  const cronSecret = required(env, "CRON_SECRET");
  return { projectRef, recipient, drivePath, rcloneConfig, cronSecret };
}

export function backupObjectPath(root, key) {
  const parts = String(key || "").split("/");
  if (!parts.length || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Unsafe historical object key");
  }
  const target = path.resolve(root, ...parts);
  const base = path.resolve(root);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error("Unsafe historical object key");
  return target;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.on("data", () => {});
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed`));
    });
    void stderr;
  });
}

async function fileHash(file, algorithm = "sha256") {
  const hash = createHash(algorithm);
  await new Promise((resolve, reject) => {
    createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("end", resolve).on("error", reject);
  });
  return hash.digest("hex");
}

async function post(config, body, fetchImpl) {
  const response = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.cronSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || !payload?.success || payload.stop) {
    const reason = String(payload?.stopReason || response.status || "failed");
    throw new Error(`Historical backup request stopped: ${reason}`);
  }
  return payload;
}

async function downloadUrl(url, fetchImpl) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetchImpl(url, { method: "GET", redirect: "manual" });
      if (!response.ok) throw new Error(`download status ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("download failed");
}

export async function downloadHistoricalCopies({ config, workspace, fetchImpl = fetch }) {
  const inventory = await post(config, { mode: "inventory" }, fetchImpl);
  const entries = inventory.entries || [];
  const counts = inventory.counts || {};
  if (entries.length !== HISTORICAL_COLLECTION_COUNTS.objects
    || counts.objects !== HISTORICAL_COLLECTION_COUNTS.objects
    || counts.receipts !== HISTORICAL_COLLECTION_COUNTS.receipts
    || counts.payments !== HISTORICAL_COLLECTION_COUNTS.payments
    || counts.other !== 0) {
    throw new Error("Historical inventory counts did not match the approved set");
  }

  const filesRoot = path.join(workspace, "files");
  await mkdir(filesRoot, { recursive: true, mode: 0o700 });
  let totalBytes = 0;
  for (let index = 0; index < entries.length; index += SIGN_BATCH_LIMIT) {
    const batch = entries.slice(index, index + SIGN_BATCH_LIMIT);
    const signed = await post(config, { mode: "sign", names: batch.map((entry) => entry.name) }, fetchImpl);
    const urls = new Map((signed.signed || []).map((item) => [item.name, item.url]));
    if (urls.size !== batch.length) throw new Error("Signed backup batch was incomplete");
    for (const entry of batch) {
      const bytes = await downloadUrl(urls.get(entry.name), fetchImpl);
      const verified = verifyDownloadedObject({ bytes, sha256: entry.sha256, supabaseBytes: entry.supabaseBytes });
      const target = backupObjectPath(filesRoot, entry.key);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, bytes, { mode: 0o600 });
      totalBytes += verified.bytes;
    }
    if ((index + batch.length) % 100 < SIGN_BATCH_LIMIT) {
      console.log(`Verified ${Math.min(index + batch.length, entries.length)} of ${entries.length} historical R2 objects.`);
    }
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    projectRef: config.projectRef,
    r2Bucket: HISTORICAL_R2_BUCKET,
    supabaseBucket: "payment-collections",
    counts: HISTORICAL_COLLECTION_COUNTS,
    totalBytes,
    files: entries.map((entry) => ({
      key: entry.key,
      sha256: entry.sha256,
      bytes: entry.supabaseBytes,
    })),
  };
  await writeFile(path.join(workspace, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  await writeFile(path.join(workspace, "RESTORE.md"), restorationInstructions(), { mode: 0o600 });
  console.log(`Downloaded ${entries.length} objects, ${totalBytes} bytes. Checksums and sizes matched.`);
  return { entries, totalBytes, manifest };
}

async function restoreSamples(archive, workspace, entries) {
  const samples = [
    entries.find((entry) => entry.name.startsWith("receipt-copies/")),
    entries.find((entry) => entry.name.startsWith("payment-copies/")),
  ];
  const sampleDir = path.join(workspace, "sample-restore");
  await mkdir(sampleDir, { mode: 0o700 });
  for (const sample of samples) {
    if (!sample) throw new Error("Sample restore file is missing from the inventory");
    const archived = `files/${sample.key}`;
    await run("tar", ["-xzf", archive, "-C", sampleDir, archived]);
    const restored = path.join(sampleDir, "files", ...sample.key.split("/"));
    const actual = await fileHash(restored);
    const size = (await stat(restored)).size;
    if (actual !== sample.sha256 || size !== sample.supabaseBytes) {
      throw new Error("Sample restore did not match the manifest");
    }
  }
  console.log("Sample receipt and payment files were restored from the archive and matched.");
}

export async function publishHistoricalBackup({ config, workspace, archive, runCommand = run }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const runId = `${process.env.GITHUB_RUN_ID || "manual"}-${process.env.GITHUB_RUN_ATTEMPT || "1"}`;
  const name = `madiba-sfa-historical-collection-copies-${stamp}-${runId}.tar.gz.age`;
  const encrypted = path.join(workspace, name);
  await runCommand("age", ["--encrypt", "--recipient", config.recipient, "--output", encrypted, archive]);
  const rcloneFile = path.join(workspace, "rclone.conf");
  await writeFile(rcloneFile, config.rcloneConfig, { mode: 0o600 });
  const rclone = (...args) => runCommand("rclone", [...args, "--config", rcloneFile, "--log-level", "ERROR", "--retries", "3", "--drive-skip-shortcuts"]);
  const remoteFile = `${config.drivePath}/${name}`;
  await rclone("mkdir", config.drivePath);
  await rclone("copyto", encrypted, remoteFile, "--immutable", "--checksum");
  const remoteStat = JSON.parse(await new Promise((resolve, reject) => {
    const child = spawn("rclone", ["lsjson", remoteFile, "--stat", "--hash", "--config", rcloneFile, "--log-level", "ERROR"], { shell: false });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error("rclone stat failed"))));
  }));
  const localSize = (await stat(encrypted)).size;
  const remoteMd5 = Object.entries(remoteStat.Hashes || {}).find(([algorithm]) => algorithm.toLowerCase() === "md5")?.[1];
  const downloaded = path.join(workspace, "downloaded.tar.gz.age");
  await rclone("copyto", remoteFile, downloaded);
  const downloadedHash = await fileHash(downloaded, "sha256");
  const localHash = await fileHash(encrypted, "sha256");
  const localMd5 = await fileHash(encrypted, "md5");
  if (remoteStat.Size !== localSize || !remoteMd5 || remoteMd5.toLowerCase() !== localMd5 || downloadedHash !== localHash) {
    throw new Error("Google Drive download verification failed");
  }
  console.log(`Drive backup verified: ${name}, ${localSize} encrypted bytes.`);
  return { name, bytes: localSize };
}

export async function runHistoricalCollectionBackup(env = process.env) {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("Historical collection backup runs only in GitHub Actions on main");
  }
  const config = readHistoricalBackupConfig(env);
  const workspace = await mkdtemp(path.join(tmpdir(), "madiba-historical-collection-"));
  try {
    const downloaded = await downloadHistoricalCopies({ config, workspace });
    const archive = path.join(workspace, "historical-collection-copies.tar.gz");
    await run("tar", ["-czf", archive, "-C", workspace, "files", "manifest.json", "RESTORE.md"]);
    await restoreSamples(archive, workspace, downloaded.entries);
    await rm(path.join(workspace, "files"), { recursive: true, force: true });
    await publishHistoricalBackup({ config, workspace, archive });
    console.log("Historical collection backup complete. No Supabase objects were deleted.");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runHistoricalCollectionBackup().catch((error) => {
    const message = error instanceof Error ? error.message : "";
    console.error(/^Historical |^Missing required setting: |^Expected an age |^Use a dedicated |^Rclone |^Google Drive |^Sample |^Downloaded |^Unsafe /.test(message)
      ? message.replace(/https?:\/\/\S+/g, "[url]")
      : "Historical collection backup failed. No archive was accepted.");
    process.exitCode = 1;
  });
}
