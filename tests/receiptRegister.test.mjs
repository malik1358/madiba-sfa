import test from "node:test";
import assert from "node:assert/strict";
import {
  excelDateToIso,
  findReceiptHeaderRow,
  parseParticularsParty,
  parseReceiptRegisterRows,
  prioritizeReceiptSheets,
} from "../app/lib/receiptRegister.js";

const NEW_FORMAT_HEADER = [
  "TRANSACTIONDATE",
  "VOUCHERTYPENAME",
  "VOUCHERNUMBER",
  "LEDGERNAME",
  "Cr",
];

test("findReceiptHeaderRow accepts the TRANSACTIONDATE / LEDGERNAME / Cr export", () => {
  const header = findReceiptHeaderRow([
    ["ignored"],
    NEW_FORMAT_HEADER,
  ]);

  assert.ok(header);
  assert.equal(header.headerRowIndex, 1);
  assert.equal(header.columns.date, 0);
  assert.equal(header.columns.vchType, 1);
  assert.equal(header.columns.vchNo, 2);
  assert.equal(header.columns.particulars, 3);
  assert.equal(header.columns.credit, 4);
});

test("parseReceiptRegisterRows keeps Receipt and JV-Collection rows from the new format", () => {
  const lookup = {
    byCode: new Map([
      ["1006", { customer_code: "1006", customer_name: "ABDULLAH HAMAD AL DAKHEEL TRADING EST." }],
      ["1144", { customer_code: "1144", customer_name: "HELAL ALSAIF TRADING Est" }],
    ]),
    byName: new Map(),
  };

  const parsed = parseReceiptRegisterRows([
    NEW_FORMAT_HEADER,
    [new Date("2026-01-01T00:00:00.000Z"), "Receipt", "1", "1006  ABDULLAH HAMAD AL DAKHEEL TRADING EST.", 500],
    [new Date("2026-01-01T00:00:00.000Z"), "Receipt", "2", "Uncleared Payments of Clients", 1038.5],
    [new Date("2026-01-08T00:00:00.000Z"), "JV-Collection", "45", "1144  HELAL ALSAIF TRADING Est", 837.2],
    [new Date("2026-01-09T00:00:00.000Z"), "Payment", "99", "1006  ABDULLAH HAMAD AL DAKHEEL TRADING EST.", 10],
  ], null, lookup);

  assert.equal(parsed.rows.length, 3);
  assert.deepEqual(parsed.dates, ["2026-01-01", "2026-01-08"]);
  assert.equal(parsed.rows[0].receipt_date, "2026-01-01");
  assert.equal(parsed.rows[0].customer_code, "1006");
  assert.equal(parsed.rows[0].vch_no, "1");
  assert.equal(parsed.rows[0].amount, 500);
  assert.equal(parsed.rows[0].matched, true);
  assert.equal(parsed.rows[1].customer_code, "");
  assert.equal(parsed.rows[1].matched, false);
  assert.equal(parsed.rows[2].vch_type, "JV-Collection");
  assert.equal(parsed.rows[2].customer_code, "1144");
  assert.equal(parsed.rows[2].amount, 837.2);
  assert.equal(parsed.matchedCount, 2);
  assert.equal(parsed.unmatchedCount, 1);
});

test("parseParticularsParty keeps letter suffixes on customer codes", () => {
  const party = parseParticularsParty("1194C  Muhammed Awad Awn  Al-Rahmani Est.");
  assert.equal(party.customer_code, "1194C");
  assert.match(party.customer_name, /Muhammed Awad Awn/i);
});

test("excelDateToIso reads US-style dates when the day is > 12", () => {
  assert.equal(excelDateToIso("9/20/2026"), "2026-09-20");
  assert.equal(excelDateToIso("20/9/2026"), "2026-09-20");
  assert.equal(excelDateToIso("09-18-2026"), "2026-09-18");
});

test("prioritizeReceiptSheets prefers Export when no receipt sheet name exists", () => {
  assert.deepEqual(
    prioritizeReceiptSheets(["Summary", "Export", "Other"]),
    ["Export", "Summary", "Other"],
  );
});
