import test from "node:test";
import assert from "node:assert/strict";

import { mergeSalesSnapshots } from "../app/lib/salesHistory.js";

function sale(id, importBatchId, overrides = {}) {
  return {
    id,
    import_batch_id: importBatchId,
    transaction_date: "2026-05-10",
    voucher_number: "INV-1",
    reference: "REF-1",
    customer_code: "1224",
    item_code: "ITEM-1",
    quantity: 2,
    sales_amount: 100,
    rate: 50,
    ...overrides,
  };
}

test("mergeSalesSnapshots removes the same transaction from repeated exports", () => {
  const merged = mergeSalesSnapshots([sale(1, 10), sale(2, 11)]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].import_batch_id, 11);
});

test("mergeSalesSnapshots preserves legitimate repeated lines within one export", () => {
  const merged = mergeSalesSnapshots([
    sale(1, 10),
    sale(2, 10),
    sale(3, 11),
  ]);

  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((row) => row.import_batch_id), [10, 10]);
});

test("mergeSalesSnapshots keeps distinct transactions across historical exports", () => {
  const merged = mergeSalesSnapshots([
    sale(1, 10),
    sale(2, 11, { transaction_date: "2026-06-10", voucher_number: "INV-2" }),
  ]);

  assert.equal(merged.length, 2);
});

test("mergeSalesSnapshots collapses re-imports that only change rate", () => {
  const merged = mergeSalesSnapshots([
    sale(1, 8, { rate: 106.4, sales_amount: 95.76, quantity: 24, item_code: "A003595" }),
    sale(2, 10, { rate: 3.99, sales_amount: 95.76, quantity: 24, item_code: "A003595" }),
    sale(3, 10, {
      rate: 2.72,
      sales_amount: 97.78,
      quantity: 36,
      item_code: "A003606",
    }),
  ]);

  assert.equal(merged.length, 2);
  assert.equal(merged.find((row) => row.item_code === "A003595")?.import_batch_id, 10);
  assert.equal(merged.find((row) => row.item_code === "A003595")?.rate, 3.99);
  assert.equal(
    merged.reduce((total, row) => total + Number(row.sales_amount || 0), 0),
    95.76 + 97.78,
  );
});