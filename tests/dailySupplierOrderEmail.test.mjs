import test from "node:test";
import assert from "node:assert/strict";

import {
  amountInclVat,
  extractInvoiceAmountExclVat,
  invoiceAmountExclVatFromLines,
  parseMoneyAmount,
  resolveInvoiceAmountExclVat,
} from "../app/lib/invoiceAmountFromPdf.js";
import {
  buildDailySupplierOrderEmail,
  groupDailySupplierOrders,
  resolveDailySupplierOrderDigestCc,
  resolveDailySupplierOrderDigestRecipients,
  selectDailySupplierOrders,
  shouldIncludeInSupplierOrderReport,
} from "../app/lib/dailySupplierOrderEmail.js";
import { DEFAULT_MISSING_INVOICE_EMAIL_CC, DEFAULT_MISSING_INVOICE_EMAIL_TO } from "../app/lib/missingInvoiceEmail.js";
import { runDailySupplierOrderEmailCycle } from "../app/lib/dailySupplierOrderEmailServer.js";

test("parseMoneyAmount accepts comma and dot thousands", () => {
  assert.equal(parseMoneyAmount("1,250.50"), 1250.5);
  assert.equal(parseMoneyAmount("1.250,50"), 1250.5);
  assert.equal(parseMoneyAmount("SAR 980"), 980);
});

test("extractInvoiceAmountExclVat prefers labeled amount without VAT", () => {
  const text = `Item A 10 100 1000
Amount without VAT 1,000.00
VAT 15% 150.00
Total including VAT 1,150.00`;
  assert.equal(extractInvoiceAmountExclVat(text), 1000);
});

test("extractInvoiceAmountExclVat falls back from total including VAT", () => {
  const text = `Grand total 1150.00`;
  assert.equal(extractInvoiceAmountExclVat(text), 1000);
});

test("invoiceAmountExclVatFromLines uses invoice qty and rate when present", () => {
  const amount = invoiceAmountExclVatFromLines(
    [{ item_code: "A1", quantity: 2, rate: 50 }],
    [{ type: "quantity", item_code: "A1", invoice_quantity: 1, invoice_rate: 50 }],
  );
  assert.equal(amount, 50);
});

test("resolveInvoiceAmountExclVat uses PDF total before line fallback", () => {
  assert.equal(resolveInvoiceAmountExclVat({
    pdfText: "Amount without VAT 200",
    orderLines: [{ item_code: "A1", quantity: 1, rate: 50 }],
    diffs: [],
  }), 200);
});

test("amountInclVat adds 15 percent", () => {
  assert.equal(amountInclVat(1000), 1150);
});

test("selectDailySupplierOrders drops drafts and test customers", () => {
  const selected = selectDailySupplierOrders([
    { id: 1, status: "SUBMITTED", customer_name: "Dhawi Trading", salesman_code: "AR", order_number: "378", created_at: "2026-09-09T10:00:00.000Z" },
    { id: 2, status: "DRAFT", customer_name: "Dhawi Trading", salesman_code: "AR", order_number: "379", created_at: "2026-09-09T10:00:00.000Z" },
    { id: 3, status: "SUBMITTED", customer_name: "TEST CUSTOMER", salesman_code: "AR", order_number: "380", created_at: "2026-09-09T10:00:00.000Z" },
  ], new Map(), {
    sinceIso: "2026-09-01T00:00:00.000Z",
    asOfIso: "2026-09-10T12:00:00.000Z",
  });
  assert.deepEqual(selected.map((order) => order.id), [1]);
});

test("shouldIncludeInSupplierOrderReport includes all statuses raised in the window", () => {
  const sinceMs = Date.parse("2026-09-09T21:00:00.000Z"); // KSA day start-ish
  const asOfMs = Date.parse("2026-09-10T20:59:59.999Z");
  const raisedToday = {
    id: 50,
    status: "SUBMITTED",
    customer_name: "Today Shop",
    created_at: "2026-09-10T08:00:00.000Z",
    submitted_at: "2026-09-10T08:00:00.000Z",
    updated_at: "2026-09-10T08:00:00.000Z",
  };
  assert.equal(shouldIncludeInSupplierOrderReport(raisedToday, null, sinceMs, asOfMs), true);
  assert.equal(shouldIncludeInSupplierOrderReport(raisedToday, { status: "Invoice made", invoiceUploadedAt: "2026-09-10T09:00:00.000Z" }, sinceMs, asOfMs), true);
  assert.equal(shouldIncludeInSupplierOrderReport(raisedToday, { status: "Pending for credit approval" }, sinceMs, asOfMs), true);

  const oldInvoiced = {
    id: 51,
    status: "SUBMITTED",
    customer_name: "Old Shop",
    created_at: "2026-09-05T08:00:00.000Z",
    submitted_at: "2026-09-05T08:00:00.000Z",
    updated_at: "2026-09-05T08:00:00.000Z",
  };
  assert.equal(shouldIncludeInSupplierOrderReport(oldInvoiced, { status: "Invoice made", invoiceUploadedAt: "2026-09-06T10:00:00.000Z" }, sinceMs, asOfMs), false);
  assert.equal(shouldIncludeInSupplierOrderReport(oldInvoiced, null, sinceMs, asOfMs), true);
  assert.equal(shouldIncludeInSupplierOrderReport(oldInvoiced, { status: "Invoice made", statusUpdatedAt: "2026-09-10T12:00:00.000Z" }, sinceMs, asOfMs), true);
});

test("groupDailySupplierOrders splits by salesman and attaches profile", () => {
  const groups = groupDailySupplierOrders(
    [
      { id: 378, salesman_code: "AR", salesman_name: "ABDUL REHMAN", customer_name: "Dhawi" },
      { id: 377, salesman_code: "AR", salesman_name: "ABDUL REHMAN", customer_name: "Arkan" },
      { id: 10, salesman_code: "SM2", salesman_name: "Sara", customer_name: "Other" },
    ],
    [{ id: "u1", salesman_code: "AR", salesman_name: "ABDUL REHMAN", email: "abdul@madiba.com" }],
  );
  assert.equal(groups.length, 2);
  assert.equal(groups[0].salesmanName, "ABDUL REHMAN (AR)");
  assert.equal(groups[0].orders.length, 2);
  assert.equal(groups[0].profile.email, "abdul@madiba.com");
});

test("buildDailySupplierOrderEmail includes values with VAT and a total row", () => {
  const message = buildDailySupplierOrderEmail({
    date: "2026-09-10",
    salesmanName: "ABDUL REHMAN (AR)",
    rows: [
      {
        order: "378",
        customer: "Dhawi Salem",
        salesman: "ABDUL REHMAN (AR)",
        orderStatus: "SUBMITTED",
        invoiceStatus: "Invoice made",
        createdAt: "10/09/2026, 09:43",
        orderValue: 1150,
        invoiceValue: 1127,
      },
      {
        order: "377",
        customer: "Arkan Appliances",
        salesman: "ABDUL REHMAN (AR)",
        orderStatus: "SUBMITTED",
        invoiceStatus: "Invoice made",
        createdAt: "10/09/2026, 09:14",
        orderValue: 575,
        invoiceValue: 575,
      },
    ],
  });

  assert.match(message.subject, /ABDUL REHMAN/);
  assert.match(message.html, /Order value \(incl\. VAT\)/);
  assert.match(message.html, /Invoice made \(incl\. VAT\)/);
  assert.match(message.html, /MADIBA SFA/);
  assert.match(message.html, /Daily order confirmation/);
  assert.match(message.html, /1,150.00/);
  assert.match(message.html, /1,127.00/);
  assert.match(message.html, /Total \(2 orders\)/);
  assert.match(message.html, /1,725.00/);
  assert.match(message.html, /1,702.00/);
  assert.match(message.html, /background:#dcfce7/);
  assert.equal(message.orderCount, 2);
  assert.equal(message.totals.orderValue, 1725);
  assert.equal(message.totals.invoiceValue, 1702);
});

test("resolveDailySupplierOrderDigestRecipients uses the invoice-ops list", () => {
  assert.deepEqual(resolveDailySupplierOrderDigestRecipients({}), DEFAULT_MISSING_INVOICE_EMAIL_TO);
  assert.deepEqual(resolveDailySupplierOrderDigestCc({}), DEFAULT_MISSING_INVOICE_EMAIL_CC);
});

test("runDailySupplierOrderEmailCycle emails each salesman plus one boss digest and company digest", async () => {
  const sent = [];
  const saved = [];
  const result = await runDailySupplierOrderEmailCycle({}, {
    trigger: "sales-upload",
    now: new Date("2026-09-10T12:00:00+03:00"),
    env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "sfa@madiba.com" },
    send: async (message) => {
      sent.push(message);
      return { provider: "test" };
    },
    loadOrders: async () => ([
      {
        id: 378,
        order_number: "378",
        customer_code: "C1",
        customer_name: "Dhawi Salem",
        salesman_code: "AR",
        salesman_name: "ABDUL REHMAN",
        status: "SUBMITTED",
        created_by: "u1",
        created_at: "2026-09-10T06:43:00.000Z",
        submitted_at: "2026-09-10T06:43:00.000Z",
        updated_at: "2026-09-10T06:43:00.000Z",
      },
      {
        id: 379,
        order_number: "379",
        customer_code: "C2",
        customer_name: "Sara Shop",
        salesman_code: "SM2",
        salesman_name: "Sara",
        status: "SUBMITTED",
        created_by: "u2",
        created_at: "2026-09-10T07:00:00.000Z",
        submitted_at: "2026-09-10T07:00:00.000Z",
        updated_at: "2026-09-10T07:00:00.000Z",
      },
    ]),
    loadProfiles: async () => ([
      {
        id: "u1",
        salesman_code: "AR",
        salesman_name: "ABDUL REHMAN",
        email: "abdul@madiba.com",
        report_email: "abdul.report@madiba.com",
        role: "salesman",
        is_active: true,
      },
      {
        id: "u2",
        salesman_code: "SM2",
        salesman_name: "Sara",
        email: "sara@madiba.com",
        report_email: "sara.report@madiba.com",
        role: "salesman",
        is_active: true,
      },
      {
        id: "boss1",
        salesman_code: "MGR",
        salesman_name: "Boss One",
        email: "boss@madiba.com",
        report_email: "boss.report@madiba.com",
        role: "manager",
        is_active: true,
      },
    ]),
    loadMeta: async () => new Map([
      ["378", { status: "Invoice made", invoiceFilePath: "C1/378/file.pdf", invoiceAmountExclVat: 980, statusUpdatedAt: "2026-09-10T08:00:00.000Z" }],
      ["379", { status: "Invoice not uploaded" }],
    ]),
    loadValues: async () => ({
      values: new Map([["378", 1000], ["379", 200]]),
      linesByOrder: new Map([
        ["378", [{ item_code: "A1", quantity: 10, rate: 100, line_value: 1000 }]],
        ["379", [{ item_code: "B1", quantity: 2, rate: 100, line_value: 200 }]],
      ]),
    }),
    loadInvoiceValues: async () => new Map([["378", 980], ["379", null]]),
    loadLastSentMarker: async () => ({ date: "", lastSentAt: "2026-09-08T00:00:00.000Z" }),
    saveLastSentMarker: async (_admin, marker) => {
      saved.push(marker);
    },
    listAuthUsers: async () => ([
      {
        id: "u1",
        user_metadata: {
          salesman_code: "AR",
          salesman_name: "ABDUL REHMAN",
          head_salesman_code: "MGR",
          head_salesman_name: "Boss One",
        },
      },
      {
        id: "u2",
        user_metadata: {
          salesman_code: "SM2",
          salesman_name: "Sara",
          head_salesman_code: "MGR",
          head_salesman_name: "Boss One",
        },
      },
      {
        id: "boss1",
        user_metadata: {
          salesman_code: "MGR",
          salesman_name: "Boss One",
        },
      },
    ]),
  });

  assert.equal(result.skipped, false);
  assert.equal(result.sentCount, 4);
  assert.equal(result.orderCount, 2);
  const salesmanMail = sent.find((message) => message.to[0] === "abdul.report@madiba.com");
  assert.ok(salesmanMail);
  assert.equal(salesmanMail.cc, undefined);
  assert.match(salesmanMail.html, /1,127.00/);
  assert.match(salesmanMail.html, /Invoice made/);
  assert.match(salesmanMail.html, /incl\. VAT/);
  assert.match(salesmanMail.html, /MADIBA SFA/);
  assert.match(salesmanMail.html, /Bosses receive a separate consolidated team email/);
  const saraMail = sent.find((message) => message.to[0] === "sara.report@madiba.com");
  assert.ok(saraMail);
  assert.equal(saraMail.cc, undefined);
  const bossDigest = sent.find((message) => message.to[0] === "boss.report@madiba.com");
  assert.ok(bossDigest);
  assert.match(bossDigest.subject, /Boss One/);
  assert.match(bossDigest.html, /your team/);
  assert.match(bossDigest.html, /ABDUL REHMAN \(AR\)/);
  assert.match(bossDigest.html, /Sara \(SM2\)/);
  assert.match(bossDigest.html, /do not need to track repeated CC copies/);
  const companyDigest = sent.find((message) => Array.isArray(message.to) && message.to[0] === DEFAULT_MISSING_INVOICE_EMAIL_TO[0]);
  assert.ok(companyDigest);
  assert.deepEqual(companyDigest.to, DEFAULT_MISSING_INVOICE_EMAIL_TO);
  assert.match(companyDigest.html, /ABDUL REHMAN/);
  assert.match(companyDigest.html, /Sara/);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].trigger, "sales-upload");
});

test("buildDailySupplierOrderEmail boss audience uses per-salesman sections", () => {
  const message = buildDailySupplierOrderEmail({
    date: "2026-10-13",
    salesmanName: "Boss One (MGR)",
    includeSalesman: true,
    audience: "boss",
    rows: [
      {
        order: "378",
        customer: "Dhawi Salem",
        salesman: "ABDUL REHMAN (AR)",
        orderStatus: "SUBMITTED",
        invoiceStatus: "Invoice made",
        createdAt: "13/10/2026, 09:43",
        orderValue: 1150,
        invoiceValue: 1127,
      },
      {
        order: "379",
        customer: "Sara Shop",
        salesman: "Sara (SM2)",
        orderStatus: "SUBMITTED",
        invoiceStatus: "Invoice not uploaded",
        createdAt: "13/10/2026, 10:00",
        orderValue: 230,
        invoiceValue: null,
      },
    ],
  });
  assert.match(message.subject, /Boss One/);
  assert.match(message.html, /your team/);
  assert.match(message.html, /<h3[^>]*>ABDUL REHMAN \(AR\)<\/h3>/);
  assert.match(message.html, /<h3[^>]*>Sara \(SM2\)<\/h3>/);
  assert.doesNotMatch(message.html, /Hierarchy bosses are copied/);
});

test("runDailySupplierOrderEmailCycle skips cron when already sent for the report date", async () => {
  const result = await runDailySupplierOrderEmailCycle({}, {
    trigger: "cron",
    date: "2026-09-09",
    now: new Date("2026-09-09T21:00:00+03:00"),
    env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "sfa@madiba.com" },
    send: async () => {
      throw new Error("should not send");
    },
    loadLastSentMarker: async () => ({ date: "2026-09-09", lastSentAt: "2026-09-09T12:00:00.000Z" }),
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "already_sent");
});
