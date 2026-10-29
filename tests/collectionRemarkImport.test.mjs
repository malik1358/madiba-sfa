import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeCollectionRemarkCustomerCode,
  normalizeCollectionRemarkImportRows,
  parseCollectionRemarkImportText,
  parseCollectionRemarkOcrText,
  parseCollectionRemarkTableText,
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
  assert.match(rows[2].remark, /Ahmed hadyah/i);
  assert.equal(rows[2].visitOutcome, "ASKED_COME_LATER");
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
