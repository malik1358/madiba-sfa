import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCustomerGrowthHolds,
  customerAuditHrefFromGrowthRow,
  customerHasOverSixtyOutstanding,
  isHeldCustomerGrowthRow,
  parseGrowthCustomerLabel,
} from "../app/lib/customerGrowthHold.js";

test("growth helpers parse labels and detect holds without hiding BI history", () => {
  assert.equal(
    customerAuditHrefFromGrowthRow({ label: "Sheem Al Majd Trading Company · 12558C" }),
    "/management/customer-audit?customer_code=12558C",
  );
  assert.deepEqual(parseGrowthCustomerLabel("Sheem Al Majd Trading Company · 12558C"), {
    customer_name: "Sheem Al Majd Trading Company",
    customer_code: "12558C",
  });
  assert.equal(customerHasOverSixtyOutstanding({ outstanding_61_90: 120 }), true);
  assert.equal(customerHasOverSixtyOutstanding({ outstanding_30_60: 500 }), false);

  const legalRow = { label: "Sheem Al Majd Trading Company · 12558C" };
  assert.equal(isHeldCustomerGrowthRow(legalRow, {
    legalTransfers: [{ customer_code: "12558C", is_transferred: true }],
  }), true);

  const overdueRow = { label: "Old Debtor · 99X" };
  assert.equal(isHeldCustomerGrowthRow(overdueRow, {
    outstandingDataset: {
      rows: [{ customer_code: "99X", customer_name: "Old Debtor", outstanding_61_90: 800 }],
    },
  }), true);

  const source = {
    filters: { groupBy: "customer" },
    groups: [
      { label: "Sheem Al Majd Trading Company · 12558C", status: "red" },
      { label: "Active Shop · 10A", status: "green" },
    ],
    alerts: [
      { title: "Sheem Al Majd Trading Company · 12558C" },
    ],
    meta: { groupBy: "customer" },
  };
  const report = applyCustomerGrowthHolds(source, {
    legalTransfers: [{ customer_code: "12558C", is_transferred: true }],
  });

  // BI history stays complete — overdue/legal customers are not removed.
  assert.equal(report.groups.length, 2);
  assert.equal(report, source);
});
