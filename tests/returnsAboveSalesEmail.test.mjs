import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_RETURNS_ABOVE_SALES_EMAIL_TO,
  buildReturnsAboveSalesEmail,
  returnsAboveSalesEmailCc,
  returnsAboveSalesEmailRecipients,
} from "../app/lib/returnsAboveSalesEmail.js";
import { resolveReturnsAboveSalesEmailSchedule } from "../app/lib/returnsAboveSalesEmailServer.js";

test("returns above sales email goes to Vinit, Badrish, and Malik", () => {
  assert.deepEqual(returnsAboveSalesEmailRecipients({}), DEFAULT_RETURNS_ABOVE_SALES_EMAIL_TO);
  assert.deepEqual(returnsAboveSalesEmailRecipients({}), [
    "vinit.kulkarni@noorshukran.com",
    "badrish.thapliyal@noorshukran.com",
    "malik@pinasz.com",
  ]);
});

test("returns above sales test override replaces the daily list and skips CC", () => {
  const env = {
    RETURNS_ABOVE_SALES_EMAIL_TEST_TO: "qa@example.com",
    RETURNS_ABOVE_SALES_EMAIL_CC: "copy@example.com",
  };
  const to = returnsAboveSalesEmailRecipients(env);
  assert.deepEqual(to, ["qa@example.com"]);
  assert.deepEqual(returnsAboveSalesEmailCc(env, to), []);
});

test("returns above sales email lists excess value and both voucher columns", () => {
  const message = buildReturnsAboveSalesEmail({
    date: "2026-11-06",
    report: {
      span: { firstDate: "2025-01-01", lastDate: "2026-11-06" },
      summary: { customerCount: 1, itemCount: 1, excessAmount: 4360 },
      rows: [{
        customerCode: "1198",
        customerName: "Sample",
        itemCode: "A004234",
        itemName: "Topstar pen",
        salesAmount: 8720,
        returnAmount: 13080,
        excessAmount: 4360,
        salesVouchers: "1730",
        returnVouchers: "043, 044",
      }],
    },
  });

  assert.match(message.subject, /06\/11\/2026/);
  assert.match(message.subject, /excess 4,360\.00/);
  assert.match(message.html, /#0f4c5c/);
  assert.match(message.html, /Topstar pen/);
  assert.match(message.html, /043, 044/);
  assert.match(message.html, /management\/returns-above-sales/);
});

test("returns above sales email still sends a clear message when the list is empty", () => {
  const message = buildReturnsAboveSalesEmail({
    date: "2026-11-06",
    report: { rows: [], summary: { itemCount: 0, customerCount: 0, excessAmount: 0 } },
  });
  assert.match(message.subject, /none/);
  assert.match(message.html, /No customer and item has return value above sales value/);
});

test("scheduled returns above sales email uses today and skips Friday", () => {
  const friday = new Date("2026-11-06T05:30:00.000Z");
  const saturday = new Date("2026-11-07T05:30:00.000Z");
  assert.equal(resolveReturnsAboveSalesEmailSchedule(friday).skipped, true);
  assert.equal(resolveReturnsAboveSalesEmailSchedule(friday).reason, "friday_holiday");
  assert.equal(resolveReturnsAboveSalesEmailSchedule(saturday).skipped, false);
  assert.equal(resolveReturnsAboveSalesEmailSchedule(saturday).date, "2026-11-07");
  assert.equal(resolveReturnsAboveSalesEmailSchedule(friday, { force: true }).skipped, false);
});
