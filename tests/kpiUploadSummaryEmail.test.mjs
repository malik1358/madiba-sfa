import test from "node:test";
import assert from "node:assert/strict";
import {
  KPI_UPLOAD_SUMMARY_DEBOUNCE_MS,
  buildKpiUploadSummaryEmail,
  buildKpiUploadSummaryTable,
  isKpiUploadSummaryDue,
  kpiUploadSummarySignature,
  mergeKpiUploadSummaryPending,
  nextKpiUploadSummarySendAfter,
  resolveKpiUploadSummaryEmailRecipients,
} from "../app/lib/kpiUploadSummaryEmail.js";
import { runKpiUploadSummaryEmailCycle } from "../app/lib/kpiUploadSummaryEmailServer.js";

const ahmed = {
  salesmanCode: "AHMED",
  salesmanName: "Ahmed",
  isTeam: false,
  officeSupplies: "100000",
  localItemSales: "50000",
  otherSales: "50000",
  totalSales: "200000",
  collection: "300000",
  paceShares: null,
  salesAsOfDate: "2026-10-15",
  receiptAsOfDate: "2026-10-14",
  kpis: [
    { key: "officeSupplies", actual: 100_000 },
    { key: "localItemSales", actual: 50_000 },
    { key: "otherSales", actual: 50_000 },
    { key: "totalSales", actual: 200_000 },
    { key: "collection", actual: 300_000 },
    { key: "cashCollection", actual: 0 },
    { key: "totalCashCollected", actual: 300_000 },
    { key: "newCustomers", actual: 0 },
    { key: "repeatCustomers", actual: 0 },
  ],
};

test("debounce pending merges triggers and resets sendAfter", () => {
  const first = mergeKpiUploadSummaryPending({}, {
    trigger: "sales-upload",
    now: new Date("2026-10-29T10:00:00.000Z"),
    debounceMs: 18 * 60 * 1000,
  });
  assert.equal(first.pending, true);
  assert.deepEqual(first.triggers, ["sales-upload"]);
  assert.equal(first.sendAfter, "2026-10-29T10:18:00.000Z");

  const second = mergeKpiUploadSummaryPending(first, {
    trigger: "receipt-upload",
    now: new Date("2026-10-29T10:05:00.000Z"),
    debounceMs: 18 * 60 * 1000,
  });
  assert.deepEqual(second.triggers, ["sales-upload", "receipt-upload"]);
  assert.equal(second.sendAfter, "2026-10-29T10:23:00.000Z");
  assert.equal(isKpiUploadSummaryDue(second, new Date("2026-10-29T10:22:00.000Z")), false);
  assert.equal(isKpiUploadSummaryDue(second, new Date("2026-10-29T10:23:00.000Z")), true);
});

test("next sendAfter uses 18 minute default", () => {
  assert.equal(KPI_UPLOAD_SUMMARY_DEBOUNCE_MS, 18 * 60 * 1000);
  assert.equal(
    nextKpiUploadSummarySendAfter(new Date("2026-10-29T12:00:00.000Z")),
    "2026-10-29T12:18:00.000Z",
  );
});

test("summary table transposes footer rows into columns for total sales and collection", () => {
  const summary = buildKpiUploadSummaryTable({
    rows: [ahmed],
    reportDate: "2026-10-01",
    todayIso: "2026-10-20",
    salesAsOfDate: "2026-10-15",
    receiptAsOfDate: "2026-10-14",
    priorMonth: "2026-09",
    priorMonthActualsByCode: {
      AHMED: {
        totalSales: 250_000,
        collection: 200_000,
        officeSupplies: 0,
        localItemSales: 0,
        otherSales: 0,
        cashCollection: 0,
      },
    },
  });

  assert.equal(summary.salesmanCount, 1);
  assert.equal(summary.columns.length, 3);
  assert.deepEqual(summary.columns.map((col) => col.key), [
    "totalFiltered",
    "paceEstimate",
    "vsLastMonth",
  ]);
  assert.equal(summary.rows.length, 2);
  assert.equal(summary.rows[0].key, "totalSales");
  assert.equal(summary.rows[0].label, "Total sales");
  assert.equal(summary.rows[0].totalFiltered.actual, 200_000);
  assert.equal(summary.rows[0].totalFiltered.target, 200_000);
  assert.ok(summary.rows[0].paceEstimate.estimate != null);
  assert.ok(summary.rows[0].vsLastMonth);
  assert.equal(summary.rows[1].key, "collection");
  assert.equal(summary.rows[1].totalFiltered.actual, 300_000);
});

test("email HTML uses transposed header labels", () => {
  const summary = buildKpiUploadSummaryTable({
    rows: [ahmed],
    reportDate: "2026-10-01",
    todayIso: "2026-10-20",
    salesAsOfDate: "2026-10-15",
    receiptAsOfDate: "2026-10-14",
    priorMonth: "2026-09",
    priorMonthActualsByCode: {
      AHMED: { totalSales: 180_000, collection: 250_000 },
    },
  });
  const message = buildKpiUploadSummaryEmail({
    summary,
    triggers: ["sales-upload", "receipt-upload"],
    env: { NEXT_PUBLIC_APP_ORIGIN: "https://madiba-sfa.vercel.app" },
  });
  assert.match(message.subject, /KPI Targets summary/);
  assert.match(message.html, /Total \(filtered\)/);
  assert.match(message.html, /Estimate at current pace/);
  assert.match(message.html, /vs last month/);
  assert.match(message.html, /Total sales/);
  assert.match(message.html, /Collection/);
  assert.match(message.html, /#0f4c5c/);
  assert.match(message.text, /Uploads: sales-upload, receipt-upload|sales-upload/);
});

test("recipients default to malik and accept overrides", () => {
  assert.deepEqual(resolveKpiUploadSummaryEmailRecipients({}), ["malik@pinasz.com"]);
  assert.deepEqual(
    resolveKpiUploadSummaryEmailRecipients({ KPI_UPLOAD_SUMMARY_EMAIL_TO: "a@x.com,b@y.com" }),
    ["malik@pinasz.com", "a@x.com", "b@y.com"],
  );
  assert.deepEqual(
    resolveKpiUploadSummaryEmailRecipients({ KPI_UPLOAD_SUMMARY_EMAIL_TEST_TO: "test@x.com" }),
    ["test@x.com"],
  );
});

test("run cycle waits for debounce then sends once", async () => {
  const pending = mergeKpiUploadSummaryPending({}, {
    trigger: "sales-upload",
    now: new Date("2026-10-29T10:00:00.000Z"),
  });
  let savedPending = pending;
  let lastSent = {};
  const sent = [];
  const summary = buildKpiUploadSummaryTable({
    rows: [ahmed],
    reportDate: "2026-10-01",
    todayIso: "2026-10-20",
    salesAsOfDate: "2026-10-15",
    receiptAsOfDate: "2026-10-14",
    priorMonth: "2026-09",
    priorMonthActualsByCode: { AHMED: { totalSales: 100_000, collection: 100_000 } },
  });

  const early = await runKpiUploadSummaryEmailCycle({}, {
    now: new Date("2026-10-29T10:10:00.000Z"),
    env: {
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_USER: "u",
      SMTP_PASS: "p",
      SMTP_FROM: "from@example.com",
    },
    loadPending: async () => savedPending,
    savePending: async (_admin, value) => { savedPending = value; },
    clearPending: async () => { savedPending = { pending: false }; },
    loadLastSent: async () => lastSent,
    saveLastSent: async (_admin, value) => { lastSent = value; },
    loadPayload: async () => ({ summary }),
    send: async (message) => { sent.push(message); },
  });
  assert.equal(early.skipped, true);
  assert.equal(early.reason, "debounce_wait");
  assert.equal(sent.length, 0);

  const due = await runKpiUploadSummaryEmailCycle({}, {
    now: new Date("2026-10-29T10:18:00.000Z"),
    env: {
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_USER: "u",
      SMTP_PASS: "p",
      SMTP_FROM: "from@example.com",
    },
    loadPending: async () => savedPending,
    savePending: async (_admin, value) => { savedPending = value; },
    clearPending: async () => { savedPending = { pending: false }; },
    loadLastSent: async () => lastSent,
    saveLastSent: async (_admin, value) => { lastSent = value; },
    loadPayload: async () => ({ summary }),
    send: async (message) => { sent.push(message); },
  });
  assert.equal(due.skipped, false);
  assert.equal(due.sentCount, 1);
  assert.equal(sent.length, 1);
  assert.equal(savedPending.pending, false);
  assert.equal(lastSent.signature, kpiUploadSummarySignature(summary));

  savedPending = mergeKpiUploadSummaryPending({}, {
    trigger: "receipt-upload",
    now: new Date("2026-10-29T11:00:00.000Z"),
  });
  const unchanged = await runKpiUploadSummaryEmailCycle({}, {
    now: new Date("2026-10-29T11:18:00.000Z"),
    env: {
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_USER: "u",
      SMTP_PASS: "p",
      SMTP_FROM: "from@example.com",
    },
    loadPending: async () => savedPending,
    savePending: async (_admin, value) => { savedPending = value; },
    clearPending: async () => { savedPending = { pending: false }; },
    loadLastSent: async () => lastSent,
    saveLastSent: async (_admin, value) => { lastSent = value; },
    loadPayload: async () => ({ summary }),
    send: async (message) => { sent.push(message); },
  });
  assert.equal(unchanged.skipped, true);
  assert.equal(unchanged.reason, "unchanged");
  assert.equal(sent.length, 1);
});
