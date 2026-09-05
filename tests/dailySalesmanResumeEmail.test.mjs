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
  runDailySalesmanResumeEmailCycle,
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
        collections: 3,
        visits: 5,
        skuSoldCount: 12,
      },
      {
        salesmanName: "Sara",
        salesmanCode: "SM002",
        orders: 0,
        collections: 1,
        visits: 2,
        skuSoldCount: 0,
      },
    ],
  });

  assert.match(message.subject, /2026-09-04/);
  assert.match(message.html, /Orders/);
  assert.match(message.html, /Collections/);
  assert.match(message.html, /Visits/);
  assert.match(message.html, /SKU sold/);
  assert.match(message.html, /Ahmed \(SM001\)/);
  assert.match(message.html, />12</);
  assert.match(message.text, /Sara \(SM002\) \| 0 \| 1 \| 2 \| 0/);
  assert.deepEqual(message.totals, {
    orders: 2,
    collections: 4,
    visits: 7,
    skuSoldCount: 12,
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
    orderMetrics: new Map([["u1", { orders: 3, skuSoldCount: 15 }]]),
  });

  assert.equal(rows.length, 2);
  const ahmed = rows.find((row) => row.userId === "u1");
  assert.deepEqual(
    {
      orders: ahmed.orders,
      collections: ahmed.collections,
      visits: ahmed.visits,
      skuSoldCount: ahmed.skuSoldCount,
    },
    { orders: 3, collections: 2, visits: 4, skuSoldCount: 15 },
  );
});

test("summarizeSalesmanResumeRows totals columns", () => {
  assert.deepEqual(
    summarizeSalesmanResumeRows([
      { orders: 1, collections: 2, visits: 3, skuSoldCount: 4 },
      { orders: 5, collections: 6, visits: 7, skuSoldCount: 8 },
    ]),
    { orders: 6, collections: 8, visits: 10, skuSoldCount: 12 },
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
