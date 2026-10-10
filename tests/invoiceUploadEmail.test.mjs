import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInvoiceUploadEmail,
  DEFAULT_INVOICE_UPLOAD_FIXED_RECIPIENTS,
  resolveInvoiceUploadEmailRecipients,
} from "../app/lib/invoiceUploadEmail.js";
import { normalizeEmailAttachments } from "../app/lib/mailer.js";
import {
  findLatestUploadedInvoiceMeta,
  resendInvoiceUploadNotification,
  sendInvoiceUploadNotification,
} from "../app/lib/invoiceUploadEmailServer.js";

test("resolveInvoiceUploadEmailRecipients includes uploader, salesman, direct boss, Iliyas, and extra CC", () => {
  const recipients = resolveInvoiceUploadEmailRecipients({
    uploaderEmail: "uploader@example.com",
    salesmanEmail: "sales@example.com",
    directBossEmail: "boss@example.com",
    extraCc: "malik@pinasz.com",
  });
  assert.deepEqual(recipients.to, [
    "uploader@example.com",
    "sales@example.com",
    "boss@example.com",
    "iliyas.belliyaru@noorshukran.com",
  ]);
  assert.deepEqual(recipients.cc, ["malik@pinasz.com"]);
  assert.ok(DEFAULT_INVOICE_UPLOAD_FIXED_RECIPIENTS.includes("iliyas.belliyaru@noorshukran.com"));
});

test("resolveInvoiceUploadEmailRecipients dedupes overlapping addresses and accepts extras", () => {
  const recipients = resolveInvoiceUploadEmailRecipients({
    uploaderEmail: "sales@example.com",
    salesmanEmail: "sales@example.com",
    directBossEmail: "iliyas.belliyaru@noorshukran.com",
    extraTo: "ops@example.com, sales@example.com",
    extraCc: "malik@pinasz.com, sales@example.com",
  });
  assert.deepEqual(recipients.to, [
    "sales@example.com",
    "iliyas.belliyaru@noorshukran.com",
    "ops@example.com",
  ]);
  assert.deepEqual(recipients.cc, ["malik@pinasz.com"]);
});

test("buildInvoiceUploadEmail includes order and attachment summary", () => {
  const message = buildInvoiceUploadEmail({
    orderNumber: "MOI12",
    customerCode: "1114C",
    customerName: "Shop One",
    salesmanName: "Belal",
    uploaderName: "Invoice Maker",
    uploadedAtIso: "2026-10-10T10:00:00.000Z",
    attachmentNames: ["order-MOI12.pdf", "invoice-MOI12.pdf"],
  });
  assert.match(message.subject, /MOI12/);
  assert.match(message.subject, /1114C/);
  assert.match(message.text, /Belal/);
  assert.match(message.text, /order-MOI12\.pdf/);
  assert.match(message.html, /Invoice uploaded/);
  assert.match(message.html, /0f4c5c/);
});

test("normalizeEmailAttachments keeps filename and content only", () => {
  const attachments = normalizeEmailAttachments([
    { filename: "a.pdf", content: Buffer.from("A"), contentType: "application/pdf" },
    { filename: "", content: Buffer.from("x") },
    { fileName: "b.pdf", content: Buffer.from("B") },
  ]);
  assert.equal(attachments.length, 2);
  assert.equal(attachments[0].filename, "a.pdf");
  assert.equal(attachments[1].filename, "b.pdf");
  assert.equal(attachments[1].contentType, "application/octet-stream");
});

function createFakeAdmin({ order, lines = [], profiles = [], authUsers = [], settings = [] }) {
  return {
    from(table) {
      const filters = [];
      const query = {
        select() { return query; },
        eq(column, value) { filters.push((row) => row[column] === value); return query; },
        like(column, pattern) {
          const prefix = String(pattern || "").replace(/%/g, "");
          filters.push((row) => String(row[column] || "").startsWith(prefix));
          return query;
        },
        order() { return query; },
        range() { return query; },
        maybeSingle: async () => {
          if (table === "sales_orders") return { data: order, error: null };
          if (table === "system_settings") {
            const rows = settings.filter((row) => filters.every((fn) => fn(row)));
            return { data: rows[0] || null, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve) {
          if (table === "sales_order_items") return resolve({ data: lines, error: null });
          if (table === "profiles") return resolve({ data: profiles, error: null });
          if (table === "system_settings") {
            const rows = settings.filter((row) => filters.every((fn) => fn(row)));
            return resolve({ data: rows, error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return query;
    },
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: authUsers }, error: null }),
      },
    },
  };
}

test("sendInvoiceUploadNotification emails recipients with order and invoice PDFs", async () => {
  const sent = [];
  const order = {
    id: "378",
    order_number: "MOI12",
    customer_code: "1114C",
    customer_name: "Shop One",
    salesman_code: "S01",
    salesman_name: "Sales One",
    status: "SUBMITTED",
    created_at: "2026-10-10T08:00:00.000Z",
    updated_at: "2026-10-10T08:00:00.000Z",
    created_by: "sales-1",
  };
  const lines = [
    { id: 1, item_code: "A1", item_name: "Item A", category: "CAT", quantity: 2, rate: 10, line_value: 20 },
  ];
  const profiles = [
    {
      id: "uploader-1",
      salesman_code: "INV1",
      salesman_name: "Invoice Maker",
      role: "invoice-maker",
      email: "uploader@example.com",
      report_email: "",
    },
    {
      id: "sales-1",
      salesman_code: "S01",
      salesman_name: "Sales One",
      role: "salesman",
      email: "sales@example.com",
      report_email: "sales-report@example.com",
    },
    {
      id: "boss-1",
      salesman_code: "B01",
      salesman_name: "Boss One",
      role: "manager",
      email: "boss@example.com",
      report_email: "",
    },
  ];
  const authUsers = [
    { id: "uploader-1", email: "uploader-auth@example.com", user_metadata: {} },
    {
      id: "sales-1",
      email: "sales-auth@example.com",
      user_metadata: { head_salesman_code: "B01", head_salesman_id: "boss-1" },
    },
    { id: "boss-1", email: "boss-auth@example.com", user_metadata: {} },
  ];

  const admin = createFakeAdmin({ order, lines, profiles, authUsers });
  const result = await sendInvoiceUploadNotification(admin, {
    orderId: "378",
    invoiceBuffer: Buffer.from("%PDF-1.4 invoice"),
    invoiceFileName: "Inv_1.pdf",
    uploaderUserId: "uploader-1",
    uploadedAtIso: "2026-10-10T10:00:00.000Z",
    extraCc: "malik@pinasz.com",
    env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "sfa@pinasz.com" },
    loadCatalog: async () => null,
    send: async (message) => {
      sent.push(message);
      return { provider: "test", id: "msg-1" };
    },
  });

  assert.equal(result.sent, true);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].to.includes("uploader@example.com"));
  assert.ok(sent[0].to.includes("sales-report@example.com"));
  assert.ok(sent[0].to.includes("boss@example.com"));
  assert.ok(sent[0].to.includes("iliyas.belliyaru@noorshukran.com"));
  assert.deepEqual(sent[0].cc, ["malik@pinasz.com"]);
  assert.equal(sent[0].attachments.length, 2);
  assert.match(sent[0].attachments[0].filename, /\.pdf$/i);
  assert.match(sent[0].attachments[1].filename, /Inv_1\.pdf$/i);
  assert.match(sent[0].subject, /MOI12/);
});

test("findLatestUploadedInvoiceMeta picks the newest uploaded invoice", async () => {
  const admin = createFakeAdmin({
    settings: [
      {
        setting_key: "order_invoice_meta:1",
        setting_value: JSON.stringify({
          orderId: "1",
          invoiceFilePath: "a/1.pdf",
          invoiceUploadedAt: "2026-10-09T10:00:00.000Z",
        }),
      },
      {
        setting_key: "order_invoice_meta:2",
        setting_value: JSON.stringify({
          orderId: "2",
          invoiceFilePath: "b/2.pdf",
          invoiceUploadedAt: "2026-10-10T12:00:00.000Z",
        }),
      },
      {
        setting_key: "order_invoice_meta:3",
        setting_value: JSON.stringify({ orderId: "3", status: "Pending for invoice creation" }),
      },
    ],
  });
  const latest = await findLatestUploadedInvoiceMeta(admin);
  assert.equal(latest.orderId, "2");
});

test("resendInvoiceUploadNotification uses latest invoice and CC", async () => {
  const sent = [];
  const order = {
    id: "2",
    order_number: "MOI99",
    customer_code: "2000C",
    customer_name: "Shop Two",
    salesman_code: "S01",
    salesman_name: "Sales One",
    status: "SUBMITTED",
    created_by: "sales-1",
  };
  const admin = createFakeAdmin({
    order,
    lines: [{ id: 1, item_code: "A1", item_name: "Item A", category: "CAT", quantity: 1, rate: 5, line_value: 5 }],
    profiles: [{
      id: "uploader-1",
      salesman_code: "INV1",
      salesman_name: "Invoice Maker",
      role: "invoice-maker",
      email: "uploader@example.com",
    }, {
      id: "sales-1",
      salesman_code: "S01",
      salesman_name: "Sales One",
      role: "salesman",
      email: "sales@example.com",
    }],
    authUsers: [
      { id: "uploader-1", email: "uploader@example.com", user_metadata: {} },
      { id: "sales-1", email: "sales@example.com", user_metadata: {} },
    ],
    settings: [{
      setting_key: "order_invoice_meta:2",
      setting_value: JSON.stringify({
        orderId: "2",
        invoiceFilePath: "b/2.pdf",
        invoiceUploadedAt: "2026-10-10T12:00:00.000Z",
        invoiceUploadedBy: "uploader-1",
      }),
    }],
  });

  const result = await resendInvoiceUploadNotification(admin, {
    extraCc: "malik@pinasz.com",
    env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "sfa@pinasz.com" },
    loadCatalog: async () => null,
    readInvoice: async () => Buffer.from("%PDF-1.4 latest"),
    send: async (message) => {
      sent.push(message);
      return { provider: "test", id: "msg-resend" };
    },
  });

  assert.equal(result.sent, true);
  assert.equal(result.orderId, "2");
  assert.deepEqual(sent[0].cc, ["malik@pinasz.com"]);
  assert.equal(sent[0].attachments.length, 2);
});
