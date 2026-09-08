import test from "node:test";
import assert from "node:assert/strict";

import {
  buildUserVisitReportEmail,
  resolveUserReportEmail,
  resolveVisitReportRecipients,
} from "../app/lib/dailyVisitReportEmail.js";
import { runDailyVisitReportEmailCycle, resolveDailyVisitReportEmailSchedule, resolveVisitReportChainEmails } from "../app/lib/dailyVisitReportEmailServer.js";
import { getMailerConfig, isDeliverableEmail, isEmailConfigured, parseEmailList } from "../app/lib/mailer.js";

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
      chainEmails: [],
    },
  );
});

test("resolveVisitReportRecipients copies every head in the reporting chain", () => {
  assert.deepEqual(
    resolveVisitReportRecipients({
      reportEmail: "belal@company.com",
      managerEmails: "office@madiba.com",
      chainEmails: ["ahmed.nabil@noorshukran.com", "soyeb@company.com", "ahmed.nabil@noorshukran.com"],
      sendToUser: true,
    }).to,
    ["belal@company.com", "ahmed.nabil@noorshukran.com", "soyeb@company.com", "office@madiba.com"],
  );
});

test("login usernames at .local are not treated as report inboxes", () => {
  assert.equal(isDeliverableEmail("ahmed@madiba-sfa.local"), false);
  assert.equal(isDeliverableEmail("ahmed@company.com"), true);
  assert.equal(resolveUserReportEmail({
    reportEmail: "ahmed@company.com",
    email: "ahmed@madiba-sfa.local",
  }), "ahmed@company.com");
  assert.deepEqual(
    resolveVisitReportRecipients({
      userEmail: "ahmed@madiba-sfa.local",
      reportEmail: "ahmed@company.com",
      managerEmails: "boss@madiba.com",
      sendToUser: true,
    }).to,
    ["ahmed@company.com", "boss@madiba.com"],
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
          transactionType: "VISIT_REPORT",
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
  assert.doesNotMatch(message.html, /Daily visit summary/);
  assert.doesNotMatch(message.html, /Visited 1 customer/);
  assert.match(message.html, /Day route/);
  assert.match(message.html, /Visit without order/);
  assert.match(message.html, /Visit #/);
  assert.doesNotMatch(message.html, /Bigger red circle/);
  assert.doesNotMatch(message.html, /Entries more than/);
  assert.match(message.html, /background:#dbeafe/);
  assert.match(message.html, /24\.70000, 46\.70000/);
});

test("buildUserVisitReportEmail appends working hours after the day route", () => {
  const message = buildUserVisitReportEmail({
    date: "2026-09-07",
    user: {
      userName: "OSAMA (OSAMA)",
      visitCount: 1,
      entries: [
        {
          savedAt: "2026-09-07T07:34:00.000Z",
          transactionType: "MORNING_ATTENDANCE",
          transactionLabel: "Login",
          hasEntryGps: true,
          entryLatitude: 24.7,
          entryLongitude: 46.7,
        },
        {
          savedAt: "2026-09-07T10:47:00.000Z",
          transactionType: "LUNCH_BREAK_OUT",
          transactionLabel: "Lunch out",
          hasEntryGps: true,
          entryLatitude: 24.71,
          entryLongitude: 46.71,
        },
        {
          savedAt: "2026-09-07T12:14:00.000Z",
          transactionType: "LUNCH_BREAK_IN",
          transactionLabel: "Lunch in",
          hasEntryGps: true,
          entryLatitude: 24.71,
          entryLongitude: 46.71,
        },
        {
          savedAt: "2026-09-07T16:10:00.000Z",
          transactionType: "END_OF_DAY",
          transactionLabel: "Logout",
          hasEntryGps: true,
          entryLatitude: 24.72,
          entryLongitude: 46.72,
        },
      ],
    },
  });

  assert.match(message.html, /Day route/);
  assert.match(message.html, /Working hours:<\/strong> 7h 9m/);
});

test("buildUserVisitReportEmail shows posted order values", () => {
  const message = buildUserVisitReportEmail({
    date: "2026-09-05",
    user: {
      userName: "PARVEZ (PARVEZ)",
      entries: [
        {
          visitSequence: 9,
          savedAt: "2026-09-05T10:18:00.000Z",
          customerName: "Delta Egyptian Trading Est.",
          customerCode: "1108C",
          transactionLabel: "Order submitted",
          transactionType: "ORDER_SUBMITTED",
          orderValue: 5380.6,
          hasEntryGps: true,
          hasCustomerLocation: true,
          distanceFromCustomerKm: 0.1,
        },
      ],
      daySummary: {
        stats: { orderCount: 3, orderValue: 15380.6 },
      },
    },
  });

  assert.match(message.html, /New-customer orders<\/td><td>3<\/td><td>15,380\.6/);
  assert.match(message.html, /Order submitted · 5,380\.6 SAR/);
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
      { id: "u1", role: "salesman", email: "one@madiba-sfa.local", report_email: "one@company.com", salesman_name: "Sales One", is_active: true },
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
  assert.deepEqual(sent.find((message) => message.subject.includes("Sales One")).to, ["one@company.com", "manager@madiba.com"]);
});

test("resolveDailyVisitReportEmailSchedule sends Thursday at Friday midnight and Saturday on Sunday", () => {
  const fridayStartKsa = new Date("2026-09-03T21:10:00.000Z");
  const fridayStart = resolveDailyVisitReportEmailSchedule("", fridayStartKsa);
  assert.equal(fridayStart.skipped, true);
  assert.equal(fridayStart.reason, "friday_holiday");
  assert.equal(fridayStart.date, "2026-09-03");

  const fridayMidnightKsa = new Date("2026-09-04T21:10:00.000Z");
  const fridayMidnight = resolveDailyVisitReportEmailSchedule("", fridayMidnightKsa);
  assert.equal(fridayMidnight.skipped, false);
  assert.equal(fridayMidnight.date, "2026-09-03");

  const mondayMidnightKsa = new Date("2026-09-06T21:10:00.000Z");
  const mondaySchedule = resolveDailyVisitReportEmailSchedule("", mondayMidnightKsa);
  assert.equal(mondaySchedule.skipped, false);
  assert.equal(mondaySchedule.date, "2026-09-06");

  const sundayMidnightKsa = new Date("2026-09-05T21:10:00.000Z");
  const sundaySchedule = resolveDailyVisitReportEmailSchedule("", sundayMidnightKsa);
  assert.equal(sundaySchedule.skipped, false);
  assert.equal(sundaySchedule.date, "2026-09-05");

  const manual = resolveDailyVisitReportEmailSchedule("2026-09-03", fridayStartKsa);
  assert.equal(manual.skipped, false);
  assert.equal(manual.date, "2026-09-03");
});

test("runDailyVisitReportEmailCycle CCs every boss above the salesman", async () => {
  const sent = [];
  const result = await runDailyVisitReportEmailCycle({}, {
    date: "2026-09-02",
    userIds: ["belal"],
    env: {
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "sfa@madiba.com",
    },
    send: async (message) => {
      sent.push(message);
      return { provider: "test" };
    },
    loadReport: async () => ({
      date: "2026-09-02",
      thresholdKm: 0.5,
      users: [{
        userId: "belal",
        userName: "Belal",
        email: "belal@madiba-sfa.local",
        visitCount: 1,
        farFromCustomerCount: 0,
        totalRouteDistanceKm: 2,
        entries: [],
        daySummary: { lines: ["One visit."] },
      }],
    }),
    loadProfiles: async () => ([
      { id: "belal", role: "salesman", salesman_code: "BELAL", salesman_name: "Belal", email: "belal@madiba-sfa.local", report_email: "", is_active: true },
      { id: "nabil", role: "salesman", salesman_code: "AHMED NABIL", salesman_name: "Ahmed Nabil", email: "nabil@madiba-sfa.local", report_email: "ahmed.nabil@noorshukran.com", is_active: true },
      { id: "soyeb", role: "manager", salesman_code: "SOYEB", salesman_name: "Soyeb", email: "soyeb@madiba-sfa.local", report_email: "soyeb@company.com", is_active: true },
    ]),
    loadAuthUsers: async () => ([
      { id: "belal", user_metadata: { head_salesman_code: "AHMED NABIL" } },
      { id: "nabil", user_metadata: { head_salesman_code: "SOYEB" } },
      { id: "soyeb", user_metadata: {} },
    ]),
    loadSummary: async () => ({ daySummary: { lines: ["One visit."] } }),
  });

  assert.equal(result.sentCount, 1);
  assert.deepEqual(sent[0].to, ["ahmed.nabil@noorshukran.com", "soyeb@company.com"]);
});

test("resolveVisitReportChainEmails uses each head report inbox", () => {
  assert.deepEqual(
    resolveVisitReportChainEmails([
      { report_email: "ahmed.nabil@noorshukran.com", email: "nabil@madiba-sfa.local" },
      { report_email: "", email: "soyeb@company.com" },
    ]),
    ["ahmed.nabil@noorshukran.com", "soyeb@company.com"],
  );
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
