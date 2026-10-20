import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogueDriveItemCode,
  driveFileMarker,
  driveFileNeedsDownload,
  driveRevisionChanged,
  isRecentDriveLabel,
  parseDriveFileMarker,
  parseDriveFolderListing,
  parseDriveModifiedLabel,
  shouldOpenDriveFolder,
} from "../app/lib/catalogueDrivePhotos.js";

const now = new Date("2026-10-20T09:07:00.000Z");

const listing = `
<div class="flip-entry" id="entry-1qaz8H9sxMK1WsQ5lYIfQHKKg1-donLYM" role="link">
  <a href="https://drive.google.com/drive/folders/1qaz8H9sxMK1WsQ5lYIfQHKKg1-donLYM">
    <div class="flip-entry-title">A003467 - BABY OIL 200ML</div>
  </a>
  <div class="flip-entry-last-modified"><div>12:53&#8239;am</div></div>
</div>
<div class="flip-entry" id="entry-1Do-YrP8WXSQ0aPbDLtXHdkGF5ROVveWF" role="link">
  <a href="https://drive.google.com/drive/folders/1Do-YrP8WXSQ0aPbDLtXHdkGF5ROVveWF">
    <div class="flip-entry-title">Old</div>
  </a>
  <div class="flip-entry-last-modified"><div>Oct 16</div></div>
</div>
<div class="flip-entry" id="entry-1XOy0246YAumO-WZrdF8aIbh85OQJc20p" role="link">
  <a href="https://drive.google.com/file/d/1XOy0246YAumO-WZrdF8aIbh85OQJc20p/view">
    <div class="flip-entry-title">017A1482.JPG</div>
  </a>
  <div class="flip-entry-last-modified"><div>1:00 am</div></div>
</div>
<div class="flip-entry" id="entry-1mLTxXKPvf2hFEZM4a6TXS2UXu6yIBuKl" role="link">
  <a href="https://drive.google.com/file/d/1mLTxXKPvf2hFEZM4a6TXS2UXu6yIBuKl/view">
    <div class="flip-entry-title">017A1483.JPG</div>
  </a>
  <div class="flip-entry-last-modified"><div>Oct 12</div></div>
</div>
`;

test("reads Drive folder names, ids, and dates", () => {
  const entries = parseDriveFolderListing(listing);
  assert.equal(entries.length, 4);
  assert.deepEqual(entries[0], {
    id: "1qaz8H9sxMK1WsQ5lYIfQHKKg1-donLYM",
    name: "A003467 - BABY OIL 200ML",
    modified: "12:53 am",
    kind: "folder",
  });
  assert.equal(entries[2].kind, "file");
  assert.equal(catalogueDriveItemCode(entries[0].name), "A003467");
  assert.equal(catalogueDriveItemCode(entries[1].name), "");
});

test("opens folders with no catalogue photo and recent Drive changes", () => {
  const babyOil = { id: "baby", itemCode: "A003467", modified: "12:53 am" };
  const older = { id: "old-item", itemCode: "A003453", modified: "Oct 16" };
  assert.equal(shouldOpenDriveFolder(babyOil, { photoCount: 0, now }), true);
  assert.equal(shouldOpenDriveFolder(older, { photoCount: 4, now }), false);
  assert.equal(shouldOpenDriveFolder(older, { photoCount: 4, savedLabel: "Oct 16", now }), false);
  assert.equal(shouldOpenDriveFolder(older, { photoCount: 4, savedLabel: "Oct 15", now }), true);
  assert.equal(shouldOpenDriveFolder({ itemCode: "", modified: "Oct 20" }, { photoCount: 0, now }), false);
});

test("downloads a new photo and skips an unchanged Drive file", () => {
  const fresh = { id: "file-new", name: "017A1482.JPG", modified: "1:00 am", kind: "file", stored: null };
  const old = { id: "file-old", name: "017A1483.JPG", modified: "Oct 12", kind: "file", stored: null };
  assert.equal(driveFileNeedsDownload(fresh, { photoCount: 0, now }), true);
  assert.equal(driveFileNeedsDownload(old, { photoCount: 3, now }), false);
  assert.equal(driveFileNeedsDownload(fresh, { photoCount: 3, now }), true);
  const marker = driveFileMarker("file-new", "1:00 am", parseDriveModifiedLabel("1:00 am", now).toISOString());
  const stored = parseDriveFileMarker(marker);
  assert.equal(driveFileNeedsDownload({ ...fresh, stored, modified: "1:00 am" }, { photoCount: 3, now }), false);
  assert.equal(driveRevisionChanged(stored, "Oct 20", now), false);
  assert.equal(driveRevisionChanged(stored, "11:00 am", now), true);
  assert.equal(isRecentDriveLabel("Oct 16", now), false);
});
