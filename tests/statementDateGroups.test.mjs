import assert from "node:assert/strict";
import test from "node:test";
import { groupStatementRowsByDate, statementDayDifference } from "../app/lib/statementDateGroups.js";

test("statement lines on the same date stay one group until opened", () => {
  const groups = groupStatementRowsByDate([
    { id: "a", date: "2026-02-07", voucher: "NFD/57", status: "amount", tallyDebit: 100, tallyCredit: 0, sfaDebit: 90, sfaCredit: 0, difference: 10 },
    { id: "b", date: "2026-02-07", voucher: "12", status: "matched", tallyDebit: 0, tallyCredit: 40, sfaDebit: 0, sfaCredit: 40, difference: 0 },
    { id: "c", date: "2026-02-23", voucher: "71", status: "tally_only", tallyDebit: 25, tallyCredit: 0, sfaDebit: 0, sfaCredit: 0, difference: 25, leadsGap: true },
  ]);

  assert.deepEqual(groups.map((group) => group.date), ["2026-02-07", "2026-02-23"]);
  assert.equal(groups[0].rows.length, 2);
  assert.deepEqual(groups[0].rows.map((row) => row.voucher), ["NFD/57", "12"]);
  assert.equal(groups[0].tallyDebit, 100);
  assert.equal(groups[0].tallyCredit, 40);
  assert.equal(groups[0].difference, 10);
  assert.equal(groups[0].issueCount, 1);
  assert.equal(groups[1].leadsGap, true);
});

test("a day total that rounds to zero is not shown", () => {
  const groups = groupStatementRowsByDate([
    { date: "2026-02-07", status: "amount", difference: 0.5, tallyDebit: 0, tallyCredit: 0, sfaDebit: 0, sfaCredit: 0 },
    { date: "2026-02-07", status: "amount", difference: -0.504, tallyDebit: 0, tallyCredit: 0, sfaDebit: 0, sfaCredit: 0 },
  ]);
  assert.equal(groups[0].difference, 0);
  assert.equal(statementDayDifference(groups[0].difference), null);
  assert.equal(statementDayDifference(-0.004), null);
  assert.equal(statementDayDifference(-0), null);
  assert.equal(statementDayDifference(-1.5), -1.5);
  assert.equal(statementDayDifference(-0.01), -0.01);
});
