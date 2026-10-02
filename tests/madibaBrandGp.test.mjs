import test from "node:test";
import assert from "node:assert/strict";

import { buildMadibaGpPeriodRows, grossProfitPercent } from "../app/lib/madibaBrandGp.js";

const report = {
  measures: {
    sales: { groups: [
      { label: "Gloves", monthValues: { "2026-07": 100, "2026-08": 300, "2026-09": 0 }, quarterValues: { "2026-Q3": 400 } },
      { label: "Office", monthValues: { "2026-07": 100, "2026-08": 0, "2026-09": 0 }, quarterValues: { "2026-Q3": 100 } },
    ] },
    profit: { groups: [
      { label: "Gloves", monthValues: { "2026-07": 30, "2026-08": 45, "2026-09": -5 }, quarterValues: { "2026-Q3": 70 } },
      { label: "Office", monthValues: { "2026-07": -10, "2026-08": 0, "2026-09": 0 }, quarterValues: { "2026-Q3": -10 } },
    ] },
  },
};

test("MADIBA category GP percentages use net profit divided by net sales", () => {
  const { rows, totals } = buildMadibaGpPeriodRows(report, [{ label: "Gloves" }, { label: "Office" }], ["2026-07", "2026-08", "2026-09"], "monthValues");
  assert.equal(rows[0].gpValues["2026-07"], 30);
  assert.equal(rows[0].gpValues["2026-08"], 15);
  assert.equal(rows[1].gpValues["2026-07"], -10);
  assert.equal(rows[0].gpValues["2026-09"], null);
  assert.equal(totals["2026-07"], 10);
  assert.equal(totals.__total__, 12);
  assert.equal(grossProfitPercent(-20, -5), 25);
  assert.equal(grossProfitPercent(0, 5), null);
});

test("quarterly footer uses only visible category amounts", () => {
  const { rows, totals } = buildMadibaGpPeriodRows(report, [{ label: "Gloves" }], ["2026-Q3"], "quarterValues");
  assert.equal(rows[0].gpValues["2026-Q3"], 17.5);
  assert.equal(totals["2026-Q3"], 17.5);
  assert.equal(totals.__total__, 17.5);
});