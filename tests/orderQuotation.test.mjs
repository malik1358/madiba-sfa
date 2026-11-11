import test from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_STATUS_INVOICE_MADE,
  ORDER_STATUS_PENDING_INVOICE_CREATION,
  ORDER_STATUS_QUOTATION_WAITING_PAYMENT,
  ORDER_STATUS_REJECTED,
  shouldAutoMarkPendingInvoiceCreation,
} from "../app/lib/orderApproval.js";
import {
  QUOTATION_VALIDITY_WORKING_DAYS,
  addKsaWorkingDays,
  buildQuotationInvoiceMeta,
  canMakeOrderQuotation,
  formatQuotationValidUntilLabel,
  normalizeQuotationWorkingDays,
  quotationPdfSnapshotFields,
  resolveQuotationValidUntil,
} from "../app/lib/orderQuotation.js";
import { formatOrderPdfOrderNumberLabel } from "../app/lib/salesOrderNumber.js";
import { buildOrderWhatsappSummary } from "../app/lib/orderWhatsapp.js";

test("addKsaWorkingDays skips Friday and counts only working days", () => {
  // Thursday 2026-09-03 + 3 working days => Sat, Sun, Mon (Fri skipped)
  assert.equal(addKsaWorkingDays("2026-09-03", 3), "2026-09-07");
  // Sunday + 3 => Mon, Tue, Wed
  assert.equal(addKsaWorkingDays("2026-09-06", 3), "2026-09-09");
  // Wednesday + 2 => Thu, Sat (Fri skipped)
  assert.equal(addKsaWorkingDays("2026-09-02", 2), "2026-09-05");
});

test("normalizeQuotationWorkingDays defaults to 3 and allows 2", () => {
  assert.equal(normalizeQuotationWorkingDays(2), 2);
  assert.equal(normalizeQuotationWorkingDays(3), 3);
  assert.equal(normalizeQuotationWorkingDays(99), QUOTATION_VALIDITY_WORKING_DAYS);
  assert.equal(normalizeQuotationWorkingDays("nope"), QUOTATION_VALIDITY_WORKING_DAYS);
});

test("resolveQuotationValidUntil uses KSA issue date and working days", () => {
  const wednesdayMorningKsa = new Date("2026-09-02T08:00:00+03:00");
  const resolved = resolveQuotationValidUntil({
    now: wednesdayMorningKsa,
    workingDays: 3,
  });
  assert.equal(resolved.issueDate, "2026-09-02");
  assert.equal(resolved.workingDays, 3);
  assert.equal(resolved.validUntil, "2026-09-06");
});

test("buildQuotationInvoiceMeta sets validity fields without changing invoice status", () => {
  const now = new Date("2026-09-02T08:00:00+03:00");
  const meta = buildQuotationInvoiceMeta(
    { orderId: "441", status: ORDER_STATUS_PENDING_INVOICE_CREATION },
    { userId: "user-1", now, workingDays: 3 },
  );
  assert.equal(meta.status, ORDER_STATUS_PENDING_INVOICE_CREATION);
  assert.equal(meta.quotationWorkingDays, 3);
  assert.equal(meta.quotationIssueDate, "2026-09-02");
  assert.equal(meta.quotationValidUntil, "2026-09-06");
  assert.equal(meta.quotationCreatedBy, "user-1");
  assert.equal(meta.statusUpdatedBy, undefined);
  assert.ok(String(meta.quotationCreatedAt || "").length > 0);
});

test("canMakeOrderQuotation allows submitted open orders and blocks invoice/rejected/queued", () => {
  const submitted = { id: 441, status: "SUBMITTED" };
  assert.equal(canMakeOrderQuotation(submitted, null), true);
  assert.equal(canMakeOrderQuotation(submitted, { status: ORDER_STATUS_QUOTATION_WAITING_PAYMENT }), true);
  assert.equal(canMakeOrderQuotation({ id: "pending:abc", status: "SUBMITTED" }, null), false);
  assert.equal(canMakeOrderQuotation({ id: 1, status: "DRAFT" }, null), false);
  assert.equal(canMakeOrderQuotation(submitted, { invoiceFilePath: "a/b.pdf" }), false);
  assert.equal(canMakeOrderQuotation(submitted, { status: ORDER_STATUS_INVOICE_MADE }), false);
  assert.equal(canMakeOrderQuotation(submitted, { status: ORDER_STATUS_REJECTED }), false);
});

test("quotation status is settled so auto invoice-creation mark does not overwrite it", () => {
  const order = { id: 441, status: "SUBMITTED" };
  const meta = { status: ORDER_STATUS_QUOTATION_WAITING_PAYMENT, quotationValidUntil: "2026-09-06" };
  assert.equal(shouldAutoMarkPendingInvoiceCreation({
    order,
    meta,
    approvalRequired: false,
  }), false);
});

test("quotation PDF and WhatsApp labels include validity", () => {
  const fields = quotationPdfSnapshotFields({
    status: ORDER_STATUS_QUOTATION_WAITING_PAYMENT,
    quotationValidUntil: "2026-09-06",
    quotationWorkingDays: 3,
    quotationIssueDate: "2026-09-02",
  });
  assert.equal(fields.documentKind, "quotation");
  assert.equal(fields.quotationValidUntil, "2026-09-06");
  assert.match(formatQuotationValidUntilLabel(fields), /Valid until 2026-09-06 \(3 working days\)/);

  assert.equal(
    formatOrderPdfOrderNumberLabel({ orderNumber: "MOI01", documentKind: "quotation" }),
    "Quotation No. MOI01",
  );

  const whatsapp = buildOrderWhatsappSummary({
    documentKind: "quotation",
    orderNumber: "MOI01",
    customerCode: "1001",
    customerName: "Test Customer",
    salesmanCode: "MOI",
    salesmanName: "Moinudin",
    quotationValidUntil: "2026-09-06",
    quotationWorkingDays: 3,
    statusLabel: ORDER_STATUS_QUOTATION_WAITING_PAYMENT,
    paymentType: "credit",
    pricingRegion: "riyadh",
    pricingType: "wholesale",
    itemCount: 1,
    totalQuantity: 2,
    totals: { amountExclVat: 100, vatAmount: 15, amountInclVat: 115 },
  });
  assert.match(whatsapp, /^Quotation\n/);
  assert.match(whatsapp, /Quotation #: MOI01/);
  assert.match(whatsapp, /Valid until: 2026-09-06 \(3 working days\)/);
});
