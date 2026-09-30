import test from "node:test";
import assert from "node:assert/strict";
import {
  detectPartialDateOverwrites,
  detectSalesCoverageGaps,
  isSalesCoverageGapDate,
  summarizeSalesDays,
} from "../app/lib/salesCoverage.js";

function line(date, voucher, salesman) {
  return { transaction_date: date, voucher_number: voucher, salesman_name: salesman };
}

/** A full day for every salesman in the list, one voucher each. */
function fullDay(date, salesmen) {
  return salesmen.map((name, index) => line(date, `${date}-${index}`, name));
}

test("summarizeSalesDays counts lines, vouchers and salesmen per date", () => {
  const days = summarizeSalesDays([
    line("2026-08-30", "RNFD/342", "Osama"),
    line("2026-08-30", "RNFD/342", "Osama"),
    line("2026-08-30", "RNFD/343", "Junaid"),
    line("2026-08-31", "RNFD/346", "Osama"),
  ]);

  assert.deepEqual(days.map((day) => day.date), ["2026-08-30", "2026-08-31"]);
  assert.equal(days[0].lines, 3);
  assert.equal(days[0].vouchers, 2);
  assert.equal(days[0].salesmen, 2);
  assert.deepEqual(days[0].salesman_names, ["JUNAID", "OSAMA"]);
});

test("detectSalesCoverageGaps flags a day left with one salesman", () => {
  const busy = ["Osama", "Junaid", "Zia", "Parvez", "Belal", "George"];
  const rows = [
    ...fullDay("2026-08-27", busy),
    ...fullDay("2026-08-29", busy),
    ...fullDay("2026-08-30", busy),
    ...fullDay("2026-08-31", ["Moinudin"]),
    ...fullDay("2026-09-01", busy),
    ...fullDay("2026-09-02", busy),
  ];

  const gaps = detectSalesCoverageGaps(summarizeSalesDays(rows));

  assert.deepEqual(gaps.map((gap) => gap.date), ["2026-08-31"]);
  assert.equal(gaps[0].salesmen, 1);
  assert.equal(gaps[0].expected_salesmen, 6);
  assert.deepEqual(gaps[0].missing_salesmen, ["BELAL", "GEORGE", "JUNAID", "OSAMA", "PARVEZ", "ZIA"]);
  assert.equal(isSalesCoverageGapDate(gaps, "2026-08-31"), true);
  assert.equal(isSalesCoverageGapDate(gaps, "2026-08-30"), false);
});

test("detectSalesCoverageGaps ignores quiet periods with few salesmen overall", () => {
  const rows = [
    ...fullDay("2026-08-27", ["Osama", "Junaid"]),
    ...fullDay("2026-08-30", ["Osama"]),
    ...fullDay("2026-09-01", ["Osama", "Junaid"]),
  ];

  assert.deepEqual(detectSalesCoverageGaps(summarizeSalesDays(rows)), []);
});

test("detectPartialDateOverwrites warns when an upload drops salesmen from a stored date", () => {
  const existing = summarizeSalesDays(fullDay("2026-08-31", ["Osama", "Junaid", "Moinudin"]));
  const incoming = summarizeSalesDays(fullDay("2026-08-31", ["Moinudin"]));

  const warnings = detectPartialDateOverwrites({ incoming, existing });

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].date, "2026-08-31");
  assert.equal(warnings[0].stored_salesmen, 3);
  assert.equal(warnings[0].incoming_salesmen, 1);
  assert.deepEqual(warnings[0].missing_salesmen, ["JUNAID", "OSAMA"]);
});

test("detectPartialDateOverwrites stays quiet for a complete re-upload", () => {
  const rows = fullDay("2026-08-31", ["Osama", "Junaid", "Moinudin"]);
  const days = summarizeSalesDays(rows);

  assert.deepEqual(detectPartialDateOverwrites({ incoming: days, existing: days }), []);
});

test("detectPartialDateOverwrites ignores stored dates the upload does not contain", () => {
  const existing = summarizeSalesDays(fullDay("2026-08-30", ["Osama", "Junaid", "Moinudin"]));
  const incoming = summarizeSalesDays(fullDay("2026-08-31", ["Moinudin"]));

  assert.deepEqual(detectPartialDateOverwrites({ incoming, existing }), []);
});

test("detectPartialDateOverwrites warns when the same salesman uploads a fraction of the lines", () => {
  const existing = summarizeSalesDays(
    Array.from({ length: 20 }, (_, index) => line("2026-08-31", `V${index}`, "Osama")),
  );
  const incoming = summarizeSalesDays([line("2026-08-31", "V0", "Osama")]);

  const warnings = detectPartialDateOverwrites({ incoming, existing });

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].stored_lines, 20);
  assert.equal(warnings[0].incoming_lines, 1);
  assert.deepEqual(warnings[0].missing_salesmen, []);
});
