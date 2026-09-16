import test from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_REJECTION_REASONS,
  ORDER_REJECTION_REASON_CREDIT_LIMIT,
  ORDER_REJECTION_REASON_DISCOUNT_PRICE,
  ORDER_REJECTION_REASON_STOCK,
  ORDER_REJECTION_REASON_MADE_BY_MISTAKE,
  ORDER_STATUS_PENDING_APPROVAL,
  ORDER_STATUS_PENDING_CREDIT,
  ORDER_STATUS_PENDING_INVOICE_CREATION,
  ORDER_STATUS_REJECTED,
  ORDER_STATUS_STOCK_UNAVAILABLE,
  canApprovePendingOrders,
  displayInvoiceStatus,
  isOrderCreatedBeforeLegacyInvoiceCutoff,
  isPendingForApprovalStatus,
  isSubmittedWithoutUploadedInvoice,
  isValidRejectionReason,
  shouldAutoMarkPendingApproval,
  shouldAutoMarkPendingInvoiceCreation,
  shouldAutoRejectLegacyUninvoicedOrder,
  shouldShowPendingApprovalActions,
  statusForRejectionReason,
} from "../app/lib/orderApproval.js";

test("orders needing approval display Pending for approval", () => {
  assert.equal(displayInvoiceStatus(null, { approvalRequired: true }), ORDER_STATUS_PENDING_APPROVAL);
  assert.equal(
    displayInvoiceStatus({ status: ORDER_STATUS_PENDING_CREDIT }, {}),
    ORDER_STATUS_PENDING_APPROVAL,
  );
  assert.equal(
    displayInvoiceStatus({ status: ORDER_STATUS_PENDING_APPROVAL }, {}),
    ORDER_STATUS_PENDING_APPROVAL,
  );
});

test("approved orders without invoice show Pending for invoice creation", () => {
  assert.equal(
    displayInvoiceStatus({ approvedAt: "2026-09-14T10:00:00.000Z" }, { approvalRequired: true }),
    ORDER_STATUS_PENDING_INVOICE_CREATION,
  );
  assert.equal(
    displayInvoiceStatus({
      status: ORDER_STATUS_PENDING_INVOICE_CREATION,
      approvedAt: "2026-09-14T10:00:00.000Z",
    }, {}),
    ORDER_STATUS_PENDING_INVOICE_CREATION,
  );
});

test("submitted orders that do not need approval show Pending for invoice creation", () => {
  const order = { id: 12, status: "SUBMITTED" };
  assert.equal(isSubmittedWithoutUploadedInvoice(order, null), true);
  assert.equal(shouldAutoMarkPendingInvoiceCreation({ order, meta: null, approvalRequired: false }), true);
  assert.equal(shouldAutoMarkPendingApproval({ order, meta: null, approvalRequired: false }), false);
  assert.equal(shouldShowPendingApprovalActions(order, null, { approvalRequired: false }), false);
  assert.equal(displayInvoiceStatus(null, { order, approvalRequired: false }), ORDER_STATUS_PENDING_INVOICE_CREATION);
});

test("submitted orders needing approval stay in Pending for approval", () => {
  const order = { id: 12, status: "SUBMITTED" };
  assert.equal(shouldAutoMarkPendingApproval({ order, meta: null, approvalRequired: true }), true);
  assert.equal(shouldAutoMarkPendingInvoiceCreation({ order, meta: null, approvalRequired: true }), false);
  assert.equal(shouldShowPendingApprovalActions(order, null, { approvalRequired: true }), true);
  assert.equal(displayInvoiceStatus(null, { order, approvalRequired: true }), ORDER_STATUS_PENDING_APPROVAL);
});

test("unknown credit check does not auto-mark Pending for invoice creation", () => {
  const order = { id: 437, status: "SUBMITTED" };
  assert.equal(shouldAutoMarkPendingInvoiceCreation({ order, meta: null, approvalRequired: null }), false);
  assert.equal(shouldAutoMarkPendingInvoiceCreation({ order, meta: null }), false);
  assert.equal(displayInvoiceStatus(null, { order, approvalRequired: null }), "-");
});

test("credit-required overrides a wrong Pending for invoice creation mark", () => {
  const order = { id: 437, status: "SUBMITTED" };
  const meta = { status: ORDER_STATUS_PENDING_INVOICE_CREATION };
  assert.equal(
    displayInvoiceStatus(meta, { order, approvalRequired: true }),
    ORDER_STATUS_PENDING_APPROVAL,
  );
  assert.equal(shouldShowPendingApprovalActions(order, meta, { approvalRequired: true }), true);
  assert.equal(shouldAutoMarkPendingApproval({ order, meta, approvalRequired: true }), true);
});

test("submitted orders with invoice uploaded are not queued", () => {
  const order = { id: 12, status: "SUBMITTED" };
  const meta = {
    invoiceFilePath: "invoices/12.pdf",
    invoiceUploadedAt: "2026-09-14T10:00:00.000Z",
  };
  assert.equal(isSubmittedWithoutUploadedInvoice(order, meta), false);
  assert.equal(shouldAutoMarkPendingApproval({ order, meta, approvalRequired: true }), false);
  assert.equal(shouldAutoMarkPendingInvoiceCreation({ order, meta, approvalRequired: false }), false);
  assert.equal(shouldShowPendingApprovalActions(order, meta), false);
});

test("pending for approval includes legacy credit status", () => {
  assert.equal(isPendingForApprovalStatus(ORDER_STATUS_PENDING_APPROVAL), true);
  assert.equal(isPendingForApprovalStatus(ORDER_STATUS_PENDING_CREDIT), true);
  assert.equal(isPendingForApprovalStatus(ORDER_STATUS_REJECTED), false);
});

test("auto-mark approval only when required", () => {
  assert.equal(shouldAutoMarkPendingApproval({ approvalRequired: true, meta: null, order: { status: "SUBMITTED" } }), true);
  assert.equal(shouldAutoMarkPendingApproval({
    approvalRequired: true,
    order: { status: "SUBMITTED" },
    meta: { status: ORDER_STATUS_PENDING_CREDIT },
  }), true);
  assert.equal(shouldAutoMarkPendingApproval({
    approvalRequired: true,
    order: { status: "SUBMITTED" },
    meta: { status: ORDER_STATUS_PENDING_APPROVAL },
  }), false);
  assert.equal(shouldAutoMarkPendingApproval({
    approvalRequired: true,
    meta: { approvedAt: "2026-09-14T10:00:00.000Z" },
    order: { status: "SUBMITTED" },
  }), false);
  assert.equal(shouldAutoMarkPendingApproval({
    approvalRequired: false,
    meta: null,
    order: { status: "SUBMITTED" },
  }), false);
});

test("rejection reasons map to the right invoice statuses", () => {
  assert.deepEqual(ORDER_REJECTION_REASONS, [
    ORDER_REJECTION_REASON_CREDIT_LIMIT,
    ORDER_REJECTION_REASON_DISCOUNT_PRICE,
    ORDER_REJECTION_REASON_STOCK,
    ORDER_REJECTION_REASON_MADE_BY_MISTAKE,
  ]);
  assert.equal(isValidRejectionReason(ORDER_REJECTION_REASON_CREDIT_LIMIT), true);
  assert.equal(isValidRejectionReason(ORDER_REJECTION_REASON_MADE_BY_MISTAKE), true);
  assert.equal(isValidRejectionReason("other"), false);
  assert.equal(statusForRejectionReason(ORDER_REJECTION_REASON_CREDIT_LIMIT), ORDER_STATUS_REJECTED);
  assert.equal(statusForRejectionReason(ORDER_REJECTION_REASON_DISCOUNT_PRICE), ORDER_STATUS_REJECTED);
  assert.equal(statusForRejectionReason(ORDER_REJECTION_REASON_MADE_BY_MISTAKE), ORDER_STATUS_REJECTED);
  assert.equal(statusForRejectionReason(ORDER_REJECTION_REASON_STOCK), ORDER_STATUS_STOCK_UNAVAILABLE);
});

test("rejected display includes reason", () => {
  assert.equal(
    displayInvoiceStatus({
      status: ORDER_STATUS_REJECTED,
      rejectionReason: ORDER_REJECTION_REASON_CREDIT_LIMIT,
    }),
    `${ORDER_STATUS_REJECTED} (${ORDER_REJECTION_REASON_CREDIT_LIMIT})`,
  );
});

test("admin and manager can approve pending orders", () => {
  assert.equal(canApprovePendingOrders("admin"), true);
  assert.equal(canApprovePendingOrders("manager"), true);
  assert.equal(canApprovePendingOrders("invoice-maker"), false);
  assert.equal(canApprovePendingOrders("salesman"), false);
});

test("submitted orders through August 2026 without invoice are rejected by management", () => {
  const legacy = { id: 10, status: "SUBMITTED", created_at: "2026-08-31T20:00:00.000Z" };
  const september = { id: 11, status: "SUBMITTED", created_at: "2026-09-01T00:00:00.000+03:00" };
  assert.equal(isOrderCreatedBeforeLegacyInvoiceCutoff(legacy), true);
  assert.equal(isOrderCreatedBeforeLegacyInvoiceCutoff(september), false);
  assert.equal(shouldAutoRejectLegacyUninvoicedOrder(legacy, null), true);
  assert.equal(shouldAutoRejectLegacyUninvoicedOrder(legacy, { status: ORDER_STATUS_PENDING_INVOICE_CREATION }), true);
  assert.equal(shouldAutoRejectLegacyUninvoicedOrder(legacy, {
    invoiceFilePath: "invoices/10.pdf",
    invoiceUploadedAt: "2026-08-20T10:00:00.000Z",
  }), false);
  assert.equal(shouldAutoRejectLegacyUninvoicedOrder(legacy, { status: ORDER_STATUS_REJECTED }), false);
  assert.equal(shouldAutoRejectLegacyUninvoicedOrder(september, null), false);
  assert.equal(shouldAutoMarkPendingInvoiceCreation({ order: legacy, meta: null, approvalRequired: false }), false);
  assert.equal(shouldAutoMarkPendingApproval({ order: legacy, meta: null, approvalRequired: true }), false);
  assert.equal(displayInvoiceStatus(null, { order: legacy }), ORDER_STATUS_REJECTED);
  assert.equal(
    displayInvoiceStatus({ status: ORDER_STATUS_PENDING_INVOICE_CREATION }, { order: legacy }),
    ORDER_STATUS_REJECTED,
  );
});
