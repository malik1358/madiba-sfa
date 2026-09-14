import test from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_REJECTION_REASONS,
  ORDER_REJECTION_REASON_CREDIT_LIMIT,
  ORDER_REJECTION_REASON_DISCOUNT_PRICE,
  ORDER_REJECTION_REASON_STOCK,
  ORDER_STATUS_PENDING_APPROVAL,
  ORDER_STATUS_PENDING_CREDIT,
  ORDER_STATUS_REJECTED,
  ORDER_STATUS_STOCK_UNAVAILABLE,
  canApprovePendingOrders,
  displayInvoiceStatus,
  isPendingForApprovalStatus,
  isValidRejectionReason,
  shouldAutoMarkPendingApproval,
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
  assert.equal(
    displayInvoiceStatus({ approvedAt: "2026-09-14T10:00:00.000Z" }, { approvalRequired: true }),
    "-",
  );
});

test("pending for approval includes legacy credit status", () => {
  assert.equal(isPendingForApprovalStatus(ORDER_STATUS_PENDING_APPROVAL), true);
  assert.equal(isPendingForApprovalStatus(ORDER_STATUS_PENDING_CREDIT), true);
  assert.equal(isPendingForApprovalStatus(ORDER_STATUS_REJECTED), false);
});

test("auto-mark runs when approval is required and status is empty or legacy", () => {
  assert.equal(shouldAutoMarkPendingApproval({ approvalRequired: true, meta: null }), true);
  assert.equal(shouldAutoMarkPendingApproval({
    approvalRequired: true,
    meta: { status: ORDER_STATUS_PENDING_CREDIT },
  }), true);
  assert.equal(shouldAutoMarkPendingApproval({
    approvalRequired: true,
    meta: { status: ORDER_STATUS_PENDING_APPROVAL },
  }), false);
  assert.equal(shouldAutoMarkPendingApproval({
    approvalRequired: true,
    meta: { approvedAt: "2026-09-14T10:00:00.000Z" },
  }), false);
  assert.equal(shouldAutoMarkPendingApproval({
    approvalRequired: false,
    meta: null,
  }), false);
});

test("rejection reasons map to the right invoice statuses", () => {
  assert.deepEqual(ORDER_REJECTION_REASONS, [
    ORDER_REJECTION_REASON_CREDIT_LIMIT,
    ORDER_REJECTION_REASON_DISCOUNT_PRICE,
    ORDER_REJECTION_REASON_STOCK,
  ]);
  assert.equal(isValidRejectionReason(ORDER_REJECTION_REASON_CREDIT_LIMIT), true);
  assert.equal(isValidRejectionReason("other"), false);
  assert.equal(statusForRejectionReason(ORDER_REJECTION_REASON_CREDIT_LIMIT), ORDER_STATUS_REJECTED);
  assert.equal(statusForRejectionReason(ORDER_REJECTION_REASON_DISCOUNT_PRICE), ORDER_STATUS_REJECTED);
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
