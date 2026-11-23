import assert from "node:assert/strict";
import { test } from "node:test";
import { isEodStockSectionLabel } from "../app/lib/eodStock.js";
import {
  INTER_CITY_TRANSFER_SALES_DAYS,
  INTER_CITY_TRANSFER_SOURCE_RESERVE_DAYS,
  applyCbmToInterCityReport,
  applyMasterUnitsToInterCityReport,
  buildInterCityStockTransferReport,
  buildPeakWeeklySalesByItemCity,
  findInterCityStockImbalances,
  interCityWeekKey,
  isInterCityExcludedItem,
  resolveInterCitySalesWindow,
  salesCityFromVoucherType,
  suggestTransferQty,
} from "../app/lib/interCityStockTransfer.js";

test("sales city comes from voucher type tokens", () => {
  assert.equal(salesCityFromVoucherType("RIYADH W/S CREDIT"), "riyadh");
  assert.equal(salesCityFromVoucherType("DAMMAM CASH SALES"), "dammam");
  assert.equal(salesCityFromVoucherType("SALES NON FOOD DIVISION"), "");
});

test("Monday-start week key groups dates in the same week", () => {
  assert.equal(interCityWeekKey("2026-11-09"), "2026-11-09"); // Monday
  assert.equal(interCityWeekKey("2026-11-11"), "2026-11-09"); // Wednesday
  assert.equal(interCityWeekKey("2026-11-08"), "2026-11-02"); // Sunday → prior Monday
});

test("Tally section titles are not treated as stock items", () => {
  assert.equal(isEodStockSectionLabel("NON FOOD DIVISION"), true);
  assert.equal(isEodStockSectionLabel("RIYADH W/H 1"), true);
  assert.equal(isEodStockSectionLabel("Location : DAMMAM W/H 1"), true);
  assert.equal(isEodStockSectionLabel("FRAGRANCE"), true);
  assert.equal(isEodStockSectionLabel("STATIONARY"), true);
  assert.equal(isEodStockSectionLabel("A004426_MADIBA LIGHTER"), false);
  assert.equal(isInterCityExcludedItem({ itemCode: "NON FOOD DIVISION", itemName: "NON FOOD DIVISION" }), true);
  assert.equal(isInterCityExcludedItem({ itemCode: "RIYADH W/H 1", itemName: "RIYADH W/H 1" }), true);
});

test("finds stock available in one city and not the other", () => {
  const { riyadhToDammam, dammamToRiyadh, riyadhToStore } = findInterCityStockImbalances([
    {
      itemCode: "A004101",
      itemName: "Only Riyadh",
      unit: "PCS",
      cities: { riyadh: { qty: 40 }, dammam: { qty: 0 }, jeddah: { qty: 5 }, store: { qty: 0 } },
    },
    {
      itemCode: "A004102",
      itemName: "Only Dammam",
      cities: { riyadh: { qty: 0 }, dammam: { qty: 12 }, jeddah: { qty: 0 }, store: { qty: 0 } },
    },
    {
      itemCode: "A004103",
      itemName: "Both",
      cities: { riyadh: { qty: 8 }, dammam: { qty: 3 }, jeddah: { qty: 0 }, store: { qty: 2 } },
    },
    {
      itemCode: "A004104",
      itemName: "Warehouse only",
      cities: { riyadh: { qty: 15 }, dammam: { qty: 4 }, jeddah: { qty: 0 }, store: { qty: 0 } },
    },
    {
      itemCode: "NON FOOD DIVISION",
      itemName: "NON FOOD DIVISION",
      cities: { riyadh: { qty: 99 }, dammam: { qty: 0 }, jeddah: { qty: 0 }, store: { qty: 0 } },
    },
  ]);

  assert.deepEqual(riyadhToDammam.map((row) => row.itemCode), ["A004101"]);
  assert.deepEqual(dammamToRiyadh.map((row) => row.itemCode), ["A004102"]);
  assert.deepEqual(riyadhToStore.map((row) => row.itemCode), ["A004101", "A004104"]);
  assert.equal(riyadhToDammam[0].sourceQty, 40);
  assert.equal(riyadhToDammam[0].destinationQty, 0);
  assert.equal(riyadhToStore[0].sourceQty, 40);
  assert.equal(riyadhToStore.find((row) => row.itemCode === "A004104").sourceQty, 15);
});

test("excludes building-material items by category, name, and LP code", () => {
  const { riyadhToDammam, dammamToRiyadh } = findInterCityStockImbalances(
    [
      {
        itemCode: "A004200",
        itemName: "Office stapler",
        cities: { riyadh: { qty: 10 }, dammam: { qty: 0 }, jeddah: { qty: 0 } },
      },
      {
        itemCode: "A004201",
        itemName: "Rebar 12mm",
        cities: { riyadh: { qty: 20 }, dammam: { qty: 0 }, jeddah: { qty: 0 } },
      },
      {
        itemCode: "A004202",
        itemName: "Generic pack",
        category: "Building Material",
        cities: { riyadh: { qty: 0 }, dammam: { qty: 8 }, jeddah: { qty: 0 } },
      },
      {
        itemCode: "LP00318",
        itemName: "Latex gloves",
        cities: { riyadh: { qty: 5 }, dammam: { qty: 0 }, jeddah: { qty: 0 } },
      },
      {
        itemCode: "A004203",
        itemName: "Sales-tagged board",
        cities: { riyadh: { qty: 0 }, dammam: { qty: 4 }, jeddah: { qty: 0 } },
      },
    ],
    { categoryByCode: new Map([["A004203", "Building Material"]]) },
  );

  assert.deepEqual(riyadhToDammam.map((row) => row.itemCode), ["A004200"]);
  assert.deepEqual(dammamToRiyadh.map((row) => row.itemCode), []);
});

test("peak weekly sales uses the highest week for the destination city", () => {
  const peaks = buildPeakWeeklySalesByItemCity([
    { item_code: "A004301", quantity: 10, sales_amount: 100, transaction_date: "2026-05-05", voucher_type: "DAMMAM W/S CREDIT" },
    { item_code: "A004301", quantity: 20, sales_amount: 200, transaction_date: "2026-05-06", voucher_type: "DAMMAM W/S CREDIT" },
    { item_code: "A004301", quantity: 5, sales_amount: 50, transaction_date: "2026-06-02", voucher_type: "DAMMAM W/S CREDIT" },
    { item_code: "A004301", quantity: 100, sales_amount: 1000, transaction_date: "2026-05-05", voucher_type: "RIYADH W/S CREDIT" },
    { item_code: "A004301", quantity: 50, sales_amount: -10, transaction_date: "2026-05-07", voucher_type: "DAMMAM CREDIT NOTE" },
  ]);

  const dammam = peaks.get("A004301|dammam");
  assert.equal(dammam.peakWeeklyQty, 30);
  assert.equal(dammam.peakWeekKey, "2026-05-04");
  assert.equal(peaks.get("A004301|riyadh").peakWeeklyQty, 100);
});

test("suggested transfer covers 15 days from peak weekly demand and caps at source", () => {
  // Peak week 70 → daily 10 → 15-day target 150; source only has 40.
  const capped = suggestTransferQty({
    sourceQty: 40,
    destinationQty: 0,
    peakWeeklyQty: 70,
    coverDays: 15,
  });
  assert.equal(capped.dailyDemand, 10);
  assert.equal(capped.targetCoverQty, 150);
  assert.equal(capped.suggestedQty, 40);
  assert.equal(capped.cappedBySource, true);

  const exact = suggestTransferQty({
    sourceQty: 200,
    destinationQty: 0,
    peakWeeklyQty: 70,
    coverDays: 15,
  });
  assert.equal(exact.suggestedQty, 150);
  assert.equal(exact.daysCoverAfter, 15);
  assert.equal(exact.daysCoverAfterAtDestination, 15);
  assert.equal(exact.cappedBySource, false);

  const withSourcePace = suggestTransferQty({
    sourceQty: 200,
    destinationQty: 0,
    peakWeeklyQty: 70,
    sourcePeakWeeklyQty: 35,
    coverDays: 15,
    sourceReserveDays: 30,
  });
  // Dest cover 150; source reserve ceil(35/7*30)=150; max transfer 50 → remaining 150 → source days 30
  assert.equal(withSourcePace.suggestedQty, 50);
  assert.equal(withSourcePace.daysCoverAfterAtSource, 30);
  assert.equal(withSourcePace.daysCoverAfterAtDestination, 5);

  const noSales = suggestTransferQty({
    sourceQty: 25,
    destinationQty: 0,
    peakWeeklyQty: 0,
    coverDays: 15,
  });
  assert.equal(noSales.targetCoverQty, 5);
  assert.equal(noSales.suggestedQty, 5);
  assert.equal(noSales.usedUnsoldMinimum, true);

  const noSalesShortSource = suggestTransferQty({
    sourceQty: 3,
    destinationQty: 0,
    peakWeeklyQty: 0,
    coverDays: 15,
  });
  assert.equal(noSalesShortSource.suggestedQty, 3);
  assert.equal(noSalesShortSource.cappedBySource, true);
});

test("builds both direction reports with suggested quantities", () => {
  const report = buildInterCityStockTransferReport({
    stockDate: "2026-11-08",
    now: new Date("2026-11-09T08:00:00+03:00"),
    stockRows: [
      {
        itemCode: "A004400",
        itemName: "Gloves",
        unit: "CTN",
        cities: { riyadh: { qty: 100 }, dammam: { qty: 0 }, jeddah: { qty: 0 } },
      },
      {
        itemCode: "A004401",
        itemName: "Tape",
        unit: "PCS",
        cities: { riyadh: { qty: 0 }, dammam: { qty: 50 }, jeddah: { qty: 0 } },
      },
      {
        itemCode: "A004402",
        itemName: "Plywood sheet",
        unit: "PCS",
        cities: { riyadh: { qty: 80 }, dammam: { qty: 0 }, jeddah: { qty: 0 } },
      },
      {
        itemCode: "A004403",
        itemName: "Never sold in Dammam",
        unit: "CTN",
        cities: { riyadh: { qty: 12 }, dammam: { qty: 0 }, jeddah: { qty: 0 } },
      },
      {
        itemCode: "NON FOOD DIVISION",
        itemName: "NON FOOD DIVISION",
        cities: { riyadh: { qty: 50 }, dammam: { qty: 0 }, jeddah: { qty: 0 } },
      },
    ],
    saleRows: [
      // Window for now=2026-11-09 is 2026-10-06 → 2026-11-09 (35 days).
      // Dammam peak week for A004400: 35 → daily 5 → 15-day target 75
      { item_code: "A004400", quantity: 20, sales_amount: 200, transaction_date: "2026-10-19", voucher_type: "DAMMAM W/S CREDIT", category: "Personal Care" },
      { item_code: "A004400", quantity: 15, sales_amount: 150, transaction_date: "2026-10-21", voucher_type: "DAMMAM W/S CREDIT", category: "Personal Care" },
      { item_code: "A004400", quantity: 4, sales_amount: 40, transaction_date: "2026-10-28", voucher_type: "DAMMAM W/S CREDIT", category: "Personal Care" },
      // Outside the 35-day window: must be ignored (would otherwise raise the peak to 200)
      { item_code: "A004400", quantity: 200, sales_amount: 2000, transaction_date: "2026-10-05", voucher_type: "DAMMAM W/S CREDIT", category: "Personal Care" },
      // Riyadh peak week for A004401: 14 → daily 2 → 15-day target 30
      { item_code: "A004401", quantity: 14, sales_amount: 140, transaction_date: "2026-10-20", voucher_type: "RIYADH CASH SALES", category: "Office supplies" },
      { item_code: "A004401", quantity: 3, sales_amount: 30, transaction_date: "2026-11-03", voucher_type: "RIYADH W/S CREDIT", category: "Office supplies" },
      // Building material sales must not create a transfer row
      { item_code: "A004402", quantity: 40, sales_amount: 400, transaction_date: "2026-10-21", voucher_type: "DAMMAM W/S CREDIT", category: "Building Material" },
    ],
  });

  assert.equal(report.stockDate, "2026-11-08");
  assert.equal(report.coverDays, 15);
  assert.equal(report.directions.riyadhToDammam.itemCount, 2);
  const gloves = report.directions.riyadhToDammam.rows.find((row) => row.itemCode === "A004400");
  const unsold = report.directions.riyadhToDammam.rows.find((row) => row.itemCode === "A004403");
  assert.equal(gloves.suggestedQty, 75);
  assert.equal(gloves.peakWeeklyQty, 35);
  assert.equal(gloves.destinationSalesQty, 39);
  assert.equal(gloves.destinationSalesQty6m, 39);
  assert.equal(gloves.sourceMonthReserveQty, 0);
  assert.equal(gloves.cappedBySourceReserve, false);
  assert.equal(gloves.blockedBySourceReserve, false);
  assert.equal(unsold.suggestedQty, 5);
  assert.equal(unsold.usedUnsoldMinimum, true);
  assert.equal(report.directions.riyadhToDammam.rows.some((row) => row.itemCode === "NON FOOD DIVISION"), false);
  assert.equal(report.directions.dammamToRiyadh.itemCount, 1);
  assert.equal(report.directions.dammamToRiyadh.rows[0].suggestedQty, 30);
  assert.equal(report.summary.riyadhToDammamSuggestedQty, 80);
  assert.equal(report.summary.dammamToRiyadhSuggestedQty, 30);
  // Warehouse stock with no Store qty also lands on Riyadh → Store.
  assert.ok(report.directions.riyadhToStore.itemCount >= 2);
  assert.equal(
    report.directions.riyadhToStore.rows.some((row) => row.itemCode === "A004400"),
    true,
  );
});

test("store-only Riyadh stock still counts as in Riyadh vs Dammam", () => {
  const { riyadhToDammam, dammamToRiyadh, riyadhToStore } = findInterCityStockImbalances([
    {
      itemCode: "A004500",
      itemName: "Shop only",
      cities: { riyadh: { qty: 0 }, dammam: { qty: 0 }, jeddah: { qty: 0 }, store: { qty: 9 } },
    },
  ]);
  assert.deepEqual(riyadhToDammam.map((row) => row.itemCode), ["A004500"]);
  assert.equal(riyadhToDammam[0].sourceQty, 9);
  assert.deepEqual(dammamToRiyadh, []);
  assert.deepEqual(riyadhToStore, []);
});

test("sales window is 35 days and the source reserve is 30 days", () => {
  assert.equal(INTER_CITY_TRANSFER_SALES_DAYS, 35);
  assert.equal(INTER_CITY_TRANSFER_SOURCE_RESERVE_DAYS, 30);
  const window = resolveInterCitySalesWindow({ now: new Date("2026-11-09T08:00:00+03:00") });
  assert.equal(window.fromDate, "2026-10-06");
  assert.equal(window.toDate, "2026-11-09");
  assert.equal(window.days, 35);
  assert.equal(window.sourceReserveDays, 30);
});

test("source keeps 30 days of its own peak weekly sales before transferring", () => {
  // Source peak 14/week → reserve ceil(14/7*30)=60; source 100 → max transferable 40.
  const capped = suggestTransferQty({
    sourceQty: 100,
    destinationQty: 0,
    peakWeeklyQty: 70,
    sourcePeakWeeklyQty: 14,
  });
  assert.equal(capped.targetCoverQty, 150);
  assert.equal(capped.sourceMonthReserveQty, 60);
  assert.equal(capped.maxTransferable, 40);
  assert.equal(capped.suggestedQty, 40);
  assert.equal(capped.remainingAtSource, 60);
  assert.equal(capped.cappedBySourceReserve, true);
  assert.equal(capped.blockedBySourceReserve, false);

  // Destination need smaller than the spare stock: no reserve cap.
  const small = suggestTransferQty({
    sourceQty: 100,
    destinationQty: 0,
    peakWeeklyQty: 14,
    sourcePeakWeeklyQty: 14,
  });
  assert.equal(small.targetCoverQty, 30);
  assert.equal(small.suggestedQty, 30);
  assert.equal(small.cappedBySourceReserve, false);

  // Source peak 28/week → reserve 120 > stock 100 → nothing may move.
  const blocked = suggestTransferQty({
    sourceQty: 100,
    destinationQty: 0,
    peakWeeklyQty: 70,
    sourcePeakWeeklyQty: 28,
  });
  assert.equal(blocked.sourceMonthReserveQty, 120);
  assert.equal(blocked.maxTransferable, 0);
  assert.equal(blocked.suggestedQty, 0);
  assert.equal(blocked.blockedBySourceReserve, true);
  assert.equal(blocked.cappedBySourceReserve, false);
});

test("report applies the source-city reserve from the source peak week", () => {
  const report = buildInterCityStockTransferReport({
    stockDate: "2026-11-08",
    now: new Date("2026-11-09T08:00:00+03:00"),
    stockRows: [
      {
        itemCode: "A004600",
        itemName: "Reserve limited",
        unit: "CTN",
        cities: { riyadh: { qty: 100 }, dammam: { qty: 0 }, jeddah: { qty: 0 } },
      },
      {
        itemCode: "A004601",
        itemName: "Reserve blocked",
        unit: "CTN",
        cities: { riyadh: { qty: 50 }, dammam: { qty: 0 }, jeddah: { qty: 0 } },
      },
    ],
    saleRows: [
      // Riyadh peak 21/week → reserve 90 → max transferable 10; Dammam peak 35 → target 75.
      { item_code: "A004600", quantity: 21, sales_amount: 210, transaction_date: "2026-10-27", voucher_type: "RIYADH W/S CREDIT", category: "Personal Care" },
      { item_code: "A004600", quantity: 35, sales_amount: 350, transaction_date: "2026-10-20", voucher_type: "DAMMAM W/S CREDIT", category: "Personal Care" },
      // Riyadh peak 70/week → reserve 300 > stock 50 → blocked.
      { item_code: "A004601", quantity: 70, sales_amount: 700, transaction_date: "2026-11-03", voucher_type: "RIYADH W/S CREDIT", category: "Personal Care" },
      { item_code: "A004601", quantity: 35, sales_amount: 350, transaction_date: "2026-11-04", voucher_type: "DAMMAM W/S CREDIT", category: "Personal Care" },
    ],
  });

  const limited = report.directions.riyadhToDammam.rows.find((row) => row.itemCode === "A004600");
  assert.equal(limited.sourcePeakWeeklyQty, 21);
  assert.equal(limited.sourceMonthReserveQty, 90);
  assert.equal(limited.maxTransferableQty, 10);
  assert.equal(limited.targetCoverQty, 75);
  assert.equal(limited.suggestedQty, 10);
  assert.equal(limited.remainingAtSource, 90);
  assert.equal(limited.cappedBySourceReserve, true);

  const blocked = report.directions.riyadhToDammam.rows.find((row) => row.itemCode === "A004601");
  assert.equal(blocked.suggestedQty, 0);
  assert.equal(blocked.blockedBySourceReserve, true);
  assert.equal(report.summary.riyadhToDammamSuggestedQty, 10);
});

test("CBM per carton multiplies suggested cartons and totals per direction", () => {
  const report = buildInterCityStockTransferReport({
    stockDate: "2026-11-08",
    now: new Date("2026-11-09T08:00:00+03:00"),
    stockRows: [
      {
        itemCode: "A004700",
        itemName: "With CBM",
        unit: "CTN",
        cities: { riyadh: { qty: 200 }, dammam: { qty: 0 }, jeddah: { qty: 0 } },
      },
      {
        itemCode: "A004701",
        itemName: "No CBM",
        unit: "CTN",
        cities: { riyadh: { qty: 200 }, dammam: { qty: 0 }, jeddah: { qty: 0 } },
      },
    ],
    saleRows: [
      { item_code: "A004700", quantity: 14, sales_amount: 140, transaction_date: "2026-10-20", voucher_type: "DAMMAM W/S CREDIT", category: "Personal Care" },
      { item_code: "A004701", quantity: 14, sales_amount: 140, transaction_date: "2026-10-20", voucher_type: "DAMMAM W/S CREDIT", category: "Personal Care" },
    ],
  });
  const withCbm = applyCbmToInterCityReport(
    applyMasterUnitsToInterCityReport(report, {}),
    { A004700: 0.125, A004799: 1 },
  );
  const rows = withCbm.directions.riyadhToDammam.rows;
  const priced = rows.find((row) => row.itemCode === "A004700");
  const unpriced = rows.find((row) => row.itemCode === "A004701");
  assert.equal(priced.suggestedQty, 30);
  assert.equal(priced.cbmPerCtn, 0.125);
  assert.equal(priced.totalCbm, 3.75);
  assert.equal(unpriced.cbmPerCtn, null);
  assert.equal(unpriced.totalCbm, null);
  assert.equal(withCbm.directions.riyadhToDammam.totalCbm, 3.75);
  assert.equal(withCbm.summary.riyadhToDammamTotalCbm, 3.75);
});

test("unsold min stays 5 cartons after master-unit conversion", () => {
  const report = buildInterCityStockTransferReport({
    stockDate: "2026-11-08",
    now: new Date("2026-11-09T08:00:00+03:00"),
    stockRows: [
      {
        itemCode: "A004800",
        itemName: "Never sold pcs",
        unit: "PCS",
        cities: { riyadh: { qty: 100 }, dammam: { qty: 0 }, jeddah: { qty: 0 } },
      },
    ],
    saleRows: [],
  });
  const converted = applyMasterUnitsToInterCityReport(report, {
    A004800: { masterUom: "CTN", baseUom: "PCS", conv: 5 },
  });
  const row = converted.directions.riyadhToDammam.rows.find((r) => r.itemCode === "A004800");
  assert.equal(row.unit, "CTN");
  assert.equal(row.suggestedQty, 5);
  assert.equal(row.usedUnsoldMinimum, true);
  assert.equal(row.targetCoverQty, 5);
});

test("negative destination qty is shown but treated as zero for suggestions", () => {
  const raw = suggestTransferQty({
    sourceQty: 50,
    destinationQty: -212,
    peakWeeklyQty: 70,
  });
  assert.equal(raw.suggestedQty, 50);
  assert.equal(raw.afterAtDestination, 50);

  const report = buildInterCityStockTransferReport({
    stockDate: "2026-11-08",
    now: new Date("2026-11-09T08:00:00+03:00"),
    stockRows: [
      {
        itemCode: "A004801",
        itemName: "Neg dest",
        unit: "CTN",
        cities: { riyadh: { qty: 80 }, dammam: { qty: -212 }, jeddah: { qty: 0 } },
      },
    ],
    saleRows: [
      {
        item_code: "A004801",
        quantity: 14,
        sales_amount: 140,
        transaction_date: "2026-10-20",
        voucher_type: "DAMMAM W/S CREDIT",
        category: "Personal Care",
      },
    ],
  });
  const converted = applyMasterUnitsToInterCityReport(report, {});
  const row = converted.directions.riyadhToDammam.rows.find((r) => r.itemCode === "A004801");
  assert.equal(row.destinationQty, -212);
  assert.equal(row.targetCoverQty, 30);
  assert.equal(row.suggestedQty, 30);
  assert.equal(row.afterAtDestination, 30);
});

test("never leaves source under 30 days cover when source has sales pace", () => {
  // Source peak 70/week → daily 10 → must keep 300; stock 320 → max transfer 20.
  // Dest needs 150, but after any send source days cover must stay ≥ 30.
  const ok = suggestTransferQty({
    sourceQty: 320,
    destinationQty: 0,
    peakWeeklyQty: 70,
    sourcePeakWeeklyQty: 70,
  });
  assert.equal(ok.sourceMonthReserveQty, 300);
  assert.equal(ok.suggestedQty, 20);
  assert.ok(ok.daysCoverAfterAtSource >= 30);

  // Already under 30 days at source (200 < 300 reserve) → send nothing.
  const under = suggestTransferQty({
    sourceQty: 200,
    destinationQty: 0,
    peakWeeklyQty: 70,
    sourcePeakWeeklyQty: 70,
  });
  assert.equal(under.suggestedQty, 0);
  assert.equal(under.blockedBySourceReserve, true);
  assert.equal(under.remainingAtSource, 200);
  assert.ok(under.daysCoverAfterAtSource < 30);

  // No source sales pace → days cover is blank (not 0).
  const noPace = suggestTransferQty({
    sourceQty: 50,
    destinationQty: 0,
    peakWeeklyQty: 70,
    sourcePeakWeeklyQty: 0,
  });
  assert.equal(noPace.suggestedQty, 50);
  assert.equal(noPace.daysCoverAfterAtSource, null);
});
