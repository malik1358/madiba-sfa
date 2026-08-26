import test from "node:test";
import assert from "node:assert/strict";

import { buildOrderWhatsappSummary } from "../app/lib/orderWhatsapp.js";

test("buildOrderWhatsappSummary includes order totals and pdf note", () => {
  const summary = buildOrderWhatsappSummary({
    orderId: 210,
    statusLabel: "Submitted",
    customerCode: "1542",
    customerName: "Sultan Salem Ahmed Al-Shehri Accessories Establishment",
    salesmanCode: "ABD01",
    itemCount: 3,
    totalQuantity: 12,
    grandTotal: 1000,
  }, "en");

  assert.match(summary, /Sales order/);
  assert.match(summary, /Order #: 210/);
  assert.match(summary, /Subtotal: 1,000/);
  assert.match(summary, /VAT 15%: 150/);
  assert.match(summary, /Total incl. VAT: 1,150/);
  assert.match(summary, /PDF attached\./);
});
