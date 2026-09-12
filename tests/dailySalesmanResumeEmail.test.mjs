import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DAILY_SALESMAN_RESUME_TO,
  attachResumeRowBosses,
  buildDailySalesmanResumeEmail,
  classifyResumeTeamLeaders,
  groupSalesmanResumeRowsByBoss,
  isHiddenResumeSalesman,
  isOccasionalResumeSalesman,
  shouldIncludeSalesmanResumeRow,
  formatResumeMoney,
  resolveDailySalesmanResumeRecipients,
  resolveResumeWorkingEndAt,
  sortSalesmanResumeRows,
  summarizeSalesmanResumeRows,
  uniqueSkuCountFromOrderLines,
} from "../app/lib/dailySalesmanResume.js";
import {
  buildSalesmanResumeRows,
  isJwtClockSkewError,
  runDailySalesmanResumeEmailCycle,
  withJwtClockSkewRetry,
} from "../app/lib/dailySalesmanResumeServer.js";

test("resolveDailySalesmanResumeRecipients always includes the default manager inboxes", () => {
  assert.deepEqual(resolveDailySalesmanResumeRecipients({}), [
    DEFAULT_DAILY_SALESMAN_RESUME_TO,
    "soyeb@noorshukran.com",
    "fazlur.rahiman@noorshukran.com",
  ]);
  assert.deepEqual(
    resolveDailySalesmanResumeRecipients({ DAILY_SALESMAN_RESUME_TO: "boss@madiba.com, malik@pinasz.com" }),
    [
      DEFAULT_DAILY_SALESMAN_RESUME_TO,
      "soyeb@noorshukran.com",
      "fazlur.rahiman@noorshukran.com",
      "boss@madiba.com",
    ],
  );
});

test("buildDailySalesmanResumeEmail renders salesman table columns", () => {
  const message = buildDailySalesmanResumeEmail({
    date: "2026-09-04",
    rows: [
      {
        salesmanName: "Ahmed",
        salesmanCode: "SM001",
        orders: 2,
        orderValue: 1900.6,
        invoiceCount: 4,
        invoiceAmount: 2200.4,
        collections: 3,
        collectionValue: 1250.4,
        visits: 5,
        skuSoldCount: 12,
        loginAt: "2026-09-04T06:00:00.000Z",
        lunchOutAt: "2026-09-04T09:00:00.000Z",
        lunchInAt: "2026-09-04T10:00:00.000Z",
        logoutAt: "2026-09-04T14:00:00.000Z",
        workingMinutes: 420,
      },
      {
        salesmanName: "Sara",
        salesmanCode: "SM002",
        orders: 0,
        orderValue: 0,
        collections: 1,
        collectionValue: 80,
        visits: 2,
        skuSoldCount: 0,
      },
    ],
  });

  assert.match(message.subject, /2026-09-04/);
  assert.match(message.html, /Orders/);
  assert.match(message.html, /Order value/);
  assert.match(message.html, /Invoices/);
  assert.match(message.html, /Invoice amount/);
  assert.match(message.html, /Collections/);
  assert.match(message.html, /Collection value/);
  assert.match(message.html, /Visits/);
  assert.match(message.html, /SKU sold/);
  assert.match(message.html, /Login/);
  assert.match(message.html, /Working hours/);
  assert.match(message.html, /Ahmed \(SM001\)/);
  assert.match(message.html, /1,901/);
  assert.match(message.html, /1,250/);
  assert.match(message.html, /2,200/);
  assert.equal(message.html.includes("SAR"), false);
  assert.match(message.html, /#0f4c81/);
  assert.match(message.html, /7h/);
  assert.match(message.html, /Not logged in/);
  assert.match(message.text, /Sara \(SM002\) \| 0 \| 0 \| 0 \| 0 \| 1 \| 80 \| 2 \| 0 \| - \| - \| - \| - \| -/);
  assert.deepEqual(message.totals, {
    orders: 2,
    orderValue: 1900.6,
    invoiceCount: 4,
    invoiceAmount: 2200.4,
    collections: 3,
    collectionValue: 1250.4,
    visits: 5,
    skuSoldCount: 12,
    workingMinutes: 420,
  });
  assert.deepEqual(message.absentTotals, {
    orders: 0,
    orderValue: 0,
    invoiceCount: 0,
    invoiceAmount: 0,
    collections: 1,
    collectionValue: 80,
    visits: 2,
    skuSoldCount: 0,
    workingMinutes: 0,
  });
});

test("uniqueSkuCountFromOrderLines counts distinct item codes", () => {
  assert.equal(uniqueSkuCountFromOrderLines([
    { item_code: "A1", quantity: 2 },
    { item_code: "a1", quantity: 1 },
    { item_code: "B2", quantity: 4 },
    { item_code: "C3", quantity: 0 },
    { item_code: "", quantity: 5 },
  ]), 2);
});

test("formatResumeMoney rounds to whole numbers without currency", () => {
  assert.equal(formatResumeMoney(15380.6), "15,381");
  assert.equal(formatResumeMoney(16283), "16,283");
});

test("resolveResumeWorkingEndAt uses last activity for auto logout", () => {
  assert.equal(
    resolveResumeWorkingEndAt({
      logoutAt: "2026-09-04T20:59:59.999Z",
      logoutAutoClosed: true,
      lastActivityAt: "2026-09-04T12:00:00.000Z",
    }),
    "2026-09-04T12:00:00.000Z",
  );
  assert.equal(
    resolveResumeWorkingEndAt({
      logoutAt: "2026-09-04T14:00:00.000Z",
      lastActivityAt: "2026-09-04T12:00:00.000Z",
    }),
    "2026-09-04T14:00:00.000Z",
  );
});

test("groupSalesmanResumeRowsByBoss keeps first-level leaders in their own team", () => {
  const groups = groupSalesmanResumeRowsByBoss([
    {
      salesmanName: "Belal",
      bossUserId: "nabil",
      teamLeaderUserId: "nabil",
      teamLeaderName: "Ahmed Nabil",
      teamLeaderCode: "AHMED NABIL",
      orders: 1,
      orderValue: 100,
    },
    {
      salesmanName: "George",
      bossUserId: "nabil",
      teamLeaderUserId: "nabil",
      teamLeaderName: "Ahmed Nabil",
      teamLeaderCode: "AHMED NABIL",
      orders: 2,
      orderValue: 50,
    },
    { salesmanName: "Junaid", orders: 1, orderValue: 20 },
    {
      userId: "abdul",
      salesmanName: "Abdul Rehman",
      salesmanCode: "ABDUL REHMAN",
      bossUserId: "soyeb",
      bossName: "Soyeb",
      bossCode: "SOYEB",
      teamLeaderUserId: "abdul",
      teamLeaderName: "Abdul Rehman",
      teamLeaderCode: "ABDUL REHMAN",
      isFirstLevelTeamLeader: true,
      orders: 3,
      orderValue: 80,
    },
  ]);

  assert.deepEqual(groups.map((group) => group.label), [
    "Team — Abdul Rehman (ABDUL REHMAN)",
    "Team — Ahmed Nabil (AHMED NABIL)",
    "No boss",
  ]);
  assert.equal(groups[0].rows[0].salesmanName, "Abdul Rehman");
  assert.equal(groups[1].totals.orders, 3);
  assert.equal(groups[1].totals.orderValue, 150);
  assert.equal(groups[2].rows[0].salesmanName, "Junaid");
});

test("attachResumeRowBosses puts first-level leaders in their own team instead of Soyeb", () => {
  const profiles = [
    { id: "belal", salesman_code: "BELAL", salesman_name: "Belal" },
    { id: "nabil", salesman_code: "AHMED NABIL", salesman_name: "Ahmed Nabil" },
    { id: "abdul", salesman_code: "ABDUL REHMAN", salesman_name: "Abdul Rehman" },
    { id: "thamer", salesman_code: "SM002", salesman_name: "Thamer" },
    { id: "soyeb", salesman_code: "SOYEB", salesman_name: "Soyeb" },
  ];
  const authUsers = [
    { id: "belal", user_metadata: { head_salesman_code: "AHMED NABIL" } },
    { id: "nabil", user_metadata: { head_salesman_code: "SOYEB" } },
    { id: "thamer", user_metadata: { head_salesman_code: "ABDUL REHMAN" } },
    { id: "abdul", user_metadata: { head_salesman_code: "SOYEB" } },
    { id: "soyeb", user_metadata: {} },
  ];

  const classified = classifyResumeTeamLeaders({ profiles, authUsers });
  assert.equal(classified.firstLevelIds.has("nabil"), true);
  assert.equal(classified.firstLevelIds.has("abdul"), true);
  assert.equal(classified.secondTierIds.has("soyeb"), true);

  const rows = attachResumeRowBosses([
    { userId: "belal", salesmanName: "Belal" },
    { userId: "nabil", salesmanName: "Ahmed Nabil", salesmanCode: "AHMED NABIL" },
    { userId: "abdul", salesmanName: "Abdul Rehman", salesmanCode: "ABDUL REHMAN" },
    { userId: "thamer", salesmanName: "Thamer" },
  ], { profiles, authUsers });

  assert.equal(rows.find((row) => row.userId === "abdul").teamLeaderUserId, "abdul");
  assert.equal(rows.find((row) => row.userId === "abdul").isFirstLevelTeamLeader, true);
  assert.equal(rows.find((row) => row.userId === "thamer").teamLeaderUserId, "abdul");
  assert.equal(rows.find((row) => row.userId === "nabil").teamLeaderUserId, "nabil");
  assert.equal(rows.find((row) => row.userId === "belal").teamLeaderUserId, "nabil");

  const groups = groupSalesmanResumeRowsByBoss(rows);
  assert.deepEqual(groups.map((group) => group.label), [
    "Team — Abdul Rehman (ABDUL REHMAN)",
    "Team — Ahmed Nabil (AHMED NABIL)",
  ]);
  assert.equal(groups.some((group) => group.label.includes("Soyeb")), false);
});

test("buildDailySalesmanResumeEmail groups rows by boss when hierarchy is present", () => {
  const message = buildDailySalesmanResumeEmail({
    date: "2026-09-10",
    rows: [
      { salesmanName: "Junaid", salesmanCode: "JUNAID", orders: 1, orderValue: 20, loginAt: "2026-09-10T06:00:00.000Z" },
      { salesmanName: "Belal", salesmanCode: "BELAL", bossUserId: "nabil", bossName: "Ahmed Nabil", bossCode: "AHMED NABIL", orders: 1, orderValue: 100, loginAt: "2026-09-10T06:10:00.000Z" },
    ],
  });

  assert.match(message.html, /Team — Ahmed Nabil \(AHMED NABIL\)/);
  assert.match(message.html, /Team — Ahmed Nabil \(AHMED NABIL\) total/);
  assert.match(message.html, /No boss/);
  assert.match(message.text, /Team — Ahmed Nabil \(AHMED NABIL\)/);
  assert.equal(message.groups.length, 2);
});

test("attachResumeRowBosses uses the reporting hierarchy", () => {
  const rows = attachResumeRowBosses(
    [{ userId: "belal", salesmanName: "Belal" }],
    {
      profiles: [
        { id: "belal", salesman_code: "BELAL", salesman_name: "Belal" },
        { id: "nabil", salesman_code: "AHMED NABIL", salesman_name: "Ahmed Nabil" },
      ],
      authUsers: [
        { id: "belal", user_metadata: { head_salesman_code: "AHMED NABIL" } },
        { id: "nabil", user_metadata: {} },
      ],
    },
  );

  assert.equal(rows[0].bossUserId, "nabil");
  assert.equal(rows[0].bossName, "Ahmed Nabil");
  assert.equal(rows[0].bossCode, "AHMED NABIL");
});

test("sortSalesmanResumeRows ranks by activity then name", () => {
  const sorted = sortSalesmanResumeRows([
    { salesmanName: "Zero", orders: 0, collections: 0, visits: 0, skuSoldCount: 0 },
    { salesmanName: "Busy", orders: 1, collections: 2, visits: 0, skuSoldCount: 0 },
    { salesmanName: "Also Busy", orders: 3, collections: 0, visits: 0, skuSoldCount: 0 },
  ]);
  assert.equal(sorted[0].salesmanName, "Also Busy");
  assert.equal(sorted[1].salesmanName, "Busy");
});

test("buildSalesmanResumeRows aggregates metrics by user", () => {
  const rows = buildSalesmanResumeRows({
    profiles: [
      { id: "u1", role: "salesman", salesman_name: "Ahmed", salesman_code: "SM001" },
      { id: "u2", role: "salesman", salesman_name: "Sara", salesman_code: "SM002" },
    ],
    visitCounts: new Map([["u1", 4]]),
    collectionMetrics: new Map([
      ["u1", { count: 2, value: 400 }],
      ["u2", { count: 1, value: 80 }],
    ]),
    orderMetrics: new Map([["u1", { orders: 3, orderValue: 450, skuSoldCount: 15 }]]),
    invoiceMetrics: new Map([["SM001", { count: 2, amount: 800 }]]),
    hierarchyProfiles: [
      { id: "u1", salesman_code: "SM001", salesman_name: "Ahmed" },
      { id: "boss", salesman_code: "SOYEB", salesman_name: "Soyeb" },
    ],
    authUsers: [
      { id: "u1", user_metadata: { head_salesman_code: "SOYEB" } },
      { id: "boss", user_metadata: {} },
    ],
    workdays: new Map([["u1", {
      loginAt: "2026-09-04T06:00:00.000Z",
      lunchOutAt: "2026-09-04T09:00:00.000Z",
      lunchInAt: "2026-09-04T10:00:00.000Z",
      logoutAt: "2026-09-04T20:59:59.999Z",
      logoutAutoClosed: true,
      lastActivityAt: "2026-09-04T12:00:00.000Z",
    }]]),
  });

  assert.equal(rows.length, 3);
  const ahmed = rows.find((row) => row.userId === "u1");
  assert.deepEqual(
    {
      orders: ahmed.orders,
      orderValue: ahmed.orderValue,
      invoiceCount: ahmed.invoiceCount,
      invoiceAmount: ahmed.invoiceAmount,
      collections: ahmed.collections,
      collectionValue: ahmed.collectionValue,
      visits: ahmed.visits,
      skuSoldCount: ahmed.skuSoldCount,
      workingMinutes: ahmed.workingMinutes,
    },
    {
      orders: 3,
      orderValue: 450,
      invoiceCount: 2,
      invoiceAmount: 800,
      collections: 2,
      collectionValue: 400,
      visits: 4,
      skuSoldCount: 15,
      workingMinutes: 300,
    },
  );
  assert.equal(ahmed.bossUserId, "boss");
  assert.equal(ahmed.bossName, "Soyeb");
});

test("hidden resume names are dropped even with invoices", () => {
  assert.equal(isHiddenResumeSalesman({ salesmanName: "NOON", salesmanCode: "NOON" }), true);
  assert.equal(isHiddenResumeSalesman({ salesmanName: "TRENDYOL", salesmanCode: "TRENDYOL" }), true);
  assert.equal(isHiddenResumeSalesman({ salesmanName: "Unknown user" }), true);
  assert.equal(shouldIncludeSalesmanResumeRow({
    salesmanName: "NOON",
    salesmanCode: "NOON",
    invoiceCount: 14,
    invoiceAmount: 1873,
  }), false);

  const message = buildDailySalesmanResumeEmail({
    date: "2026-09-10",
    rows: [
      { salesmanName: "NOON", salesmanCode: "NOON", invoiceCount: 14, invoiceAmount: 1873 },
      { salesmanName: "TRENDYOL", salesmanCode: "TRENDYOL", invoiceCount: 10, invoiceAmount: 329 },
      { salesmanName: "Unknown user", visits: 6 },
      { salesmanName: "Junaid", salesmanCode: "JUNAID", visits: 0 },
    ],
  });

  assert.equal(message.html.includes("NOON"), false);
  assert.equal(message.html.includes("TRENDYOL"), false);
  assert.equal(message.html.includes("Unknown user"), false);
  assert.match(message.html, /Not logged in/);
  assert.match(message.html, /Junaid \(JUNAID\)/);
});

test("occasional office names appear only with an order or collection", () => {
  assert.equal(isOccasionalResumeSalesman({
    salesmanName: "AHMED NABIL",
    salesmanCode: "AHMED NABIL",
  }), true);
  assert.equal(shouldIncludeSalesmanResumeRow({
    salesmanName: "SOYEB",
    salesmanCode: "SOYEB",
    loginAt: "2026-09-06T06:35:00.000Z",
    logoutAt: "2026-09-06T20:59:00.000Z",
  }), false);

  const rows = buildSalesmanResumeRows({
    profiles: [
      { id: "nabil", role: "salesman", salesman_name: "AHMED NABIL", salesman_code: "AHMED NABIL" },
      { id: "fazlur", role: "salesman", salesman_name: "FAZLUR RAHMAN", salesman_code: "FAZLUR RAHMAN" },
      { id: "soyeb", role: "salesman", salesman_name: "SOYEB", salesman_code: "SOYEB" },
      { id: "junaid", role: "salesman", salesman_name: "JUNAID", salesman_code: "JUNAID" },
      { id: "george", role: "salesman", salesman_name: "GEORGE", salesman_code: "GEORGE" },
    ],
    collectionMetrics: new Map([["soyeb", { count: 1, value: 250 }]]),
    orderMetrics: new Map([["junaid", { orders: 1, orderValue: 100, skuSoldCount: 2 }]]),
    workdays: new Map([
      ["nabil", { loginAt: "", logoutAt: "" }],
      ["soyeb", { loginAt: "2026-09-06T06:35:00.000Z", logoutAt: "2026-09-06T20:59:59.999Z", logoutAutoClosed: true }],
      ["junaid", { loginAt: "2026-09-06T06:00:00.000Z" }],
    ]),
  });

  assert.deepEqual(rows.map((row) => row.userId).sort(), ["george", "junaid", "soyeb"]);
  assert.equal(rows.some((row) => row.userId === "nabil" || row.userId === "fazlur"), false);
});

test("first-level team leaders stay visible even without orders", () => {
  const rows = buildSalesmanResumeRows({
    profiles: [
      { id: "george", role: "salesman", salesman_name: "GEORGE", salesman_code: "GEORGE" },
    ],
    hierarchyProfiles: [
      { id: "george", role: "salesman", salesman_name: "GEORGE", salesman_code: "GEORGE" },
      { id: "nabil", role: "manager", salesman_name: "Ahmed Nabil", salesman_code: "AHMED NABIL" },
      { id: "soyeb", role: "manager", salesman_name: "SOYEB", salesman_code: "SOYEB" },
    ],
    authUsers: [
      { id: "george", user_metadata: { head_salesman_code: "AHMED NABIL" } },
      { id: "nabil", user_metadata: { head_salesman_code: "SOYEB" } },
      { id: "soyeb", user_metadata: {} },
    ],
    workdays: new Map([
      ["george", { loginAt: "2026-09-10T06:00:00.000Z" }],
    ]),
  });

  const nabil = rows.find((row) => row.userId === "nabil");
  assert.equal(Boolean(nabil), true);
  assert.equal(nabil.isFirstLevelTeamLeader, true);
  assert.equal(nabil.teamLeaderUserId, "nabil");
  assert.equal(shouldIncludeSalesmanResumeRow(nabil), true);
});

test("summarizeSalesmanResumeRows totals columns", () => {
  assert.deepEqual(
    summarizeSalesmanResumeRows([
      { orders: 1, orderValue: 10, invoiceCount: 1, invoiceAmount: 12, collections: 2, collectionValue: 15, visits: 3, skuSoldCount: 4, workingMinutes: 60 },
      { orders: 5, orderValue: 20, invoiceCount: 2, invoiceAmount: 18, collections: 6, collectionValue: 25, visits: 7, skuSoldCount: 8, workingMinutes: 90 },
    ]),
    { orders: 6, orderValue: 30, invoiceCount: 3, invoiceAmount: 30, collections: 8, collectionValue: 40, visits: 10, skuSoldCount: 12, workingMinutes: 150 },
  );
});

test("runDailySalesmanResumeEmailCycle sends one table email", async () => {
  const sent = [];
  const result = await runDailySalesmanResumeEmailCycle({}, {
    date: "2026-09-04",
    env: {
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "sfa@madiba.com",
    },
    send: async (message) => {
      sent.push(message);
      return { provider: "test" };
    },
    loadResume: async () => ({
      date: "2026-09-04",
      rows: [
        {
          userId: "u1",
          salesmanName: "Ahmed",
          salesmanCode: "SM001",
          loginAt: "2026-09-04T06:00:00.000Z",
          orders: 1,
          collections: 2,
          visits: 3,
          skuSoldCount: 9,
        },
      ],
    }),
  });

  assert.equal(result.sentCount, 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, [
    "malik@pinasz.com",
    "soyeb@noorshukran.com",
    "fazlur.rahiman@noorshukran.com",
  ]);
  assert.match(sent[0].html, /Ahmed \(SM001\)/);
  assert.match(sent[0].subject, /Daily salesman resume/);
});

test("runDailySalesmanResumeEmailCycle skips when email is not configured", async () => {
  const result = await runDailySalesmanResumeEmailCycle({}, {
    date: "2026-09-04",
    env: {},
    send: async () => {
      throw new Error("should not send");
    },
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "email_not_configured");
});

test("isJwtClockSkewError detects Supabase future iat failures", () => {
  assert.equal(isJwtClockSkewError({ message: "JWT issued at future" }), true);
  assert.equal(isJwtClockSkewError(new Error("column does not exist")), false);
});

test("withJwtClockSkewRetry retries JWT clock skew then succeeds", async () => {
  let attempts = 0;
  const value = await withJwtClockSkewRetry(async () => {
    attempts += 1;
    if (attempts < 2) throw { message: "JWT issued at future" };
    return "ok";
  }, { delayMs: 1 });

  assert.equal(value, "ok");
  assert.equal(attempts, 2);
});
