import test from "node:test";
import assert from "node:assert/strict";

import {
  expandCollectionRemarkCustomerCodeCandidates,
  extractBillRowCodeCandidates,
  isBillRefNumberFragment,
  looksLikeLedgerPartyNameAfterCode,
  normalizeCollectionRemarkCustomerCode,
  normalizeCollectionRemarkImportRows,
  parseBillsReceivableOcrText,
  parseCollectionRemarkImportText,
  parseCollectionRemarkOcrText,
  parseCollectionRemarkTableText,
  resolveCollectionRemarkCustomerCodeFromKnown,
  sanitizeCollectionRemarkComment,
  suggestCollectionRemarkVisitOutcome,
} from "../app/lib/collectionRemarkImport.js";

test("normalizeCollectionRemarkCustomerCode pulls leading codes", () => {
  assert.equal(normalizeCollectionRemarkCustomerCode("1054C — AL RABEE"), "1054C");
  assert.equal(normalizeCollectionRemarkCustomerCode("1457 Hayat"), "1457");
  assert.equal(normalizeCollectionRemarkCustomerCode(""), "");
});

test("suggestCollectionRemarkVisitOutcome detects legal language", () => {
  assert.equal(
    suggestCollectionRemarkVisitOutcome("case is currently with court"),
    "TRANSFER_TO_LEGAL",
  );
  assert.equal(
    suggestCollectionRemarkVisitOutcome("Ahmed will visit ASAP for payment"),
    "ASKED_COME_LATER",
  );
});

test("parseCollectionRemarkOcrText extracts codes and trailing remarks", () => {
  const ocr = `
1054C — AL RABEE WA AL SAIF LEMTED TRADING Co. (Legal) - / - 148,856.00 Never Never -
case is currently with court, and we are following up with the lawyer regarding the case.
1086C — BAWABT CITY HOME TRADING Co. (Legal) Never Never -
The court has ruled in our favor, and enforcement proceedings are currently underway.
1164C — Khaled Waleed ASKED_COME_LATER Ahmed hadyah fallwing up with this clint for the balance overdue payment I will ask him to visit ASAP to get the amont urgent
`;
  const rows = parseCollectionRemarkOcrText(ocr);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].customerCode, "1054C");
  assert.match(rows[0].remark, /court/i);
  assert.equal(rows[0].visitOutcome, "TRANSFER_TO_LEGAL");
  assert.equal(rows[1].customerCode, "1086C");
  assert.match(rows[1].remark, /enforcement/i);
  assert.equal(rows[2].customerCode, "1164C");
  assert.match(rows[2].remark, /fallwing up with this clint/i);
  assert.doesNotMatch(rows[2].remark, /Ahmed\s+hadyah/i);
  assert.equal(rows[2].visitOutcome, "ASKED_COME_LATER");
});

test("resolveCollectionRemarkCustomerCodeFromKnown remaps OCR variants", () => {
  assert.equal(
    resolveCollectionRemarkCustomerCodeFromKnown("1058", ["1058C", "1059"]),
    "1058C",
  );
  assert.equal(
    resolveCollectionRemarkCustomerCodeFromKnown("478", ["1478", "1479"]),
    "1478",
  );
  assert.equal(
    resolveCollectionRemarkCustomerCodeFromKnown("055", ["1055", "1155"]),
    "1055",
  );
  assert.equal(
    resolveCollectionRemarkCustomerCodeFromKnown("103", ["1030", "1035C", "1103"]),
    "1103",
  );
  assert.equal(
    resolveCollectionRemarkCustomerCodeFromKnown("986", ["1058", "1457"]),
    "",
  );
  assert.ok(expandCollectionRemarkCustomerCodeCandidates("055").includes("1055"));
});

test("sanitizeCollectionRemarkComment drops salesman and customer names", () => {
  assert.equal(
    sanitizeCollectionRemarkComment(
      "Ahmed Nabil good return in next 2 days",
      { customerCode: "1058" },
    ),
    "good return in next 2 days",
  );
  assert.equal(
    sanitizeCollectionRemarkComment(
      "1058 Al -Rowad Wholesale Trading Est. ABDALLA ANTHANATH follow up / dealyed due to wrong credit note..",
      { customerCode: "1058" },
    ),
    "follow up / dealyed due to wrong credit note..",
  );
  assert.doesNotMatch(
    sanitizeCollectionRemarkComment(
      "1457 — Hayat Al Shabab Trading company Ahmed Nabil sunday 1st Nov. expected",
      { customerCode: "1457" },
    ),
    /Hayat|Ahmed Nabil/i,
  );
  // OCR often glues the salesman cell with underscore padding before the remark.
  assert.equal(
    sanitizeCollectionRemarkComment("AhmedNabil_______ sunday 1st Nov. expected"),
    "sunday 1st Nov. expected",
  );
  assert.equal(
    sanitizeCollectionRemarkComment("ABDALLAANTHANATH _ sunday 1st Nov. expected"),
    "sunday 1st Nov. expected",
  );
});

test("parseCollectionRemarkTableText uses Customer and Remarks headers", () => {
  const table = [
    "Customer\tCity / Area\tLast outcome\tRemarks",
    "1054C — AL RABEE (Legal)\t- / -\t-\tcase is currently with court, and we are following up with the lawyer regarding the case.",
    "1457 — Hayat Al Shabab\tRiyadh\tFUNDS_RECEIVED\tPurchas manager i contacted, and the finance department and also visited",
  ].join("\n");
  const rows = parseCollectionRemarkTableText(table);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].customerCode, "1054C");
  assert.match(rows[0].remark, /court/i);
  assert.equal(rows[1].customerCode, "1457");
  assert.match(rows[1].remark, /Purchas manager/i);
});

test("parseCollectionRemarkImportText prefers table when headers present", () => {
  const text = "Customer | Remarks\n1062C | An email was sent to Mr. Fazlur Rahman, following Mr. Malik's approval";
  const rows = parseCollectionRemarkImportText(text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].customerCode, "1062C");
  assert.match(rows[0].remark, /Fazlur Rahman/i);
});

test("normalizeCollectionRemarkImportRows dedupes and keeps selection", () => {
  const rows = normalizeCollectionRemarkImportRows([
    { customerCode: "1054C", remark: "court case follow up with lawyer", selected: true },
    { customer_code: "1054C", remark_english: "duplicate", selected: true },
    { customerCode: "1164C", remark: "follow up next week please", selected: false },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].customerCode, "1054C");
  assert.equal(rows[0].visitOutcome, "TRANSFER_TO_LEGAL");
  assert.equal(rows[1].selected, false);
  assert.equal(rows[1].visitOutcome, "ASKED_COME_LATER");
});

test("parseBillsReceivableOcrText extracts party codes and remarks", () => {
  const ocr = `
ABC LTD Bills Receivable Pending Bills
Date Ref. No. Party's Name State Pending Due on Overdue Invoice Sales person Remarks
27-Jun-26 RNFD/045 1058 Al -Rowad Wholesale Trading Est. Riyadh 2,500.00 27-Jun-26 124 2,500.00 Ahmed Nabil good return in next 2 days
15-Jul-26 NFD/199 1053 AL RABEE ARABIYA TRADING Co. Riyadh 1,100.00 15-Jul-26 105 1,100.00 ABDALLA ANTHANATH follow up / dealyed due to wrong credit note..
01-Aug-26 NFD/210 1005 Abdullah bin mousa al kabbi Trading Est. Riyadh 800.00 01-Aug-26 88 800.00 Ahmed Nabil Blanace confirmation today / payment 1st Nov. if not then legal
10-Aug-26 NFD/220 1062 AL TAWFEER TRADING COMPANY Riyadh 400.00 10-Aug-26 79 400.00 Ahmed Nabil Shop closed so write off this amount / an email is shared
16-Sep-26 NFD/301 1468_Bahr Al-Takhfid Trading Company Riyadh 900.00 16-Sep-26 40 900.00 Ahmed Nabil sunday 1st Nov. expected
`;
  const rows = parseBillsReceivableOcrText(ocr);
  const byCode = Object.fromEntries(rows.map((row) => [row.customerCode, row]));
  assert.equal(byCode["1058"].remark, "good return in next 2 days");
  assert.equal(byCode["1053"].remark, "follow up / dealyed due to wrong credit note..");
  assert.match(byCode["1005"].remark, /Blanace confirmation/i);
  assert.doesNotMatch(byCode["1058"].remark, /Ahmed Nabil|Rowad|Trading/i);
  assert.doesNotMatch(byCode["1053"].remark, /ABDALLA|RABEE/i);
  assert.equal(byCode["1005"].visitOutcome, "TRANSFER_TO_LEGAL");
  assert.match(byCode["1062"].remark, /Shop closed/i);
  assert.equal(byCode["1062"].visitOutcome, "TRANSFER_TO_LEGAL");
  assert.equal(byCode["1468"].remark, "sunday 1st Nov. expected");
  assert.match(byCode["1468"].partyName || "", /Bahr Al-Takhfid/i);
});

test("parseBillsReceivableOcrText uses party code after Ref. No. not NFD/986", () => {
  const row = "13-Jun-26 NFD/986 1468_Bahr Al-Takhfid Trading Company Riyadh 9,315.00 13-Jul-26 107 137 Ahmed Nabil sunday 1st Nov. expected";
  assert.equal(isBillRefNumberFragment(row, row.indexOf("986")), true);
  assert.equal(isBillRefNumberFragment(row, row.indexOf("1468")), false);

  const candidates = extractBillRowCodeCandidates(row);
  assert.ok(candidates.includes("1468"));
  assert.equal(candidates.includes("986"), false);

  const rows = parseBillsReceivableOcrText(`Pending Bills\n${row}`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].customerCode, "1468");
  assert.match(rows[0].partyName || "", /Bahr Al-Takhfid/i);
  assert.equal(rows[0].remark, "sunday 1st Nov. expected");
  assert.doesNotMatch(rows[0].customerCodeCandidates.join(","), /\b986\b/);
});

test("parseBillsReceivableOcrText handles WhatsApp OCR brackets and mangled dates", () => {
  const ocr = `
Pending Bills
131un-26_[NFD/986 [1468 Bohr AlTakhfid Trading Company [Riyadh [9315 [13Jui26 [107 [157  |AhmedNabil______|sunday 1st Nov. expected
23-Apr-26 [NFD/478 [1435 Toot AlNoor Trading Establishment [Riyadh [531 [23-May-26 [158 [188 |ABDALLAANTHANATH _|sunday 1st Nov. expected
1-Jun-26[NFD/901 [1313 Halima Hassan Ali Al-Zubaidi General Contracting Establishment_|Riyadh [733 [1-Ju-26 [119 [149 |ABDALLAANTHANATH _|sunday 1st Nov. expected
`;
  const rows = parseBillsReceivableOcrText(ocr);
  const byCode = Object.fromEntries(rows.map((row) => [row.customerCode, row]));
  assert.equal(byCode["1468"]?.remark, "sunday 1st Nov. expected");
  assert.equal(byCode["1435"]?.remark, "sunday 1st Nov. expected");
  assert.equal(byCode["1313"]?.customerCode, "1313");
  assert.equal(Boolean(byCode["986"]), false);
  assert.equal(Boolean(byCode["2026"]), false);
});

test("parseBillsReceivableOcrText keeps ledger primary and invoice candidates", () => {
  assert.equal(looksLikeLedgerPartyNameAfterCode("Ahmed Nabil sunday 1st Nov. expected"), false);
  assert.equal(looksLikeLedgerPartyNameAfterCode("Al -Rowad Wholesale Trading Est."), true);
  assert.equal(normalizeCollectionRemarkCustomerCode("1468_Bahr Al-Takhfid Trading Company"), "1468");

  const segment = "1058 Al -Rowad Wholesale Trading Est. Riyadh 2,500.00 124 7258 Ahmed Nabil good return";
  const candidates = extractBillRowCodeCandidates(segment, { primaryCode: "1058" });
  assert.ok(candidates.includes("1058"));
  assert.ok(candidates.includes("7258"));
  assert.equal(
    resolveCollectionRemarkCustomerCodeFromKnown("986", ["1058", "1478"]),
    "",
  );
  assert.equal(
    resolveCollectionRemarkCustomerCodeFromKnown("7258", ["1058", "7258", "1478"]),
    "7258",
  );

  const ocr = `
Pending Bills
27-Jun-26 RNFD/045 1058 Al -Rowad Wholesale Trading Est. Riyadh 2,500.00 124 7258 Ahmed Nabil good return in next 2 days
16-Sep-26 NFD/199 1468_Bahr Al-Takhfid Trading Company Riyadh 900.00 40 1939 ABDALLA ANTHANATH sunday 1st Nov. expected
`;
  const rows = parseBillsReceivableOcrText(ocr);
  const codes = rows.map((row) => row.customerCode).sort();
  assert.deepEqual(codes, ["1058", "1468"]);
  assert.equal(rows.find((row) => row.customerCode === "1058")?.remark, "good return in next 2 days");
  assert.ok(rows.find((row) => row.customerCode === "1058")?.customerCodeCandidates.includes("7258"));
  assert.ok(rows.find((row) => row.customerCode === "1468")?.customerCodeCandidates.includes("1939"));
});

test("parseCollectionRemarkOcrText auto-detects bills receivable layout", () => {
  const rows = parseCollectionRemarkOcrText(`
Pending Bills
12-Sep-26 NFD/300 1457 Hayat Al Shabab Trading company Riyadh 500.00 12-Sep-26 47 500.00 Ahmed Nabil sunday 1st Nov. expected
`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].customerCode, "1457");
  assert.equal(rows[0].remark, "sunday 1st Nov. expected");
  assert.doesNotMatch(rows[0].remark, /Hayat|Ahmed Nabil/i);
});

test("parseCollectionRemarkTableText accepts Party's Name header", () => {
  const table = [
    "Party's Name\tRemarks",
    "1058 Al -Rowad Wholesale Trading\tgood return in next 2 days",
    "1005 Abdullah bin mousa\tBlanace confirmation today / payment 1st Nov. if not then legal",
  ].join("\n");
  const rows = parseCollectionRemarkTableText(table);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].customerCode, "1058");
  assert.equal(rows[1].visitOutcome, "TRANSFER_TO_LEGAL");
});
