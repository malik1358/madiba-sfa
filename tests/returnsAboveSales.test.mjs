import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReturnsAboveSalesReport,
  isReturnsAboveSalesReturn,
  missingReferencedVoucherNumbers,
  pickMissingReferencedSales,
} from "../app/lib/returnsAboveSales.js";

test("return value above sales keeps both voucher lists", () => {
  const report = buildReturnsAboveSalesReport([
    {
      transaction_date: "2026-01-10",
      voucher_number: "100",
      voucher_type: "Sales",
      reference: "INV/1",
      customer_code: "1258c",
      customer_name: "Sheem",
      item_code: "a003291",
      item_name: "Chest freezer",
      quantity: 1,
      sales_amount: 1050,
    },
    {
      transaction_date: "2026-02-12",
      voucher_number: "44",
      voucher_type: "Credit Note",
      reference: "NFD/105",
      customer_code: "1258C",
      customer_name: "Sheem Al Majd Trading Company",
      item_code: "A003291",
      item_name: "DO NOT USE",
      quantity: -80,
      sales_amount: -84000,
    },
    {
      voucher_number: "Total",
      customer_code: null,
      quantity: 999999,
      sales_amount: 999999,
    },
  ]);

  assert.equal(report.rows.length, 1);
  const row = report.rows[0];
  assert.equal(row.customerCode, "1258C");
  assert.equal(row.customerName, "Sheem Al Majd Trading Company");
  assert.equal(row.itemCode, "A003291");
  assert.equal(row.itemName, "Chest freezer");
  assert.equal(row.salesAmount, 1050);
  assert.equal(row.returnAmount, 84000);
  assert.equal(row.excessAmount, 82950);
  assert.equal(row.salesQuantity, 1);
  assert.equal(row.returnQuantity, 80);
  assert.equal(row.salesVouchers, "100 · 2026-01-10 · INV/1");
  assert.equal(row.returnVouchers, "44 · 2026-02-12 · NFD/105");
  assert.equal(report.summary.customerCount, 1);
  assert.equal(report.summary.excessAmount, 82950);
  assert.equal(report.span.firstDate, "2026-01-10");
  assert.equal(report.span.lastDate, "2026-02-12");
});

test("same voucher is listed once and a reference that mentions CN stays a sale", () => {
  assert.equal(isReturnsAboveSalesReturn({
    voucher_type: "Sales",
    voucher_number: "88",
    reference: "against CN 12",
    quantity: 2,
    sales_amount: 40,
  }), false);

  const report = buildReturnsAboveSalesReport([
    {
      transaction_date: "2026-03-01",
      voucher_number: "88",
      voucher_type: "Sales",
      reference: "against CN 12",
      customer_code: "1198",
      customer_name: "Najd",
      item_code: "A1",
      item_name: "Pen",
      quantity: 2,
      sales_amount: 40,
    },
    {
      transaction_date: "2026-03-01",
      voucher_number: "88",
      voucher_type: "Sales",
      reference: "against CN 12",
      customer_code: "1198",
      customer_name: "Najd",
      item_code: "A1",
      item_name: "Pen",
      quantity: 1,
      sales_amount: 20,
    },
    {
      transaction_date: "2026-03-02",
      voucher_number: "9",
      voucher_type: "Credit Note",
      customer_code: "1198",
      customer_name: "Najd",
      item_code: "A1",
      item_name: "Pen",
      quantity: -4,
      sales_amount: -80,
    },
  ]);

  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].salesAmount, 60);
  assert.equal(report.rows[0].returnAmount, 80);
  assert.equal(report.rows[0].salesVouchers, "88 · 2026-03-01 · against CN 12");
  assert.equal(report.rows[0].returnVouchers, "9 · 2026-03-02");
});

test("quantity gap with matching value is left out", () => {
  const report = buildReturnsAboveSalesReport([
    {
      transaction_date: "2026-04-01",
      voucher_number: "1",
      voucher_type: "Sales",
      customer_code: "1071C",
      customer_name: "Art Mart",
      item_code: "NB",
      item_name: "Notebook",
      quantity: 10,
      sales_amount: 100,
    },
    {
      transaction_date: "2026-04-02",
      voucher_number: "2",
      voucher_type: "Credit Note",
      customer_code: "1071C",
      customer_name: "Art Mart",
      item_code: "NB",
      item_name: "Notebook",
      quantity: -1000,
      sales_amount: -100,
    },
  ]);
  assert.equal(report.rows.length, 0);
});

test("a credit note reference pulls the missing sales invoice from another batch", () => {
  const activeRows = [
    {
      transaction_date: "2026-01-26",
      voucher_number: "2772",
      voucher_type: "Sales",
      customer_code: "1258C",
      customer_name: "Sheem Al Majd Trading Company",
      item_code: "A004030",
      item_name: "MADIBA SMART TV 50\"",
      quantity: 3,
      sales_amount: 1764,
    },
    {
      transaction_date: "2026-02-12",
      voucher_number: "44",
      voucher_type: "Credit Note",
      reference: "NFD/105",
      customer_code: "1258C",
      customer_name: "Sheem Al Majd Trading Company",
      item_code: "A004030",
      item_name: "MADIBA SMART TV 50\"",
      quantity: -148,
      sales_amount: -87024,
    },
    {
      transaction_date: "2026-03-11",
      voucher_number: "93",
      voucher_type: "Credit Note",
      reference: "NFD/107",
      customer_code: "1258C",
      customer_name: "Sheem Al Majd Trading Company",
      item_code: "A004030",
      item_name: "MADIBA SMART TV 50\"",
      quantity: -4,
      sales_amount: -2352,
    },
  ];
  const historyRows = [
    {
      import_batch_id: 64,
      transaction_date: "2026-02-12",
      voucher_number: "NFD/105",
      voucher_type: "SALES-NON FOOD DIVISION",
      customer_code: "1258C",
      item_code: "A004030",
      item_name: "MADIBA SMART TV 50\"",
      quantity: 148,
      sales_amount: 87024,
    },
    {
      import_batch_id: 116,
      transaction_date: "2026-02-12",
      voucher_number: "NFD/105",
      voucher_type: "SALES-NON FOOD DIVISION",
      customer_code: "1258C",
      item_code: "A004030",
      item_name: "MADIBA SMART TV 50\"",
      quantity: 148,
      sales_amount: 87024,
    },
    {
      import_batch_id: 116,
      transaction_date: "2026-02-12",
      voucher_number: "NFD/107",
      voucher_type: "SALES-NON FOOD DIVISION",
      customer_code: "1258C",
      item_code: "A004030",
      item_name: "MADIBA SMART TV 50\"",
      quantity: 148,
      sales_amount: 87024,
    },
    {
      import_batch_id: 116,
      transaction_date: "2026-02-12",
      voucher_number: "NFD/107",
      voucher_type: "SALES-NON FOOD DIVISION",
      customer_code: "9999C",
      item_code: "A004030",
      quantity: 10,
      sales_amount: 5000,
    },
  ];

  assert.deepEqual(missingReferencedVoucherNumbers(activeRows).sort(), ["NFD/105", "NFD/107"]);
  const extra = pickMissingReferencedSales(activeRows, historyRows);
  assert.equal(extra.length, 2);
  const report = buildReturnsAboveSalesReport([...activeRows, ...extra]);
  assert.equal(report.rows.length, 0);
  const withActiveOnly = buildReturnsAboveSalesReport(activeRows);
  assert.equal(withActiveOnly.rows.length, 1);
  assert.equal(withActiveOnly.rows[0].salesAmount, 1764);
  assert.equal(withActiveOnly.rows[0].returnAmount, 89376);
});

test("debit note sales stay on the sales side", () => {
  assert.equal(isReturnsAboveSalesReturn({
    voucher_type: "Debit Note Sales",
    quantity: 1,
    sales_amount: 50,
  }), false);
});
