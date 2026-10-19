import test from "node:test";
import assert from "node:assert/strict";

import {
  addYearsToIsoDate,
  buildCustomerDocumentCompliance,
  extractCrNumberFromText,
  extractIssueDateFromText,
  extractVatNumberFromText,
  findDuplicateVatHolder,
  formatVatConflictError,
  parseCustomerDocumentText,
  relinkCustomerDocuments,
  resolveDocumentLinkStatus,
  validateDocumentDates,
} from "../app/lib/customerDocumentParse.js";
import { evaluateCreditApproval, isOutstandingOverSixtyDays } from "../app/lib/creditApproval.js";

const CR_SAMPLE = `Commercial Registration Certificate
National Number : 7043111504
Release date : 24/12/2024
naghmat alraihah Company`;

const VAT_SAMPLE = `VAT Registration Certificate
Taxpayer Name شركة نغمات الرائحة
VAT Registration Number 314787395400003
CR National Number / License 7043111504
Effective Registration Date 2026/06/01
Taxpayer Address الخفجي ،حي المرقب`;

test("extracts CR and VAT numbers from certificate text", () => {
  assert.equal(extractCrNumberFromText(CR_SAMPLE), "7043111504");
  assert.equal(extractVatNumberFromText(VAT_SAMPLE), "314787395400003");
  assert.equal(extractCrNumberFromText(VAT_SAMPLE), "7043111504");
  assert.equal(extractCrNumberFromText(`Commercial Registration Certificate
National Number
7043111504
Release date
24/12/2024`), "7043111504");

  const vatCertificate = `VAT Registration Certificate
The Zakat, Tax and Customs Authority certifies that the taxpayer below is VAT registered on 01/06/2026 AD
Taxpayer Name
شركة نغمات الرائحة لتجارة الجملة و التجزئة شخص واحد
VAT Registration Number
314787395400003`;
  assert.equal(extractVatNumberFromText(vatCertificate), "314787395400003");
  assert.equal(extractIssueDateFromText(vatCertificate), "2026-06-01");
  const parsedVat = parseCustomerDocumentText("VAT", vatCertificate);
  assert.equal(parsedVat.parsed_vat_number, "314787395400003");
  assert.equal(parsedVat.issue_date, "2026-06-01");
});

test("rejects a VAT number already used by another customer", () => {
  const conflict = findDuplicateVatHolder([
    { customer_code: "1001", customer_name: "Other Co", vat_number: "314787395400003" },
    { customer_code: "1545", customer_name: "Naghmat al raihah", vat_number: "314787395400003" },
  ], "314787395400003", "1545");
  assert.equal(conflict.customer_code, "1001");
  assert.match(formatVatConflictError("314787395400003", conflict), /1001/);

  const sameCustomer = findDuplicateVatHolder([
    { customer_code: "1545", customer_name: "Naghmat al raihah", vat_number: "314787395400003" },
  ], "314787395400003", "1545");
  assert.equal(sameCustomer, null);
});

test("credit application expiry is one year after issue date", () => {
  const parsed = parseCustomerDocumentText("CREDIT_APPLICATION", "", { issueDate: "24/12/2024", crNumber: "7043111504" });
  assert.equal(parsed.issue_date, "2024-12-24");
  assert.equal(parsed.expiry_date, "2025-12-24");
  assert.equal(addYearsToIsoDate("2024-02-29"), "2025-02-28");
});

test("rejects expired documents and expiry before issue date", () => {
  const expired = validateDocumentDates({
    issueDate: "2024-08-01",
    expiryDate: "2025-08-01",
    todayIso: "2026-08-28",
  });
  assert.equal(expired.ok, false);
  assert.match(expired.error, /expired/i);

  const inverted = validateDocumentDates({
    issueDate: "2027-01-01",
    expiryDate: "2026-12-01",
    todayIso: "2026-08-28",
  });
  assert.equal(inverted.ok, false);
  assert.match(inverted.error, /after the issue date/i);

  const valid = validateDocumentDates({
    issueDate: "2026-01-01",
    expiryDate: "2027-01-01",
    todayIso: "2026-08-28",
  });
  assert.equal(valid.ok, true);

  const creditExpired = parseCustomerDocumentText("CREDIT_APPLICATION", "", { issueDate: "2024-08-01" });
  const creditCheck = validateDocumentDates({
    issueDate: creditExpired.issue_date,
    expiryDate: creditExpired.expiry_date,
    todayIso: "2026-08-28",
  });
  assert.equal(creditCheck.ok, false);
});

test("VAT CR must match the customer CR certificate", () => {
  const docs = relinkCustomerDocuments([
    { document_type: "CR", parsed_cr_number: "7043111504", created_at: "2026-08-01" },
    { document_type: "VAT", parsed_cr_number: "7043111504", parsed_vat_number: "314787395400003", created_at: "2026-08-02" },
    { document_type: "BALADY", parsed_cr_number: "1111111111", created_at: "2026-08-03" },
  ]);
  assert.equal(docs[1].link_status, "MATCHED");
  assert.equal(docs[2].link_status, "MISMATCH");
  assert.equal(resolveDocumentLinkStatus({ parsedCr: "7043111504", canonicalCr: "7043111504" }).link_status, "MATCHED");
});

test("compliance lists missing compulsory documents", () => {
  const compliance = buildCustomerDocumentCompliance([
    { document_type: "CR", parsed_cr_number: "7043111504", created_at: "2026-08-01" },
  ], { cr_number: "7043111504" });
  assert.deepEqual(compliance.missingCompulsory.sort(), ["NATIONAL_ADDRESS", "VAT"]);
  assert.equal(compliance.creditApplication.present, false);
});

test("approval required when outstanding is older than 60 days", () => {
  assert.equal(isOutstandingOverSixtyDays({ buckets: { "61-90": 500 } }), true);
  const result = evaluateCreditApproval({
    outstanding: { total_outstanding: 500, buckets: { "61-90": 500 } },
    orderValue: 100,
    creditApplication: { present: true, issueDate: "2026-01-01", expiryDate: "2027-01-01" },
    todayIso: "2026-08-28",
  });
  assert.equal(result.required, true);
  assert.match(result.remark, /outstanding over 60 days/i);
});

test("approval required when exposure exceeds 10000 without a valid credit application", () => {
  const missing = evaluateCreditApproval({
    outstanding: { total_outstanding: 8000, buckets: { "0-30": 8000 } },
    orderValue: 2500,
    creditApplication: { present: false },
    todayIso: "2026-08-28",
  });
  assert.equal(missing.required, true);
  assert.match(missing.remark, /credit application is missing/i);

  const expired = evaluateCreditApproval({
    outstanding: { total_outstanding: 8000, buckets: { "0-30": 8000 } },
    orderValue: 2500,
    creditApplication: { present: true, issueDate: "2024-08-01", expiryDate: "2025-08-01" },
    todayIso: "2026-08-28",
  });
  assert.equal(expired.required, true);
  assert.match(expired.remark, /expired/i);

  const ok = evaluateCreditApproval({
    outstanding: { total_outstanding: 8000, buckets: { "0-30": 8000 } },
    orderValue: 2500,
    creditApplication: { present: true, issueDate: "2026-01-01", expiryDate: "2027-01-01" },
    todayIso: "2026-08-28",
  });
  assert.equal(ok.required, false);
  assert.match(ok.remark, /not required/i);
});

test("cash orders skip credit approval", () => {
  const result = evaluateCreditApproval({
    outstanding: { total_outstanding: 500, buckets: { "61-90": 500 } },
    orderValue: 100,
    paymentType: "cash",
  });
  assert.equal(result.required, false);
  assert.match(result.remark, /cash order/i);
});

test("PDF remark helper wraps credit control text", async () => {
  const { wrapCreditControlRemark, formatCreditApprovalPdfRemark } = await import("../app/lib/creditApproval.js");
  const evaluation = evaluateCreditApproval({
    outstanding: { total_outstanding: 500, buckets: { "61-90": 500 } },
    orderValue: 100,
  });
  assert.match(formatCreditApprovalPdfRemark(evaluation), /outstanding over 60 days/i);

  const fakeDoc = {
    splitTextToSize(text, maxWidth) {
      assert.ok(maxWidth > 0);
      return [text];
    },
  };
  const wrapped = wrapCreditControlRemark(fakeDoc, evaluation.remark, 400);
  assert.equal(wrapped.lines.length, 1);
  assert.ok(wrapped.height >= 16);
});
