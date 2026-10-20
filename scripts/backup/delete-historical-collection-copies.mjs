import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DELETE_BATCH_SIZE,
  HISTORICAL_BACKUP_ARCHIVE,
  HISTORICAL_BACKUP_ENCRYPTED_BYTES,
  HISTORICAL_BACKUP_PLAIN_BYTES,
  HISTORICAL_COLLECTION_COUNTS,
  R2_ONLY_BUILD,
  deletionBatchPlan,
  manifestDeletionAllowlist,
  nextDeletionBatch,
  reconcileDeletionBatch,
  verifyDownloadedObject,
} from "../../app/lib/storage/historicalCollectionBackup.js";
import { readHistoricalBackupConfig } from "./historical-collection-copies.mjs";

const PROJECT_REF = "ynmtlzyqvmurpmfretji";
const SITE = "https://madiba-sfa.vercel.app";
const INVENTORY_ENDPOINT = `${SITE}/api/cron/historical-collection-backup`;
const CONFIRM_ENDPOINT = `${SITE}/api/cron/switch-historical-reads`;

function readDeleteConfig(env = process.env) {
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("Historical collection deletion runs only in GitHub Actions on main");
  }
  const backup = readHistoricalBackupConfig(env);
  const supabaseUrl = String(env.BACKUP_SUPABASE_URL || "").replace(/\/$/, "");
  if (!supabaseUrl.startsWith("https://") || !supabaseUrl.includes(`${PROJECT_REF}.supabase.co`)) {
    throw new Error("Missing required setting: BACKUP_SUPABASE_URL");
  }
  const serviceRole = String(env.BACKUP_SUPABASE_SERVICE_ROLE_KEY || "");
  if (!serviceRole) throw new Error("Missing required setting: BACKUP_SUPABASE_SERVICE_ROLE_KEY");
  return {
    ...backup,
    supabaseUrl,
    serviceRole,
    accessToken: String(env.BACKUP_SUPABASE_ACCESS_TOKEN || ""),
    allowPartial: env.ALLOW_PARTIAL === "1",
  };
}

async function storageJson(config, method, pathname, body) {
  const response = await fetch(`${config.supabaseUrl}/storage/v1${pathname}`, {
    method,
    headers: {
      apikey: config.serviceRole,
      authorization: `Bearer ${config.serviceRole}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Storage API ${method} returned ${response.status}`);
  return text ? JSON.parse(text) : null;
}

async function listBucket(config, bucket) {
  const files = [];
  async function walk(prefix) {
    for (let offset = 0; offset < 20000; offset += 100) {
      const page = await storageJson(config, "POST", `/object/list/${encodeURIComponent(bucket)}`, {
        prefix,
        limit: 100,
        offset,
        sortBy: { column: "name", order: "asc" },
      }) || [];
      if (!Array.isArray(page)) throw new Error("Storage list response was not a page");
      for (const entry of page) {
        if (!entry?.name || entry.name === "." || entry.name === "..") continue;
        const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id) files.push({ path: objectPath, bytes: Number(entry.metadata?.size) });
        else await walk(objectPath);
      }
      if (page.length < 100) break;
    }
  }
  await walk("");
  return files;
}

async function loadSetting(config, settingKey) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/system_settings?setting_key=eq.${encodeURIComponent(settingKey)}&select=setting_value`, {
    headers: { apikey: config.serviceRole, authorization: `Bearer ${config.serviceRole}` },
  });
  if (!response.ok) throw new Error("Copy manifest could not be read");
  const rows = await response.json();
  const value = rows[0]?.setting_value;
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function exactCount(config, table, filter) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${table}?select=id&${filter}`, {
    headers: {
      apikey: config.serviceRole,
      authorization: `Bearer ${config.serviceRole}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  if (!response.ok) throw new Error(`Record count failed for ${table}`);
  const count = Number(String(response.headers.get("content-range") || "").split("/")[1]);
  if (!Number.isInteger(count)) throw new Error(`Record count failed for ${table}`);
  return count;
}

async function postCron(config, endpoint, body) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.cronSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Production check returned ${response.status}`);
  return payload;
}

function assertProductionBuild() {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", R2_ONLY_BUILD, "HEAD"], { stdio: "ignore" });
  if (result.status !== 0) throw new Error("This workflow is not based on the R2-only collection implementation");
}

async function assertLiveBuild() {
  const html = await fetch(SITE).then((response) => response.text());
  const buildId = html.match(/data-build-id="([0-9a-f]{7,40})"/)?.[1];
  if (!buildId) throw new Error("Production build id is missing");
  const full = spawnSync("git", ["rev-parse", "--verify", `${buildId}^{commit}`], { encoding: "utf8" });
  if (full.status !== 0) throw new Error("Production build is not in this repository");
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", R2_ONLY_BUILD, full.stdout.trim()], { stdio: "ignore" });
  if (ancestor.status !== 0) throw new Error("Production is not running the R2-only collection implementation");
  console.log(`Production build ${buildId} includes the R2-only collection implementation.`);
}

async function rclone(config, workspace, args) {
  const rcloneFile = path.join(workspace, "rclone.conf");
  await writeFile(rcloneFile, config.rcloneConfig, { mode: 0o600 });
  await new Promise((resolve, reject) => {
    const child = spawn("rclone", [...args, "--config", rcloneFile, "--log-level", "ERROR", "--retries", "3", "--drive-skip-shortcuts"], { shell: false });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr ? "rclone failed" : "rclone failed"))));
  });
}

async function rcloneJson(config, workspace, args) {
  const rcloneFile = path.join(workspace, "rclone.conf");
  await writeFile(rcloneFile, config.rcloneConfig, { mode: 0o600 });
  const stdout = await new Promise((resolve, reject) => {
    const child = spawn("rclone", [...args, "--config", rcloneFile, "--log-level", "ERROR"], { shell: false });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error("rclone stat failed"))));
  });
  return JSON.parse(stdout);
}

async function assertDriveArchive(config, { download }) {
  const workspace = await mkdtemp(path.join(tmpdir(), "madiba-drive-archive-"));
  try {
    const remote = `${config.drivePath}/${HISTORICAL_BACKUP_ARCHIVE}`;
    const remoteStat = await rcloneJson(config, workspace, ["lsjson", remote, "--stat", "--hash"]);
    if (remoteStat.Size !== HISTORICAL_BACKUP_ENCRYPTED_BYTES) {
      throw new Error("Google Drive archive size does not match the verified backup");
    }
    if (download) {
      const downloaded = path.join(workspace, "archive.tar.gz.age");
      await rclone(config, workspace, ["copyto", remote, downloaded]);
      if ((await stat(downloaded)).size !== HISTORICAL_BACKUP_ENCRYPTED_BYTES) {
        throw new Error("Downloaded Google Drive archive size does not match the verified backup");
      }
    }
    console.log(`Encrypted Google Drive backup is ${download ? "readable" : "still present"}, ${HISTORICAL_BACKUP_ENCRYPTED_BYTES} bytes. The age private key was not read.`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function verifyR2Objects(config, entries) {
  let totalBytes = 0;
  for (let index = 0; index < entries.length; index += DELETE_BATCH_SIZE) {
    const batch = entries.slice(index, index + DELETE_BATCH_SIZE);
    const signed = await postCron(config, INVENTORY_ENDPOINT, { mode: "sign", names: batch.map((entry) => entry.name) });
    const urls = new Map((signed.signed || []).map((item) => [item.name, item.url]));
    if (urls.size !== batch.length) throw new Error("Signed R2 batch was incomplete");
    for (const entry of batch) {
      const response = await fetch(urls.get(entry.name), { redirect: "manual" });
      if (!response.ok) throw new Error("R2 object download failed");
      const bytes = Buffer.from(await response.arrayBuffer());
      const verified = verifyDownloadedObject({ bytes, sha256: entry.sha256, supabaseBytes: entry.supabaseBytes });
      totalBytes += verified.bytes;
    }
    if ((index + batch.length) % 100 < DELETE_BATCH_SIZE) {
      console.log(`Matched ${Math.min(index + batch.length, entries.length)} R2 objects to the manifest.`);
    }
  }
  return totalBytes;
}

function assertConfirm(payload, label) {
  const reads = payload.reads || {};
  const legacy = payload.legacy || {};
  const names = ["historicalReceipt", "historicalPayment", "newReceipt", "newPayment"];
  const readsOk = names.every((name) => reads[name]?.ok === true && reads[name]?.host === "r2" && reads[name]?.anonymousRejected === true);
  const legacyOk = legacy.receipt?.ok === true && legacy.payment?.ok === true && legacy.receipt?.provider === "r2" && legacy.payment?.provider === "r2";
  if (!payload.success || payload.historicalStillSupabase !== 0 || payload.writeProvider !== "r2" || payload.forceSupabaseReads !== false || !readsOk || !legacyOk || payload.rollbackOk !== true) {
    throw new Error(`${label} R2 read confirmation failed`);
  }
  console.log(`${label} historical and new receipt and payment reads opened from R2. Anonymous attachment access was rejected.`);
}

async function recordSnapshot(config) {
  const buckets = await storageJson(config, "GET", "/bucket");
  if (!Array.isArray(buckets)) throw new Error("Bucket list failed");
  const counts = {};
  for (const bucket of buckets) {
    const files = await listBucket(config, bucket.id);
    counts[bucket.id] = { objects: files.length, public: bucket.public === true };
  }
  const records = {
    receiptAttachments: await exactCount(config, "attachments", "category=eq.receipt_copy"),
    paymentAttachments: await exactCount(config, "attachments", "category=eq.payment_copy"),
    collectionVisits: await exactCount(config, "collection_visits", "id=not.is.null"),
  };
  return { counts, records };
}

function assertSnapshot(before, after) {
  const ids = new Set([...Object.keys(before.counts), ...Object.keys(after.counts)]);
  for (const id of ids) {
    if (id === "payment-collections") continue;
    const left = before.counts[id];
    const right = after.counts[id];
    if (!left || !right || left.objects !== right.objects || left.public !== right.public) {
      throw new Error("Another bucket changed during deletion");
    }
  }
  if (before.records.receiptAttachments !== after.records.receiptAttachments
    || before.records.paymentAttachments !== after.records.paymentAttachments
    || before.records.collectionVisits !== after.records.collectionVisits) {
    throw new Error("Attachment or collection records changed during deletion");
  }
}

async function storageUsage(config) {
  if (!config.accessToken) {
    console.log("Storage usage figure was not available from the management API.");
    return;
  }
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/usage`, {
    headers: { authorization: `Bearer ${config.accessToken}` },
  });
  if (!response.ok) {
    console.log(`Storage usage API returned ${response.status}. The dashboard figure may still be refreshing.`);
    return;
  }
  const body = await response.json();
  const match = JSON.stringify(body).match(/"(?:storage_size|storage_bytes|file_storage)"\s*:\s*(\d+)/);
  console.log(match
    ? `Supabase usage API storage field is ${match[1]} bytes. Compare it with the dashboard because usage can refresh later.`
    : "Storage usage API returned no storage byte field. Dashboard refresh may lag and is not a deletion failure.");
}

async function deleteApprovedObjects(config, present, allowNames) {
  let names = present.map((entry) => entry.name);
  let removed = 0;
  let batch = 0;
  while (names.length) {
    const next = nextDeletionBatch(names, allowNames, DELETE_BATCH_SIZE);
    if (!next.length) break;
    const result = await storageJson(config, "DELETE", "/object/payment-collections", { prefixes: next });
    if (!Array.isArray(result) || result.length !== next.length) throw new Error("Storage delete response was incomplete");
    const returned = new Set(result.map((row) => row?.name).filter(Boolean));
    if (next.some((name) => !returned.has(name))) throw new Error("Storage delete response missed an approved object");
    const after = await listBucket(config, "payment-collections");
    const afterNames = after.map((file) => file.path);
    const reconciled = reconcileDeletionBatch({
      beforeNames: names,
      afterNames,
      deletedNames: next,
      allowNames,
    });
    names = afterNames.sort();
    removed += reconciled.removed;
    batch += 1;
    console.log(`Deleted batch ${batch}: ${reconciled.removed} objects, ${reconciled.remaining} remaining.`);
  }
  return removed;
}

export async function runHistoricalCollectionDeletion(env = process.env) {
  const config = readDeleteConfig(env);
  assertProductionBuild();
  await assertLiveBuild();
  const receiptProgress = await loadSetting(config, "receipt_r2_copy_progress_v1");
  const paymentProgress = await loadSetting(config, "payment_r2_copy_progress_v1");
  const allow = manifestDeletionAllowlist({ receiptProgress, paymentProgress });
  if (!allow.ok) throw new Error("Verified backup manifest does not match the approved set");
  const first = await listBucket(config, "payment-collections");
  const second = await listBucket(config, "payment-collections");
  if (first.length !== second.length) throw new Error("payment-collections changed while it was being checked");
  const plan = deletionBatchPlan({ files: second, entries: allow.entries, allowPartial: config.allowPartial });
  if (!plan.ok) throw new Error(`payment-collections inventory failed: ${plan.issues.join(",")}`);
  if (!config.allowPartial) {
    if (plan.present.length !== HISTORICAL_COLLECTION_COUNTS.objects || plan.totalBytes !== HISTORICAL_BACKUP_PLAIN_BYTES) {
      throw new Error("payment-collections inventory does not match the approved byte total");
    }
    const inventory = await postCron(config, INVENTORY_ENDPOINT, { mode: "inventory" });
    const counts = inventory.counts || {};
    if (counts.objects !== HISTORICAL_COLLECTION_COUNTS.objects || counts.receipts !== HISTORICAL_COLLECTION_COUNTS.receipts || counts.payments !== HISTORICAL_COLLECTION_COUNTS.payments || counts.other !== 0) {
      throw new Error("Production inventory does not match the approved object counts");
    }
  }
  console.log(`Inventory accepted: ${plan.present.length} objects, ${plan.totalBytes} bytes. Age private key was not loaded.`);
  await assertDriveArchive(config, { download: true });
  if (!config.allowPartial) {
    const verifiedBytes = await verifyR2Objects(config, plan.present);
    if (verifiedBytes !== HISTORICAL_BACKUP_PLAIN_BYTES) throw new Error("R2 bytes do not match the approved total");
  }
  const fresh = await listBucket(config, "payment-collections");
  const freshPlan = deletionBatchPlan({ files: fresh, entries: allow.entries, allowPartial: config.allowPartial });
  const sameNames = freshPlan.present.map((entry) => entry.name).sort().join("\n") === plan.present.map((entry) => entry.name).sort().join("\n");
  if (!freshPlan.ok || !sameNames || freshPlan.totalBytes !== plan.totalBytes) {
    throw new Error("payment-collections changed during verification");
  }
  assertConfirm(await postCron(config, CONFIRM_ENDPOINT, { mode: "confirm" }), "Before deletion");
  const before = await recordSnapshot(config);
  const removed = await deleteApprovedObjects(config, plan.present, allow.entries.map((entry) => entry.name));
  const remaining = await listBucket(config, "payment-collections");
  if (remaining.length !== 0) throw new Error("payment-collections still contains objects");
  const expectedRemoved = config.allowPartial ? plan.present.length : HISTORICAL_COLLECTION_COUNTS.objects;
  if (removed !== expectedRemoved) throw new Error("Removed object count does not match the approved set");
  const after = await recordSnapshot(config);
  assertSnapshot(before, after);
  if (after.counts["payment-collections"]?.objects !== 0 || after.counts["payment-collections"]?.public !== false) {
    throw new Error("payment-collections final state is not an empty private bucket");
  }
  assertConfirm(await postCron(config, CONFIRM_ENDPOINT, { mode: "confirm" }), "After deletion");
  const anonymous = await fetch(`${config.supabaseUrl}/storage/v1/object/public/payment-collections/receipt-copies/missing.jpg`);
  if (anonymous.ok) throw new Error("Anonymous payment-collections access was not rejected");
  await assertDriveArchive(config, { download: false });
  await storageUsage(config);
  console.log(`Deletion complete. Removed ${removed} approved objects. payment-collections remaining 0. Bytes removed ${plan.totalBytes}. Other buckets and attachment records were unchanged.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runHistoricalCollectionDeletion().catch((error) => {
    const message = error instanceof Error ? error.message : "";
    console.error(/^Historical |^Missing required setting: |^Expected an age |^Use a dedicated |^Rclone |^Google Drive |^payment-collections |^Production |^Verified |^R2 |^Before |^After |^Another |^Attachment |^Removed |^Encrypted |^Downloaded |^Copy |^Storage |^Record |^Signed |^This workflow /.test(message)
      ? message.replace(/https?:\/\/\S+/g, "[url]")
      : "Historical collection deletion stopped. No further objects were deleted.");
    process.exitCode = 1;
  });
}
