import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCollectionStaleOverdueEmail,
  filterCollectionStaleOverdueRows,
  groupCollectionStaleOverdueBySalesman,
  isCollectionStaleOverdueRow,
  resolveCollectionStaleOverdueDigestRecipients,
} from "../app/lib/collectionStaleOverdueEmail.js";
import {
  resolveCollectionStaleOverdueEmailSchedule,
  resolveCollectionStaleOverdueRouteTrigger,
  runCollectionStaleOverdueEmailCycle,
} from "../app/lib/collectionStaleOverdueEmailServer.js";

test("isCollectionStaleOverdueRow requires over-60, zero receipts, and stale visit", () => {
  const todayKey = "2026-09-26";
  const match = {
    outstanding_61_90: 1000,
    outstanding_91_120: 0,
    outstanding_above_120: 0,
    received_last_10_days: 0,
    latest_collection: { saved_at: "2026-09-10T10:00:00Z" },
  };
  assert.equal(isCollectionStaleOverdueRow(match, { todayKey }), true);

  assert.equal(isCollectionStaleOverdueRow({
    ...match,
    outstanding_61_90: 0,
  }, { todayKey }), false);

  assert.equal(isCollectionStaleOverdueRow({
    ...match,
    received_last_10_days: 50,
  }, { todayKey }), false);

  assert.equal(isCollectionStaleOverdueRow({
    ...match,
    latest_collection: { saved_at: "2026-09-20T10:00:00Z" },
  }, { todayKey }), false);

  assert.equal(isCollectionStaleOverdueRow({
    ...match,
    latest_collection: null,
  }, { todayKey }), true);
});

test("groupCollectionStaleOverdueBySalesman builds separate salesman buckets", () => {
  const groups = groupCollectionStaleOverdueBySalesman([
    {
      customer_code: "C1",
      customer_name: "Shop One",
      salesman_name: "Parvez",
      salesman_code: "S01",
      outstanding_61_90: 2000,
      total_due_amount: 2000,
      received_last_10_days: 0,
    },
    {
      customer_code: "C2",
      customer_name: "Shop Two",
      salesman_name: "Sara",
      salesman_code: "S02",
      outstanding_above_120: 500,
      total_due_amount: 500,
      received_last_10_days: 0,
    },
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].salesmanName.includes("Parvez") || groups[1].salesmanName.includes("Parvez"), true);
  assert.equal(groups.reduce((sum, group) => sum + group.rows.length, 0), 2);
});

test("buildCollectionStaleOverdueEmail renders one table section per salesman", () => {
  const message = buildCollectionStaleOverdueEmail({
    date: "2026-09-26",
    reportUrl: "https://madiba-sfa.vercel.app/management/payment-collections",
    groups: [
      {
        salesmanName: "Parvez (S01)",
        rows: [{
          customer_code: "C1",
          customer_name: "Shop One",
          city: "Riyadh",
          area: "Olaya",
          salesman_name: "Parvez",
          total_due_amount: 12500,
          outstanding_61_90: 12500,
          max_overdue_days: 75,
          received_last_10_days: 0,
          latest_collection: { saved_at: "2026-09-01T08:00:00Z", visit_outcome: "ASKED_COME_LATER" },
        }],
      },
      {
        salesmanName: "Sara (S02)",
        rows: [{
          customer_code: "C2",
          customer_name: "Shop Two",
          city: "Jeddah",
          area: "Balad",
          salesman_name: "Sara",
          total_due_amount: 800,
          outstanding_above_120: 800,
          max_overdue_days: 140,
          received_last_10_days: 0,
          latest_collection: null,
        }],
      },
    ],
  });

  assert.match(message.subject, /2 customers/);
  assert.match(message.html, /Stale overdue collections/);
  assert.match(message.html, /Parvez \(S01\)/);
  assert.match(message.html, /Sara \(S02\)/);
  assert.match(message.html, /12,500.00/);
  assert.match(message.html, /Never/);
  assert.match(message.html, /Open Payment Collections/);
  assert.equal(message.customerCount, 2);
  assert.equal(message.groupCount, 2);
});

test("resolveCollectionStaleOverdueDigestRecipients defaults to malik@pinasz.com", () => {
  assert.deepEqual(resolveCollectionStaleOverdueDigestRecipients({}), ["malik@pinasz.com"]);
  assert.deepEqual(
    resolveCollectionStaleOverdueDigestRecipients({ COLLECTION_STALE_OVERDUE_EMAIL_TO: "ops@madiba.com" }),
    ["ops@madiba.com"],
  );
});

test("runCollectionStaleOverdueEmailCycle sends digest with salesman groups", async () => {
  const sent = [];
  const result = await runCollectionStaleOverdueEmailCycle({}, {
    date: "2026-09-26",
    trigger: "manual",
    env: {
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "user",
      SMTP_PASS: "pass",
      SMTP_FROM: "noreply@madiba.com",
      COLLECTION_STALE_OVERDUE_EMAIL_TEST_TO: "malik@pinasz.com",
    },
    send: async (message) => {
      sent.push(message);
      return { provider: "smtp" };
    },
    loadDueCustomers: async () => ([
      {
        customer_code: "C1",
        customer_name: "Shop One",
        salesman_name: "Parvez",
        salesman_code: "S01",
        city: "Riyadh",
        area: "Olaya",
        total_due_amount: 1000,
        outstanding_61_90: 1000,
        max_overdue_days: 70,
        received_last_10_days: 0,
        latest_collection: { saved_at: "2026-09-01T08:00:00Z" },
      },
      {
        customer_code: "C2",
        customer_name: "Fresh Visit",
        salesman_name: "Parvez",
        salesman_code: "S01",
        total_due_amount: 900,
        outstanding_61_90: 900,
        received_last_10_days: 0,
        latest_collection: { saved_at: "2026-09-24T08:00:00Z" },
      },
      {
        customer_code: "C3",
        customer_name: "Recent Receipt",
        salesman_name: "Sara",
        salesman_code: "S02",
        total_due_amount: 700,
        outstanding_61_90: 700,
        received_last_10_days: 100,
        latest_collection: { saved_at: "2026-09-01T08:00:00Z" },
      },
    ]),
    loadLastSentMarker: async () => ({ date: "", lastSentAt: "" }),
    saveLastSentMarker: async () => {},
  });

  assert.equal(result.sentCount, 1);
  assert.equal(result.customerCount, 1);
  assert.equal(result.groupCount, 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ["malik@pinasz.com"]);
  assert.match(sent[0].html, /Parvez/);
  assert.doesNotMatch(sent[0].html, /Fresh Visit/);
  assert.doesNotMatch(sent[0].html, /Recent Receipt/);
});

test("filterCollectionStaleOverdueRows keeps only matching due customers", () => {
  const rows = filterCollectionStaleOverdueRows([
    {
      outstanding_61_90: 10,
      received_last_10_days: 0,
      latest_collection: null,
    },
    {
      outstanding_61_90: 10,
      received_last_10_days: 1,
      latest_collection: null,
    },
  ], { todayKey: "2026-09-26" });
  assert.equal(rows.length, 1);
});

test("resolveCollectionStaleOverdueEmailSchedule skips Friday", () => {
  // 2026-09-25 is a Friday in KSA.
  const schedule = resolveCollectionStaleOverdueEmailSchedule("", new Date("2026-09-25T12:00:00+03:00"));
  assert.equal(schedule.skipped, true);
  assert.equal(schedule.reason, "friday_holiday");
});

test("resolveCollectionStaleOverdueRouteTrigger keeps manual reruns manual", () => {
  assert.equal(resolveCollectionStaleOverdueRouteTrigger({}), "cron");
  assert.equal(resolveCollectionStaleOverdueRouteTrigger({ date: "2026-09-26" }), "manual");
  assert.equal(resolveCollectionStaleOverdueRouteTrigger({ force: "true" }), "manual");
  assert.equal(resolveCollectionStaleOverdueRouteTrigger({ to: "ops@madiba.com" }), "manual");
  assert.equal(resolveCollectionStaleOverdueRouteTrigger({ trigger: "cron", date: "2026-09-26" }), "cron");
});
