import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileHash } from "./run-backup.mjs";

export async function verifyBackup(directory) {
  const root = path.resolve(directory);
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  if (manifest.formatVersion !== 1 || !["database", "full"].includes(manifest.mode)) {
    throw new Error("Unsupported backup manifest");
  }
  const expected = [
    ["database.dump", manifest.databaseSha256], ["roles.sql", manifest.rolesSha256],
  ];
  if (manifest.mode === "full") expected.push(
    ["repository.bundle", manifest.repositorySha256], ["source.tar.gz", manifest.sourceSha256],
    ["recovery-configuration.json", manifest.configurationSha256],
    ["storage-manifest.json", manifest.storageManifestSha256],
  );
  for (const [name, hash] of expected) {
    if (!/^[a-f0-9]{64}$/.test(hash || "") || !(await lstat(path.join(root, name))).isFile()
      || await fileHash(path.join(root, name)) !== hash) throw new Error(`Integrity check failed: ${name}`);
  }
  let storageFiles = 0;
  if (manifest.mode === "full") {
    const storage = JSON.parse(await readFile(path.join(root, "storage-manifest.json"), "utf8"));
    if (!Array.isArray(storage.buckets) || !Array.isArray(storage.files)
      || storage.files.length !== manifest.storage?.files
      || storage.buckets.length !== manifest.storage?.buckets) throw new Error("Incomplete Storage manifest");
    const objects = await lstat(path.join(root, "objects"));
    if (!objects.isDirectory() || objects.isSymbolicLink()) throw new Error("Unsafe objects directory");
    for (const file of storage.files) {
      if (!/^objects\/[a-f0-9]{64}$/.test(file.archivePath || "")) throw new Error("Unsafe object archive path");
      const location = path.join(root, file.archivePath);
      const info = await lstat(location);
      if (!info.isFile() || info.size !== file.bytes || await fileHash(location) !== file.sha256) {
        throw new Error("Storage object integrity check failed");
      }
      storageFiles += 1;
    }
  }
  return { mode: manifest.mode, storageFiles, startedAt: manifest.startedAt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) {
    console.error("Usage: node scripts/backup/verify-backup.mjs <decrypted-extracted-directory>");
    process.exitCode = 1;
  } else {
    verifyBackup(process.argv[2]).then((result) => {
      console.log(`Integrity verified: ${result.mode} backup, ${result.storageFiles} Storage files. No database writes performed.`);
    }).catch(() => {
      console.error("Backup verification failed. Do not restore this archive.");
      process.exitCode = 1;
    });
  }
}