import assert from "node:assert/strict";
import { test } from "node:test";
import { isEodStockSectionLabel } from "../app/lib/eodStock.js";
import {
  buildInterCityStockTransferReport,
  buildPeakWeeklySalesByItemCity,
  findInterCityStockImbalances,
  interCityWeekKey,
  isInterCityExcludedItem,
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
  assert.equal(exact.cappedBySource, false);

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
      // Dammam peak week for A004400: 35 → daily 5 → 15-day target 75
      { item_code: "A004400", quantity: 20, sales_amount: 200, transaction_date: "2026-08-03", voucher_type: "DAMMAM W/S CREDIT", category: "Personal Care" },
      { item_code: "A004400", quantity: 15, sales_amount: 150, transaction_date: "2026-08-05", voucher_type: "DAMMAM W/S CREDIT", category: "Personal Care" },
      { item_code: "A004400", quantity: 4, sales_amount: 40, transaction_date: "2026-09-10", voucher_type: "DAMMAM W/S CREDIT", category: "Personal Care" },
      // Riyadh peak week for A004401: 14 → daily 2 → 15-day target 30
      { item_code: "A004401", quantity: 14, sales_amount: 140, transaction_date: "2026-07-14", voucher_type: "RIYADH CASH SALES", category: "Office supplies" },
      { item_code: "A004401", quantity: 3, sales_amount: 30, transaction_date: "2026-10-01", voucher_type: "RIYADH W/S CREDIT", category: "Office supplies" },
      // Building material sales must not create a transfer row
      { item_code: "A004402", quantity: 40, sales_amount: 400, transaction_date: "2026-08-04", voucher_type: "DAMMAM W/S CREDIT", category: "Building Material" },
    ],
  });

  assert.equal(report.stockDate, "2026-11-08");
  assert.equal(report.coverDays, 15);
  assert.equal(report.directions.riyadhToDammam.itemCount, 2);
  const gloves = report.directions.riyadhToDammam.rows.find((row) => row.itemCode === "A004400");
  const unsold = report.directions.riyadhToDammam.rows.find((row) => row.itemCode === "A004403");
  assert.equal(gloves.suggestedQty, 75);
  assert.equal(gloves.peakWeeklyQty, 35);
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
