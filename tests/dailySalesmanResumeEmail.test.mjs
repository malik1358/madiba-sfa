import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DAILY_SALESMAN_RESUME_TO,
  buildDailySalesmanResumeEmail,
  resolveDailySalesmanResumeRecipients,
  sortSalesmanResumeRows,
  summarizeSalesmanResumeRows,
} from "../app/lib/dailySalesmanResume.js";
import {
  buildSalesmanResumeRows,
  isJwtClockSkewError,
  runDailySalesmanResumeEmailCycle,
  withJwtClockSkewRetry,
} from "../app/lib/dailySalesmanResumeServer.js";

test("resolveDailySalesmanResumeRecipients defaults to malik@pinasz.com", () => {
  assert.deepEqual(resolveDailySalesmanResumeRecipients({}), [DEFAULT_DAILY_SALESMAN_RESUME_TO]);
  assert.deepEqual(
    resolveDailySalesmanResumeRecipients({ DAILY_SALESMAN_RESUME_TO: "boss@madiba.com, malik@pinasz.com" }),
    ["boss@madiba.com", "malik@pinasz.com"],
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
        orderValue: 1900,
        collections: 3,
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
        visits: 2,
        skuSoldCount: 0,
      },
    ],
  });

  assert.match(message.subject, /2026-09-04/);
  assert.match(message.html, /Orders/);
  assert.match(message.html, /Order value/);
  assert.match(message.html, /Collections/);
  assert.match(message.html, /Visits/);
  assert.match(message.html, /SKU sold/);
  assert.match(message.html, /Login/);
  assert.match(message.html, /Working hours/);
  assert.match(message.html, /Ahmed \(SM001\)/);
  assert.match(message.html, /1,900 SAR/);
  assert.match(message.html, /7h/);
  assert.match(message.text, /Sara \(SM002\) \| 0 \| 0 SAR \| 1 \| 2 \| 0 \| - \| - \| - \| - \| -/);
  assert.deepEqual(message.totals, {
    orders: 2,
    orderValue: 1900,
    collections: 4,
    visits: 7,
    skuSoldCount: 12,
    workingMinutes: 420,
  });
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
    collectionCounts: new Map([["u1", 2], ["u2", 1]]),
    orderMetrics: new Map([["u1", { orders: 3, orderValue: 450, skuSoldCount: 15 }]]),
    workdays: new Map([["u1", {
      loginAt: "2026-09-04T06:00:00.000Z",
      lunchOutAt: "2026-09-04T09:00:00.000Z",
      lunchInAt: "2026-09-04T10:00:00.000Z",
      logoutAt: "2026-09-04T14:00:00.000Z",
      workingMinutes: 420,
    }]]),
  });

  assert.equal(rows.length, 2);
  const ahmed = rows.find((row) => row.userId === "u1");
  assert.deepEqual(
    {
      orders: ahmed.orders,
      orderValue: ahmed.orderValue,
      collections: ahmed.collections,
      visits: ahmed.visits,
      skuSoldCount: ahmed.skuSoldCount,
      workingMinutes: ahmed.workingMinutes,
    },
    { orders: 3, orderValue: 450, collections: 2, visits: 4, skuSoldCount: 15, workingMinutes: 420 },
  );
});

test("summarizeSalesmanResumeRows totals columns", () => {
  assert.deepEqual(
    summarizeSalesmanResumeRows([
      { orders: 1, orderValue: 10, collections: 2, visits: 3, skuSoldCount: 4, workingMinutes: 60 },
      { orders: 5, orderValue: 20, collections: 6, visits: 7, skuSoldCount: 8, workingMinutes: 90 },
    ]),
    { orders: 6, orderValue: 30, collections: 8, visits: 10, skuSoldCount: 12, workingMinutes: 150 },
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
  assert.deepEqual(sent[0].to, ["malik@pinasz.com"]);
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
