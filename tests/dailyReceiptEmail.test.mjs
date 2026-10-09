import test from "node:test";
import assert from "node:assert/strict";
import { buildDailyReceiptEmail } from "../app/lib/dailyReceiptEmail.js";
import { parseDailyReceiptReportDate, runDailyReceiptEmailCycle } from "../app/lib/dailyReceiptEmailServer.js";

test("daily receipt email summarizes customer and collector totals", () => {
  const email = buildDailyReceiptEmail({
    date: "2026-10-06",
    salesman: { salesman_code: "S01", salesman_name: "Sales One" },
    receipts: [
      {
        customer_code: "C1",
        customer_name: "Shop One",
        created_by: "collector-1",
        collector_name: "Collector One",
        amount_received: 120.5,
        receipt_mode: "CASH",
      },
      {
        customer_code: "C1",
        customer_name: "Shop One",
        created_by: "collector-2",
        collector_name: "Collector Two",
        amount_received: 30,
        receipt_mode: "BANK",
      },
      {
        customer_code: "C2",
        customer_name: "Shop Two",
        created_by: "collector-1",
        collector_name: "Collector One",
        amount_received: 50,
        receipt_mode: "CASH",
      },
      { customer_code: "C3", amount_received: 0, collector_name: "Collector One" },
    ],
  });

  assert.equal(email.receiptCount, 3);
  assert.equal(email.totalAmount, 200.5);
  assert.match(email.subject, /Sales One - 2026-10-06/);
  assert.match(email.html, /Customer-wise/);
  assert.match(email.html, /Collector-wise/);
  assert.match(email.html, /Collector One/);
  assert.match(email.html, /Collector Two/);
  assert.match(email.text, /2 customers \| 2 receipts \| 170\.50/);
  assert.match(email.text, /1 customers \| 1 receipts \| 30\.00/);
});

test("daily receipt email escapes user data and supports an empty day", () => {
  const email = buildDailyReceiptEmail({
    date: "2026-10-06",
    salesman: { salesman_name: "<Sales & Co>" },
    receipts: [],
  });

  assert.match(email.html, /&lt;Sales &amp; Co&gt;/);
  assert.match(email.html, /No receipts/);
  assert.equal(email.receiptCount, 0);
  assert.equal(email.totalAmount, 0);
});

test("daily receipt cycle sends one email per salesman to the report address", async () => {
  const sent = [];
  const saved = [];
  const result = await runDailyReceiptEmailCycle({}, {
    date: "2026-10-06",
    now: new Date("2026-10-07T00:00:00.000Z"),
    env: {
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "user",
      SMTP_PASS: "pass",
      SMTP_FROM: "noreply@example.com",
    },
    loadMarker: async (_admin, date) => {
      assert.equal(date, "2026-10-06");
      return {};
    },
    loadData: async (_admin, date) => {
      assert.equal(date, "2026-10-06");
      return {
        receiptsBySalesman: new Map([["S01", {
          salesman: { salesman_name: "Sales One", report_email: "reports@example.com", email: "user@example.com" },
          receipts: [{ customer_code: "C1", customer_name: "Shop One", collector_name: "Collector One", created_by: "U1", amount_received: 100 }],
        }]]),
      };
    },
    send: async (message) => sent.push(message),
    saveMarker: async (_admin, marker) => saved.push(marker),
  });

  assert.equal(result.sentCount, 1);
  assert.equal(result.receiptCount, 1);
  assert.deepEqual(sent[0].to, ["reports@example.com"]);
  assert.match(sent[0].html, /Shop One/);
  assert.match(sent[0].html, /Collector One/);
  assert.equal(saved[0].reportDate, "2026-10-06");
});

test("daily receipt cycle skips sent dates and defaults to the previous KSA day", async () => {
  let loaded = false;
  const result = await runDailyReceiptEmailCycle({}, {
    now: new Date("2026-10-07T00:30:00.000Z"),
    env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "noreply@example.com" },
    loadMarker: async () => ({ date: "2026-10-06" }),
    loadData: async () => { loaded = true; return { receiptsBySalesman: new Map() }; },
  });

  assert.equal(parseDailyReceiptReportDate("", new Date("2026-10-07T00:30:00.000Z")), "2026-10-06");
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "already_sent");
  assert.equal(loaded, false);
});