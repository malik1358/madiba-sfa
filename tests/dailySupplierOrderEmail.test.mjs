import test from "node:test";
import assert from "node:assert/strict";

import {
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

test("selectDailySupplierOrders drops drafts and test customers", () => {
  const selected = selectDailySupplierOrders([
    { id: 1, status: "SUBMITTED", customer_name: "Dhawi Trading", salesman_code: "AR", order_number: "378" },
    { id: 2, status: "DRAFT", customer_name: "Dhawi Trading", salesman_code: "AR", order_number: "379" },
    { id: 3, status: "SUBMITTED", customer_name: "TEST CUSTOMER", salesman_code: "AR", order_number: "380" },
  ]);
  assert.deepEqual(selected.map((order) => order.id), [1]);
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

test("buildDailySupplierOrderEmail includes values without VAT and a total row", () => {
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
        orderValue: 1000,
        invoiceValue: 980,
      },
      {
        order: "377",
        customer: "Arkan Appliances",
        salesman: "ABDUL REHMAN (AR)",
        orderStatus: "SUBMITTED",
        invoiceStatus: "Invoice made",
        createdAt: "10/09/2026, 09:14",
        orderValue: 500,
        invoiceValue: 500,
      },
    ],
  });

  assert.match(message.subject, /ABDUL REHMAN/);
  assert.match(message.html, /Order value \(excl\. VAT\)/);
  assert.match(message.html, /Invoice made \(excl\. VAT\)/);
  assert.match(message.html, /1,000.00/);
  assert.match(message.html, /980.00/);
  assert.match(message.html, /Total \(2 orders\)/);
  assert.match(message.html, /1,500.00/);
  assert.match(message.html, /1,480.00/);
  assert.equal(message.orderCount, 2);
  assert.equal(message.totals.orderValue, 1500);
  assert.equal(message.totals.invoiceValue, 1480);
});

test("resolveDailySupplierOrderDigestRecipients uses the invoice-ops list", () => {
  assert.deepEqual(resolveDailySupplierOrderDigestRecipients({}), DEFAULT_MISSING_INVOICE_EMAIL_TO);
  assert.deepEqual(resolveDailySupplierOrderDigestCc({}), DEFAULT_MISSING_INVOICE_EMAIL_CC);
});

test("runDailySupplierOrderEmailCycle emails each salesman and a combined digest", async () => {
  const sent = [];
  const result = await runDailySupplierOrderEmailCycle({}, {
    date: "2026-09-09",
    now: new Date("2026-09-10T00:20:00+03:00"),
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
        created_at: "2026-09-09T06:43:00.000Z",
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
    ]),
    loadMeta: async () => new Map([
      ["378", { status: "Invoice made", invoiceFilePath: "C1/378/file.pdf", invoiceAmountExclVat: 980 }],
    ]),
    loadValues: async () => ({
      values: new Map([["378", 1000]]),
      linesByOrder: new Map([["378", [{ item_code: "A1", quantity: 10, rate: 100, line_value: 1000 }]]]),
    }),
    loadInvoiceValues: async () => new Map([["378", 980]]),
    loadLastSentDate: async () => "",
    saveLastSentDate: async () => {},
    listAuthUsers: async () => [],
  });

  assert.equal(result.skipped, false);
  assert.equal(result.sentCount, 2);
  assert.equal(result.orderCount, 1);
  assert.equal(sent[0].to[0], "abdul.report@madiba.com");
  assert.match(sent[0].html, /980.00/);
  assert.match(sent[0].html, /Invoice made/);
  assert.deepEqual(sent[1].to, DEFAULT_MISSING_INVOICE_EMAIL_TO);
  assert.match(sent[1].html, /ABDUL REHMAN/);
});

test("runDailySupplierOrderEmailCycle skips when already sent for the report date", async () => {
  const result = await runDailySupplierOrderEmailCycle({}, {
    date: "2026-09-09",
    now: new Date("2026-09-10T00:20:00+03:00"),
    env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "sfa@madiba.com" },
    send: async () => {
      throw new Error("should not send");
    },
    loadLastSentDate: async () => "2026-09-09",
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "already_sent");
});
