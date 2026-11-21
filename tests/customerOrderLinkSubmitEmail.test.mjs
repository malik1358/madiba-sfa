import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCustomerOrderLinkSubmitEmail,
  resolveCustomerOrderLinkSubmitEmailRecipients,
} from "../app/lib/customerOrderLinkSubmitEmail.js";

test("guest submit email goes to salesman and full hierarchy", () => {
  const recipients = resolveCustomerOrderLinkSubmitEmailRecipients({
    salesmanEmail: "sales@example.com",
    hierarchyEmails: ["boss@example.com", "director@example.com", "sales@example.com"],
    extraCc: "ops@example.com",
  });
  assert.deepEqual(recipients.to, [
    "sales@example.com",
    "boss@example.com",
    "director@example.com",
  ]);
  assert.deepEqual(recipients.cc, ["ops@example.com"]);
});

test("guest submit email body names the order and customer", () => {
  const message = buildCustomerOrderLinkSubmitEmail({
    orderNumber: "SM001-12",
    customerCode: "1224",
    customerName: "Demo Shop",
    salesmanName: "Ali",
    salesmanCode: "SM001",
    totalValue: 1250.5,
    lineCount: 3,
    submittedAtIso: "2026-11-21T12:00:00.000Z",
    pricingRegion: "riyadh",
    pricingType: "wholesale",
  });
  assert.match(message.subject, /SM001-12/);
  assert.match(message.subject, /1224/);
  assert.match(message.text, /Demo Shop/);
  assert.match(message.text, /Ali \(SM001\)/);
  assert.match(message.html, /Customer order link submitted/);
});
