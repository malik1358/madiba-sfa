import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTallyStatementRecord,
  readTallyStatementRecord,
  tallyStatementSettingKey,
} from "../app/lib/tallyStatementStore.js";

test("statement key uses the account code", () => {
  assert.equal(tallyStatementSettingKey("1009 Bandar"), "tally_statement_v1:1009");
  assert.equal(tallyStatementSettingKey("1009C"), "tally_statement_v1:1009C");
  assert.equal(tallyStatementSettingKey(""), "");
});

test("stored statement keeps ledger lines and drops the file bytes", () => {
  const record = buildTallyStatementRecord({
    fileName: "ledger.pdf",
    opening: { amount: 2838, side: "debit" },
    closing: { amount: 100, side: "credit" },
    entries: [
      { date: "2026-10-08", voucher: "1358", particulars: "Sales", vchType: "Sales", side: "debit", amount: 1080 },
      { date: "", voucher: "skip", amount: 0 },
    ],
  }, { fileName: "ledger.pdf", uploadedBy: "a@b.com", uploadedAt: "2026-10-22T12:00:00.000Z" });

  assert.equal(record.entries.length, 1);
  assert.equal(record.fileName, "ledger.pdf");
  assert.equal(record.opening.amount, 2838);
  assert.equal("pdf" in record, false);

  const again = readTallyStatementRecord(JSON.stringify(record));
  assert.equal(again.entries[0].voucher, "1358");
  assert.equal(readTallyStatementRecord("{"), null);
});
