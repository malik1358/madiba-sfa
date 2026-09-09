import test from "node:test";
import assert from "node:assert/strict";

import {
  INACTIVITY_EMAIL_MINUTES,
  buildDailyVisitReportPageUrl,
  buildInactivityAlertEmail,
  buildLateLoginReminderEmail,
  inactivityEmailReferenceKey,
  lateLoginEmailReferenceKey,
  resolveAppOrigin,
  resolveInactivityEmailRecipients,
} from "../app/lib/inactivityEmail.js";
import { runInactivityEmailCycle } from "../app/lib/inactivityEmailServer.js";
import {
  INACTIVITY_EMAIL_MS,
  inactivityEmailReminderSlot,
  inactivityReferenceTimestamp,
  lastTransactionTimestamp,
  shouldEmailInactivity,
  shouldWarnInactivity,
} from "../app/lib/workdayActivity.js";

const loginAt = "2026-09-06T05:00:00.000Z";

function visitAt(iso) {
  return {
    entry_type: "VISIT_REPORT",
    note: JSON.stringify({ captured_at: iso }),
    created_at: iso,
  };
}

function lunchLogs() {
  return [
    {
      entry_type: "MORNING_ATTENDANCE",
      note: JSON.stringify({ captured_at: loginAt }),
      created_at: loginAt,
    },
    {
      entry_type: "LUNCH_BREAK_OUT",
      note: JSON.stringify({ captured_at: "2026-09-06T09:00:00.000Z" }),
      created_at: "2026-09-06T09:00:00.000Z",
    },
    {
      entry_type: "LUNCH_BREAK_IN",
      note: JSON.stringify({ captured_at: "2026-09-06T09:45:00.000Z" }),
      created_at: "2026-09-06T09:45:00.000Z",
    },
  ];
}

test("inactivity email threshold is 40 minutes", () => {
  assert.equal(INACTIVITY_EMAIL_MINUTES, 40);
  assert.equal(INACTIVITY_EMAIL_MS, 40 * 60 * 1000);
});

test("shouldEmailInactivity waits 40 minutes after login or last activity", () => {
  const logs = [visitAt("2026-09-06T05:10:00.000Z")];

  assert.equal(shouldEmailInactivity({
    loginAt,
    logoutAt: null,
    userLogs: logs,
    now: new Date("2026-09-06T05:49:00.000Z"),
  }), false);

  assert.equal(shouldEmailInactivity({
    loginAt,
    logoutAt: null,
    userLogs: logs,
    now: new Date("2026-09-06T05:50:00.000Z"),
  }), true);

  assert.equal(shouldWarnInactivity({
    loginAt,
    logoutAt: null,
    userLogs: logs,
    now: new Date("2026-09-06T05:55:00.000Z"),
  }), true);
});

test("shouldEmailInactivity skips lunch, logout, and the first 40 minutes after lunch in", () => {
  const logs = [
    ...lunchLogs(),
    visitAt("2026-09-06T05:10:00.000Z"),
  ];

  assert.equal(shouldEmailInactivity({
    loginAt,
    logoutAt: null,
    userLogs: logs.slice(0, 2),
    now: new Date("2026-09-06T09:20:00.000Z"),
  }), false);

  assert.equal(shouldEmailInactivity({
    loginAt,
    logoutAt: "2026-09-06T12:00:00.000Z",
    userLogs: logs,
    now: new Date("2026-09-06T11:00:00.000Z"),
  }), false);

  assert.equal(shouldEmailInactivity({
    loginAt,
    logoutAt: null,
    userLogs: logs,
    now: new Date("2026-09-06T10:20:00.000Z"),
  }), false);

  assert.equal(shouldEmailInactivity({
    loginAt,
    logoutAt: null,
    userLogs: logs,
    now: new Date("2026-09-06T10:24:00.000Z"),
  }), false);

  assert.equal(shouldEmailInactivity({
    loginAt,
    logoutAt: null,
    userLogs: logs,
    now: new Date("2026-09-06T10:25:00.000Z"),
  }), true);
});

test("idle clock after lunch ignores silent order updated_at", () => {
  const lunchInAt = "2026-09-07T13:12:00.000Z";
  const logs = [
    {
      entry_type: "MORNING_ATTENDANCE",
      note: JSON.stringify({ captured_at: "2026-09-07T06:27:00.000Z" }),
      created_at: "2026-09-07T06:27:00.000Z",
    },
    {
      entry_type: "LUNCH_BREAK_OUT",
      note: JSON.stringify({ captured_at: "2026-09-07T10:09:00.000Z" }),
      created_at: "2026-09-07T10:09:00.000Z",
    },
    {
      entry_type: "ORDER_SUBMITTED",
      note: JSON.stringify({ captured_at: "2026-09-07T11:27:00.000Z" }),
      created_at: "2026-09-07T11:27:00.000Z",
    },
    {
      entry_type: "LUNCH_BREAK_IN",
      note: JSON.stringify({ captured_at: lunchInAt }),
      created_at: lunchInAt,
    },
  ];
  const silentOrderTouch = [{
    created_at: "2026-09-07T11:27:00.000Z",
    submitted_at: "2026-09-07T11:27:00.000Z",
    updated_at: "2026-09-07T14:04:00.000Z",
  }];

  assert.equal(
    lastTransactionTimestamp(logs, [], silentOrderTouch),
    Date.parse("2026-09-07T11:27:00.000Z"),
  );
  assert.equal(
    inactivityReferenceTimestamp({
      loginAt: "2026-09-07T06:27:00.000Z",
      userLogs: logs,
      orders: silentOrderTouch,
    }),
    Date.parse(lunchInAt),
  );
  assert.equal(shouldEmailInactivity({
    loginAt: "2026-09-07T06:27:00.000Z",
    logoutAt: null,
    userLogs: logs,
    orders: silentOrderTouch,
    now: new Date("2026-09-07T13:51:00.000Z"),
  }), false);
  assert.equal(shouldEmailInactivity({
    loginAt: "2026-09-07T06:27:00.000Z",
    logoutAt: null,
    userLogs: logs,
    orders: silentOrderTouch,
    now: new Date("2026-09-07T13:52:00.000Z"),
  }), true);
});

test("shouldEmailInactivity stops at 10:00 PM KSA", () => {
  const logs = [visitAt("2026-09-06T17:00:00.000Z")];

  assert.equal(shouldEmailInactivity({
    loginAt,
    logoutAt: null,
    userLogs: logs,
    now: new Date("2026-09-06T18:59:00.000Z"),
  }), true);

  assert.equal(shouldEmailInactivity({
    loginAt,
    logoutAt: null,
    userLogs: logs,
    now: new Date("2026-09-06T19:00:00.000Z"),
  }), false);
});

test("resolveInactivityEmailRecipients puts the user and bosses on one email", () => {
  assert.deepEqual(
    resolveInactivityEmailRecipients({
      userEmail: "ahmed@madiba-sfa.local",
      reportEmail: "ahmed@company.com",
      chainEmails: ["boss@madiba.com", "ahmed@company.com", "gm@madiba.com"],
    }),
    {
      to: ["ahmed@company.com", "boss@madiba.com", "gm@madiba.com"],
      userEmail: "ahmed@company.com",
      chainEmails: ["boss@madiba.com", "ahmed@company.com", "gm@madiba.com"],
    },
  );
});

test("buildInactivityAlertEmail names the idle user and duration", () => {
  const message = buildInactivityAlertEmail({
    date: "2026-09-06",
    userName: "Ahmed (SM001)",
    idleMinutes: 52,
    lastActivityAt: "2026-09-06T05:10:00.000Z",
    loginAt,
    userId: "u1",
    origin: "https://madiba-sfa.vercel.app",
  });

  assert.match(message.subject, /Ahmed \(SM001\)/);
  assert.match(message.subject, /52 min/);
  assert.match(message.text, /no visit, order, or collection/);
  assert.match(message.text, /Idle since:/);
  assert.match(message.html, /Ahmed \(SM001\)/);
  assert.match(message.html, /Idle since/);
  assert.equal(
    message.reportUrl,
    "https://madiba-sfa.vercel.app/management/daily-visit-report?date=2026-09-06&userId=u1",
  );
  assert.match(message.html, /Open Daily Visit Report/);
  assert.match(message.html, /userId=u1/);
});

test("buildDailyVisitReportPageUrl points at that salesman and date", () => {
  assert.equal(
    buildDailyVisitReportPageUrl({
      date: "2026-09-09",
      userId: "sales-1",
      origin: "https://madiba-sfa.vercel.app/",
    }),
    "https://madiba-sfa.vercel.app/management/daily-visit-report?date=2026-09-09&userId=sales-1",
  );
  assert.equal(resolveAppOrigin({}), "https://madiba-sfa.vercel.app");
  assert.equal(
    resolveAppOrigin({ VERCEL_URL: "madiba-sfa-staging.vercel.app" }),
    "https://madiba-sfa-staging.vercel.app",
  );
});

test("inactivityEmailReferenceKey is unique per idle stretch and 40-minute slot", () => {
  assert.equal(
    inactivityEmailReferenceKey({ userId: "u1", reportDate: "2026-09-06", idleSinceTs: 1000, slot: 1 }),
    "inactivity_email:u1:2026-09-06:1000:1",
  );
  assert.notEqual(
    inactivityEmailReferenceKey({ userId: "u1", reportDate: "2026-09-06", idleSinceTs: 1000, slot: 1 }),
    inactivityEmailReferenceKey({ userId: "u1", reportDate: "2026-09-06", idleSinceTs: 1000, slot: 2 }),
  );
});

test("inactivityEmailReminderSlot advances every 40 minutes after last activity", () => {
  const idleSinceTs = Date.parse("2026-09-06T05:10:00.000Z");
  assert.equal(inactivityEmailReminderSlot(idleSinceTs, new Date("2026-09-06T05:49:00.000Z")), -1);
  assert.equal(inactivityEmailReminderSlot(idleSinceTs, new Date("2026-09-06T05:50:00.000Z")), 1);
  assert.equal(inactivityEmailReminderSlot(idleSinceTs, new Date("2026-09-06T06:29:00.000Z")), 1);
  assert.equal(inactivityEmailReminderSlot(idleSinceTs, new Date("2026-09-06T06:30:00.000Z")), 2);
});

test("lateLoginEmailReferenceKey is unique per 30-minute slot", () => {
  assert.equal(
    lateLoginEmailReferenceKey({ userId: "u1", reportDate: "2026-09-06", slot: 1 }),
    "late_login_email:u1:2026-09-06:1",
  );
});

test("buildLateLoginReminderEmail names the user and 11:00 cutoff", () => {
  const message = buildLateLoginReminderEmail({
    date: "2026-09-06",
    userName: "Ahmed (SM001)",
    reminderTime: "2026-09-06T08:00:00.000Z",
  });

  assert.match(message.subject, /Not logged in by 11:00/);
  assert.match(message.subject, /Ahmed \(SM001\)/);
  assert.match(message.text, /11:00 KSA/);
  assert.match(message.html, /every 30 minutes/);
});

function createLogTable(existingKeys = []) {
  const rows = existingKeys.map((reference_key) => ({ reference_key }));
  return {
    select() {
      return {
        eq(_column, value) {
          const matches = rows.filter((row) => row.reference_key === value);
          return {
            then(resolve) {
              return Promise.resolve({ count: matches.length, error: null }).then(resolve);
            },
          };
        },
      };
    },
    insert(row) {
      rows.push(row);
      return Promise.resolve({ error: null });
    },
  };
}

test("runInactivityEmailCycle emails the user and bosses, then repeats every 40 minutes", async () => {
  const sent = [];
  const logTable = createLogTable();
  const admin = {
    from(table) {
      if (table === "push_notification_log") return logTable;
      if (table === "profiles") {
        return {
          select() {
            return {
              in() {
                return Promise.resolve({
                  data: [
                    { id: "u1", salesman_name: "Ahmed", salesman_code: "SM001", email: "ahmed@company.com", report_email: "" },
                    { id: "boss", salesman_name: "Nabil", salesman_code: "NABIL", email: "boss@madiba.com", report_email: "" },
                  ],
                  error: null,
                });
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  const result = await runInactivityEmailCycle(admin, {
    now: new Date("2026-09-06T06:00:00.000Z"),
    env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "sfa@madiba.com" },
    send: async (message) => {
      sent.push(message);
      return { provider: "test" };
    },
    resolveChain: async () => [{ id: "boss" }],
    loadActiveUsers: async () => ([
      { userId: "u1", loginLog: { created_at: loginAt, note: JSON.stringify({ captured_at: loginAt }) } },
    ]),
    loadActivity: async () => ({
      logs: [visitAt("2026-09-06T05:10:00.000Z")],
      collections: [],
      orders: [],
    }),
  });

  assert.equal(result.sent, 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ["ahmed@company.com", "boss@madiba.com"]);
  assert.match(sent[0].subject, /Ahmed \(SM001\)/);
  assert.match(sent[0].html, /Open Daily Visit Report/);
  assert.match(sent[0].html, /daily-visit-report\?date=2026-09-06&amp;userId=u1/);

  const second = await runInactivityEmailCycle(admin, {
    now: new Date("2026-09-06T06:10:00.000Z"),
    env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "sfa@madiba.com" },
    send: async (message) => {
      sent.push(message);
      return { provider: "test" };
    },
    resolveChain: async () => [{ id: "boss" }],
    loadActiveUsers: async () => ([
      { userId: "u1", loginLog: { created_at: loginAt, note: JSON.stringify({ captured_at: loginAt }) } },
    ]),
    loadActivity: async () => ({
      logs: [visitAt("2026-09-06T05:10:00.000Z")],
      collections: [],
      orders: [],
    }),
  });

  assert.equal(second.sent, 0);
  assert.equal(sent.length, 1);
  assert.equal(second.details[0].reason, "already_sent");

  const nextSlot = await runInactivityEmailCycle(admin, {
    now: new Date("2026-09-06T06:30:00.000Z"),
    env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "sfa@madiba.com" },
    send: async (message) => {
      sent.push(message);
      return { provider: "test" };
    },
    resolveChain: async () => [{ id: "boss" }],
    loadActiveUsers: async () => ([
      { userId: "u1", loginLog: { created_at: loginAt, note: JSON.stringify({ captured_at: loginAt }) } },
    ]),
    loadActivity: async () => ({
      logs: [visitAt("2026-09-06T05:10:00.000Z")],
      collections: [],
      orders: [],
    }),
  });

  assert.equal(nextSlot.sent, 1);
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /every 40 minutes/);
});

test("runInactivityEmailCycle skips when email is not configured", async () => {
  const result = await runInactivityEmailCycle({}, {
    env: {},
    send: async () => {
      throw new Error("should not send");
    },
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "email_not_configured");
});

test("runInactivityEmailCycle reminds every 30 minutes when a field user has not logged in by 11:00", async () => {
  const sent = [];
  const logTable = createLogTable();
  const admin = {
    from(table) {
      if (table === "push_notification_log") return logTable;
      if (table === "profiles") {
        return {
          select() {
            return {
              in() {
                return Promise.resolve({
                  data: [
                    { id: "u1", salesman_name: "Ahmed", salesman_code: "SM001", email: "ahmed@company.com", report_email: "" },
                    { id: "boss", salesman_name: "Nabil", salesman_code: "NABIL", email: "boss@madiba.com", report_email: "" },
                  ],
                  error: null,
                });
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  const options = {
    env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "sfa@madiba.com" },
    send: async (message) => {
      sent.push(message);
      return { provider: "test" };
    },
    resolveChain: async () => [{ id: "boss" }],
    loadActiveUsers: async () => [],
    loadActivity: async () => ({ logs: [], collections: [], orders: [] }),
    loadPendingLoginUsers: async () => [{ userId: "u1" }],
  };

  const first = await runInactivityEmailCycle(admin, {
    ...options,
    now: new Date("2026-09-06T08:05:00.000Z"),
  });
  assert.equal(first.loginRemindersSent, 1);
  assert.deepEqual(sent[0].to, ["ahmed@company.com", "boss@madiba.com"]);
  assert.match(sent[0].subject, /Not logged in by 11:00/);
  assert.match(sent[0].html, /Open Daily Visit Report/);
  assert.match(sent[0].html, /userId=u1/);

  const sameSlot = await runInactivityEmailCycle(admin, {
    ...options,
    now: new Date("2026-09-06T08:20:00.000Z"),
  });
  assert.equal(sameSlot.loginRemindersSent, 0);
  assert.equal(sent.length, 1);

  const nextSlot = await runInactivityEmailCycle(admin, {
    ...options,
    now: new Date("2026-09-06T08:35:00.000Z"),
  });
  assert.equal(nextSlot.loginRemindersSent, 1);
  assert.equal(sent.length, 2);
});
