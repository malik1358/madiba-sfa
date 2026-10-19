import test from "node:test";
import assert from "node:assert/strict";

import { extractInvoiceBuyerFromPdfText } from "../app/lib/invoiceBuyerExtract.js";
import { parseProspectIdFromCustomerCode } from "../app/lib/prospects.js";

const SAMPLE_INVOICE_TEXT = [
  "MADIBA OFFICE SUPPLIES",
  "Tax Invoice",
  "1542 RENEWABLE TECHNOLOGY FOR TRADING EST",
  "Building No, City 7654, RIYADH",
  "Al Dirah Dist, 12633",
  "Region Riyadh",
  "Country Saudi Arabia",
  "VAT No. 311522527200003",
  "Buyer",
  "المشتري",
  "A004075 THERMAL POS ROLL 100 66 6600",
].join("\n");

test("extractInvoiceBuyerFromPdfText reads buyer code and name from invoice text", () => {
  const buyer = extractInvoiceBuyerFromPdfText(SAMPLE_INVOICE_TEXT);

  assert.equal(buyer.customer_code, "1542");
  assert.equal(buyer.customer_name, "RENEWABLE TECHNOLOGY FOR TRADING EST");
});

test("extractInvoiceBuyerFromPdfText finds buyer when marker appears after name block", () => {
  const buyer = extractInvoiceBuyerFromPdfText([
    "Seller details",
    "1301 AL TAWFEER TRADING COMPANY",
    "1115C OTHER CUSTOMER LLC",
    "Buyer",
  ].join("\n"));

  assert.equal(buyer.customer_code, "1115C");
  assert.equal(buyer.customer_name, "OTHER CUSTOMER LLC");
});

test("parseProspectIdFromCustomerCode extracts numeric prospect id", () => {
  assert.equal(parseProspectIdFromCustomerCode("PROSPECT-210"), 210);
  assert.equal(parseProspectIdFromCustomerCode("prospect-64"), 64);
  assert.equal(parseProspectIdFromCustomerCode("1542"), null);
});
