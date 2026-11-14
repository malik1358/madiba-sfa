import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EXPECTED_STOCKED_SALES_EMAIL_TO,
  buildExpectedStockedCohortTrendRows,
  buildExpectedStockedSalesEmail,
  buildExpectedStockedTrendLabel,
  compareExpectedStockedMetric,
  expectedStockedSalesEmailCc,
  expectedStockedSalesEmailClaimKey,
  expectedStockedSalesEmailRecipients,
  expectedStockedSalesEmailWeekMonday,
} from "../app/lib/expectedStockedSalesEmail.js";
import { resolveExpectedStockedSalesEmailSchedule } from "../app/lib/expectedStockedSalesEmailServer.js";

test("expected stocked sales email defaults to Malik", () => {
  assert.deepEqual(expectedStockedSalesEmailRecipients({}), [DEFAULT_EXPECTED_STOCKED_SALES_EMAIL_TO]);
});

test("expected stocked sales test override replaces recipients and skips CC", () => {
  const env = {
    EXPECTED_STOCKED_SALES_EMAIL_TEST_TO: "qa@example.com",
    EXPECTED_STOCKED_SALES_EMAIL_CC: "copy@example.com",
  };
  const to = expectedStockedSalesEmailRecipients(env);
  assert.deepEqual(to, ["qa@example.com"]);
  assert.deepEqual(expectedStockedSalesEmailCc(env, to), []);
});

test("week claim uses Monday of the KSA week", () => {
  assert.equal(expectedStockedSalesEmailWeekMonday("2026-11-15"), "2026-11-09"); // Sunday
  assert.equal(expectedStockedSalesEmailWeekMonday("2026-11-09"), "2026-11-09"); // Monday
  assert.equal(expectedStockedSalesEmailWeekMonday("2026-11-11"), "2026-11-09"); // Wednesday
  assert.equal(
    expectedStockedSalesEmailClaimKey("2026-11-15"),
    "expected_stocked_sales_email:2026-11-09",
  );
});

test("trend labels show up and down against the prior week", () => {
  const up = compareExpectedStockedMetric(1_600_000, 1_500_000);
  const down = compareExpectedStockedMetric(1_400_000, 1_500_000);
  const first = compareExpectedStockedMetric(1_500_000, null);
  assert.equal(up.direction, "up");
  assert.equal(down.direction, "down");
  assert.match(buildExpectedStockedTrendLabel(up).text, /Up/);
  assert.match(buildExpectedStockedTrendLabel(down).text, /Down/);
  assert.match(buildExpectedStockedTrendLabel(first).text, /No prior week/);
});

test("cohort trend rows cover sales, GP, margin, and item count", () => {
  const rows = buildExpectedStockedCohortTrendRows(
    { itemCount: 221, expectedSales: 1_504_935.23, expectedProfit: 249_526.01, expectedGpPercent: 16.58 },
    { itemCount: 220, expectedSales: 1_450_000, expectedProfit: 240_000, expectedGpPercent: 16.55 },
  );
  assert.equal(rows.length, 4);
  assert.equal(rows[0].direction, "up");
  assert.match(rows[0].currentText, /1,504,935\.23/);
  assert.match(rows[2].label, /margin/i);
});

test("weekly email subject and body show both cohorts and link", () => {
  const message = buildExpectedStockedSalesEmail({
    date: "2026-11-15",
    report: {
      asOfDate: "2026-11-15",
      season: { calendarMonths: ["08", "09", "10"] },
      summary: {
        itemCount: 221,
        expectedSales: 1_504_935.23,
        expectedProfit: 249_526.01,
        expectedGpPercent: 16.58,
      },
      profitableSummary: {
        itemCount: 242,
        expectedSales: 2_019_346.63,
        expectedProfit: 272_824.77,
        expectedGpPercent: 13.51,
      },
      categoryRows: [{
        category: "Building Material",
        itemCount: 40,
        expectedSales: 643_211.16,
        expectedProfit: 108_532.87,
        expectedGpPercent: 16.87,
      }],
      profitableCategoryRows: [{
        category: "Building Material",
        itemCount: 45,
        expectedSales: 1_115_933.66,
        expectedProfit: 131_205.69,
        expectedGpPercent: 11.76,
      }],
    },
    previous: {
      asOfDate: "2026-11-08",
      gp10: {
        itemCount: 220,
        expectedSales: 1_450_000,
        expectedProfit: 240_000,
        expectedGpPercent: 16.55,
      },
      gp0: {
        itemCount: 240,
        expectedSales: 1_950_000,
        expectedProfit: 260_000,
        expectedGpPercent: 13.33,
      },
    },
    env: { APP_ORIGIN: "https://madiba-sfa.vercel.app" },
  });

  assert.match(message.subject, /15\/11\/2026/);
  assert.match(message.subject, /GP>10% up/);
  assert.match(message.subject, /all profitable up/);
  assert.match(message.html, /#0f4c5c/);
  assert.match(message.html, /GP &gt; 10%/);
  assert.match(message.html, /GP &gt; 0%/);
  assert.match(message.html, /Building Material/);
  assert.match(message.html, /management\/expected-stocked-sales/);
  assert.match(message.html, /▲/);
  assert.equal(message.gp10Direction, "up");
  assert.equal(message.gp0Direction, "up");
});

test("scheduled weekly email skips Friday unless forced", () => {
  const friday = new Date("2026-11-13T05:30:00.000Z"); // Friday 08:30 KSA
  const sunday = new Date("2026-11-15T05:30:00.000Z"); // Sunday 08:30 KSA
  assert.equal(resolveExpectedStockedSalesEmailSchedule(friday).skipped, true);
  assert.equal(resolveExpectedStockedSalesEmailSchedule(friday).reason, "friday_holiday");
  assert.equal(resolveExpectedStockedSalesEmailSchedule(sunday).skipped, false);
  assert.equal(resolveExpectedStockedSalesEmailSchedule(sunday).date, "2026-11-15");
  assert.equal(resolveExpectedStockedSalesEmailSchedule(friday, { force: true }).skipped, false);
});
