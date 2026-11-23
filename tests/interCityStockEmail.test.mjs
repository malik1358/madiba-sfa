import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  DEFAULT_INTER_CITY_STOCK_EMAIL_CC,
  INTER_CITY_STOCK_EMAIL_VILYATH,
  buildInterCityStockEmail,
  buildInterCityStockEmailMessages,
  buildInterCityStockExcelAttachment,
  interCityStockEmailCc,
  interCityStockEmailClaimKey,
  interCityStockEmailGroupRecipients,
  interCityStockEmailRecipients,
} from "../app/lib/interCityStockEmail.js";
import { resolveInterCityStockEmailSchedule } from "../app/lib/interCityStockEmailServer.js";
import { WAREHOUSE_INVOICE_ILIYAS_EMAIL, WAREHOUSE_INVOICE_JAVED_EMAIL } from "../app/lib/warehouseInvoiceRecipients.js";

const sampleReport = {
  stockDate: "2026-11-11",
  summary: {
    dammamToRiyadhItems: 1,
    riyadhToDammamItems: 2,
    riyadhToStoreItems: 3,
    storeToRiyadhItems: 1,
    storeStockItems: 4,
  },
  directions: {
    dammamToRiyadh: {
      rows: [{
        itemCode: "A001",
        itemName: "Dammam only",
        unit: "CTN",
        sourceQty: 10,
        destinationQty: 0,
        peakWeeklyQty: 14,
        sourcePeakWeeklyQty: 7,
        peakWeekKey: "2026-10-20",
        dailyDemand: 2,
        targetCoverQty: 30,
        suggestedQty: 5,
        afterAtDestination: 5,
        remainingAtSource: 5,
        daysCoverAfterAtDestination: 2.5,
        daysCoverAfterAtSource: 35,
        cbmPerCtn: 0.1,
        totalCbm: 0.5,
      }],
      totalCbm: 0.5,
    },
    riyadhToDammam: {
      rows: [{
        itemCode: "A002",
        itemName: "Riyadh only",
        unit: "CTN",
        sourceQty: 20,
        destinationQty: 0,
        suggestedQty: 8,
        totalCbm: 1.2,
      }],
      totalCbm: 1.2,
    },
    riyadhToStore: {
      rows: [{
        itemCode: "A003",
        itemName: "Warehouse not store",
        unit: "CTN",
        sourceQty: 12,
        destinationQty: 0,
        suggestedQty: 5,
        usedUnsoldMinimum: true,
        totalCbm: 0.4,
      }],
      totalCbm: 0.4,
    },
    storeToRiyadh: {
      rows: [{
        itemCode: "A004",
        itemName: "Store only",
        unit: "CTN",
        sourceQty: 9,
        destinationQty: 0,
        suggestedQty: 5,
        totalCbm: 0.3,
      }],
      totalCbm: 0.3,
    },
  },
};

test("dammam/riyadh digest defaults to Iliyas and DWH", () => {
  assert.deepEqual(
    interCityStockEmailGroupRecipients("dammamRiyadh", {}),
    [WAREHOUSE_INVOICE_ILIYAS_EMAIL, WAREHOUSE_INVOICE_JAVED_EMAIL],
  );
});

test("store/riyadh digest defaults to Iliyas and Vilyath", () => {
  assert.deepEqual(
    interCityStockEmailGroupRecipients("storeRiyadh", {}),
    [WAREHOUSE_INVOICE_ILIYAS_EMAIL, INTER_CITY_STOCK_EMAIL_VILYATH],
  );
});

test("default CC is Fazlur Soyeb Sohail Malik", () => {
  assert.deepEqual(interCityStockEmailCc({}), DEFAULT_INTER_CITY_STOCK_EMAIL_CC);
});

test("test override replaces To and skips CC", () => {
  assert.deepEqual(
    interCityStockEmailGroupRecipients("dammamRiyadh", { INTER_CITY_STOCK_EMAIL_TEST_TO: "qa@example.com" }),
    ["qa@example.com"],
  );
  assert.deepEqual(interCityStockEmailCc({ INTER_CITY_STOCK_EMAIL_TEST_TO: "qa@example.com" }), []);
});

test("legacy recipients helper still returns a list", () => {
  assert.ok(interCityStockEmailRecipients({}).includes(WAREHOUSE_INVOICE_ILIYAS_EMAIL));
});

test("claim key is per KSA day", () => {
  assert.equal(interCityStockEmailClaimKey("2026-11-14"), "inter_city_stock_email:2026-11-14");
});

test("schedule skips Friday unless forced", () => {
  const friday = new Date("2026-11-13T08:00:00+03:00");
  assert.equal(resolveInterCityStockEmailSchedule(friday).skipped, true);
  assert.equal(resolveInterCityStockEmailSchedule(friday, { force: true }).skipped, false);
  const saturday = new Date("2026-11-14T08:00:00+03:00");
  assert.equal(resolveInterCityStockEmailSchedule(saturday).skipped, false);
});

test("builds city and store digests with excel attachments", () => {
  const messages = buildInterCityStockEmailMessages(sampleReport, {
    date: "2026-11-14",
    env: { NEXT_PUBLIC_APP_URL: "https://madiba-sfa.vercel.app" },
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].groupKey, "dammamRiyadh");
  assert.equal(messages[1].groupKey, "storeRiyadh");
  assert.match(messages[0].subject, /Dammam ↔ Riyadh/);
  assert.match(messages[1].subject, /Store ↔ Riyadh/);
  assert.match(messages[0].html, /In Dammam, not in Riyadh/);
  assert.match(messages[1].html, /In Riyadh warehouse, not in Store/);
  assert.equal(messages[0].attachments.length, 1);
  assert.equal(messages[1].attachments.length, 1);
  assert.match(messages[0].attachments[0].filename, /dammamRiyadh/);
  assert.match(messages[1].attachments[0].filename, /storeRiyadh/);
});

test("excel attachment includes all report columns", () => {
  const attachment = buildInterCityStockExcelAttachment(sampleReport, {
    groupKey: "dammamRiyadh",
    date: "2026-11-14",
  });
  assert.ok(attachment);
  const workbook = XLSX.read(attachment.content, { type: "buffer" });
  assert.deepEqual(workbook.SheetNames, ["Dammam to Riyadh", "Riyadh to Dammam"]);
  const sheet = workbook.Sheets["Dammam to Riyadh"];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  assert.ok(rows[0].includes("Item code"));
  assert.ok(rows[0].includes("Peak weekly (dest)"));
  assert.ok(rows[0].includes("Days cover left at Dammam"));
  assert.ok(rows[0].includes("CBM / Ctn"));
  assert.ok(rows[0].includes("Total CBM"));
  assert.equal(rows[1][0], "A001");
  assert.equal(rows[1][10], "5");
});

test("single-group builder still works for city digest", () => {
  const message = buildInterCityStockEmail(sampleReport, {
    date: "2026-11-14",
    groupKey: "dammamRiyadh",
    env: { NEXT_PUBLIC_APP_URL: "https://madiba-sfa.vercel.app" },
  });
  assert.match(message.html, /A001/);
  assert.match(message.text, /Excel attachment/);
});
