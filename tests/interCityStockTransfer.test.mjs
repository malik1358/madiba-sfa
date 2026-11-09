import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildInterCityStockTransferReport,
  buildPeakWeeklySalesByItemCity,
  findInterCityStockImbalances,
  interCityWeekKey,
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

test("finds stock available in one city and not the other", () => {
  const { riyadhToDammam, dammamToRiyadh } = findInterCityStockImbalances([
    {
      itemCode: "A1",
      itemName: "Only Riyadh",
      unit: "PCS",
      cities: { riyadh: { qty: 40 }, dammam: { qty: 0 }, jeddah: { qty: 5 } },
    },
    {
      itemCode: "A2",
      itemName: "Only Dammam",
      cities: { riyadh: { qty: 0 }, dammam: { qty: 12 }, jeddah: { qty: 0 } },
    },
    {
      itemCode: "A3",
      itemName: "Both",
      cities: { riyadh: { qty: 8 }, dammam: { qty: 3 }, jeddah: { qty: 0 } },
    },
  ]);

  assert.deepEqual(riyadhToDammam.map((row) => row.itemCode), ["A1"]);
  assert.deepEqual(dammamToRiyadh.map((row) => row.itemCode), ["A2"]);
  assert.equal(riyadhToDammam[0].sourceQty, 40);
  assert.equal(riyadhToDammam[0].destinationQty, 0);
});

test("peak weekly sales uses the highest week for the destination city", () => {
  const peaks = buildPeakWeeklySalesByItemCity([
    { item_code: "A1", quantity: 10, sales_amount: 100, transaction_date: "2026-05-05", voucher_type: "DAMMAM W/S CREDIT" },
    { item_code: "A1", quantity: 20, sales_amount: 200, transaction_date: "2026-05-06", voucher_type: "DAMMAM W/S CREDIT" },
    { item_code: "A1", quantity: 5, sales_amount: 50, transaction_date: "2026-06-02", voucher_type: "DAMMAM W/S CREDIT" },
    { item_code: "A1", quantity: 100, sales_amount: 1000, transaction_date: "2026-05-05", voucher_type: "RIYADH W/S CREDIT" },
    { item_code: "A1", quantity: 50, sales_amount: -10, transaction_date: "2026-05-07", voucher_type: "DAMMAM CREDIT NOTE" },
  ]);

  const dammam = peaks.get("A1|dammam");
  assert.equal(dammam.peakWeeklyQty, 30);
  assert.equal(dammam.peakWeekKey, "2026-05-04");
  assert.equal(peaks.get("A1|riyadh").peakWeeklyQty, 100);
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
  assert.equal(noSales.suggestedQty, 0);
  assert.equal(noSales.targetCoverQty, 0);
});

test("builds both direction reports with suggested quantities", () => {
  const report = buildInterCityStockTransferReport({
    stockDate: "2026-11-08",
    now: new Date("2026-11-09T08:00:00+03:00"),
    stockRows: [
      {
        itemCode: "LP1",
        itemName: "Gloves",
        unit: "CTN",
        cities: { riyadh: { qty: 100 }, dammam: { qty: 0 }, jeddah: { qty: 0 } },
      },
      {
        itemCode: "LP2",
        itemName: "Tape",
        unit: "PCS",
        cities: { riyadh: { qty: 0 }, dammam: { qty: 50 }, jeddah: { qty: 0 } },
      },
    ],
    saleRows: [
      // Dammam peak week for LP1: 35 → daily 5 → 15-day target 75
      { item_code: "LP1", quantity: 20, sales_amount: 200, transaction_date: "2026-08-03", voucher_type: "DAMMAM W/S CREDIT" },
      { item_code: "LP1", quantity: 15, sales_amount: 150, transaction_date: "2026-08-05", voucher_type: "DAMMAM W/S CREDIT" },
      { item_code: "LP1", quantity: 4, sales_amount: 40, transaction_date: "2026-09-10", voucher_type: "DAMMAM W/S CREDIT" },
      // Riyadh peak week for LP2: 14 → daily 2 → 15-day target 30
      { item_code: "LP2", quantity: 14, sales_amount: 140, transaction_date: "2026-07-14", voucher_type: "RIYADH CASH SALES" },
      { item_code: "LP2", quantity: 3, sales_amount: 30, transaction_date: "2026-10-01", voucher_type: "RIYADH W/S CREDIT" },
    ],
  });

  assert.equal(report.stockDate, "2026-11-08");
  assert.equal(report.coverDays, 15);
  assert.equal(report.directions.riyadhToDammam.itemCount, 1);
  assert.equal(report.directions.riyadhToDammam.rows[0].suggestedQty, 75);
  assert.equal(report.directions.riyadhToDammam.rows[0].peakWeeklyQty, 35);
  assert.equal(report.directions.dammamToRiyadh.itemCount, 1);
  assert.equal(report.directions.dammamToRiyadh.rows[0].suggestedQty, 30);
  assert.equal(report.summary.riyadhToDammamSuggestedQty, 75);
  assert.equal(report.summary.dammamToRiyadhSuggestedQty, 30);
});
