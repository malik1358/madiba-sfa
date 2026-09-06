import test from "node:test";
import assert from "node:assert/strict";

import {
  INACTIVITY_EMAIL_MINUTES,
  buildInactivityAlertEmail,
  inactivityEmailReferenceKey,
  resolveInactivityEmailRecipients,
} from "../app/lib/inactivityEmail.js";
import { runInactivityEmailCycle } from "../app/lib/inactivityEmailServer.js";
import {
  INACTIVITY_EMAIL_MS,
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

test("inactivity email threshold is 50 minutes", () => {
  assert.equal(INACTIVITY_EMAIL_MINUTES, 50);
  assert.equal(INACTIVITY_EMAIL_MS, 50 * 60 * 1000);
});

test("shouldEmailInactivity waits 50 minutes after login or last activity", () => {
  const logs = [visitAt("2026-09-06T05:10:00.000Z")];

  assert.equal(shouldEmailInactivity({
    loginAt,
    logoutAt: null,
    userLogs: logs,
    now: new Date("2026-09-06T05:59:00.000Z"),
  }), false);

  assert.equal(shouldEmailInactivity({
    loginAt,
    logoutAt: null,
    userLogs: logs,
    now: new Date("2026-09-06T06:00:00.000Z"),
  }), true);

  assert.equal(shouldWarnInactivity({
    loginAt,
    logoutAt: null,
    userLogs: logs,
    now: new Date("2026-09-06T05:55:00.000Z"),
  }), true);
});

test("shouldEmailInactivity skips lunch, logout, and the first 50 minutes after lunch in", () => {
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
    now: new Date("2026-09-06T10:35:00.000Z"),
  }), true);
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
  });

  assert.match(message.subject, /Ahmed \(SM001\)/);
  assert.match(message.subject, /52 min/);
  assert.match(message.text, /no visit, order, or collection/);
  assert.match(message.html, /Ahmed \(SM001\)/);
});

test("inactivityEmailReferenceKey is unique per idle stretch", () => {
  assert.equal(
    inactivityEmailReferenceKey({ userId: "u1", reportDate: "2026-09-06", idleSinceTs: 1000 }),
    "inactivity_email:u1:2026-09-06:1000",
  );
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

test("runInactivityEmailCycle sends one email to the user and reporting-chain bosses", async () => {
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
