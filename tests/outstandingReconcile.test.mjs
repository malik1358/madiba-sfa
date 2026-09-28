import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOutstandingReconcileRow,
  normalizeOutstandingReconcileDataset,
  sortOutstandingReconcileRows,
  summarizeOutstandingReconcileRows,
} from "../app/lib/outstandingReconcile.js";
import { buildOutstandingReconcileEmail } from "../app/lib/outstandingReconcileEmail.js";
import { outstandingReconcileSignature, runOutstandingReconcileCycle } from "../app/lib/outstandingReconcileEmailServer.js";

const EMAIL_ENV = {
  SMTP_HOST: "smtp.example.com",
  SMTP_FROM: "reports@example.com",
  OUTSTANDING_RECONCILE_EMAIL_TO: "ops@example.com",
};

test("buildOutstandingReconcileRow flags SFA vs Tally customer differences", () => {
  const differs = buildOutstandingReconcileRow({
    customer: { customer_code: " c01 ", customer_name: "Alpha", salesman_name: "AHMED" },
    totals: { computed_open: 1150, discrepancy_count: 0 },
    tallyOutstanding: 1000,
  });
  assert.equal(differs.customer_code, "C01");
  assert.equal(differs.difference, 150);
  assert.equal(differs.has_difference, true);

  const withinTolerance = buildOutstandingReconcileRow({
    customer: { customer_code: "C02" },
    totals: { computed_open: 500.01, discrepancy_count: 0 },
    tallyOutstanding: 500,
  });
  assert.equal(withinTolerance.has_difference, false);

  // Invoice-level gaps that net to zero at customer level still count as a difference.
  const nettedGaps = buildOutstandingReconcileRow({
    customer: { customer_code: "C03" },
    totals: { computed_open: 500, discrepancy_count: 2 },
    tallyOutstanding: 500,
  });
  assert.equal(nettedGaps.has_difference, true);
});

test("summarize and sort rank rows by absolute difference", () => {
  const rows = sortOutstandingReconcileRows([
    { customer_code: "A", difference: -40, tally_outstanding: 100, sfa_outstanding: 60, invoice_gap_count: 1 },
    { customer_code: "B", difference: 90, tally_outstanding: 10, sfa_outstanding: 100, invoice_gap_count: 2 },
  ]);
  assert.deepEqual(rows.map((row) => row.customer_code), ["B", "A"]);

  const summary = summarizeOutstandingReconcileRows(rows);
  assert.equal(summary.customer_count, 2);
  assert.equal(summary.difference, 50);
  assert.equal(summary.sfa_higher, 90);
  assert.equal(summary.sfa_lower, -40);
  assert.equal(summary.invoice_gap_count, 3);
});

test("normalizeOutstandingReconcileDataset repairs a stored payload", () => {
  const dataset = normalizeOutstandingReconcileDataset({
    builtAt: "2026-09-28T06:00:00.000Z",
    rows: [{ customer_code: "c9", difference: "12.5", sfa_outstanding: "112.5", tally_outstanding: "100" }],
  });
  assert.equal(dataset.rows[0].customer_code, "C9");
  assert.equal(dataset.rows[0].difference, 12.5);
  assert.equal(dataset.summary.customer_count, 1);

  assert.equal(normalizeOutstandingReconcileDataset(null).rows.length, 0);
});

test("email lists only difference rows and links each customer to settlement", () => {
  const message = buildOutstandingReconcileEmail({
    rows: [
      { customer_code: "C01", customer_name: "Alpha", difference: 150, tally_outstanding: 1000, sfa_outstanding: 1150, invoice_gap_count: 1 },
    ],
    summary: summarizeOutstandingReconcileRows([{ difference: 150, tally_outstanding: 1000, sfa_outstanding: 1150, invoice_gap_count: 1 }]),
    builtAt: "2026-09-28T06:00:00.000Z",
    env: {},
  });

  assert.match(message.subject, /1 customer\(s\) differ/);
  assert.match(message.html, /payment-settlement\?customer_code=C01#invoices-settlement/);
  assert.match(message.html, /Alpha/);
  assert.equal(message.rowCount, 1);
});

test("cycle emails differences once and skips an unchanged rebuild", async () => {
  const rows = [{ customer_code: "C01", difference: 150, invoice_gap_count: 0 }];
  const dataset = { builtAt: "2026-09-28T06:00:00.000Z", rows, summary: {}, scannedCount: 3, failedCount: 0 };
  const sent = [];
  let marker = {};

  const options = {
    env: EMAIL_ENV,
    rebuild: async () => dataset,
    send: async (message) => { sent.push(message); },
    loadMarker: async () => marker,
    saveMarker: async (_admin, next) => { marker = next; },
  };

  const first = await runOutstandingReconcileCycle({}, { ...options, trigger: "receipt-upload" });
  assert.equal(first.sentCount, 1);
  assert.equal(first.differenceCount, 1);
  assert.ok(sent[0].to.includes("ops@example.com"));

  const second = await runOutstandingReconcileCycle({}, { ...options, trigger: "receipt-upload" });
  assert.equal(second.sentCount, 0);
  assert.equal(second.reason, "unchanged");
  assert.equal(sent.length, 1);

  const changed = await runOutstandingReconcileCycle({}, {
    ...options,
    rebuild: async () => ({ ...dataset, rows: [{ customer_code: "C01", difference: 200, invoice_gap_count: 0 }] }),
  });
  assert.equal(changed.sentCount, 1);
});

test("cycle does not email when there are no differences", async () => {
  const sent = [];
  const result = await runOutstandingReconcileCycle({}, {
    env: EMAIL_ENV,
    rebuild: async () => ({ builtAt: "", rows: [], summary: {} }),
    send: async (message) => { sent.push(message); },
    loadMarker: async () => ({}),
    saveMarker: async () => {},
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "no_differences");
  assert.equal(sent.length, 0);
});

test("signature ignores row order", () => {
  const left = outstandingReconcileSignature([
    { customer_code: "A", difference: 1, invoice_gap_count: 0 },
    { customer_code: "B", difference: 2, invoice_gap_count: 1 },
  ]);
  const right = outstandingReconcileSignature([
    { customer_code: "B", difference: 2, invoice_gap_count: 1 },
    { customer_code: "A", difference: 1, invoice_gap_count: 0 },
  ]);
  assert.equal(left, right);
});
