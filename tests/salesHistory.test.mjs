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