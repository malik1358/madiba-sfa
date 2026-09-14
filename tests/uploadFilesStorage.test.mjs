import assert from "node:assert/strict";
import test from "node:test";
import {
  excelContentType,
  parseUploadFileMeta,
  safeUploadFileName,
} from "../app/lib/uploadFilesStorage.js";

test("safeUploadFileName keeps extension and strips unsafe characters", () => {
  assert.equal(safeUploadFileName("data (8).xlsx"), "data_8_.xlsx");
  assert.equal(safeUploadFileName("Outstanding report 13-9-26.xls"), "Outstanding_report_13-9-26.xls");
  assert.equal(safeUploadFileName(""), "upload.xlsx");
});

test("excelContentType picks xls vs xlsx", () => {
  assert.equal(excelContentType("a.xls"), "application/vnd.ms-excel");
  assert.equal(
    excelContentType("a.xlsx"),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
});

test("parseUploadFileMeta requires filePath", () => {
  assert.equal(parseUploadFileMeta(null), null);
  assert.equal(parseUploadFileMeta({ fileName: "a.xlsx" }), null);
  assert.deepEqual(parseUploadFileMeta({
    fileName: "a.xlsx",
    filePath: "sales/a.xlsx",
    uploadedAt: "2026-09-13T12:00:00.000Z",
    kind: "sales",
    batchId: 12,
  }), {
    filePath: "sales/a.xlsx",
    fileName: "a.xlsx",
    uploadedAt: "2026-09-13T12:00:00.000Z",
    kind: "sales",
    batchId: 12,
  });
});
