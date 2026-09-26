import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOutstandingNoGpsEmail,
  groupOutstandingNoGpsBySalesman,
  resolveOutstandingNoGpsDigestCc,
  resolveOutstandingNoGpsDigestRecipients,
  salesmanOutstandingNoGpsRecipients,
} from "../app/lib/outstandingNoGpsEmail.js";
import {
  resolveOutstandingNoGpsEmailSchedule,
  runOutstandingNoGpsEmailCycle,
} from "../app/lib/outstandingNoGpsEmailServer.js";

test("groupOutstandingNoGpsBySalesman splits by salesman code and attaches profile", () => {
  const groups = groupOutstandingNoGpsBySalesman(
    [
      {
        customer_code: "C1",
        customer_name: "Shop One",
        current_salesman_code: "S01",
        salesman_name: "Parvez",
        total_outstanding: 100,
      },
      {
        customer_code: "C2",
        customer_name: "Shop Two",
        current_salesman_code: "S01",
        salesman_name: "Parvez",
        total_outstanding: 200,
      },
      {
        customer_code: "C3",
        customer_name: "Shop Three",
        current_salesman_code: "S02",
        salesman_name: "Sara",
        total_outstanding: 50,
      },
    ],
    [{ id: "u1", salesman_code: "S01", salesman_name: "Parvez", email: "parvez@madiba.com" }],
  );

  assert.equal(groups.length, 2);
  assert.equal(groups[0].salesmanName, "Parvez (S01)");
  assert.equal(groups[0].rows.length, 2);
  assert.equal(groups[0].profile.email, "parvez@madiba.com");
  assert.equal(groups[1].salesmanName, "Sara (S02)");
});

test("buildOutstandingNoGpsEmail asks salesman to visit and update GPS with total row", () => {
  const message = buildOutstandingNoGpsEmail({
    date: "2026-09-16",
    salesmanName: "Parvez (S01)",
    reportUrl: "https://madiba-sfa.vercel.app/management/outstanding-no-gps",
    rows: [
      {
        customer: "1062C — AL TAWFEER",
        city: "Riyadh",
        area: "Olaya",
        salesman: "Parvez (S01)",
        outstanding: 12500,
        lastInvoiceDate: "2026-07-15",
        lastVisitDate: "2026-08-20",
      },
      {
        customer: "2001 — Other Shop",
        city: "Jeddah",
        area: "Balad",
        salesman: "Parvez (S01)",
        outstanding: 500,
        lastInvoiceDate: "-",
        lastVisitDate: "-",
      },
    ],
  });

  assert.match(message.subject, /Parvez/);
  assert.match(message.subject, /2/);
  assert.match(message.html, /Outstanding without GPS/);
  assert.match(message.html, /visit these customers/i);
  assert.match(message.html, /update their GPS/i);
  assert.match(message.html, /12,500.00/);
  assert.match(message.html, /Total \(2 customers\)/);
  assert.match(message.html, /13,000.00/);
  assert.match(message.html, /#0f4c5c/);
  assert.match(message.html, /Open Outstanding Without GPS report/);
  assert.equal(message.customerCount, 2);
  assert.equal(message.totals.outstanding, 13000);
});

test("salesmanOutstandingNoGpsRecipients puts salesman on To and bosses on CC", () => {
  const recipients = salesmanOutstandingNoGpsRecipients({
    reportEmail: "parvez.report@madiba.com",
    email: "parvez@madiba.com",
    chainEmails: ["boss@madiba.com", "parvez.report@madiba.com", "top@madiba.com"],
  });
  assert.deepEqual(recipients.to, ["parvez.report@madiba.com"]);
  assert.deepEqual(recipients.cc, ["boss@madiba.com", "top@madiba.com"]);
});

test("resolveOutstandingNoGpsDigestRecipients reads env lists", () => {
  assert.deepEqual(resolveOutstandingNoGpsDigestRecipients({}), []);
  assert.deepEqual(
    resolveOutstandingNoGpsDigestRecipients({ OUTSTANDING_NO_GPS_EMAIL_TO: "ops@madiba.com" }),
    ["ops@madiba.com"],
  );
  assert.deepEqual(
    resolveOutstandingNoGpsDigestCc(
      { OUTSTANDING_NO_GPS_EMAIL_CC: "cc@madiba.com,ops@madiba.com" },
      ["ops@madiba.com"],
    ),
    ["cc@madiba.com"],
  );
});

test("resolveOutstandingNoGpsEmailSchedule skips Friday holiday", () => {
  // Friday 00:30 KSA
  const friday = resolveOutstandingNoGpsEmailSchedule("", new Date("2026-09-18T00:30:00+03:00"));
  assert.equal(friday.skipped, true);
  assert.equal(friday.reason, "friday_holiday");

  const saturday = resolveOutstandingNoGpsEmailSchedule("", new Date("2026-09-19T00:30:00+03:00"));
  assert.equal(saturday.skipped, false);
  assert.equal(saturday.date, "2026-09-19");
});

test("runOutstandingNoGpsEmailCycle sends user emails plus one boss digest", async () => {
  const sent = [];
  const saved = [];
  const result = await runOutstandingNoGpsEmailCycle({}, {
    trigger: "cron",
    now: new Date("2026-09-16T00:25:00+03:00"),
    env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "sfa@madiba.com" },
    send: async (message) => {
      sent.push(message);
      return { provider: "test" };
    },
    loadCustomers: async () => ([
      {
        customer_code: "1062C",
        customer_name: "AL TAWFEER",
        current_salesman_code: "S01",
        salesman_name: "Parvez",
        city: "Riyadh",
        area: "Olaya",
        total_outstanding: 12500,
        last_invoice_date: "2026-07-15",
        last_visit_date: "2026-08-20",
      },
      {
        customer_code: "2001",
        customer_name: "Other Shop",
        current_salesman_code: "S02",
        salesman_name: "Sara",
        city: "Jeddah",
        area: "Balad",
        total_outstanding: 800,
        last_invoice_date: "2026-08-01",
        last_visit_date: "",
      },
    ]),
    loadProfiles: async () => ([
      {
        id: "u1",
        salesman_code: "S01",
        salesman_name: "Parvez",
        email: "parvez@madiba.com",
        report_email: "parvez.report@madiba.com",
        role: "salesman",
        is_active: true,
      },
      {
        id: "u2",
        salesman_code: "S02",
        salesman_name: "Sara",
        email: "sara@madiba.com",
        role: "salesman",
        is_active: true,
      },
      {
        id: "boss1",
        salesman_code: "MGR",
        salesman_name: "Boss One",
        email: "boss@madiba.com",
        report_email: "boss.report@madiba.com",
        role: "manager",
        is_active: true,
      },
    ]),
    loadLastSentMarker: async () => ({ date: "", lastSentAt: "" }),
    saveLastSentMarker: async (_admin, marker) => {
      saved.push(marker);
    },
    listAuthUsers: async () => ([
      {
        id: "u1",
        user_metadata: {
          salesman_code: "S01",
          head_salesman_code: "MGR",
          head_salesman_name: "Boss One",
        },
      },
      {
        id: "u2",
        user_metadata: {
          salesman_code: "S02",
          head_salesman_code: "MGR",
          head_salesman_name: "Boss One",
        },
      },
      {
        id: "boss1",
        user_metadata: {
          salesman_code: "MGR",
          salesman_name: "Boss One",
        },
      },
    ]),
  });

  assert.equal(result.skipped, false);
  assert.equal(result.sentCount, 3);
  assert.equal(result.customerCount, 2);
  assert.equal(sent[0].to[0], "parvez.report@madiba.com");
  assert.equal(sent[0].cc, undefined);
  assert.match(sent[0].html, /visit these customers/i);
  assert.match(sent[0].html, /AL TAWFEER/);
  assert.equal(sent[1].to[0], "sara@madiba.com");
  assert.equal(sent[1].cc, undefined);
  const bossDigest = sent.find((message) => message.to[0] === "boss.report@madiba.com");
  assert.ok(bossDigest);
  assert.match(bossDigest.html, /across your subordinates/i);
  assert.match(bossDigest.html, /Parvez \(S01\)/);
  assert.match(bossDigest.html, /Sara \(S02\)/);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].reportDate, "2026-09-16");
  assert.equal(saved[0].trigger, "cron");
});

test("runOutstandingNoGpsEmailCycle de-duplicates boss digest customers", async () => {
  const sent = [];
  await runOutstandingNoGpsEmailCycle({}, {
    trigger: "cron",
    now: new Date("2026-09-16T00:25:00+03:00"),
    env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "sfa@madiba.com" },
    send: async (message) => {
      sent.push(message);
      return { provider: "test" };
    },
    loadCustomers: async () => ([
      {
        customer_code: "1062C",
        customer_name: "AL TAWFEER",
        current_salesman_code: "S01",
        salesman_name: "Parvez",
        city: "Riyadh",
        area: "Olaya",
        total_outstanding: 12500,
      },
      {
        customer_code: "1062C",
        customer_name: "AL TAWFEER",
        current_salesman_code: "S01",
        salesman_name: "Parvez",
        city: "Riyadh",
        area: "Olaya",
        total_outstanding: 12500,
      },
    ]),
    loadProfiles: async () => ([
      {
        id: "u1",
        salesman_code: "S01",
        salesman_name: "Parvez",
        email: "parvez@madiba.com",
        report_email: "parvez.report@madiba.com",
        role: "salesman",
        is_active: true,
      },
      {
        id: "boss1",
        salesman_code: "MGR",
        salesman_name: "Boss One",
        email: "boss@madiba.com",
        report_email: "boss.report@madiba.com",
        role: "manager",
        is_active: true,
      },
    ]),
    loadLastSentMarker: async () => ({ date: "", lastSentAt: "" }),
    saveLastSentMarker: async () => {},
    listAuthUsers: async () => ([
      {
        id: "u1",
        user_metadata: {
          salesman_code: "S01",
          head_salesman_code: "MGR",
          head_salesman_name: "Boss One",
        },
      },
      {
        id: "boss1",
        user_metadata: {
          salesman_code: "MGR",
          salesman_name: "Boss One",
        },
      },
    ]),
  });

  const bossDigest = sent.find((message) => message.to[0] === "boss.report@madiba.com");
  assert.ok(bossDigest);
  assert.match(bossDigest.html, /Total \(1 customer\)/);
});

test("runOutstandingNoGpsEmailCycle skips cron when already sent for the report date", async () => {
  const result = await runOutstandingNoGpsEmailCycle({}, {
    trigger: "cron",
    date: "2026-09-16",
    now: new Date("2026-09-16T00:25:00+03:00"),
    env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "sfa@madiba.com" },
    send: async () => {
      throw new Error("should not send");
    },
    loadLastSentMarker: async () => ({ date: "2026-09-16", lastSentAt: "2026-09-16T00:10:00.000Z" }),
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "already_sent");
});
