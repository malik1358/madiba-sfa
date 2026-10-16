import test from "node:test";
import assert from "node:assert/strict";
import { zipStoredFiles } from "../app/lib/zipStoredFiles.js";

function readStoredZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = [];
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const size = view.getUint32(offset + 18, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    files.push({
      name: new TextDecoder().decode(bytes.slice(nameStart, nameStart + nameLength)),
      bytes: bytes.slice(dataStart, dataStart + size),
    });
    offset = dataStart + size;
  }
  return files;
}

test("stored zip keeps each catalogue photo and renames duplicates", () => {
  const archive = zipStoredFiles([
    { name: "A1-1.jpg", bytes: new Uint8Array([1, 2, 3]) },
    { name: "A1-1.jpg", bytes: new TextEncoder().encode("jpeg") },
  ]);
  const files = readStoredZip(archive);
  assert.deepEqual(files.map((file) => file.name), ["A1-1.jpg", "A1-1-2.jpg"]);
  assert.deepEqual([...files[0].bytes], [1, 2, 3]);
  assert.equal(new TextDecoder().decode(files[1].bytes), "jpeg");
  assert.equal(new DataView(archive.buffer, archive.byteOffset, archive.byteLength).getUint32(archive.length - 22, true), 0x06054b50);
});
