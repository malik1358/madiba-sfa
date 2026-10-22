import test from "node:test";
import assert from "node:assert/strict";
import { mergeCustomerHistoryState } from "../app/lib/customerHistoryReceipts.js";

test("a history response that is still waiting for receipts does not publish an open ledger", () => {
  const next = mergeCustomerHistoryState({}, {
    transactions: [{ voucher_number: "RNFD/573" }],
    receipts: [],
    receiptsPending: true,
  });

  assert.equal(next.receiptsPending, true);
  assert.deepEqual(next.receipts, []);
  assert.equal(next.receiptsSettled, false);
  assert.equal(next.transactions.length, 1);
});

test("a later receipt-less refresh does not wipe a settled receipt list", () => {
  const next = mergeCustomerHistoryState({
    receipts: [{ amount: 10 }],
    receiptsSettled: true,
  }, {
    transactions: [{ voucher_number: "NFD/845" }],
    receipts: [],
    receiptsPending: true,
  });

  assert.equal(next.receiptsPending, false);
  assert.equal(next.receiptsSettled, true);
  assert.deepEqual(next.receipts, [{ amount: 10 }]);
});

test("receipts replace the held state once the register is included", () => {
  const next = mergeCustomerHistoryState({
    receiptsPending: true,
    receiptsSettled: false,
  }, {
    transactions: [{ voucher_number: "NFD/845" }],
    receipts: [{ amount: 6415.27 }],
    receiptsPending: false,
  });

  assert.equal(next.receiptsPending, false);
  assert.equal(next.receiptsSettled, true);
  assert.equal(next.receipts[0].amount, 6415.27);
});
