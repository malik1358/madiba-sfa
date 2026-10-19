import assert from "node:assert/strict";
import test from "node:test";
import { buildDueCollectionQueueExport } from "../app/lib/collectionQueueExport.js";

test("buildDueCollectionQueueExport includes customer summary and invoice rows for Excel matching", () => {
  const queueToday = "2026-09-02";
  const { summaryRows, invoiceRows, cashRows } = buildDueCollectionQueueExport({
    dueCustomers: [{
      customer_code: "1468",
      customer_name: "Bahr Al-Takhfid Trading Company",
      salesman_code: "SM001",
      salesman_name: "Ahmed Nabil",
      city: "Riyadh",
      area: "North",
      total_due_amount: 19315,
      outstanding_cash: 0,
      outstanding_0_30: 19315,
      outstanding_30_60: 0,
      outstanding_61_90: 0,
      outstanding_91_120: 0,
      outstanding_above_120: 0,
      max_overdue_days: 51,
      due_invoice_count: 1,
      probability_label: "High",
      invoices: [{
        ref_no: "NFD/986",
        invoice_date: "2026-07-13",
        pending_amount: 19315,
        due_date: "2026-07-13",
      }],
    }],
    notDueCustomers: [],
    queueToday,
    priorityByCode: new Map([["1468", 12]]),
    keepRow: () => true,
  });

  assert.equal(summaryRows.length, 1);
  assert.equal(summaryRows[0].Code, "1468");
  assert.equal(summaryRows[0].Party, "1468_Bahr Al-Takhfid Trading Company");
  assert.equal(summaryRows[0]["Priority #"], 12);
  assert.equal(summaryRows[0]["Due Amount"], 19315);

  assert.equal(invoiceRows.length, 1);
  assert.equal(invoiceRows[0]["Ref No"], "NFD/986");
  assert.equal(invoiceRows[0]["Pending Amount"], 19315);
  assert.equal(invoiceRows[0].Party, "1468_Bahr Al-Takhfid Trading Company");

  assert.equal(cashRows.length, 0);
});
