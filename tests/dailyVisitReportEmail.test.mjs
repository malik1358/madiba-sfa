import test from "node:test";
import assert from "node:assert/strict";

import {
  buildUserVisitReportEmail,
  resolveVisitReportRecipients,
} from "../app/lib/dailyVisitReportEmail.js";
import { runDailyVisitReportEmailCycle } from "../app/lib/dailyVisitReportEmailServer.js";
import { getMailerConfig, isEmailConfigured, parseEmailList } from "../app/lib/mailer.js";

test("parseEmailList splits mixed separators and ignores invalid values", () => {
  assert.deepEqual(
    parseEmailList("Manager@Madiba.com, other@madiba.com; bad; also@ok.co"),
    ["manager@madiba.com", "other@madiba.com", "also@ok.co"],
  );
});

test("resolveVisitReportRecipients sends each user separately and copies managers", () => {
  assert.deepEqual(
    resolveVisitReportRecipients({
      userEmail: "salesman@madiba.com",
      managerEmails: "boss@madiba.com, salesman@madiba.com",
      sendToUser: true,
    }),
    {
      to: ["salesman@madiba.com", "boss@madiba.com"],
      userEmail: "salesman@madiba.com",
      managerEmails: ["boss@madiba.com", "salesman@madiba.com"],
    },
  );
});

test("resolveVisitReportRecipients can send only to managers", () => {
  assert.deepEqual(
    resolveVisitReportRecipients({
      userEmail: "salesman@madiba.com",
      managerEmails: "boss@madiba.com",
      sendToUser: false,
    }).to,
    ["boss@madiba.com"],
  );
});

test("buildUserVisitReportEmail includes the user name and timeline", () => {
  const message = buildUserVisitReportEmail({
    date: "2026-09-02",
    thresholdKm: 0.5,
    user: {
      userName: "Ahmed (SM001)",
      visitCount: 2,
      farFromCustomerCount: 1,
      totalRouteDistanceKm: 12.5,
      daySummary: { lines: ["Visited 1 customer."] },
      entries: [
        {
          visitSequence: 1,
          savedAt: "2026-09-02T06:00:00.000Z",
          customerName: "Shop A",
          customerCode: "C1",
          transactionLabel: "Visit report",
          hasEntryGps: true,
          hasCustomerLocation: true,
          distanceFromCustomerKm: 0.2,
          distanceFromPreviousKm: null,
          area: "Riyadh",
          street: "Olaya",
          speedKmh: null,
          waitingMinutesFromPrevious: null,
          capturePlatformLabel: "Android",
          entryLatitude: 24.7,
          entryLongitude: 46.7,
        },
      ],
    },
  });

  assert.match(message.subject, /Ahmed \(SM001\)/);
  assert.match(message.subject, /2026-09-02/);
  assert.match(message.text, /Shop A \(C1\)/);
  assert.match(message.html, /Visit report/);
  assert.match(message.html, /Daily visit summary/);
  assert.match(message.html, /Day route/);
});

test("isEmailConfigured requires from plus SMTP or Resend", () => {
  assert.equal(isEmailConfigured(getMailerConfig({})), false);
  assert.equal(isEmailConfigured(getMailerConfig({ SMTP_HOST: "smtp.office365.com", SMTP_FROM: "sfa@madiba.com" })), true);
  assert.equal(isEmailConfigured(getMailerConfig({ RESEND_API_KEY: "re_test", SMTP_FROM: "sfa@madiba.com" })), true);
});

test("runDailyVisitReportEmailCycle sends one email per field user", async () => {
  const sent = [];
  const result = await runDailyVisitReportEmailCycle({}, {
    date: "2026-09-02",
    env: {
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "sfa@madiba.com",
      DAILY_VISIT_REPORT_TO: "manager@madiba.com",
    },
    send: async (message) => {
      sent.push(message);
      return { provider: "test" };
    },
    loadReport: async () => ({
      date: "2026-09-02",
      thresholdKm: 0.5,
      users: [
        {
          userId: "u1",
          userName: "Sales One",
          email: "one@madiba.com",
          visitCount: 1,
          farFromCustomerCount: 0,
          totalRouteDistanceKm: 3,
          entries: [],
          daySummary: { lines: ["One visit."] },
        },
      ],
    }),
    loadProfiles: async () => ([
      { id: "u1", role: "salesman", email: "one@madiba.com", salesman_name: "Sales One", is_active: true },
      { id: "u2", role: "salesman", email: "two@madiba.com", salesman_name: "Sales Two", is_active: true },
      { id: "mgr", role: "manager", email: "manager@madiba.com", salesman_name: "Boss", is_active: true },
    ]),
    loadSummary: async () => ({ daySummary: { lines: ["No visits today."] } }),
  });

  assert.equal(result.sentCount, 2);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].subject.includes("Sales One") || sent[1].subject.includes("Sales One"), true);
  assert.equal(sent.some((message) => message.subject.includes("Sales Two")), true);
  assert.equal(sent.some((message) => message.subject.includes("Boss")), false);
  assert.deepEqual(sent.find((message) => message.subject.includes("Sales One")).to, ["one@madiba.com", "manager@madiba.com"]);
});

test("runDailyVisitReportEmailCycle skips when email is not configured", async () => {
  const result = await runDailyVisitReportEmailCycle({}, {
    date: "2026-09-02",
    env: {},
    send: async () => {
      throw new Error("should not send");
    },
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "email_not_configured");
});

test("runDailyVisitReportEmailCycle can send only selected users", async () => {
  const sent = [];
  const result = await runDailyVisitReportEmailCycle({}, {
    date: "2026-09-02",
    userIds: ["u2"],
    env: {
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "sfa@madiba.com",
      DAILY_VISIT_REPORT_TO: "manager@madiba.com",
    },
    send: async (message) => {
      sent.push(message);
      return { provider: "test" };
    },
    loadReport: async () => ({
      date: "2026-09-02",
      thresholdKm: 0.5,
      users: [
        {
          userId: "u1",
          userName: "Sales One",
          email: "one@madiba.com",
          visitCount: 1,
          farFromCustomerCount: 0,
          totalRouteDistanceKm: 3,
          entries: [],
          daySummary: { lines: ["One visit."] },
        },
      ],
    }),
    loadProfiles: async () => ([
      { id: "u1", role: "salesman", email: "one@madiba.com", salesman_name: "Sales One", is_active: true },
      { id: "u2", role: "salesman", email: "two@madiba.com", salesman_name: "Sales Two", is_active: true },
    ]),
    loadSummary: async () => ({ daySummary: { lines: ["No visits today."] } }),
  });

  assert.equal(result.sentCount, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /Sales Two/);
  assert.equal(sent.some((message) => message.subject.includes("Sales One")), false);
});
