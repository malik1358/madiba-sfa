import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCustomerGrowthHolds,
  customerAuditHrefFromGrowthRow,
  customerHasOverSixtyOutstanding,
  isHeldCustomerGrowthRow,
  parseGrowthCustomerLabel,
} from "../app/lib/customerGrowthHold.js";

test("held customer rows hide legal transfers and 60+ day outstanding", () => {
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

  const report = applyCustomerGrowthHolds({
    filters: { groupBy: "customer" },
    groups: [
      { label: "Sheem Al Majd Trading Company · 12558C", status: "red" },
      { label: "Active Shop · 10A", status: "green" },
    ],
    alerts: [
      { title: "Sheem Al Majd Trading Company · 12558C" },
    ],
    meta: { groupBy: "customer" },
  }, {
    legalTransfers: [{ customer_code: "12558C", is_transferred: true }],
  });

  assert.equal(report.groups.length, 1);
  assert.equal(report.groups[0].label, "Active Shop · 10A");
  assert.equal(report.alerts.length, 0);
  assert.equal(report.meta.decliningCount, 0);
  assert.equal(report.meta.heldCustomersHidden, 1);
});
