import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execute, fileHash } from "../scripts/backup/run-backup.mjs";

test("real age encryption round-trips and rejects corrupt archives", { skip: process.env.BACKUP_TOOL_TESTS !== "true" }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "madiba-age-test-"));
  try {
    const identity = path.join(root, "identity.txt");
    await execute("age-keygen", ["-o", identity]);
    const recipient = (await execute("age-keygen", ["-y", identity])).trim();
    const source = path.join(root, "synthetic-data.json");
    await writeFile(source, JSON.stringify({ synthetic: true, orders: [{ number: "TEST-1" }] }));
    const archive = path.join(root, "synthetic.tar.gz");
    await execute("tar", ["-czf", archive, "-C", root, "synthetic-data.json"]);
    const encrypted = path.join(root, "synthetic.tar.gz.age");
    await execute("age", ["-r", recipient, "-o", encrypted, archive]);
    const decrypted = path.join(root, "decrypted.tar.gz");
    await execute("age", ["-d", "-i", identity, "-o", decrypted, encrypted]);
    assert.equal(await fileHash(archive), await fileHash(decrypted));
    const content = await readFile(encrypted);
    content[content.length - 1] ^= 1;
    const corrupt = path.join(root, "corrupt.age");
    await writeFile(corrupt, content);
    await assert.rejects(execute("age", ["-d", "-i", identity, "-o", path.join(root, "bad.tar.gz"), corrupt]), /failed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});