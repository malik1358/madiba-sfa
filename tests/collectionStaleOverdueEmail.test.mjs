import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCollectionStaleOverdueEmail,
  buildCollectionStaleOverdueSalesmanSection,
  filterCollectionStaleOverdueRows,
  filterCollectionStaleOverdueRowsForProfile,
  groupCollectionStaleOverdueBySalesman,
  isCollectionStaleOverdueRow,
  isSoftAgingSalesman,
  resolveCollectionStaleOverdueDigestCc,
  resolveCollectionStaleOverdueDigestRecipients,
} from "../app/lib/collectionStaleOverdueEmail.js";
import {
  attachLastVisitWithoutOrder,
  resolveCollectionStaleOverdueEmailSchedule,
  resolveCollectionStaleOverdueRouteTrigger,
  runCollectionStaleOverdueEmailCycle,
} from "../app/lib/collectionStaleOverdueEmailServer.js";
import { buildUserVisitReportEmail } from "../app/lib/dailyVisitReportEmail.js";

test("isCollectionStaleOverdueRow requires overdue threshold, zero 8d receipts, and stale visit", () => {
  const todayKey = "2026-09-26";
  const match = {
    outstanding_61_90: 1000,
    outstanding_91_120: 0,
    outstanding_above_120: 0,
    collection_history: [],
    latest_collection: { saved_at: "2026-09-10T10:00:00Z" },
  };
  assert.equal(isCollectionStaleOverdueRow(match, { todayKey }), true);

  assert.equal(isCollectionStaleOverdueRow({
    ...match,
    outstanding_61_90: 0,
  }, { todayKey }), false);

  assert.equal(isCollectionStaleOverdueRow({
    ...match,
    collection_history: [{ saved_at: "2026-09-22T10:00:00Z", amount_received: 50 }],
  }, { todayKey, todayIso: "2026-09-26T12:00:00+03:00" }), false);

  assert.equal(isCollectionStaleOverdueRow({
    ...match,
    latest_collection: { saved_at: "2026-09-20T10:00:00Z" },
  }, { todayKey }), false);

  assert.equal(isCollectionStaleOverdueRow({
    ...match,
    latest_collection: null,
  }, { todayKey }), true);
});

test("Parvez and Junaid use over-30 outstanding while others use over-60", () => {
  const todayKey = "2026-09-26";
  const only31to60 = {
    outstanding_30_60: 800,
    outstanding_61_90: 0,
    outstanding_91_120: 0,
    outstanding_above_120: 0,
    collection_history: [],
    latest_collection: null,
    salesman_name: "Parvez",
    salesman_code: "PARVEZ",
  };
  assert.equal(isSoftAgingSalesman(only31to60), true);
  assert.equal(isCollectionStaleOverdueRow(only31to60, { todayKey }), true);

  assert.equal(isCollectionStaleOverdueRow({
    ...only31to60,
    salesman_name: "Sara",
    salesman_code: "SARA",
  }, { todayKey }), false);

  assert.equal(isCollectionStaleOverdueRow({
    ...only31to60,
    salesman_name: "Junaid",
    salesman_code: "JUNAID",
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
    },
    {
      customer_code: "C2",
      customer_name: "Shop Two",
      salesman_name: "Sara",
      salesman_code: "S02",
      outstanding_above_120: 500,
      total_due_amount: 500,
    },
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].salesmanName.includes("Parvez") || groups[1].salesmanName.includes("Parvez"), true);
  assert.equal(groups.reduce((sum, group) => sum + group.rows.length, 0), 2);
});

test("attachLastVisitWithoutOrder maps visit_report_latest dates onto due rows", () => {
  const visitByCustomer = new Map([
    ["C1", "2026-09-05T09:00:00.000Z"],
  ]);
  const [row] = attachLastVisitWithoutOrder([{ customer_code: "C1" }], visitByCustomer);
  assert.equal(row.last_visit_without_order_at, "2026-09-05T09:00:00.000Z");
});

test("buildCollectionStaleOverdueEmail includes last visit without order column", () => {
  const message = buildCollectionStaleOverdueEmail({
    date: "2026-09-26",
    groups: [{
      salesmanName: "Parvez",
      rows: [{
        customer_code: "C1",
        customer_name: "Shop One",
        city: "Riyadh",
        area: "Olaya",
        salesman_name: "Parvez",
        salesman_code: "PARVEZ",
        total_due_amount: 500,
        outstanding_30_60: 500,
        max_overdue_days: 40,
        collection_history: [],
        latest_collection: { saved_at: "2026-09-01T08:00:00Z" },
        last_visit_without_order_at: "2026-09-05T09:00:00+03:00",
      }],
    }],
  });
  assert.match(message.html, /Last visit w\/o order/);
  assert.match(message.html, /2026-09-05/);
  assert.match(message.html, /Last collection/);
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
          salesman_code: "PARVEZ",
          total_due_amount: 12500,
          outstanding_30_60: 12500,
          max_overdue_days: 45,
          collection_history: [],
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
          collection_history: [],
          latest_collection: null,
        }],
      },
    ],
  });

  assert.match(message.subject, /2 customers/);
  assert.match(message.html, /Stale overdue collections/);
  assert.match(message.html, /Parvez \(S01\)/);
  assert.match(message.html, /Sara \(S02\)/);
  assert.match(message.html, /Recv 8d/);
  assert.match(message.html, /Over 30/);
  assert.match(message.html, /Never/);
  assert.match(message.html, /Last visit w\/o order/);
  assert.equal(message.customerCount, 2);
  assert.equal(message.groupCount, 2);
});

test("digest recipients default To malik and CC soyeb/fazlur", () => {
  assert.deepEqual(resolveCollectionStaleOverdueDigestRecipients({}), ["malik@pinasz.com"]);
  const cc = resolveCollectionStaleOverdueDigestCc({}, ["malik@pinasz.com"]);
  assert.ok(cc.includes("soyeb@noorshukran.com"));
  assert.ok(cc.includes("fazlur.rahiman@noorshukran.com"));
});

test("runCollectionStaleOverdueEmailCycle CCs soyeb and fazlur on digest", async () => {
  const sent = [];
  const result = await runCollectionStaleOverdueEmailCycle({}, {
    date: "2026-09-26",
    trigger: "manual",
    env: {
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "user",
      SMTP_PASS: "pass",
      SMTP_FROM: "noreply@madiba.com",
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
        salesman_code: "PARVEZ",
        city: "Riyadh",
        area: "Olaya",
        total_due_amount: 1000,
        outstanding_30_60: 1000,
        max_overdue_days: 40,
        collection_history: [],
        latest_collection: { saved_at: "2026-09-01T08:00:00Z" },
      },
    ]),
    loadLastSentMarker: async () => ({ date: "", lastSentAt: "" }),
    saveLastSentMarker: async () => {},
  });

  assert.equal(result.sentCount, 1);
  assert.deepEqual(sent[0].to, ["malik@pinasz.com"]);
  assert.ok(sent[0].cc.includes("soyeb@noorshukran.com"));
  assert.ok(sent[0].cc.includes("fazlur.rahiman@noorshukran.com"));
});

test("filterCollectionStaleOverdueRowsForProfile keeps matching salesman customers", () => {
  const rows = [
    {
      customer_code: "C1",
      salesman_name: "Parvez",
      salesman_code: "PARVEZ",
      outstanding_30_60: 10,
      collection_history: [],
      latest_collection: null,
    },
    {
      customer_code: "C2",
      salesman_name: "Sara",
      salesman_code: "SARA",
      outstanding_61_90: 10,
      collection_history: [],
      latest_collection: null,
    },
  ];
  const matched = filterCollectionStaleOverdueRowsForProfile(rows, {
    salesman_name: "Parvez",
    salesman_code: "PARVEZ",
  }, { todayKey: "2026-09-26" });
  assert.equal(matched.length, 1);
  assert.equal(matched[0].customer_code, "C1");
});

test("buildUserVisitReportEmail embeds stale overdue section for salesman and bosses", () => {
  const section = buildCollectionStaleOverdueSalesmanSection({
    salesmanName: "Parvez",
    sourceRows: [{
      customer_code: "C1",
      customer_name: "Shop One",
      city: "Riyadh",
      area: "Olaya",
      salesman_name: "Parvez",
      salesman_code: "PARVEZ",
      total_due_amount: 500,
      outstanding_30_60: 500,
      max_overdue_days: 40,
      collection_history: [],
      latest_collection: null,
    }],
    todayKey: "2026-09-26",
    agingThresholdDays: 30,
  });
  const message = buildUserVisitReportEmail({
    date: "2026-09-25",
    user: { userName: "Parvez", visitCount: 0, farFromCustomerCount: 0, entries: [] },
    staleOverdueSection: section,
  });
  assert.match(message.html, /Stale overdue collections/);
  assert.match(message.html, /Shop One/);
  assert.match(message.text, /Stale overdue collections/);
});

test("runCollectionStaleOverdueEmailCycle honors legacy date-only sent markers for cron", async () => {
  let sent = false;
  const result = await runCollectionStaleOverdueEmailCycle({}, {
    date: "2026-09-26",
    trigger: "cron",
    env: {
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "user",
      SMTP_PASS: "pass",
      SMTP_FROM: "noreply@madiba.com",
    },
    send: async () => {
      sent = true;
      return { provider: "smtp" };
    },
    loadDueCustomers: async () => ([]),
    loadLastSentMarker: async () => ({ date: "2026-09-26", lastSentAt: "" }),
    saveLastSentMarker: async () => {},
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "already_sent");
  assert.equal(sent, false);
});

test("filterCollectionStaleOverdueRows keeps only matching due customers", () => {
  const rows = filterCollectionStaleOverdueRows([
    {
      outstanding_61_90: 10,
      collection_history: [],
      latest_collection: null,
    },
    {
      outstanding_61_90: 10,
      collection_history: [{ saved_at: "2026-09-25T08:00:00Z", amount_received: 1 }],
      latest_collection: { saved_at: "2026-09-25T08:00:00Z", amount_received: 1 },
    },
  ], { todayKey: "2026-09-26", todayIso: "2026-09-26T12:00:00+03:00" });
  assert.equal(rows.length, 1);
});

test("resolveCollectionStaleOverdueEmailSchedule skips Friday", () => {
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
