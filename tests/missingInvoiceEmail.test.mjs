import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MISSING_INVOICE_EMAIL_CC,
  DEFAULT_MISSING_INVOICE_EMAIL_TO,
  MISSING_INVOICE_GRACE_MS,
  MISSING_INVOICE_STATUS_NOT_UPLOADED,
  MISSING_INVOICE_STATUS_REJECTED,
  buildMissingInvoiceAlertEmail,
  hasUploadedInvoice,
  isCreatedFromSeptember2026,
  isInvoiceNotUploadedStatus,
  isMissingInvoiceOverdue,
  isRejectedByManagement,
  isTestCustomerName,
  isTestCustomerOrder,
  isWithinMissingInvoiceEmailWindow,
  missingInvoiceCreatedFromIso,
  resolveMissingInvoiceEmailCc,
  resolveMissingInvoiceEmailRecipients,
  selectMissingInvoiceOrders,
} from "../app/lib/missingInvoiceEmail.js";
import { runMissingInvoiceEmailCycle } from "../app/lib/missingInvoiceEmailServer.js";

const now = new Date("2026-09-07T10:00:00.000Z");
const createdOverdue = new Date(now.getTime() - MISSING_INVOICE_GRACE_MS - 60 * 1000).toISOString();
const createdRecent = new Date(now.getTime() - 30 * 60 * 1000).toISOString();

function submittedOrder(id, createdAt = createdOverdue) {
  return {
    id,
    order_number: `SO-${id}`,
    customer_code: `C${id}`,
    customer_name: `Customer ${id}`,
    salesman_code: "SM001",
    salesman_name: "Ahmed",
    status: "SUBMITTED",
    created_at: createdAt,
    total_value: 1500,
  };
}

test("resolveMissingInvoiceEmailRecipients always includes the default inboxes", () => {
  assert.deepEqual(resolveMissingInvoiceEmailRecipients({}), DEFAULT_MISSING_INVOICE_EMAIL_TO);
  assert.deepEqual(
    resolveMissingInvoiceEmailRecipients({ MISSING_INVOICE_EMAIL_TO: "extra@madiba.com, malik@pinasz.com" }),
    [...DEFAULT_MISSING_INVOICE_EMAIL_TO, "extra@madiba.com"],
  );
});

test("resolveMissingInvoiceEmailCc includes Jenil and extra CC addresses", () => {
  assert.deepEqual(resolveMissingInvoiceEmailCc({}), DEFAULT_MISSING_INVOICE_EMAIL_CC);
  assert.deepEqual(
    resolveMissingInvoiceEmailCc({ MISSING_INVOICE_EMAIL_CC: "extra-cc@madiba.com, jenil.modi@noorshukran.com" }),
    [...DEFAULT_MISSING_INVOICE_EMAIL_CC, "extra-cc@madiba.com"],
  );
  assert.deepEqual(
    resolveMissingInvoiceEmailCc({}, [...DEFAULT_MISSING_INVOICE_EMAIL_TO, "jenil.modi@noorshukran.com"]),
    [],
  );
});

test("missing invoice emails are limited to Saturday-Thursday 9am-8pm IST", () => {
  assert.equal(isWithinMissingInvoiceEmailWindow(new Date("2026-09-07T03:29:00.000Z")), false);
  assert.equal(isWithinMissingInvoiceEmailWindow(new Date("2026-09-07T03:30:00.000Z")), true);
  assert.equal(isWithinMissingInvoiceEmailWindow(new Date("2026-09-07T10:00:00.000Z")), true);
  assert.equal(isWithinMissingInvoiceEmailWindow(new Date("2026-09-07T14:30:00.000Z")), true);
  assert.equal(isWithinMissingInvoiceEmailWindow(new Date("2026-09-07T14:45:00.000Z")), false);
  assert.equal(isWithinMissingInvoiceEmailWindow(new Date("2026-09-11T10:00:00.000Z")), false);
  assert.equal(isWithinMissingInvoiceEmailWindow(new Date("2026-09-12T03:30:00.000Z")), true);
});

test("only orders created from September 2026 KSA are considered", () => {
  assert.equal(missingInvoiceCreatedFromIso(), "2026-08-31T21:00:00.000Z");
  assert.equal(isCreatedFromSeptember2026(submittedOrder(8, "2026-08-31T20:59:59.000Z")), false);
  assert.equal(isCreatedFromSeptember2026(submittedOrder(8, "2026-08-31T21:00:00.000Z")), true);
  assert.equal(isMissingInvoiceOverdue(submittedOrder(8, "2026-08-01T08:00:00.000Z"), {}, now), false);
  assert.equal(isMissingInvoiceOverdue(submittedOrder(8, "2026-08-31T20:59:59.000Z"), {}, now), false);
});

test("customer names that contain the word test are treated as test orders", () => {
  assert.equal(isTestCustomerName("TEST CUSTOMER"), true);
  assert.equal(isTestCustomerName("Customer Test Shop"), true);
  assert.equal(isTestCustomerName("test"), true);
  assert.equal(isTestCustomerName("Latest Trading Company"), false);
  assert.equal(isTestCustomerName("Contest Supplies"), false);
  assert.equal(isTestCustomerOrder({ ...submittedOrder(20), customer_name: "TEST ORDER CUSTOMER" }), true);
  assert.equal(isMissingInvoiceOverdue({ ...submittedOrder(21), customer_name: "TEST CUSTOMER" }, {}, now), false);
  assert.equal(isMissingInvoiceOverdue({ ...submittedOrder(22), customer_name: "Rokn Al-Muhareb Trading Company" }, {}, now), true);

  const selected = selectMissingInvoiceOrders(
    [
      { ...submittedOrder(23), customer_name: "TEST CUSTOMER" },
      submittedOrder(24),
    ],
    new Map(),
    now,
  ).map((order) => order.id);

  assert.deepEqual(selected, [24]);
});

test("rejected and uploaded invoices are excluded from the overdue list", () => {
  assert.equal(isRejectedByManagement({ status: MISSING_INVOICE_STATUS_REJECTED }), true);
  assert.equal(hasUploadedInvoice({ invoiceFilePath: "C1/1/file.pdf" }), true);
  assert.equal(isMissingInvoiceOverdue(submittedOrder(1), {}, now), true);
  assert.equal(isMissingInvoiceOverdue(submittedOrder(2, createdRecent), {}, now), false);
  assert.equal(isMissingInvoiceOverdue({ ...submittedOrder(3), status: "DRAFT" }, {}, now), false);
  assert.equal(isMissingInvoiceOverdue(submittedOrder(4), { status: MISSING_INVOICE_STATUS_REJECTED }, now), false);
  assert.equal(isMissingInvoiceOverdue(submittedOrder(5), { invoiceUploadedAt: now.toISOString() }, now), false);

  const selected = selectMissingInvoiceOrders(
    [submittedOrder(9), submittedOrder(1), submittedOrder(4)],
    new Map([
      ["4", { status: MISSING_INVOICE_STATUS_REJECTED }],
      ["9", {}],
      ["1", {}],
    ]),
    now,
  ).map((order) => order.id);

  assert.deepEqual(selected, [9, 1]);
});

test("only Invoice not uploaded status is included in the overdue list", () => {
  assert.equal(isInvoiceNotUploadedStatus({}), true);
  assert.equal(isInvoiceNotUploadedStatus({ status: MISSING_INVOICE_STATUS_NOT_UPLOADED }), true);
  assert.equal(isInvoiceNotUploadedStatus({ status: "Pending for credit approval" }), false);
  assert.equal(isInvoiceNotUploadedStatus({ status: "Stock unavailable" }), false);
  assert.equal(isInvoiceNotUploadedStatus({ status: "Waiting for credit application" }), false);
  assert.equal(isMissingInvoiceOverdue(submittedOrder(31), { status: "Pending for credit approval" }, now), false);
  assert.equal(isMissingInvoiceOverdue(submittedOrder(32), { status: "Stock unavailable" }, now), false);
  assert.equal(isMissingInvoiceOverdue(submittedOrder(33), { status: MISSING_INVOICE_STATUS_NOT_UPLOADED }, now), true);

  const selected = selectMissingInvoiceOrders(
    [submittedOrder(31), submittedOrder(32), submittedOrder(33), submittedOrder(34)],
    new Map([
      ["31", { status: "Pending for credit approval" }],
      ["32", { status: "Stock unavailable" }],
      ["33", { status: MISSING_INVOICE_STATUS_NOT_UPLOADED }],
      ["34", {}],
    ]),
    now,
  ).map((order) => order.id);

  assert.deepEqual(selected, [33, 34]);
});

test("buildMissingInvoiceAlertEmail lists overdue orders", () => {
  const message = buildMissingInvoiceAlertEmail({
    now,
    orders: [submittedOrder(12)],
    metaByOrder: new Map([["12", { status: MISSING_INVOICE_STATUS_NOT_UPLOADED }]]),
  });

  assert.match(message.subject, /1 order missing invoice after 1 hour/);
  assert.match(message.html, /SO-12/);
  assert.match(message.html, /C12 — Customer 12/);
  assert.match(message.html, /Ahmed \(SM001\)/);
  assert.match(message.html, /Invoice not uploaded/);
  assert.doesNotMatch(message.html, /Pending for credit approval|Stock unavailable/);
  assert.match(message.html, /Saturday–Thursday, 9:00 AM–8:00 PM IST/);
  assert.match(message.text, /from September 2026 onward/);
  assert.match(message.text, /Orders rejected by management, pending credit approval, stock unavailable, test-customer orders, and orders created before September 2026 are excluded/);
  assert.equal(message.orderCount, 1);
});

test("runMissingInvoiceEmailCycle skips when nothing is overdue", async () => {
  const result = await runMissingInvoiceEmailCycle({}, {
    now,
    env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "sfa@madiba.com" },
    send: async () => {
      throw new Error("should not send");
    },
    loadOrders: async () => ({ orders: [], metaByOrder: new Map() }),
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "no_overdue_orders");
});

test("runMissingInvoiceEmailCycle sends one digest to the default list", async () => {
  const sent = [];
  const result = await runMissingInvoiceEmailCycle({}, {
    now,
    env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "sfa@madiba.com" },
    send: async (message) => {
      sent.push(message);
      return { provider: "test" };
    },
    loadOrders: async () => ({
      orders: [submittedOrder(7)],
      metaByOrder: new Map(),
    }),
  });

  assert.equal(result.skipped, false);
  assert.equal(result.sentCount, 1);
  assert.equal(result.orderCount, 1);
  assert.deepEqual(sent[0].to, DEFAULT_MISSING_INVOICE_EMAIL_TO);
  assert.deepEqual(sent[0].cc, DEFAULT_MISSING_INVOICE_EMAIL_CC);
  assert.deepEqual(result.cc, DEFAULT_MISSING_INVOICE_EMAIL_CC);
  assert.match(sent[0].subject, /SO-7|1 order missing invoice/);
});

test("runMissingInvoiceEmailCycle skips outside India back-office hours", async () => {
  const result = await runMissingInvoiceEmailCycle({}, {
    now: new Date("2026-09-11T10:00:00.000Z"),
    env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "sfa@madiba.com" },
    send: async () => {
      throw new Error("should not send");
    },
    loadOrders: async () => {
      throw new Error("should not load orders");
    },
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "outside_india_back_office_hours");
});

test("runMissingInvoiceEmailCycle skips when email is not configured", async () => {
  const result = await runMissingInvoiceEmailCycle({}, {
    now,
    env: {},
    send: async () => {
      throw new Error("should not send");
    },
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, "email_not_configured");
});
