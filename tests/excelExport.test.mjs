import test from "node:test";
import assert from "node:assert/strict";
import {
  excelFileStamp,
  isExcelFilterHeaderRow,
  normalizeExcelFilename,
  rowsFromTableMatrix,
  uniqueExcelHeader,
} from "../app/lib/excelExport.js";

test("normalizeExcelFilename stamps and sanitizes the download name", () => {
  assert.equal(normalizeExcelFilename("User Activity", "2026-09-04-08-00-00"), "User-Activity-2026-09-04-08-00-00.xlsx");
  assert.equal(excelFileStamp(new Date("2026-09-04T08:00:00.000Z")), "2026-09-04-08-00-00");
});

test("rowsFromTableMatrix uses headers and skips blank placeholder rows", () => {
  const rows = rowsFromTableMatrix(
    ["User", "Visits"],
    [
      ["Parvez", "3"],
      [""],
      ["Junaid", "1"],
    ],
  );

  assert.deepEqual(rows, [
    { User: "Parvez", Visits: "3" },
    { User: "Junaid", Visits: "1" },
  ]);
});

test("uniqueExcelHeader keeps duplicate column titles distinct", () => {
  const used = new Set();
  assert.equal(uniqueExcelHeader("Customer", used), "Customer");
  assert.equal(uniqueExcelHeader("Customer", used), "Customer 2");
});

test("isExcelFilterHeaderRow skips collector filter rows and custom header controls", () => {
  assert.equal(isExcelFilterHeaderRow({
    classList: { contains: (name) => name === "moduleCollectorFilterRow" },
    querySelectorAll: () => [],
  }), true);
  assert.equal(isExcelFilterHeaderRow({
    classList: { contains: () => false },
    querySelectorAll: () => [{ classList: { contains: () => false } }],
  }), true);
  assert.equal(isExcelFilterHeaderRow({
    classList: { contains: () => false },
    querySelectorAll: () => [{ classList: { contains: (name) => name === "moduleTableColumnFilterInput" } }],
  }), false);
});
