import test from "node:test";
import assert from "node:assert/strict";
import { backupName, parseBackupName, retentionCandidates, readBackupConfig, listStorageFiles } from "../scripts/backup/backup-policy.mjs";

function environment() {
  const project = "abcdefghijklmnopqrst";
  return {
    BACKUP_SUPABASE_PROJECT_REF: project,
    BACKUP_SUPABASE_URL: `https://${project}.supabase.co`,
    BACKUP_DATABASE_URL: `postgresql://postgres.${project}:fake-password@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`,
    BACKUP_SUPABASE_SERVICE_ROLE_KEY: "fake-service-key",
    BACKUP_AGE_RECIPIENT: `age1${"a".repeat(58)}`,
    BACKUP_RCLONE_CONFIG: '[gdrive]\ntype = drive\nscope = drive.file\nclient_id = fake-id\nclient_secret = fake-secret\ntoken = {"refresh_token":"fake-token"}\n',
  };
}

test("backup requires explicit matching project and TLS session pooler", () => {
  const env = environment();
  const config = readBackupConfig(env, "database");
  assert.equal(config.pgEnv.PGSSLMODE, "require");
  assert.equal(config.pgEnv.PGOPTIONS, "-c default_transaction_read_only=on");
  assert.throws(() => readBackupConfig({ ...env, BACKUP_SUPABASE_URL: "https://other.supabase.co" }, "database"), /match/);
  assert.throws(() => readBackupConfig({ ...env, BACKUP_DATABASE_URL: env.BACKUP_DATABASE_URL.replace("5432", "6543") }, "database"), /SESSION/);
  assert.throws(() => readBackupConfig({ ...env, BACKUP_DATABASE_URL: env.BACKUP_DATABASE_URL.replace("sslmode=require", "sslmode=disable") }, "database"), /sslmode/);
  assert.throws(() => readBackupConfig({ ...env, BACKUP_DATABASE_URL: env.BACKUP_DATABASE_URL.replace("fake-password", "") }, "database"), /SESSION/);
});

test("backup rejects private age keys, arbitrary Drive paths and missing full recovery coverage", () => {
  const env = environment();
  assert.throws(() => readBackupConfig({ ...env, BACKUP_AGE_RECIPIENT: "AGE-SECRET-KEY-fake" }, "database"), /public/);
  assert.throws(() => readBackupConfig({ ...env, BACKUP_DRIVE_PATH: "gdrive:../other" }, "database"), /dedicated/);
  const full = { ...env, BACKUP_SUPABASE_ACCESS_TOKEN: "fake-access-token", BACKUP_VERCEL_TOKEN: "fake-vercel-token",
    BACKUP_VERCEL_PROJECT_ID: "project-id", BACKUP_RECOVERY_INVENTORY_JSON: JSON.stringify({
      vaultReference: "Password manager: MADIBA production recovery", secretNames: ["ANDROID_KEYSTORE_BASE64"],
    }) };
  assert.equal(readBackupConfig(full, "full").recoveryInventory.secretNames[0], "ANDROID_KEYSTORE_BASE64");
  assert.throws(() => readBackupConfig({ ...full, BACKUP_RECOVERY_INVENTORY_JSON: JSON.stringify({
    vaultReference: "vault", secretNames: ["ANDROID_KEYSTORE_BASE64"], androidSigning: { privateKey: "do-not-archive" },
  }) }, "full"), /only a vaultReference/);
  assert.throws(() => readBackupConfig(env, "full"), /BACKUP_SUPABASE_ACCESS_TOKEN/);
  assert.throws(() => readBackupConfig(env, "everything"), /mode/);
  assert.throws(() => readBackupConfig({ ...env, BACKUP_RCLONE_CONFIG: env.BACKUP_RCLONE_CONFIG.replace("drive.file", "drive") }, "database"), /scope/);
  assert.throws(() => readBackupConfig({ ...env, BACKUP_RCLONE_CONFIG: env.BACKUP_RCLONE_CONFIG.replace("refresh_token", "access_token") }, "database"), /refresh token/);
});

test("names round-trip with KSA month boundaries and ignore unrelated files", () => {
  const date = new Date("2026-09-30T23:47:00Z");
  const name = backupName("full", date, "123-1");
  assert.equal(parseBackupName(name).ksaDay, "2026-10-01");
  assert.equal(parseBackupName(name).month, "2026-10");
  assert.equal(parseBackupName("personal-document.pdf"), null);
  assert.equal(parseBackupName("madiba-sfa-full-20260231T000000Z-1.tar.gz.age"), null);
  assert.throws(() => backupName("full", date, "../secret"), /identity/);
});

test("retention preserves 30 daily and 12 monthly full restore points and latest database", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const daily = Array.from({ length: 45 }, (_, index) => backupName("full", new Date(now - index * 86400000), `day-${index}`));
  const monthly = Array.from({ length: 15 }, (_, index) => backupName("full", new Date(Date.UTC(2026, 8 - index, 1, 1)), `month-${index}`));
  const oldDatabase = backupName("database", new Date("2026-01-01T00:00:00Z"), "old");
  const newestDatabase = backupName("database", new Date("2026-02-01T00:00:00Z"), "newest");
  const expired = retentionCandidates([...daily, ...monthly, oldDatabase, newestDatabase, "notes.txt"], now);
  assert.ok(expired.includes(oldDatabase));
  assert.ok(!expired.includes(newestDatabase));
  assert.ok(!expired.includes("notes.txt"));
  for (const name of daily.slice(0, 30)) assert.ok(!expired.includes(name));
  assert.ok(expired.includes(monthly.at(-1)));
});

test("retention preserves recent database snapshots and future timestamps", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const recent = backupName("database", new Date(now - 86400000), "recent");
  const future = backupName("full", new Date("2030-01-01T00:00:00Z"), "future");
  assert.deepEqual(retentionCandidates([recent, future], now), []);
});

test("Storage listing paginates and traverses nested folders without dropping file 1001", async () => {
  const calls = [];
  const storage = { from: () => ({ list: async (prefix, options) => {
    calls.push({ prefix, offset: options.offset });
    if (prefix === "nested") return { data: [{ name: "photo.jpg", id: "file", metadata: {} }] };
    if (options.offset === 0) return { data: [
      { name: "nested", id: null, metadata: null },
      ...Array.from({ length: 999 }, (_, index) => ({ name: `file-${index}`, id: String(index), metadata: {} })),
    ] };
    return { data: [{ name: "last.pdf", id: "last", metadata: {} }] };
  } }) };
  const files = await listStorageFiles(storage, "documents");
  assert.equal(files.length, 1001);
  assert.ok(files.some((file) => file.path === "nested/photo.jpg"));
  assert.ok(files.some((file) => file.path === "last.pdf"));
  assert.ok(calls.some((call) => call.offset === 1000));
});

test("Storage errors and unsafe paths fail closed", async () => {
  await assert.rejects(listStorageFiles({ from: () => ({ list: async () => ({ error: { message: "secret" } }) }) }, "bucket"), /incomplete/);
  await assert.rejects(listStorageFiles({ from: () => ({ list: async () => ({ data: [{ name: ".." }] }) }) }, "bucket"), /Unsafe/);
});