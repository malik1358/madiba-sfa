import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  HISTORICAL_COLLECTION_COUNTS,
  assertSignBatch,
  historicalBackupPlan,
  restorationInstructions,
  verifyDownloadedObject,
} from "../app/lib/storage/historicalCollectionBackup.js";
import { backupObjectPath, readHistoricalBackupConfig } from "../scripts/backup/historical-collection-copies.mjs";

const SHA = "a".repeat(64);

function names(prefix, count) {
  return Array.from({ length: count }, (_, index) => `${prefix}/file-${index}.jpg`);
}

function progress(list, sha = SHA) {
  return {
    verified: Object.fromEntries(list.map((name) => [name, sha])),
    reconciled: Object.fromEntries(list.map((name) => [name, sha])),
  };
}

function filesFor(list, bytes = 10) {
  return list.map((name) => ({ path: name, bytes }));
}

function smallPlan(extra = {}) {
  const receipts = names("receipt-copies", 2);
  const payments = names("payment-copies", 1);
  return historicalBackupPlan({
    files: filesFor([...receipts, ...payments]),
    receiptProgress: progress(receipts),
    paymentProgress: progress(payments),
    expected: { objects: 3, receipts: 2, payments: 1 },
    ...extra,
  });
}

test("the approved historical set is 1323 receipts and 266 payments", () => {
  assert.deepEqual(HISTORICAL_COLLECTION_COUNTS, { objects: 1589, receipts: 1323, payments: 266 });
});

test("a matching Supabase inventory and reconciled manifest is the only backup plan", () => {
  const plan = smallPlan();
  assert.equal(plan.ok, true);
  assert.equal(plan.entries.length, 3);
  assert.equal(plan.entries[0].key.startsWith("payment-collections/"), true);
  assert.equal(plan.entries.every((entry) => entry.sha256 === SHA && entry.supabaseBytes === 10), true);
});

test("an extra, nested, or unreconciled object rejects the whole plan", () => {
  const receipts = names("receipt-copies", 2);
  const payments = names("payment-copies", 1);
  const extra = historicalBackupPlan({
    files: [...filesFor([...receipts, ...payments]), { path: "receipt-copies/2026/new.jpg", bytes: 10 }],
    receiptProgress: progress(receipts),
    paymentProgress: progress(payments),
    expected: { objects: 3, receipts: 2, payments: 1 },
  });
  assert.equal(extra.ok, false);
  assert.equal(extra.entries.length, 0);
  assert.ok(extra.issues.includes("unexpected-object"));

  const drift = historicalBackupPlan({
    files: filesFor([...receipts, ...payments]),
    receiptProgress: { verified: progress(receipts).verified, reconciled: {} },
    paymentProgress: progress(payments),
    expected: { objects: 3, receipts: 2, payments: 1 },
  });
  assert.equal(drift.ok, false);
  assert.ok(drift.issues.includes("manifest-mismatch"));
});

test("downloaded bytes must match the manifest checksum and Supabase size", () => {
  const bytes = Buffer.from("receipt-bytes");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.deepEqual(verifyDownloadedObject({ bytes, sha256, supabaseBytes: bytes.length }), {
    sha256,
    bytes: bytes.length,
  });
  assert.throws(() => verifyDownloadedObject({ bytes, sha256: SHA, supabaseBytes: bytes.length }), /checksum/);
  assert.throws(() => verifyDownloadedObject({ bytes, sha256, supabaseBytes: bytes.length + 1 }), /size/);
});

test("sign batches stay inside the approved inventory", () => {
  const plan = smallPlan();
  assert.equal(assertSignBatch(plan.entries, [plan.entries[0].name]).length, 1);
  assert.throws(() => assertSignBatch(plan.entries, ["receipt-copies/other.jpg"]), /outside/);
  assert.throws(() => assertSignBatch(plan.entries, []), /batch/);
});

test("backup paths cannot escape the archive directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "historical-backup-"));
  try {
    const target = backupObjectPath(root, "payment-collections/receipt-copies/a.jpg");
    assert.equal(target.startsWith(root), true);
    assert.throws(() => backupObjectPath(root, "../secret.txt"), /Unsafe/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restoration instructions name the archive contents and do not delete other buckets", () => {
  const text = restorationInstructions();
  assert.match(text, /age --decrypt/);
  assert.match(text, /manifest\.json/);
  assert.match(text, /payment-collections/);
  assert.match(text, /customer-documents/);
  assert.doesNotMatch(text, /DELETE FROM|service_role/i);
});

test("drive config accepts the production backup remote and rejects a private age key", () => {
  const rclone = [
    "[gdrive]",
    "type = drive",
    "scope = drive.file",
    "client_id = client",
    "client_secret = secret",
    'token = {"refresh_token":"refresh"}',
  ].join("\n");
  const config = readHistoricalBackupConfig({
    BACKUP_SUPABASE_PROJECT_REF: "ynmtlzyqvmurpmfretji",
    BACKUP_AGE_RECIPIENT: `age1${"a".repeat(58)}`,
    BACKUP_RCLONE_CONFIG: rclone,
    CRON_SECRET: "cron",
  });
  assert.equal(config.drivePath, "gdrive:MADIBA-SFA-Backups");
  assert.throws(() => readHistoricalBackupConfig({
    BACKUP_SUPABASE_PROJECT_REF: "ynmtlzyqvmurpmfretji",
    BACKUP_AGE_RECIPIENT: "AGE-SECRET-KEY-1private",
    BACKUP_RCLONE_CONFIG: rclone,
    CRON_SECRET: "cron",
  }), /public recipient/);
});

test("the backup route and workflow do not delete storage objects or print signed URLs", async () => {
  const route = await readFile(new URL("../app/api/cron/historical-collection-backup/route.js", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../.github/workflows/historical-collection-backup.yml", import.meta.url), "utf8");
  const script = await readFile(new URL("../scripts/backup/historical-collection-copies.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(route, /deleteObject|\.remove\(|storage\.objects/);
  assert.match(workflow, /environment: production-backup/);
  assert.match(workflow, /refs\/heads\/main/);
  assert.doesNotMatch(script, /console\.log\([^)]*(\.url|signed\.|entry\.name)/);
});
