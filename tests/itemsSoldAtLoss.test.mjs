import test from "node:test";
import assert from "node:assert/strict";
import {
  buildItemsSoldAtLossEmail,
  itemsSoldAtLossEmailRecipients,
} from "../app/lib/itemsSoldAtLossEmail.js";
import {
  buildItemsSoldAtLossReport,
  groupItemsSoldAtLossBySalesman,
  isLossSaleProfit,
  summarizeItemsSoldAtLoss,
} from "../app/lib/itemsSoldAtLoss.js";
import {
  resolveItemsSoldAtLossEmailSchedule,
  runItemsSoldAtLossEmailCycle,
} from "../app/lib/itemsSoldAtLossEmailServer.js";

function lossRow(overrides = {}) {
  return {
    transaction_date: "2026-10-26",
    voucher_number: "NFD/1001",
    voucher_type: "Sales",
    reference: "",
    salesman_code: "AHMED",
    salesman_name: "Ahmed Nabil",
    customer_code: "1001C",
    customer_name: "Alpha Trading",
    item_code: "A001",
    item_name: "Vinyl gloves",
    category: "Gloves",
    local_import: "Local",
    abc_class: "A",
    quantity: 10,
    rate: 5,
    sales_amount: 50,
    profit_amount: -12.5,
    ...overrides,
  };
}

test("loss detection requires negative profit", () => {
  assert.equal(isLossSaleProfit(-0.01), true);
  assert.equal(isLossSaleProfit(0), false);
  assert.equal(isLossSaleProfit(5), false);
  assert.equal(isLossSaleProfit("x"), false);
});

test("report keeps only negative GP lines and totals loss", () => {
  const report = buildItemsSoldAtLossReport({
    sourceRows: [
      lossRow(),
      lossRow({ item_code: "B002", profit_amount: 8, sales_amount: 40 }),
      lossRow({
        salesman_code: "SALEH",
        salesman_name: "Saleh",
        item_code: "C003",
        profit_amount: -3,
        sales_amount: 20,
        quantity: 2,
      }),
    ],
    dateFrom: "2026-10-01",
    dateTo: "2026-10-26",
  });
  assert.equal(report.rows.length, 2);
  assert.equal(report.totals.lineCount, 2);
  assert.equal(report.totals.profitAmount, -15.5);
  assert.equal(report.totals.salesAmount, 70);
  assert.deepEqual(groupItemsSoldAtLossBySalesman(report.rows).map((g) => g.salesman), [
    "Ahmed Nabil",
    "Saleh",
  ]);
});

test("email defaults to malik@pinasz.com and lists salesman item qty price customer", () => {
  assert.deepEqual(itemsSoldAtLossEmailRecipients({}), ["malik@pinasz.com"]);
  assert.deepEqual(itemsSoldAtLossEmailRecipients({
    ITEMS_SOLD_AT_LOSS_EMAIL_TEST_TO: "checker@example.com",
  }), ["checker@example.com"]);

  const rows = buildItemsSoldAtLossReport({ sourceRows: [lossRow()] }).rows;
  const message = buildItemsSoldAtLossEmail({ date: "2026-10-26", rows });
  assert.match(message.subject, /Items sold at loss/);
  assert.match(message.html, /Ahmed Nabil/);
  assert.match(message.html, /Vinyl gloves/);
  assert.match(message.html, /1001C/);
  assert.match(message.html, /Alpha Trading/);
  assert.match(message.html, /-12\.50/);
  assert.match(message.text, /Qty/);
  assert.match(message.text, /Price/);
});

test("scheduled email skips Friday unless forced", () => {
  // 2026-10-23 is Friday in KSA for midday UTC.
  const friday = new Date("2026-10-23T12:00:00.000Z");
  const held = resolveItemsSoldAtLossEmailSchedule(friday);
  assert.equal(held.skipped, true);
  assert.equal(held.reason, "friday_holiday");
  const forced = resolveItemsSoldAtLossEmailSchedule(friday, { force: true });
  assert.equal(forced.skipped, false);
});

test("email cycle claims once and sends loss digests", async () => {
  const sent = [];
  const claims = new Map();
  const admin = {
    from() {
      return {
        insert: async ({ setting_key, setting_value }) => {
          if (claims.has(setting_key)) return { error: { code: "23505" } };
          claims.set(setting_key, setting_value);
          return { error: null };
        },
        update: () => ({
          eq: () => ({
            eq: async () => ({ error: null }),
          }),
        }),
        delete: () => ({
          eq: () => ({
            eq: async () => ({ error: null }),
          }),
        }),
      };
    },
  };

  const result = await runItemsSoldAtLossEmailCycle(admin, {
    date: "2026-10-26",
    force: true,
    env: {
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "u",
      SMTP_PASS: "p",
      SMTP_FROM: "noreply@example.com",
    },
    loadReport: async () => buildItemsSoldAtLossReport({ sourceRows: [lossRow()] }),
    send: async (message) => {
      sent.push(message);
      return { ok: true };
    },
  });

  assert.equal(result.skipped, false);
  assert.equal(result.sentCount, 1);
  assert.equal(result.lineCount, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /\[TEST\]|Items sold at loss/);
  assert.deepEqual(sent[0].to, ["malik@pinasz.com"]);
});

test("summary helper matches footer totals", () => {
  const totals = summarizeItemsSoldAtLoss([
    { quantity: 1, salesAmount: 10, profitAmount: -2 },
    { quantity: 3, salesAmount: 30, profitAmount: -5 },
  ]);
  assert.deepEqual(totals, {
    lineCount: 2,
    quantity: 4,
    salesAmount: 40,
    profitAmount: -7,
  });
});
