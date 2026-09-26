import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTeamVisitReportEmail,
  buildUserVisitReportEmail,
  buildVisitReportDigestEmail,
  resolveUserReportEmail,
  resolveVisitReportRecipients,
} from "../app/lib/dailyVisitReportEmail.js";
import {
  collectVisitReportTeamLeaders,
  isExcludedVisitReportEmailSalesman,
  runDailyVisitReportEmailCycle,
  resolveDailyVisitReportEmailSchedule,
  resolveVisitReportChainEmails,
} from "../app/lib/dailyVisitReportEmailServer.js";
import { buildPerformanceSnapshot } from "../app/lib/performanceKpis.js";
import { getMailerConfig, isDeliverableEmail, isEmailConfigured, parseEmailList } from "../app/lib/mailer.js";

test("isExcludedVisitReportEmailSalesman matches Fazlur by code or display name", () => {
  assert.equal(isExcludedVisitReportEmailSalesman({
    profile: { salesman_code: "FAZLUR RAHMAN", salesman_name: "FAZLUR RAHMAN" },
  }), true);
  assert.equal(isExcludedVisitReportEmailSalesman({
    user: { userName: "FAZLUR RAHMAN (FAZLUR RAHMAN)" },
  }), true);
  assert.equal(isExcludedVisitReportEmailSalesman({
    profile: { salesman_code: "BELAL", salesman_name: "Belal" },
  }), false);
});

test("parseEmailList splits mixed separators and ignores invalid values", () => {
  assert.deepEqual(
    parseEmailList("Manager@Madiba.com, other@madiba.com; bad; also@ok.co"),
    ["manager@madiba.com", "other@madiba.com", "also@ok.co"],
  );
});

test("resolveVisitReportRecipients keeps personal sends on the user inbox only", () => {
  assert.deepEqual(
    resolveVisitReportRecipients({
      userEmail: "salesman@madiba.com",
      managerEmails: "boss@madiba.com, salesman@madiba.com",
      sendToUser: true,
    }),
    {
      to: ["salesman@madiba.com"],
      userEmail: "salesman@madiba.com",
      managerEmails: ["boss@madiba.com", "salesman@madiba.com"],
      chainEmails: [],
    },
  );
});

test("resolveVisitReportRecipients keeps boss chain separate from personal recipients", () => {
  assert.deepEqual(
    resolveVisitReportRecipients({
      reportEmail: "belal@company.com",
      managerEmails: "office@madiba.com",
      chainEmails: ["ahmed.nabil@noorshukran.com", "soyeb@company.com", "ahmed.nabil@noorshukran.com"],
      sendToUser: true,
    }),
    {
      to: ["belal@company.com"],
      userEmail: "belal@company.com",
      managerEmails: ["office@madiba.com"],
      chainEmails: ["ahmed.nabil@noorshukran.com", "soyeb@company.com"],
    },
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
    ["ahmed@company.com"],
  );
});

test("resolveVisitReportRecipients returns no personal recipients when send-to-user is disabled", () => {
  assert.deepEqual(
    resolveVisitReportRecipients({
      userEmail: "salesman@madiba.com",
      managerEmails: "boss@madiba.com",
      sendToUser: false,
    }).to,
    [],
  );
});

test("buildVisitReportDigestEmail combines multiple subordinate reports into one boss email", () => {
  const message = buildVisitReportDigestEmail({
    date: "2026-09-26",
    bossName: "Boss One",
    reports: [
      {
        userName: "Belal",
        message: buildUserVisitReportEmail({ date: "2026-09-26", user: { userName: "Belal", entries: [] } }),
      },
      {
        userName: "Sara",
        message: buildUserVisitReportEmail({ date: "2026-09-26", user: { userName: "Sara", entries: [] } }),
      },
    ],
    teamMessage: buildTeamVisitReportEmail({ date: "2026-09-26", bossName: "Boss One", members: [] }),
  });

  assert.match(message.subject, /Team digest/);
  assert.match(message.html, /Daily visit reports for your subordinates/);
  assert.match(message.html, /Belal/);
  assert.match(message.html, /Sara/);
  assert.match(message.text, /=== Belal ===/);
  assert.match(message.text, /=== Sara ===/);
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
          savedAt: "2026-09-07T06:00:00.000Z",
          transactionType: "MORNING_ATTENDANCE",
          transactionLabel: "Login",
          hasEntryGps: true,
          entryLatitude: 24.7,
          entryLongitude: 46.7,
        },
        {
          savedAt: "2026-09-07T07:34:00.000Z",
          transactionType: "VISIT_REPORT",
          transactionLabel: "Visit report",
          customerCode: "C1",
          customerName: "Shop A",
          isFarFromCustomer: false,
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
          savedAt: "2026-09-07T15:00:00.000Z",
          transactionType: "COLLECTION_VISIT",
          transactionLabel: "Collection visit",
          customerCode: "C2",
          customerName: "Shop B",
          isFarFromCustomer: false,
          hasEntryGps: true,
          entryLatitude: 24.72,
          entryLongitude: 46.72,
        },
        {
          savedAt: "2026-09-07T16:10:00.000Z",
          transactionType: "END_OF_DAY",
          transactionLabel: "Logout",
          hasEntryGps: true,
          entryLatitude: 24.73,
          entryLongitude: 46.73,
        },
      ],
    },
  });

  assert.match(message.html, /Day route/);
  assert.match(message.html, /Working hours:<\/strong> 5h 59m/);
});

test("buildUserVisitReportEmail shows collection outcome when nothing was collected", () => {
  const message = buildUserVisitReportEmail({
    date: "2026-09-09",
    user: {
      userName: "collector (SM001)",
      entries: [
        {
          visitSequence: 6,
          savedAt: "2026-09-09T08:49:00.000Z",
          customerName: "NAJDLINKS TRADING COMPANY",
          customerCode: "1198",
          transactionLabel: "Collection visit",
          transactionType: "COLLECTION_VISIT",
          visitOutcome: "ASKED_COME_LATER",
          amountReceived: 0,
        },
      ],
    },
  });

  assert.match(message.html, /Asked to come later/);
  assert.match(message.text, /Asked to come later/);
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
  assert.match(message.html, /<th>Outcome<\/th>/);
  assert.match(message.html, /Order submitted<\/td>\s*<td>Order 5,380\.6 SAR/);
});

test("buildTeamVisitReportEmail consolidates team target vs achievement", () => {
  const members = [
    buildPerformanceSnapshot({
      reportDate: "2026-09-09",
      salesmanCode: "BELAL",
      salesmanName: "Belal",
      actuals: { officeSupplies: 40, otherSales: 10, collection: 5, newCustomers: 1, repeatCustomers: 2 },
      targets: { officeSupplies: 100, otherSales: 20, collection: 10, newCustomers: 2, repeatCustomers: 4 },
    }),
    buildPerformanceSnapshot({
      reportDate: "2026-09-09",
      salesmanCode: "GEORGE",
      salesmanName: "George",
      actuals: { officeSupplies: 60, otherSales: 30, collection: 15, newCustomers: 1, repeatCustomers: 3 },
      targets: { officeSupplies: 100, otherSales: 80, collection: 30, newCustomers: 2, repeatCustomers: 6 },
    }),
  ];
  const team = buildPerformanceSnapshot({
    reportDate: "2026-09-09",
    salesmanCode: "TEAM",
    salesmanName: "Ahmed Nabil — team",
    actuals: { officeSupplies: 100, otherSales: 40, collection: 20, newCustomers: 2, repeatCustomers: 5 },
    targets: { officeSupplies: 250, otherSales: 150, collection: 80, newCustomers: 6, repeatCustomers: 12 },
  });
  const message = buildTeamVisitReportEmail({
    date: "2026-09-09",
    bossName: "Ahmed Nabil",
    team,
    members,
  });

  assert.match(message.subject, /Team target vs achievement/);
  assert.match(message.subject, /Ahmed Nabil/);
  assert.match(message.html, /Team target vs achievement/);
  assert.match(message.html, /Team members/);
  assert.match(message.html, /Belal \(BELAL\)/);
  assert.match(message.html, /George \(GEORGE\)/);
  assert.match(message.text, /Team target vs achievement/);
  assert.match(message.text, /Belal \(BELAL\)/);
});

test("collectVisitReportTeamLeaders walks the reporting chain", () => {
  const profiles = [
    { id: "belal", salesman_code: "BELAL", salesman_name: "Belal", role: "salesman" },
    { id: "nabil", salesman_code: "AHMED NABIL", salesman_name: "Ahmed Nabil", role: "salesman", report_email: "nabil@company.com" },
    { id: "soyeb", salesman_code: "SOYEB", salesman_name: "Soyeb", role: "manager", report_email: "soyeb@company.com" },
  ];
  const authUsers = [
    { id: "belal", user_metadata: { head_salesman_code: "AHMED NABIL" } },
    { id: "nabil", user_metadata: { head_salesman_code: "SOYEB" } },
    { id: "soyeb", user_metadata: {} },
  ];
  const leaders = collectVisitReportTeamLeaders({
    recipients: [{ user: { userId: "belal" }, profile: profiles[0] }],
    profiles,
    authUsers,
  });
  assert.deepEqual(leaders.map((row) => row.id), ["nabil", "soyeb"]);
});

test("collectVisitReportTeamLeaders includes salesman heads who have a team", () => {
  const profiles = [
    { id: "junaid", salesman_code: "JUNAID", salesman_name: "JUNAID", role: "salesman" },
    { id: "parvez", salesman_code: "PARVEZ", salesman_name: "PARVEZ", role: "salesman" },
    { id: "soyeb", salesman_code: "SOYEB", salesman_name: "SOYEB", role: "manager" },
  ];
  const authUsers = [
    { id: "junaid", user_metadata: { head_salesman_code: "SOYEB" } },
    { id: "parvez", user_metadata: { head_salesman_code: "JUNAID" } },
    { id: "soyeb", user_metadata: {} },
  ];
  const leaders = collectVisitReportTeamLeaders({
    recipients: [{ user: { userId: "junaid" }, profile: profiles[0] }],
    profiles,
    authUsers,
  });
  assert.deepEqual(leaders.map((row) => row.id), ["soyeb", "junaid"]);
});

test("isEmailConfigured requires from plus SMTP or Resend", () => {
  assert.equal(isEmailConfigured(getMailerConfig({})), false);
  assert.equal(isEmailConfigured(getMailerConfig({ SMTP_HOST: "smtp.office365.com", SMTP_FROM: "sfa@madiba.com" })), true);
  assert.equal(isEmailConfigured(getMailerConfig({ RESEND_API_KEY: "re_test", SMTP_FROM: "sfa@madiba.com" })), true);
});

test("runDailyVisitReportEmailCycle sends personal emails plus one company digest", async () => {
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

  assert.equal(result.sentCount, 3);
  assert.equal(sent.length, 3);
  assert.equal(sent[0].subject.includes("Sales One") || sent[1].subject.includes("Sales One"), true);
  assert.equal(sent.some((message) => message.subject.includes("Sales Two")), true);
  assert.equal(sent.some((message) => /Team digest — All teams/.test(message.subject)), true);
  assert.deepEqual(sent.find((message) => message.subject.includes("Sales One")).to, ["one@company.com"]);
  assert.deepEqual(sent.find((message) => /Team digest — All teams/.test(message.subject)).to, ["manager@madiba.com"]);
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

test("runDailyVisitReportEmailCycle sends one consolidated boss digest for the reporting chain", async () => {
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

  assert.equal(result.sentCount, 2);
  const nabilDigest = sent.find((message) => /Team digest — Ahmed Nabil/.test(message.subject));
  const soyebDigest = sent.find((message) => /Team digest — Soyeb/.test(message.subject));
  assert.deepEqual(nabilDigest.to, ["ahmed.nabil@noorshukran.com"]);
  assert.match(nabilDigest.html, /Belal/);
  assert.deepEqual(soyebDigest.to, ["soyeb@company.com"]);
  assert.match(soyebDigest.html, /Belal/);
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

test("runDailyVisitReportEmailCycle skips Fazlur Rahman", async () => {
  const sent = [];
  const result = await runDailyVisitReportEmailCycle({}, {
    date: "2026-09-13",
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
      date: "2026-09-13",
      thresholdKm: 0.5,
      users: [],
    }),
    loadProfiles: async () => ([
      {
        id: "fazlur",
        role: "salesman",
        salesman_code: "FAZLUR RAHMAN",
        salesman_name: "FAZLUR RAHMAN",
        email: "fazlur@madiba-sfa.local",
        report_email: "fazlur.rahiman@noorshukran.com",
        is_active: true,
      },
      {
        id: "belal",
        role: "salesman",
        salesman_code: "BELAL",
        salesman_name: "Belal",
        email: "belal@madiba-sfa.local",
        report_email: "belal@company.com",
        is_active: true,
      },
    ]),
    loadSummary: async () => ({ daySummary: { lines: ["No visits today."] } }),
  });

  assert.equal(result.sentCount, 2);
  assert.equal(result.skippedCount, 1);
  assert.equal(sent.length, 2);
  assert.match(sent[0].subject, /Belal/);
  assert.equal(sent.some((message) => /FAZLUR/i.test(message.subject)), false);
  assert.equal(sent.some((message) => /Team digest — All teams/.test(message.subject)), true);
  assert.deepEqual(
    result.results.find((row) => row.userId === "fazlur"),
    {
      userId: "fazlur",
      userName: "FAZLUR RAHMAN (FAZLUR RAHMAN)",
      status: "skipped",
      reason: "excluded_salesman",
    },
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

test("runDailyVisitReportEmailCycle does not send personal reports for admin", async () => {
  const sent = [];
  const result = await runDailyVisitReportEmailCycle({}, {
    date: "2026-09-13",
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
      date: "2026-09-13",
      thresholdKm: 0.5,
      users: [
        {
          userId: "admin1",
          userName: "malik@pinasz.com",
          email: "malik@pinasz.com",
          visitCount: 2,
          farFromCustomerCount: 2,
          totalRouteDistanceKm: 0,
          entries: [{ id: "e1" }, { id: "e2" }],
          daySummary: { lines: ["Two visits."] },
        },
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
      { id: "admin1", role: "admin", email: "malik@pinasz.com", salesman_name: "Malik", is_active: true },
      { id: "u1", role: "salesman", email: "one@madiba.com", report_email: "one@company.com", salesman_name: "Sales One", is_active: true },
    ]),
    loadSummary: async () => ({ daySummary: { lines: ["No visits today."] } }),
  });

  assert.equal(result.userCount, 1);
  assert.equal(sent.some((message) => /malik@pinasz\.com|Malik/.test(message.subject)), false);
  assert.equal(sent.some((message) => message.subject.includes("Sales One")), true);
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

  assert.equal(result.sentCount, 2);
  assert.equal(sent.length, 2);
  assert.match(sent[0].subject, /Sales Two/);
  assert.equal(sent.some((message) => message.subject.includes("Sales One")), false);
  assert.equal(sent.some((message) => /Team digest — All teams/.test(message.subject)), true);
});

test("runDailyVisitReportEmailCycle sends bosses one team target vs achievement email", async () => {
  const sent = [];
  const belalSnapshot = buildPerformanceSnapshot({
    reportDate: "2026-09-02",
    salesmanCode: "BELAL",
    salesmanName: "Belal",
    actuals: { officeSupplies: 40, otherSales: 10, collection: 5, newCustomers: 1, repeatCustomers: 2 },
    targets: { officeSupplies: 100, otherSales: 20, collection: 10, newCustomers: 2, repeatCustomers: 4 },
  });
  const result = await runDailyVisitReportEmailCycle({}, {
    date: "2026-09-02",
    userIds: ["belal"],
    env: {
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "sfa@madiba.com",
      DAILY_VISIT_REPORT_TO: "office@madiba.com",
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
      { id: "belal", role: "salesman", salesman_code: "BELAL", salesman_name: "Belal", email: "belal@madiba-sfa.local", report_email: "belal@company.com", is_active: true },
      { id: "nabil", role: "salesman", salesman_code: "AHMED NABIL", salesman_name: "Ahmed Nabil", email: "nabil@madiba-sfa.local", report_email: "ahmed.nabil@noorshukran.com", is_active: true },
      { id: "soyeb", role: "manager", salesman_code: "SOYEB", salesman_name: "Soyeb", email: "soyeb@madiba-sfa.local", report_email: "soyeb@company.com", is_active: true },
    ]),
    loadAuthUsers: async () => ([
      { id: "belal", user_metadata: { head_salesman_code: "AHMED NABIL" } },
      { id: "nabil", user_metadata: { head_salesman_code: "SOYEB" } },
      { id: "soyeb", user_metadata: {} },
    ]),
    loadSummary: async () => ({ daySummary: { lines: ["One visit."] } }),
    loadKpis: async () => [belalSnapshot],
    loadTeamTargets: async () => new Map([
      ["TEAM::AHMED NABIL", {
        targets: { officeSupplies: 250, otherSales: 150, collection: 80, newCustomers: 6, repeatCustomers: 12, totalSales: 400 },
      }],
    ]),
  });

  const teamEmails = sent.filter((message) => /Team digest/.test(message.subject));
  assert.equal(result.results.filter((row) => /_digest$/.test(row.kind || "") && row.status === "sent").length, teamEmails.length);
  assert.ok(teamEmails.length >= 2);
  assert.equal(teamEmails.some((message) => message.to.includes("ahmed.nabil@noorshukran.com")), true);
  assert.equal(teamEmails.some((message) => message.to.includes("soyeb@company.com")), true);
  assert.equal(teamEmails.some((message) => message.html.includes("Team members")), true);
  assert.equal(teamEmails.some((message) => message.html.includes("Belal (BELAL)")), true);
  assert.equal(sent.filter((message) => message.subject.includes("Belal") && !/Team target vs achievement/.test(message.subject)).length, 1);
});

test("salesman heads get team target vs achievement inside their own visit email", async () => {
  const sent = [];
  const junaidSnapshot = buildPerformanceSnapshot({
    reportDate: "2026-09-13",
    salesmanCode: "JUNAID",
    salesmanName: "JUNAID",
    actuals: { officeSupplies: 12071, otherSales: 12825, collection: 113993, newCustomers: 3, repeatCustomers: 3 },
    targets: { officeSupplies: 0, otherSales: 50000, collection: 0, newCustomers: 10, repeatCustomers: 0 },
  });
  const parvezSnapshot = buildPerformanceSnapshot({
    reportDate: "2026-09-13",
    salesmanCode: "PARVEZ",
    salesmanName: "PARVEZ",
    actuals: { officeSupplies: 5000, otherSales: 7000, collection: 20000, newCustomers: 1, repeatCustomers: 2 },
    targets: { officeSupplies: 10000, otherSales: 15000, collection: 30000, newCustomers: 3, repeatCustomers: 4 },
  });

  const result = await runDailyVisitReportEmailCycle({}, {
    date: "2026-09-13",
    userIds: ["junaid", "parvez"],
    env: {
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "sfa@madiba.com",
      DAILY_VISIT_REPORT_TO: "office@madiba.com",
    },
    send: async (message) => {
      sent.push(message);
      return { provider: "test" };
    },
    loadReport: async () => ({
      date: "2026-09-13",
      thresholdKm: 0.5,
      users: [
        {
          userId: "junaid",
          userName: "JUNAID (JUNAID)",
          email: "junaid@madiba-sfa.local",
          visitCount: 0,
          farFromCustomerCount: 0,
          totalRouteDistanceKm: 0,
          entries: [],
          daySummary: { lines: ["No visits today."] },
        },
        {
          userId: "parvez",
          userName: "PARVEZ (PARVEZ)",
          email: "parvez@madiba-sfa.local",
          visitCount: 2,
          farFromCustomerCount: 0,
          totalRouteDistanceKm: 4,
          entries: [],
          daySummary: { lines: ["Two visits."] },
        },
      ],
    }),
    loadProfiles: async () => ([
      {
        id: "junaid",
        role: "salesman",
        salesman_code: "JUNAID",
        salesman_name: "JUNAID",
        email: null,
        report_email: "junaid.thonse@noorshukran.com",
        is_active: true,
      },
      {
        id: "parvez",
        role: "salesman",
        salesman_code: "PARVEZ",
        salesman_name: "PARVEZ",
        email: null,
        report_email: "parvez.patagar@noorshukran.com",
        is_active: true,
      },
      {
        id: "soyeb",
        role: "manager",
        salesman_code: "SOYEB",
        salesman_name: "SOYEB",
        email: "soyeb@madiba-sfa.local",
        report_email: "soyeb@company.com",
        is_active: true,
      },
    ]),
    loadAuthUsers: async () => ([
      { id: "junaid", user_metadata: { head_salesman_code: "SOYEB" } },
      { id: "parvez", user_metadata: { head_salesman_code: "JUNAID", head_salesman_name: "JUNAID" } },
      { id: "soyeb", user_metadata: {} },
    ]),
    loadSummary: async () => ({ daySummary: { lines: ["No visits today."] } }),
    loadKpis: async (_admin, { salesmen }) => salesmen.map((row) => (
      row.userId === "junaid" ? junaidSnapshot : parvezSnapshot
    )),
    loadTeamTargets: async () => new Map([
      ["TEAM::JUNAID", {
        targets: { officeSupplies: 0, otherSales: 80000, collection: 0, newCustomers: 15, repeatCustomers: 0, totalSales: 80000 },
      }],
    ]),
  });

  const junaidEmail = sent.find((message) => (
    message.subject.includes("JUNAID") && !/Team target vs achievement/.test(message.subject)
  ));
  assert.ok(junaidEmail);
  assert.match(junaidEmail.html, /Monthly KPI status/);
  assert.match(junaidEmail.html, /Team target vs achievement/);
  assert.match(junaidEmail.html, /PARVEZ \(PARVEZ\)/);
  assert.match(junaidEmail.text, /Team target vs achievement/);
  assert.equal(result.results.some((row) => row.userId === "junaid" && row.hasTeamKpis), true);

  assert.equal(
    sent.some((message) => (
      /Team digest/.test(message.subject)
      && message.to.includes("junaid.thonse@noorshukran.com")
      && message.html.includes("PARVEZ")
    )),
    true,
  );
  assert.equal(
    sent.some((message) => (
      /Team digest/.test(message.subject)
      && message.to.includes("soyeb@company.com")
    )),
    true,
  );
});

test("buildUserVisitReportEmail can include team target vs achievement for bosses", () => {
  const team = buildPerformanceSnapshot({
    reportDate: "2026-09-13",
    salesmanCode: "TEAM",
    salesmanName: "JUNAID — team",
    actuals: { officeSupplies: 17071, otherSales: 19825, collection: 133993, newCustomers: 4, repeatCustomers: 5 },
    targets: { officeSupplies: 0, otherSales: 80000, collection: 0, newCustomers: 15, repeatCustomers: 0 },
  });
  const members = [
    buildPerformanceSnapshot({
      reportDate: "2026-09-13",
      salesmanCode: "JUNAID",
      salesmanName: "JUNAID",
      actuals: { officeSupplies: 12071, otherSales: 12825, collection: 113993, newCustomers: 3, repeatCustomers: 3 },
      targets: { officeSupplies: 0, otherSales: 50000, collection: 0, newCustomers: 10, repeatCustomers: 0 },
    }),
    buildPerformanceSnapshot({
      reportDate: "2026-09-13",
      salesmanCode: "PARVEZ",
      salesmanName: "PARVEZ",
      actuals: { officeSupplies: 5000, otherSales: 7000, collection: 20000, newCustomers: 1, repeatCustomers: 2 },
      targets: { officeSupplies: 10000, otherSales: 15000, collection: 30000, newCustomers: 3, repeatCustomers: 4 },
    }),
  ];
  const message = buildUserVisitReportEmail({
    date: "2026-09-13",
    user: {
      userName: "JUNAID (JUNAID)",
      visitCount: 0,
      farFromCustomerCount: 0,
      totalRouteDistanceKm: 0,
      entries: [],
      performance: members[0],
    },
    team,
    teamMembers: members,
  });

  assert.match(message.html, /Monthly KPI status/);
  assert.match(message.html, /Team target vs achievement/);
  assert.match(message.html, /Team members/);
  assert.match(message.html, /PARVEZ \(PARVEZ\)/);
  assert.match(message.text, /Team target vs achievement/);
});
