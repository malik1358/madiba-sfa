import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BackupDiagnosticError, classifyCommandFailure, databaseStage, databaseCommand, execute, exportStorage, fetchJson, runBackup, safeBackupConfigError, validateDatabaseArchiveCoverage } from "../scripts/backup/run-backup.mjs";
import { verifyBackup } from "../scripts/backup/verify-backup.mjs";

test("database command captures all schemas and passes passwords only through environment", () => {
  const args = databaseCommand("/tmp/backup", { PGPASSWORD: "do-not-log", PGSSLMODE: "require" }, "pg_dump", ["--format=custom"]);
  assert.ok(args.includes("PGPASSWORD"));
  assert.ok(!args.join(" ").includes("do-not-log"));
  assert.ok(!args.some((arg) => arg.startsWith("--exclude-schema")));
  assert.ok(args.includes("postgres:17"));
});

test("command and API failures do not leak raw credentials", async () => {
  await assert.rejects(execute(process.execPath, ["-e", "console.error('private-password');process.exit(1)"]), (error) => {
    assert.ok(!error.message.includes("private-password"));
    return true;
  });
  await assert.rejects(fetchJson("https://example.test", {}, async () => new Response("secret", { status: 401 })), /HTTP 401/);
  await assert.rejects(fetchJson("https://example.test", {}, async () => { throw new Error("password"); }), /raw details suppressed/);
});

test("Storage export streams files with logical paths, metadata and hashes", async () => {
  const payload = await mkdtemp(path.join(tmpdir(), "madiba-storage-test-"));
  try {
    const fetchImpl = async (url) => {
      if (url.endsWith("/bucket")) return Response.json([{ id: "documents", public: false }]);
      if (url.includes("/list/")) return Response.json([{ name: "receipt.pdf", id: "file", metadata: { size: 4 }, updated_at: "2026-10-05" }]);
      return new Response("test", { headers: { "content-type": "application/pdf" } });
    };
    const summary = await exportStorage({ supabaseUrl: "https://example.test", serviceKey: "fake" }, payload, fetchImpl);
    assert.equal(summary.files, 1);
    const manifest = JSON.parse(await readFile(path.join(payload, "storage-manifest.json"), "utf8"));
    assert.equal(manifest.files[0].path, "receipt.pdf");
    assert.equal(manifest.files[0].sha256, createHash("sha256").update("test").digest("hex"));
    assert.equal(await readFile(path.join(payload, manifest.files[0].archivePath), "utf8"), "test");
  } finally { await rm(payload, { recursive: true, force: true }); }
});

test("Storage changes during export fail instead of publishing an incomplete snapshot", async () => {
  const payload = await mkdtemp(path.join(tmpdir(), "madiba-storage-test-"));
  let lists = 0;
  try {
    const fetchImpl = async (url) => {
      if (url.endsWith("/bucket")) return Response.json([{ id: "documents" }]);
      if (url.includes("/list/")) return Response.json([{ name: "file", id: "file", metadata: { size: 4 }, updated_at: String(++lists) }]);
      return new Response("test");
    };
    await assert.rejects(exportStorage({ supabaseUrl: "https://example.test", serviceKey: "fake" }, payload, fetchImpl), /changed/);
  } finally { await rm(payload, { recursive: true, force: true }); }
});

async function databaseFixture(options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "madiba-run-test-"));
  const calls = [];
  const config = {
    mode: "database", projectRef: "fake", pgEnv: { PGPASSWORD: "secret" },
    drivePath: "gdrive:MADIBA-SFA-Backups", rcloneConfig: "fake", recipient: "fake",
  };
  const recoveryExport = {};
  const fakeRun = async (command, args) => {
    calls.push({ command, args });
    if (command === "docker") {
      const volume = args[args.indexOf("--volume") + 1];
      const workspace = volume.slice(0, volume.indexOf(":/backup"));
      if (args.includes("pg_dump")) await writeFile(path.join(workspace, "payload", "database.dump"), "database");
      if (args.includes("pg_dumpall")) await writeFile(path.join(workspace, "payload", "roles.sql"), "roles");
      if (args.includes("pg_restore")) return options.badToc ? "TABLE DATA public" : "TABLE DATA public customers\nTABLE DATA auth users\nTABLE DATA storage objects";
    }
    if (command === "tar") {
      const payload = args[args.indexOf("-C") + 1];
      try {
        recoveryExport.json = await readFile(path.join(payload, "recovery-configuration.json"), "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await writeFile(args[1], "archive");
    }
    if (command === "age") await writeFile(args[args.indexOf("--output") + 1], "encrypted");
    if (command === "rclone" && args[0] === "lsjson") {
      if (args.includes("--stat")) return JSON.stringify({ Size: 9, Hashes: { MD5: options.badChecksum ? "bad" : createHash("md5").update("encrypted").digest("hex") } });
      return JSON.stringify([
        { Name: "madiba-sfa-database-20200101T000000Z-old.tar.gz.age" },
        { Name: "madiba-sfa-database-20261005T001700Z-new.tar.gz.age" },
      ]);
    }
    return "";
  };
  return { root, calls, config, fakeRun, recoveryExport };
}

test("database orchestration encrypts before upload, verifies before cleanup, removes plaintext", async () => {
  const fixture = await databaseFixture();
  try {
    const result = await runBackup(fixture.config, { run: fixture.fakeRun, tempRoot: fixture.root, date: new Date("2026-10-05T00:17:00Z"), prune: true });
    assert.equal(result.manifest.mode, "database");
    const encryptedAt = fixture.calls.findIndex((call) => call.command === "age");
    const uploadAt = fixture.calls.findIndex((call) => call.args[0] === "copyto");
    const verifyAt = fixture.calls.findIndex((call) => call.args.includes("--stat"));
    const deleteAt = fixture.calls.findIndex((call) => call.args[0] === "deletefile");
    assert.ok(encryptedAt < uploadAt && uploadAt < verifyAt && verifyAt < deleteAt);
    assert.ok(fixture.calls[uploadAt].args[1].endsWith(".age"));
    assert.deepEqual(await readdir(fixture.root), []);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("failed checksum and missing Auth data never trigger retention cleanup", async () => {
  for (const options of [{ badChecksum: true }, { badToc: true }]) {
    const fixture = await databaseFixture(options);
    try {
      await assert.rejects(runBackup(fixture.config, { run: fixture.fakeRun, tempRoot: fixture.root, prune: true }), options.badToc
        ? /missing required sections: Supabase Auth user data, Supabase Storage metadata\. No backup was uploaded/
        : /verification failed/);
      assert.ok(!fixture.calls.some((call) => call.args[0] === "deletefile"));
      assert.deepEqual(await readdir(fixture.root), []);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  }
});

test("post-dump file failures identify safe permission, missing-file and disk-full categories", async () => {
  const cases = [
    ["EACCES", /cannot read or write a private local backup file/],
    ["EPERM", /cannot read or write a private local backup file/],
    ["ENOENT", /expected local database dump or roles file is missing/],
    ["ENOSPC", /ran out of disk space while finalizing/],
  ];
  for (const [code, expected] of cases) {
    await assert.rejects(databaseStage("database dump checksum", async () => {
      const error = new Error("private path and customer table");
      error.code = code;
      throw error;
    }), (error) => {
      assert.ok(error instanceof BackupDiagnosticError);
      assert.match(error.message, expected);
      assert.ok(!error.message.includes("private path"));
      assert.ok(!error.message.includes("customer table"));
      return true;
    });
  }
});

test("full orchestration exports configuration, Storage and verified git history", async () => {
  const fixture = await databaseFixture();
  const config = { ...fixture.config, mode: "full", supabaseUrl: "https://example.test", serviceKey: "fake",
    supabaseAccessToken: "fake", vercelToken: "fake", vercelProjectId: "fake",
    recoveryInventory: { vaultReference: "Password manager: MADIBA recovery", secretNames: ["ANDROID_KEYSTORE_BASE64"] } };
  const fakeRun = async (command, args, options) => {
    if (command === "git") {
      if (args[0] === "bundle" && args[1] === "create") await writeFile(args[2], "git-history");
      if (args[0] === "archive") await writeFile(args.find((arg) => arg.startsWith("--output=")).slice(9), "source");
      if (args[0] === "rev-parse") return "fake-commit";
      fixture.calls.push({ command, args });
      return "";
    }
    return fixture.fakeRun(command, args, options);
  };
  const fetchImpl = async (url) => {
    if (url.includes("/config/auth")) return Response.json({ site_url: "https://example.test", smtp_pass: "must-not-archive", jwt_secret: "must-not-archive" });
    if (url.includes("/env?")) {
      assert.match(url, /decrypt=false/);
      return Response.json({ envs: [
        { key: "NEXT_PUBLIC_SUPABASE_URL", value: "must-not-archive", target: ["production"] },
        { key: "SUPABASE_SERVICE_ROLE_KEY", value: "must-not-archive", target: ["production"] },
      ] });
    }
    if (url.includes("api.vercel.com")) return Response.json({ id: "fake", name: "MADIBA SFA", envSecret: "must-not-archive" });
    if (url.endsWith("/bucket")) return Response.json([{ id: "documents" }]);
    if (url.includes("/list/")) return Response.json([{ name: "file", id: "file", metadata: { size: 4 } }]);
    return new Response("test");
  };
  try {
    const result = await runBackup(config, { run: fakeRun, fetchImpl, tempRoot: fixture.root });
    assert.equal(result.manifest.storage.files, 1);
    assert.equal(result.manifest.commit, "fake-commit");
    assert.match(result.manifest.repositorySha256, /^[a-f0-9]{64}$/);
    assert.ok(fixture.calls.some((call) => call.command === "git" && call.args[1] === "verify"));
    assert.ok(!fixture.calls.some((call) => call.args[0] === "deletefile"));
    assert.ok(!fixture.recoveryExport.json.includes("must-not-archive"));
    const recovery = JSON.parse(fixture.recoveryExport.json);
    assert.equal(recovery.supabaseAuth.smtp_pass, "[REDACTED]");
    assert.equal(recovery.supabaseAuth.jwt_secret, "[REDACTED]");
    assert.equal(recovery.vercelEnvironmentInventory.find((entry) => entry.key === "SUPABASE_SERVICE_ROLE_KEY").value, undefined);
    assert.ok(fixture.recoveryExport.json.includes("ANDROID_KEYSTORE_BASE64"));
    assert.ok(fixture.recoveryExport.json.includes("Password manager: MADIBA recovery"));
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test("offline recovery verifier detects tampered database archives", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "madiba-verify-test-"));
  try {
    await writeFile(path.join(root, "database.dump"), "database");
    await writeFile(path.join(root, "roles.sql"), "roles");
    await writeFile(path.join(root, "manifest.json"), JSON.stringify({ formatVersion: 1, mode: "database",
      databaseSha256: createHash("sha256").update("database").digest("hex"),
      rolesSha256: createHash("sha256").update("roles").digest("hex"),
    }));
    assert.equal((await verifyBackup(root)).mode, "database");
    await writeFile(path.join(root, "database.dump"), "corrupt");
    await assert.rejects(verifyBackup(root), /Integrity/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("database diagnostics classify failures without copying identifiers or credentials", async () => {
  const cases = [
    ["password authentication failed for user private-user secret-password", /authentication rejected/],
    ["pg_dump: error: permission denied for table private-table", /permission denied/],
    ["pg_dump: error: aborting because of server version mismatch", /newer than/],
    ["could not translate host name private-host", /hostname/],
    ["connection timed out private-host", /unavailable/],
    ["Tenant or user not found private-user", /identify/],
    ["cannot execute private-query in a read-only transaction", /read-only/],
  ];
  for (const [stderr, expected] of cases) {
    const message = classifyCommandFailure(stderr);
    assert.match(message, expected);
    assert.ok(!message.includes("private-"));
    assert.ok(!message.includes("secret-password"));
  }
  await assert.rejects(databaseStage("roles export (pg_dumpall)", async () => {
    throw new BackupDiagnosticError(classifyCommandFailure("permission denied private-table"));
  }), /roles export.*permission denied/);
  await assert.rejects(databaseStage("database archive (pg_dump)", async () => {
    throw new Error("private-password");
  }), (error) => !error.message.includes("private-password") && error.message.includes("database archive"));
  await assert.rejects(execute(process.execPath, ["-e", "console.error('password authentication failed private-password');process.exit(1)"]),
    (error) => error instanceof BackupDiagnosticError && /authentication rejected/.test(error.message) && !error.message.includes("private-password"));
});

test("configuration validation reports fixed safe reasons but hides arbitrary input", () => {
  assert.equal(safeBackupConfigError(new Error("Use the selected project's direct or SESSION pooler URL on port 5432 with sslmode=require")),
    "Use the selected project's direct or SESSION pooler URL on port 5432 with sslmode=require");
  assert.equal(safeBackupConfigError(new Error("Missing required setting: BACKUP_DATABASE_URL")),
    "Missing required setting: BACKUP_DATABASE_URL");
  assert.equal(safeBackupConfigError(new Error("Invalid URL containing private-password")), null);
  assert.equal(safeBackupConfigError(new Error("BACKUP_DATABASE_URL=private-password")), null);
});

test("database coverage failure reports safe section categories only", () => {
  assert.throws(() => validateDatabaseArchiveCoverage("TABLE DATA public"), (error) => {
    assert.ok(error instanceof BackupDiagnosticError);
    assert.match(error.message, /Supabase Auth user data, Supabase Storage metadata/);
    assert.ok(!error.message.includes("private-table"));
    return true;
  });
  assert.doesNotThrow(() => validateDatabaseArchiveCoverage("TABLE DATA public\nTABLE DATA auth users\nTABLE DATA storage objects"));
});
test("post-dump file access failures report safe categories without paths", async () => {
  for (const [code, expected] of [["EACCES", /cannot read or write/], ["EPERM", /cannot read or write/],
    ["ENOENT", /expected local database dump or roles file is missing/], ["ENOSPC", /ran out of disk space/]]) {
    await assert.rejects(databaseStage("database dump checksum", async () => {
      const error = new Error("private path and customer-table name");
      error.code = code;
      throw error;
    }), (error) => {
      assert.ok(error instanceof BackupDiagnosticError);
      assert.match(error.message, expected);
      assert.ok(!error.message.includes("private path"));
      assert.ok(!error.message.includes("customer-table"));
      return true;
    });
  }
});