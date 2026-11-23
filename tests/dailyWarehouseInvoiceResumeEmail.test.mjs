import test from "node:test";
import assert from "node:assert/strict";
import {
  bucketWarehouseInvoiceResumeRows,
  buildDailyWarehouseInvoiceResumeEmail,
  buildWarehouseInvoiceResumeRow,
  resolveDailyWarehouseInvoiceResumeRecipients,
  selectWarehouseInvoiceResumeRows,
} from "../app/lib/dailyWarehouseInvoiceResumeEmail.js";
import {
  parseWarehouseInvoiceResumeDate,
  resolveDailyWarehouseInvoiceResumeSchedule,
  runDailyWarehouseInvoiceResumeEmailCycle,
} from "../app/lib/dailyWarehouseInvoiceResumeEmailServer.js";
import {
  invoiceFileNumberFromName,
  resolveWarehouseInvoiceFixedRecipient,
  warehouseInvoiceBucketKey,
  WAREHOUSE_INVOICE_BUCKET_DAMMAM,
  WAREHOUSE_INVOICE_BUCKET_RIYADH_JEDDAH,
  WAREHOUSE_INVOICE_ILIYAS_EMAIL,
  WAREHOUSE_INVOICE_JAVED_EMAIL,
} from "../app/lib/warehouseInvoiceRecipients.js";

test("invoiceFileNumberFromName strips path and pdf suffix", () => {
  assert.equal(invoiceFileNumberFromName("C:/tmp/Inv_4521.pdf"), "Inv_4521");
  assert.equal(invoiceFileNumberFromName("4521.PDF"), "4521");
  assert.equal(invoiceFileNumberFromName(""), "");
});

test("warehouse buckets route Riyadh/Jeddah to Iliyas and Dammam to Javed", () => {
  assert.equal(warehouseInvoiceBucketKey("riyadh"), WAREHOUSE_INVOICE_BUCKET_RIYADH_JEDDAH);
  assert.equal(warehouseInvoiceBucketKey("jeddah"), WAREHOUSE_INVOICE_BUCKET_RIYADH_JEDDAH);
  assert.equal(warehouseInvoiceBucketKey(""), WAREHOUSE_INVOICE_BUCKET_RIYADH_JEDDAH);
  assert.equal(warehouseInvoiceBucketKey("dammam"), WAREHOUSE_INVOICE_BUCKET_DAMMAM);
  assert.equal(resolveWarehouseInvoiceFixedRecipient("riyadh"), WAREHOUSE_INVOICE_ILIYAS_EMAIL);
  assert.equal(resolveWarehouseInvoiceFixedRecipient("jeddah"), WAREHOUSE_INVOICE_ILIYAS_EMAIL);
  assert.equal(resolveWarehouseInvoiceFixedRecipient("dammam"), WAREHOUSE_INVOICE_JAVED_EMAIL);
});

test("daily resume recipients include Jenil and Shreyans on CC", () => {
  const riyadh = resolveDailyWarehouseInvoiceResumeRecipients(WAREHOUSE_INVOICE_BUCKET_RIYADH_JEDDAH);
  assert.deepEqual(riyadh.to, [WAREHOUSE_INVOICE_ILIYAS_EMAIL]);
  assert.ok(riyadh.cc.includes("jenil.modi@noorshukran.com"));
  assert.ok(riyadh.cc.includes("shreyansh.sharma@noorshukran.com"));

  const dammam = resolveDailyWarehouseInvoiceResumeRecipients(WAREHOUSE_INVOICE_BUCKET_DAMMAM);
  assert.deepEqual(dammam.to, [WAREHOUSE_INVOICE_JAVED_EMAIL]);
  assert.ok(dammam.cc.includes("jenil.modi@noorshukran.com"));
});

test("selectWarehouseInvoiceResumeRows keeps uploads inside the KSA day window", () => {
  const orders = [
    {
      id: "1",
      order_number: "MOI1",
      customer_code: "1001",
      customer_name: "One",
      salesman_name: "A",
      status: "SUBMITTED",
    },
    {
      id: "2",
      order_number: "MOI2",
      customer_code: "1002",
      customer_name: "Two",
      salesman_name: "B",
      status: "SUBMITTED",
    },
  ];
  const metaByOrder = new Map([
    ["1", {
      invoiceUploadedAt: "2026-11-22T10:00:00.000Z",
      originalFileName: "Inv_100.pdf",
      invoiceFilePath: "a/1.pdf",
      invoiceAmountExclVat: 100,
    }],
    ["2", {
      invoiceUploadedAt: "2026-11-20T10:00:00.000Z",
      originalFileName: "Inv_200.pdf",
      invoiceFilePath: "a/2.pdf",
    }],
  ]);
  const pricingRegionByOrder = new Map([["1", "dammam"], ["2", "riyadh"]]);
  const sinceMs = Date.parse("2026-11-22T00:00:00.000+03:00");
  const asOfMs = Date.parse("2026-11-22T23:59:59.999+03:00");
  const rows = selectWarehouseInvoiceResumeRows({
    orders,
    metaByOrder,
    pricingRegionByOrder,
    sinceMs,
    asOfMs,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].invoiceFileNumber, "Inv_100");
  assert.equal(rows[0].bucketKey, WAREHOUSE_INVOICE_BUCKET_DAMMAM);
});

test("buildDailyWarehouseInvoiceResumeEmail includes invoice file number and teal header", () => {
  const row = buildWarehouseInvoiceResumeRow({
    order: {
      id: "9",
      order_number: "MOI9",
      customer_code: "1500",
      customer_name: "Shop",
      salesman_name: "Belal",
      status: "SUBMITTED",
    },
    meta: {
      invoiceUploadedAt: "2026-11-22T12:00:00.000Z",
      originalFileName: "Inv_7788.pdf",
      invoiceFilePath: "x.pdf",
      invoiceAmountExclVat: 250.5,
    },
    pricingRegion: "jeddah",
  });
  const mail = buildDailyWarehouseInvoiceResumeEmail({
    date: "2026-11-22",
    bucketKey: WAREHOUSE_INVOICE_BUCKET_RIYADH_JEDDAH,
    rows: [row],
  });
  assert.match(mail.subject, /Riyadh & Jeddah/);
  assert.match(mail.html, /Inv_7788/);
  assert.match(mail.html, /0f4c5c/);
  assert.match(mail.html, /1500/);
  assert.match(mail.text, /Belal/);
});

test("bucketWarehouseInvoiceResumeRows splits Dammam from Riyadh/Jeddah", () => {
  const buckets = bucketWarehouseInvoiceResumeRows([
    { bucketKey: WAREHOUSE_INVOICE_BUCKET_DAMMAM, orderId: "1" },
    { bucketKey: WAREHOUSE_INVOICE_BUCKET_RIYADH_JEDDAH, orderId: "2" },
    { bucketKey: WAREHOUSE_INVOICE_BUCKET_RIYADH_JEDDAH, orderId: "3" },
  ]);
  assert.equal(buckets[WAREHOUSE_INVOICE_BUCKET_DAMMAM].length, 1);
  assert.equal(buckets[WAREHOUSE_INVOICE_BUCKET_RIYADH_JEDDAH].length, 2);
});

test("Thursday report date is used when previous KSA day is Friday", () => {
  // Saturday 08:30 KSA = 05:30 UTC
  const saturday = new Date("2026-11-21T05:30:00.000Z");
  assert.equal(parseWarehouseInvoiceResumeDate("", saturday), "2026-11-19");
  const schedule = resolveDailyWarehouseInvoiceResumeSchedule("", saturday);
  assert.equal(schedule.skipped, false);
  assert.equal(schedule.date, "2026-11-19");
});

test("runDailyWarehouseInvoiceResumeEmailCycle sends both buckets on force test with CC", async () => {
  const sent = [];
  const result = await runDailyWarehouseInvoiceResumeEmailCycle({}, {
    force: true,
    to: "malik@pinasz.com",
    cc: "malik@pinasz.com",
    date: "2026-11-22",
    env: { SMTP_HOST: "smtp.example.com", SMTP_FROM: "sfa@pinasz.com" },
    send: async (message) => {
      sent.push(message);
      return { provider: "test" };
    },
    loadRows: async () => ({
      date: "2026-11-22",
      rows: [
        {
          orderId: "1",
          orderNumber: "MOI1",
          customerCode: "1001",
          customerName: "One",
          salesmanName: "A",
          pricingRegion: "riyadh",
          cityLabel: "Riyadh",
          bucketKey: WAREHOUSE_INVOICE_BUCKET_RIYADH_JEDDAH,
          invoiceFileNumber: "Inv_1",
          invoiceFileName: "Inv_1.pdf",
          amountExclVat: 10,
          uploadedAtIso: "2026-11-22T10:00:00.000Z",
          uploadedAtMs: Date.parse("2026-11-22T10:00:00.000Z"),
        },
        {
          orderId: "2",
          orderNumber: "MOI2",
          customerCode: "1002",
          customerName: "Two",
          salesmanName: "B",
          pricingRegion: "dammam",
          cityLabel: "Dammam",
          bucketKey: WAREHOUSE_INVOICE_BUCKET_DAMMAM,
          invoiceFileNumber: "Inv_2",
          invoiceFileName: "Inv_2.pdf",
          amountExclVat: 20,
          uploadedAtIso: "2026-11-22T11:00:00.000Z",
          uploadedAtMs: Date.parse("2026-11-22T11:00:00.000Z"),
        },
      ],
      buckets: {
        [WAREHOUSE_INVOICE_BUCKET_RIYADH_JEDDAH]: [{
          orderId: "1",
          orderNumber: "MOI1",
          customerCode: "1001",
          customerName: "One",
          salesmanName: "A",
          pricingRegion: "riyadh",
          cityLabel: "Riyadh",
          bucketKey: WAREHOUSE_INVOICE_BUCKET_RIYADH_JEDDAH,
          invoiceFileNumber: "Inv_1",
          invoiceFileName: "Inv_1.pdf",
          amountExclVat: 10,
          uploadedAtIso: "2026-11-22T10:00:00.000Z",
          uploadedAtMs: Date.parse("2026-11-22T10:00:00.000Z"),
        }],
        [WAREHOUSE_INVOICE_BUCKET_DAMMAM]: [{
          orderId: "2",
          orderNumber: "MOI2",
          customerCode: "1002",
          customerName: "Two",
          salesmanName: "B",
          pricingRegion: "dammam",
          cityLabel: "Dammam",
          bucketKey: WAREHOUSE_INVOICE_BUCKET_DAMMAM,
          invoiceFileNumber: "Inv_2",
          invoiceFileName: "Inv_2.pdf",
          amountExclVat: 20,
          uploadedAtIso: "2026-11-22T11:00:00.000Z",
          uploadedAtMs: Date.parse("2026-11-22T11:00:00.000Z"),
        }],
      },
    }),
  });

  assert.equal(result.sentCount, 2);
  assert.equal(sent.length, 2);
  assert.ok(sent.every((message) => message.to.includes("malik@pinasz.com")));
  assert.ok(sent.every((message) => message.subject.startsWith("[TEST]")));
  assert.ok(sent.some((message) => message.html.includes("Inv_1")));
  assert.ok(sent.some((message) => message.html.includes("Inv_2")));
  assert.ok(sent.every((message) => message.cc.includes("jenil.modi@noorshukran.com")));
});
