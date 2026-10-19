import test from "node:test";
import assert from "node:assert/strict";

import {
  compareOrderLinesWithInvoiceText,
  extractQtyRateFromNumbers,
  parseInvoiceLineNumbers,
} from "../app/lib/invoiceOrderCompare.js";

const ORDER_LINES = [
  { item_code: "A004078", item_name: "BOX FILE", quantity: 5, rate: 12.5 },
  { item_code: "B001122", item_name: "PEN PACK", quantity: 10, rate: 3.25 },
];

test("compareOrderLinesWithInvoiceText detects quantity and price differences", () => {
  const pdfText = [
    "A004078 BOX FILE 5 13.00 65.00",
    "B001122 PEN PACK 10 3.25 32.50",
  ].join("\n");

  const diffs = compareOrderLinesWithInvoiceText(ORDER_LINES, pdfText);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].type, "price");
  assert.equal(diffs[0].item_code, "A004078");
});

test("compareOrderLinesWithInvoiceText detects missing invoice items", () => {
  const pdfText = "B001122 PEN PACK 10 3.25 32.50";
  const diffs = compareOrderLinesWithInvoiceText(ORDER_LINES, pdfText);

  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].type, "missing_item");
  assert.equal(diffs[0].item_code, "A004078");
});

test("parseInvoiceLineNumbers reads comma-separated values", () => {
  assert.deepEqual(parseInvoiceLineNumbers("Item 1,250.50 10 1,234.00"), [1250.5, 10, 1234]);
});

test("extractQtyRateFromNumbers prefers trailing qty/rate/total pattern", () => {
  assert.deepEqual(extractQtyRateFromNumbers([5, 13, 65], 5, 12.5), { qty: 5, rate: 13 });
});
