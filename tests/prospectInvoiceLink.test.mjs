import test from "node:test";
import assert from "node:assert/strict";

import { isProspectInvoiceLinkCandidate } from "../app/lib/prospectInvoiceLink.js";

test("isProspectInvoiceLinkCandidate matches prospect orders with uploaded invoice and no link yet", () => {
  assert.equal(
    isProspectInvoiceLinkCandidate(
      { customer_code: "PROSPECT-210" },
      { invoiceFilePath: "PROSPECT-210/210/invoice.pdf" },
    ),
    true,
  );
});

test("isProspectInvoiceLinkCandidate skips already linked invoice meta", () => {
  assert.equal(
    isProspectInvoiceLinkCandidate(
      { customer_code: "PROSPECT-210" },
      {
        invoiceFilePath: "PROSPECT-210/210/invoice.pdf",
        prospectLinkedAt: "2026-08-26T10:00:00.000Z",
      },
    ),
    false,
  );
});

test("isProspectInvoiceLinkCandidate skips non-prospect orders", () => {
  assert.equal(
    isProspectInvoiceLinkCandidate(
      { customer_code: "1542" },
      { invoiceFilePath: "1542/210/invoice.pdf" },
    ),
    false,
  );
});
