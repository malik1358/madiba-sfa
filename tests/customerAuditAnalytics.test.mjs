import test from "node:test";
import assert from "node:assert/strict";

import { buildAnalytics } from "../app/management/customer-audit/lib/analytics.js";

function sampleTransactions() {
  return [{
    id: 1,
    transaction_date: "2026-09-01",
    sales_amount: 1000,
    quantity: 10,
    rate: 100,
    item_code: "ITM-1",
    item_name: "Item 1",
    category: "General",
    voucher_number: "V-1",
    reference: "R-1",
  }];
}

test("buildAnalytics reports receipt amount for the last 10 days", () => {
  const analytics = buildAnalytics(sampleTransactions(), {
    todayIso: "2026-09-21T09:00:00.000Z",
    receipts: [
      { receipt_date: "2026-09-21", amount: 100 },
      { receipt_date: "2026-09-12", amount: 200 },
      { receipt_date: "2026-09-11", amount: 300 },
      { receipt_date: "2026-09-25", amount: 400 },
      { receipt_date: "15/09/2026", amount: 50 },
    ],
  });

  assert.equal(analytics.receiptAmountLast10Days, 350);
  assert.equal(analytics.receiptTotal, 1050);
});
