import test from "node:test";
import assert from "node:assert/strict";
import {
  filterIgnoredMissing,
  isVisitIgnored,
  markVisitIgnored,
  parseIgnoredMistakes,
  unmarkVisitIgnored,
} from "../app/lib/receiptsNotInTallyIgnore.js";
import {
  buildReceiptsNotInTallyEmail,
  resolveReceiptsNotInTallyEmailRecipients,
} from "../app/lib/receiptsNotInTallyEmail.js";

test("parseIgnoredMistakes reads byVisitId map", () => {
  const dataset = parseIgnoredMistakes({
    byVisitId: {
      "v-1": { ignoredAt: "2026-09-26T10:00:00.000Z", note: "mistake" },
    },
  });
  assert.equal(isVisitIgnored(dataset, "v-1"), true);
  assert.equal(isVisitIgnored(dataset, "v-2"), false);
});

test("mark and unmark visit as mistake", () => {
  let dataset = parseIgnoredMistakes(null);
  dataset = markVisitIgnored(dataset, "abc", {
    ignoredBy: "user-1",
    ignoredByName: "Malik",
    customerCode: "1441",
    amountReceived: 100,
  });
  assert.equal(isVisitIgnored(dataset, "abc"), true);
  assert.equal(dataset.byVisitId.abc.customerCode, "1441");
  dataset = unmarkVisitIgnored(dataset, "abc");
  assert.equal(isVisitIgnored(dataset, "abc"), false);
});

test("filterIgnoredMissing removes marked visits from open list", () => {
  const dataset = markVisitIgnored(parseIgnoredMistakes(null), "gone");
  const open = filterIgnoredMissing([
    { id: "keep", amount_received: 10 },
    { id: "gone", amount_received: 20 },
  ], dataset);
  assert.equal(open.length, 1);
  assert.equal(open[0].id, "keep");
});

test("resolveReceiptsNotInTallyEmailRecipients defaults to Vinit Badrish Prem Malik", () => {
  const recipients = resolveReceiptsNotInTallyEmailRecipients({});
  assert.deepEqual(recipients, [
    "vinit.kulkarni@noorshukran.com",
    "badrish.thapliyal@noorshukran.com",
    "prem.shah@noorshukran.com",
    "malik@pinasz.com",
  ]);
});

test("buildReceiptsNotInTallyEmail includes open rows and excludes empty subject wording", () => {
  const message = buildReceiptsNotInTallyEmail({
    date: "2026-09-26",
    from: "2026-09-01",
    to: "2026-09-26",
    windowDays: 5,
    ignoredCount: 2,
    rows: [
      {
        visitDate: "2026-09-18",
        customerCode: "1441",
        customerName: "Jazeerat",
        amountReceived: 3674,
        receiptMode: "CASH",
        paymentStatus: "PAID",
        collectorName: "Collector A",
      },
    ],
    reportUrl: "https://madiba-sfa.vercel.app/management/receipts-not-in-tally",
  });

  assert.match(message.subject, /1 open/);
  assert.match(message.html, /Jazeerat/);
  assert.match(message.html, /3,674\.00/);
  assert.match(message.html, /Marked mistakes/);
  assert.equal(message.openCount, 1);
});
