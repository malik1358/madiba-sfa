const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let crc = n;
  for (let k = 0; k < 8; k += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  CRC_TABLE[n] = crc >>> 0;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function uniqueZipName(name, used) {
  const raw = String(name || "item.jpg").replace(/[\\/]/g, "_").trim() || "item.jpg";
  if (!used.has(raw)) {
    used.add(raw);
    return raw;
  }
  const dot = raw.lastIndexOf(".");
  const stem = dot > 0 ? raw.slice(0, dot) : raw;
  const ext = dot > 0 ? raw.slice(dot) : "";
  let next = raw;
  let count = 2;
  while (used.has(next)) {
    next = `${stem}-${count}${ext}`;
    count += 1;
  }
  used.add(next);
  return next;
}

function dosStamp(date) {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | (Math.floor(date.getSeconds() / 2) & 31);
  const day = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { time, day };
}

export function zipStoredFiles(entries, date = new Date()) {
  const used = new Set();
  const files = (entries || []).map((entry) => {
    const bytes = entry?.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry?.bytes || []);
    return { name: uniqueZipName(entry?.name, used), bytes };
  }).filter((entry) => entry.name);
  const { time, day } = dosStamp(date);
  const parts = [];
  const centrals = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = new TextEncoder().encode(file.name);
    const crc = crc32(file.bytes);
    const local = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, time, true);
    view.setUint16(12, day, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, file.bytes.length, true);
    view.setUint32(22, file.bytes.length, true);
    view.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, day, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.bytes.length, true);
    centralView.setUint32(24, file.bytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    parts.push(local, file.bytes);
    centrals.push(central);
    offset += local.length + file.bytes.length;
  });

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  parts.push(...centrals, end);

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const archive = new Uint8Array(total);
  let cursor = 0;
  parts.forEach((part) => {
    archive.set(part, cursor);
    cursor += part.length;
  });
  return archive;
}

function triggerBrowserDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function downloadStoredZip(files, filename) {
  const entries = [];
  for (const file of files || []) {
    entries.push({
      name: file?.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  }
  if (!entries.length) throw new Error("No photos to export.");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const base = String(filename || "catalogue").replace(/\.zip$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "catalogue";
  const blob = new Blob([zipStoredFiles(entries)], { type: "application/zip" });
  triggerBrowserDownload(blob, `${base}-${stamp}.zip`);
}
