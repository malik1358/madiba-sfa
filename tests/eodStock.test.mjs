import test from "node:test";
import assert from "node:assert/strict";

import {
  applyEodStockUpload,
  availableEodStockQty,
  countryEodStockQty,
  filterItemsWithPositiveCountryEodStock,
  hasPositiveCountryEodStockQty,
  buildEodStockAvailability,
  buildEodStockReportRows,
  eodQtyMovement,
  eodStockTemplateMatrix,
  formatEodDelta,
  formatEodStockAsOfDate,
  formatEodStockAvailableLabel,
  formatEodStockCityBreakdown,
  inferEodCityFromFileName,
  isEodStockOlderThanHours,
  isEodStockQtyOverAvailable,
  mergeEodCityUploads,
  parseEodQtyCell,
  parseEodStockDate,
  parseEodStockSheets,
  splitEodItemLabel,
  summarizeEodCityUploads,
  summarizeEodStock,
} from "../app/lib/eodStock.js";

test("parseEodStockDate reads KSA day-first dates, month names, and Excel serials", () => {
  assert.equal(parseEodStockDate("2026-10-26"), "2026-10-26");
  assert.equal(parseEodStockDate("26/10/2026"), "2026-10-26");
  assert.equal(parseEodStockDate("10/26/2026"), "2026-10-26");
  assert.equal(parseEodStockDate("1-Apr-2026 to 26-Oct-2026"), "2026-10-26");
  assert.equal(parseEodStockDate(45956), "2025-10-26");
});

test("wide city columns and godowns become one row per item", () => {
  const parsed = parseEodStockSheets([{
    name: "Stock",
    matrix: [
      ["Stock Summary as on 26-Oct-2026"],
      ["Item Code", "Item Name", "Unit", "RIYADH W/H 1", "RIYADH W/H 2", "DAMMAM W/H 1", "JEDDAH W/H 1"],
      ["lp00318", "Latex gloves", "ctn", 10, 2, 4, 1],
      ["AB100", "A4 paper", "CTN", 0, 0, 0, 0],
    ],
  }], { fallbackDate: "2026-10-01" });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.stockDate, "2026-10-26");
  assert.deepEqual(parsed.citiesPresent, ["riyadh", "dammam", "jeddah"]);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].itemCode, "LP00318");
  assert.equal(parsed.rows[0].unit, "CTN");
  assert.equal(parsed.rows[0].cities.riyadh.qty, 12);
  assert.equal(parsed.rows[0].cities.dammam.qty, 4);
  assert.equal(parsed.skippedZero, 1);
});

test("an explicit city qty column is not added again from godown columns", () => {
  const parsed = parseEodStockSheets([{
    name: "Stock",
    matrix: [
      ["Item Code", "Riyadh Qty", "RIYADH W/H 1", "Dammam Qty", "Jeddah Qty", "Stock Date"],
      ["AB100", 5, 99, 2, 1, "2026-10-26"],
    ],
  }]);
  assert.equal(parsed.rows[0].cities.riyadh.qty, 5);
  assert.equal(parsed.rows[0].cities.dammam.qty, 2);
});

test("long godown rows and one sheet per city keep the latest stock date", () => {
  const parsed = parseEodStockSheets([
    {
      name: "Riyadh",
      matrix: [
        ["Item Name", "Closing Qty", "Stock Date"],
        ["Latex gloves", 8, "2026-10-25"],
        ["Latex gloves", 9, "2026-10-26"],
      ],
    },
    {
      name: "Lines",
      matrix: [
        ["Item Code", "Godown", "Qty", "Value", "Date"],
        ["AB100", "DAMMAM W/H 1", 3, 90, "26/10/2026"],
        ["AB100", "Unknown depot", 7, 10, "26/10/2026"],
        ["AB100", "JEDDAH W/H 1", "(2)", 40, "25/10/2026"],
      ],
    },
  ], { fallbackDate: "2026-10-01" });

  assert.equal(parsed.stockDate, "2026-10-26");
  const gloves = parsed.rows.find((row) => row.itemCode === "LATEX GLOVES");
  const paper = parsed.rows.find((row) => row.itemCode === "AB100");
  assert.equal(gloves.cities.riyadh.qty, 9);
  assert.equal(paper.cities.dammam.qty, 3);
  assert.equal(paper.cities.dammam.value, 90);
  assert.equal(paper.cities.jeddah.qty, 0);
  assert.equal(parsed.skippedUnknownCity, 1);
  assert.ok(parsed.skippedOtherDates >= 1);
});

test("Tally Location Summary reads Quantity from column B for one city", () => {
  assert.deepEqual(splitEodItemLabel("A004426_MADIBA CIGARETTE LIGHTER"), {
    code: "A004426",
    name: "MADIBA CIGARETTE LIGHTER",
  });
  assert.deepEqual(parseEodQtyCell("14 TRAY"), { qty: 14, unit: "TRAY" });
  assert.deepEqual(parseEodQtyCell(-72), { qty: -72, unit: "" });

  const riyadh = parseEodStockSheets([{
    name: "Riyadh-Region",
    matrix: [
      ["ABC LTD"],
      ["Riyadh-Region"],
      ["Location Summary"],
      ["1-Jan-26 to 27-Oct-26"],
      ["", "Riyadh-Region"],
      ["Particulars", "1-Jan-26 to 27-Oct-26"],
      ["", "Closing Balance"],
      ["", "Quantity", "(Alt. Units)"],
      ["A004426_MADIBA CIGARETTE LIGHTER 50 PCS", 14, 0.7],
      ["A003468_MADIBA BABY TALCUM POWDER - WHITE", -72, -2],
      ["A003622_GRADE-E2 5 MM", "13 PCS"],
    ],
  }]);
  assert.equal(riyadh.ok, true);
  assert.equal(riyadh.stockDate, "2026-10-27");
  assert.deepEqual(riyadh.citiesPresent, ["riyadh"]);
  assert.equal(riyadh.rows.length, 3);
  assert.equal(riyadh.rows.find((row) => row.itemCode === "A004426").cities.riyadh.qty, 14);
  assert.equal(riyadh.rows.find((row) => row.itemCode === "A003468").cities.riyadh.qty, -72);
  assert.equal(riyadh.rows.find((row) => row.itemCode === "A003622").unit, "PCS");

  const dammam = parseEodStockSheets([{
    name: "NON FOOD DIVISION",
    matrix: [
      ["ABC LTD"],
      ["NON FOOD DIVISION"],
      ["Location Summary"],
      ["1-Jan-26 to 27-Oct-26"],
      ["", "Location : DAMMAM W/H 1"],
      ["Particulars", "1-Jan-26 to 27-Oct-26"],
      ["", "FIFO"],
      ["", "Closing Balance"],
      ["", "Quantity", "(Alt. Units)"],
      ["A003234_PHOTOCOPY PAPER A4", 140, 700],
      ["A003283_MADIBA TWIN TUB WASHING MACHINE", 6],
    ],
  }]);
  assert.equal(dammam.ok, true);
  assert.deepEqual(dammam.citiesPresent, ["dammam"]);
  assert.equal(dammam.rows.find((row) => row.itemCode === "A003234").cities.dammam.qty, 140);
  assert.equal(dammam.rows.find((row) => row.itemCode === "A003283").cities.dammam.qty, 6);

  const wideTally = parseEodStockSheets([{
    name: "Riyadh-Region",
    matrix: [
      ["ABC LTD"],
      ["Riyadh-Region"],
      ["Location Summary"],
      ["1-Jan-26 to 9-Nov-26"],
      ["Particulars", "1-Jan-26 to 9-Nov-26"],
      ["", "Opening Balance", "", "Inwards", "", "Closing Balance", ""],
      ["", "Quantity", "(Alt. Units)", "Quantity", "(Alt. Units)", "Quantity", "(Alt. Units)"],
      ["NON FOOD DIVISION"],
      ["A005353_Westpoint Split AC 24K COOL ONLY", "", "", 240, 240, 239, 239],
      ["A003622_GRADE-E2 5 MM", "", "", 3999, "", 13, ""],
      ["16-Inch portable Ventilation Fan", "", "", 47, "", 6, ""],
    ],
  }]);
  assert.equal(wideTally.ok, true);
  assert.equal(wideTally.stockDate, "2026-11-09");
  assert.equal(wideTally.rows.find((row) => row.itemCode === "A005353").cities.riyadh.qty, 239);
  assert.equal(wideTally.rows.find((row) => row.itemCode === "A003622").cities.riyadh.qty, 13);
  assert.equal(wideTally.rows.find((row) => row.itemCode === "16-INCH PORTABLE VENTILATION FAN").cities.riyadh.qty, 6);
});

test("space-joined CODE NAME labels split into clean codes", () => {
  assert.deepEqual(splitEodItemLabel("A006566 GLASS JAR 1750ML X 24PCS PER CTN (XT-2)"), {
    code: "A006566",
    name: "GLASS JAR 1750ML X 24PCS PER CTN (XT-2)",
  });
  // Product names must stay names: no digits, too few digits, digit-leading tokens.
  assert.deepEqual(splitEodItemLabel("LATEX GLOVES"), { code: "", name: "LATEX GLOVES" });
  assert.deepEqual(splitEodItemLabel("A4 PAPER COPY"), { code: "", name: "A4 PAPER COPY" });
  assert.deepEqual(splitEodItemLabel("16-INCH PORTABLE VENTILATION FAN"), {
    code: "",
    name: "16-INCH PORTABLE VENTILATION FAN",
  });

  const parsed = parseEodStockSheets([{
    name: "Riyadh-Region",
    matrix: [
      ["ABC LTD"],
      ["Riyadh-Region"],
      ["Location Summary"],
      ["1-Jan-26 to 13-Nov-26"],
      ["Particulars", "1-Jan-26 to 13-Nov-26"],
      ["", "Closing Balance"],
      ["", "Quantity", "(Alt. Units)"],
      ["A006566 GLASS JAR 1750ML X 24PCS PER CTN (XT-2)", 1440, 60],
    ],
  }]);
  assert.equal(parsed.ok, true);
  const row = parsed.rows.find((entry) => entry.itemCode === "A006566");
  assert.ok(row);
  assert.equal(row.itemName, "GLASS JAR 1750ML X 24PCS PER CTN (XT-2)");
  assert.equal(row.cities.riyadh.qty, 1440);
});

test("stored space-joined keys from older uploads still resolve to the clean code", () => {
  const availability = buildEodStockAvailability({
    stockDate: "2026-11-13",
    rows: [{
      itemCode: "A006566 GLASS JAR 1750ML X 24PCS PER CTN (XT-2)",
      itemName: "A006566 GLASS JAR 1750ML X 24PCS PER CTN (XT-2)",
      unit: "PCS",
      cities: {
        riyadh: { qty: 1440, value: 0 },
        dammam: { qty: 0, value: 0 },
        jeddah: { qty: 0, value: 0 },
      },
    }],
  });
  assert.equal(availability.byCity.riyadh.A006566, 1440);
  assert.equal(availability.units.A006566, "PCS");
  assert.equal(countryEodStockQty(availability, "A006566"), 1440);
  assert.equal(availableEodStockQty(availability, "riyadh", "A006566"), 1440);
  assert.equal(hasPositiveCountryEodStockQty(availability, "A006566"), true);

  // Cached pricing payloads whose byCity keys were saved before the fix.
  const cached = {
    stockDate: "2026-11-13",
    byCity: {
      riyadh: { "A006566 GLASS JAR 1750ML X 24PCS PER CTN (XT-2)": 1440 },
      dammam: {},
      jeddah: {},
    },
  };
  assert.equal(countryEodStockQty(cached, "A006566"), 1440);
  assert.equal(
    filterItemsWithPositiveCountryEodStock([{ item_code: "A006566" }], cached).length,
    1,
  );
});

test("Location Summary switches between Riyadh warehouse and Store/Dukan", () => {
  const parsed = parseEodStockSheets([{
    name: "Riyadh-Region",
    matrix: [
      ["ABC LTD"],
      ["Riyadh-Region"],
      ["Location Summary"],
      ["1-Jan-26 to 11-Nov-26"],
      ["", "Location : RIYADH W/H 1"],
      ["Particulars", "1-Jan-26 to 11-Nov-26"],
      ["", "Closing Balance"],
      ["", "Quantity", "(Alt. Units)"],
      ["A004700_WAREHOUSE ONLY ITEM", 20, 1],
      ["", "Location : DUKAN STORE"],
      ["A004701_STORE ONLY ITEM", 7, 1],
      ["A004700_WAREHOUSE ONLY ITEM", 2, 1],
    ],
  }]);
  assert.equal(parsed.ok, true);
  assert.ok(parsed.citiesPresent.includes("riyadh"));
  assert.ok(parsed.citiesPresent.includes("store"));
  assert.equal(parsed.rows.find((row) => row.itemCode === "A004700").cities.riyadh.qty, 20);
  assert.equal(parsed.rows.find((row) => row.itemCode === "A004700").cities.store.qty, 2);
  assert.equal(parsed.rows.find((row) => row.itemCode === "A004701").cities.store.qty, 7);
  assert.equal(parsed.rows.find((row) => row.itemCode === "A004701").cities.riyadh.qty, 0);
});

test("inferEodCityFromFileName recognizes Store/Dukan uploads", () => {
  assert.equal(inferEodCityFromFileName("Dukan_Store.xlsx"), "store");
  assert.equal(inferEodCityFromFileName("store-stock.xlsx"), "store");
  assert.equal(inferEodCityFromFileName("Riyadh.xlsx"), "riyadh");
});

test("order qty stock hint keeps last upload and shows date when older than 24 hours", () => {
  const availability = buildEodStockAvailability({
    stockDate: "2026-10-27",
    uploadedAt: "2026-10-27T10:00:00.000Z",
    rows: [{
      itemCode: "A004426",
      itemName: "Lighter",
      unit: "TRAY",
      cities: {
        riyadh: { qty: 30, value: 0 },
        dammam: { qty: 6, value: 0 },
        jeddah: { qty: 0, value: 0 },
      },
    }, {
      itemCode: "NEG1",
      itemName: "Negative",
      cities: {
        riyadh: { qty: -12, value: 0 },
        dammam: { qty: 0, value: 0 },
        jeddah: { qty: 0, value: 0 },
      },
    }],
  });

  assert.equal(availability.active, true);
  assert.equal(availability.uploadedAt, "2026-10-27T10:00:00.000Z");
  assert.equal(availableEodStockQty(availability, "riyadh", "A004426"), 30);
  assert.equal(availableEodStockQty(availability, "dammam", "A004426"), 6);
  assert.equal(availableEodStockQty(availability, "jeddah", "A004426"), 0);
  assert.equal(availableEodStockQty(availability, "riyadh", "MISSING"), 0);
  assert.equal(availableEodStockQty(availability, "riyadh", "NEG1"), 0);
  assert.equal(availableEodStockQty(null, "riyadh", "A004426"), null);
  assert.equal(countryEodStockQty(availability, "A004426"), 36);
  assert.equal(countryEodStockQty(availability, "MISSING"), 0);
  assert.equal(countryEodStockQty(availability, "NEG1"), 0);
  assert.equal(countryEodStockQty(null, "A004426"), null);
  assert.equal(hasPositiveCountryEodStockQty(availability, "A004426"), true);
  assert.equal(hasPositiveCountryEodStockQty(availability, "MISSING"), false);
  assert.equal(hasPositiveCountryEodStockQty(null, "A004426"), true);
  assert.deepEqual(
    filterItemsWithPositiveCountryEodStock(
      [{ item_code: "A004426" }, { item_code: "MISSING" }, { item_code: "NEG1" }],
      availability,
    ).map((item) => item.item_code),
    ["A004426"],
  );
  assert.equal(isEodStockQtyOverAvailable(31, 30), true);
  assert.equal(isEodStockQtyOverAvailable(30, 30), false);
  assert.equal(isEodStockQtyOverAvailable(40, null), false);

  const freshNow = Date.parse("2026-10-27T20:00:00.000Z");
  const staleNow = Date.parse("2026-10-28T11:00:00.000Z");
  assert.equal(isEodStockOlderThanHours(availability, 24, freshNow), false);
  assert.equal(isEodStockOlderThanHours(availability, 24, staleNow), true);
  assert.equal(formatEodStockAsOfDate("2026-10-27", "en"), "27 Oct 2026");
  assert.equal(formatEodStockCityBreakdown(availability, "A004426"), "R:30 D:6 J:0");
  assert.equal(formatEodStockCityBreakdown(null, "A004426"), "");
  assert.equal(
    formatEodStockAvailableLabel(36, "en", null, availability, "A004426", freshNow),
    "Available: 36 · R:30 D:6 J:0",
  );
  assert.equal(
    formatEodStockAvailableLabel(36, "en", null, availability, "A004426", staleNow),
    `Available: 36 · R:30 D:6 J:0 · ${formatEodStockAsOfDate("2026-10-27", "en")}`,
  );
  assert.equal(
    formatEodStockAvailableLabel(36, "en", 40, availability, "A004426", staleNow),
    `Available: 36 · R:30 D:6 J:0 · ${formatEodStockAsOfDate("2026-10-27", "en")} — over stock`,
  );
  assert.match(
    formatEodStockAvailableLabel(36, "ar", 40, availability, "A004426", staleNow),
    /المتاح: 36 · R:30 D:6 J:0 · .+ — أكثر من المخزون/,
  );
});

test("template, missing date, and snapshot comparison", () => {
  const parsed = parseEodStockSheets([{ name: "Stock", matrix: eodStockTemplateMatrix() }]);
  assert.equal(parsed.stockDate, "2026-10-26");
  assert.equal(parsed.rows.length, 2);

  const undated = parseEodStockSheets([{
    name: "Jeddah",
    matrix: [
      ["Item Code", "Closing Qty"],
      ["AB100", 4],
    ],
  }], { fallbackDate: "2026-10-26" });
  assert.equal(undated.stockDate, "2026-10-26");
  assert.deepEqual(undated.citiesPresent, ["jeddah"]);

  const first = applyEodStockUpload(null, parsed);
  const nextDay = applyEodStockUpload({
    stockDate: first.stockDate,
    rows: first.rows,
    previousRows: [],
  }, {
    ...parsed,
    stockDate: "2026-10-27",
    rows: parsed.rows.map((row) => (
      row.itemCode === "LP00318"
        ? { ...row, cities: { ...row.cities, riyadh: { qty: 10, value: 1500 } } }
        : row
    )),
  });
  assert.equal(nextDay.previousStockDate, "2026-10-26");
  assert.equal(nextDay.rows.find((row) => row.itemCode === "LP00318").cities.riyadh.qty, 10);

  const sameDay = applyEodStockUpload(nextDay, {
    stockDate: "2026-10-27",
    citiesPresent: ["jeddah"],
    rows: [{
      itemCode: "AB100",
      itemName: "A4 paper",
      unit: "CTN",
      cities: {
        riyadh: { qty: 0, value: 0 },
        dammam: { qty: 0, value: 0 },
        jeddah: { qty: 11, value: 300 },
      },
    }],
  });
  assert.equal(sameDay.previousStockDate, "2026-10-26");
  assert.equal(sameDay.rows.find((row) => row.itemCode === "AB100").cities.riyadh.qty, 30);
  assert.equal(sameDay.rows.find((row) => row.itemCode === "AB100").cities.jeddah.qty, 11);

  const older = applyEodStockUpload(sameDay, { ...undated, stockDate: "2026-10-20" });
  assert.equal(older.stockDate, "2026-10-27");
  assert.equal(older.previousStockDate, "2026-10-26");
  assert.equal(older.rows.find((row) => row.itemCode === "AB100").cities.jeddah.qty, 4);
  assert.equal(older.rows.find((row) => row.itemCode === "AB100").cities.riyadh.qty, 30);
  assert.ok(older.citiesPresent.includes("riyadh"));
  assert.ok(older.citiesPresent.includes("jeddah"));

  const report = buildEodStockReportRows(nextDay);
  const gloves = report.find((row) => row.itemCode === "LP00318");
  assert.equal(gloves.riyadh, 10);
  assert.equal(gloves.riyadhPrev, 12);
  assert.equal(gloves.total, 14);
  assert.equal(eodQtyMovement(gloves.riyadh, gloves.riyadhPrev, true), "down");
  assert.equal(formatEodDelta(gloves.riyadh, gloves.riyadhPrev), "-2");
  assert.equal(eodQtyMovement(gloves.dammam, gloves.dammamPrev, true), "current");
  assert.equal(eodQtyMovement(4, 0, false), "current");
});

test("city file names and per-city upload pointers stay after a later sibling upload", () => {
  assert.equal(inferEodCityFromFileName("Riyadh.xlsx"), "riyadh");
  assert.equal(inferEodCityFromFileName("dammam1.xlsx"), "dammam");
  assert.equal(inferEodCityFromFileName("eod-stock/2026-11-09T12-04-26-285Z_Riyadh.xlsx"), "riyadh");
  assert.equal(inferEodCityFromFileName("GdwnSum.xlsx"), "");

  const withRiyadh = mergeEodCityUploads(null, ["riyadh"], {
    fileName: "Riyadh.xlsx",
    filePath: "eod-stock/riyadh.xlsx",
    uploadedAt: "2026-11-09T12:04:26.285Z",
    stockDate: "2026-11-09",
    itemCount: 400,
  });
  const withDammam = mergeEodCityUploads(withRiyadh, ["dammam"], {
    fileName: "dammam1.xlsx",
    filePath: "eod-stock/dammam1.xlsx",
    uploadedAt: "2026-11-09T12:05:02.240Z",
    stockDate: "2026-12-31",
    itemCount: 233,
  });
  assert.equal(withDammam.riyadh.fileName, "Riyadh.xlsx");
  assert.equal(withDammam.dammam.fileName, "dammam1.xlsx");

  const summary = summarizeEodStock({
    fileName: "dammam1.xlsx",
    filePath: "eod-stock/dammam1.xlsx",
    uploadedAt: "2026-11-09T12:05:02.240Z",
    stockDate: "2026-12-31",
    citiesPresent: ["dammam"],
    cityUploads: withDammam,
    rows: [{
      itemCode: "A1",
      itemName: "Item",
      unit: "CTN",
      cities: {
        riyadh: { qty: 2, value: 0 },
        dammam: { qty: 5, value: 0 },
        jeddah: { qty: 0, value: 0 },
      },
    }],
  });
  assert.equal(summary.cityUploads.riyadh.fileName, "Riyadh.xlsx");
  assert.equal(summary.cityUploads.dammam.canDownload, true);
  assert.equal(summary.cityItemCounts.riyadh, 1);
  assert.equal(summary.cityItemCounts.dammam, 1);

  const legacy = summarizeEodCityUploads({
    fileName: "dammam1.xlsx",
    filePath: "eod-stock/dammam1.xlsx",
    uploadedAt: "2026-11-09T12:05:02.240Z",
    citiesPresent: ["dammam"],
  });
  assert.equal(legacy.dammam.fileName, "dammam1.xlsx");
  assert.equal(legacy.riyadh, null);
});
