export const CATALOGUE_DRIVE_FOLDER_ID = "1Gy9bLmAUEqdrYjGzBIKRTg0eITN3nRd7";
export const CATALOGUE_DRIVE_SYNC_KEY = "catalogue_drive_photo_sync_v1";
export const DRIVE_PHOTO_LOOKBACK_MS = 48 * 60 * 60 * 1000;
export const DRIVE_SYNC_IMPORT_GENERATION = 2;
export const DRIVE_SYNC_LOCK_MS = 10 * 60 * 1000;

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function cleanDriveLabel(value) {
  return String(value || "").replace(/[\u202f\u00a0]/g, " ").replace(/\s+/g, " ").trim();
}

export function decodeDriveText(value) {
  return cleanDriveLabel(String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, digits) => String.fromCharCode(Number(digits))));
}

export function catalogueDriveItemCode(folderName) {
  const token = decodeDriveText(folderName).split(" ")[0].toUpperCase();
  return /^A\d{5,}$/.test(token) ? token : "";
}

export function isDriveImageName(name) {
  return /\.(jpe?g|png|webp)$/i.test(decodeDriveText(name));
}

export function driveFolderListUrl(folderId) {
  return `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}`;
}

export function driveFileDownloadUrl(fileId) {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
}

export function parseDriveFolderListing(html) {
  const source = String(html || "");
  if (!source.includes("flip-entry-title")) {
    throw new Error("Google Drive folder could not be read.");
  }
  const pattern = /id="entry-([A-Za-z0-9_-]+)"[\s\S]*?href="([^"]+)"[\s\S]*?flip-entry-title">([^<]*)<[\s\S]*?flip-entry-last-modified"><div>([^<]*)</g;
  const entries = [];
  let match;
  while ((match = pattern.exec(source))) {
    const href = match[2];
    entries.push({
      id: match[1],
      name: decodeDriveText(match[3]),
      modified: decodeDriveText(match[4]),
      kind: href.includes("/folders/") ? "folder" : "file",
    });
  }
  if (!entries.length) throw new Error("Google Drive folder listing was empty.");
  return entries;
}

export function ksaDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const read = (type) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day") };
}

function ksaInstant(year, month, day, hour = 0, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - 3, minute, 0));
}

function ksaDateKey(date) {
  const { year, month, day } = ksaDateParts(date);
  return (year * 10000) + (month * 100) + day;
}

export function parseDriveModifiedLabel(label, now = new Date()) {
  const text = cleanDriveLabel(label);
  if (!text) return null;
  const today = ksaDateParts(now);
  const time = text.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
  if (time) {
    let hour = Number(time[1]) % 12;
    if (time[3].toLowerCase() === "pm") hour += 12;
    let instant = ksaInstant(today.year, today.month, today.day, hour, Number(time[2]));
    if (instant.getTime() > now.getTime() + (2 * 60 * 1000)) {
      instant = new Date(instant.getTime() - (24 * 60 * 60 * 1000));
    }
    return instant;
  }
  if (/^yesterday$/i.test(text)) {
    return new Date(ksaInstant(today.year, today.month, today.day).getTime() - (24 * 60 * 60 * 1000));
  }
  const monthDay = text.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (!monthDay) return null;
  const month = MONTHS[monthDay[1].slice(0, 3).toLowerCase()];
  if (!month) return null;
  let year = monthDay[3] ? Number(monthDay[3]) : today.year;
  let instant = ksaInstant(year, month, Number(monthDay[2]));
  if (!monthDay[3] && instant.getTime() > now.getTime() + (2 * 24 * 60 * 60 * 1000)) {
    year -= 1;
    instant = ksaInstant(year, month, Number(monthDay[2]));
  }
  return instant;
}

export function isRecentDriveLabel(label, now = new Date(), lookbackMs = DRIVE_PHOTO_LOOKBACK_MS) {
  const instant = parseDriveModifiedLabel(label, now);
  if (!instant) return false;
  const age = now.getTime() - instant.getTime();
  return age >= -(2 * 60 * 1000) && age <= lookbackMs;
}

export function driveFileMarker(fileId, modifiedLabel, modifiedAt) {
  return `drive:${fileId}\t${cleanDriveLabel(modifiedLabel)}\t${modifiedAt || ""}`;
}

export function parseDriveFileMarker(value) {
  const match = /^drive:([A-Za-z0-9_-]+)(?:\t([^\t]*))?(?:\t([^\t]*))?$/.exec(String(value || ""));
  if (!match) return null;
  return { fileId: match[1], modifiedLabel: match[2] || "", modifiedAt: match[3] || "" };
}

export function driveRevisionChanged(stored, nextLabel, now = new Date()) {
  const next = cleanDriveLabel(nextLabel);
  if (!stored?.fileId) return true;
  if (cleanDriveLabel(stored.modifiedLabel) === next) return false;
  const nextAt = parseDriveModifiedLabel(next, now);
  const previousAt = stored.modifiedAt
    ? new Date(stored.modifiedAt)
    : parseDriveModifiedLabel(stored.modifiedLabel, now);
  if (!nextAt || !previousAt || Number.isNaN(previousAt.getTime())) return true;
  if (!/am|pm/i.test(next)) return ksaDateKey(nextAt) > ksaDateKey(previousAt);
  return nextAt.getTime() > previousAt.getTime() + (60 * 1000);
}

export function shouldOpenDriveFolder(folder, { photoCount = 0, savedLabel = undefined, now = new Date() } = {}) {
  if (!folder?.itemCode) return false;
  if (!photoCount) return true;
  if (savedLabel == null) return isRecentDriveLabel(folder.modified, now);
  return cleanDriveLabel(savedLabel) !== cleanDriveLabel(folder.modified);
}

export function folderNeedsDriveCatchUp(photos) {
  return Array.isArray(photos)
    && photos.length > 0
    && photos.every((photo) => parseDriveFileMarker(photo.original_file_name));
}

export function driveFileNeedsDownload(file, { photoCount = 0, now = new Date() } = {}) {
  if (!file || file.kind === "folder" || !isDriveImageName(file.name)) return false;
  if (!photoCount) return true;
  if (file.stored) return driveRevisionChanged(file.stored, file.modified, now);
  return isRecentDriveLabel(file.modified, now);
}

export function parseDriveSyncState(value) {
  const source = typeof value === "string" ? safeJson(value) : (value || {});
  const folders = source.folders && typeof source.folders === "object" ? source.folders : {};
  return {
    status: String(source.status || ""),
    startedAt: source.startedAt || "",
    folders,
  };
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function driveSyncIsLocked(state, now = new Date()) {
  if (state?.status !== "running" || !state.startedAt) return false;
  const started = Date.parse(state.startedAt);
  return Number.isFinite(started) && now.getTime() - started < DRIVE_SYNC_LOCK_MS;
}
