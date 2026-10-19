import test from "node:test";
import assert from "node:assert/strict";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { buildOrderPdfSnapshotFromSavedOrder, createOrderPdfDocument } from "../app/lib/orderPdfDocument.js";

const PROSPECT_NAME = "شركة عبدالرحمن محمد الرشودي";

async function pdfText(doc) {
  const data = new Uint8Array(doc.output("arraybuffer"));
  const pdf = await getDocument({ data, disableWorker: true, isEvalSupported: false }).promise;
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();
  return content.items.map((item) => item.str).join(" ").normalize("NFKC").replace(/\s+/g, " ").trim();
}

test("order PDF prints an Arabic prospect name instead of spaced Latin garbage", async () => {
  const snapshot = buildOrderPdfSnapshotFromSavedOrder({
    order: {
      id: 880,
      order_number: "SM13",
      status: "SUBMITTED",
      customer_code: "PROSPECT-726",
      customer_name: PROSPECT_NAME,
      salesman_code: "SM002",
      salesman_name: "Thamer",
      updated_at: "2026-10-18T10:10:23.000Z",
    },
    lines: [{ item_code: "A003291", item_name: "MADIBA CHEST FREEZER", quantity: 5, rate: 428, line_value: 2140 }],
    outstanding: {
      bucketLabels: ["0-30 days"],
      customer: { buckets: { "0-30 days": 0 }, open_invoices: 0, total_outstanding: 0 },
      customerInvoices: [],
    },
  });

  const doc = await createOrderPdfDocument(snapshot);
  const text = await pdfText(doc);

  assert.match(text, /PROSPECT-726/);
  assert.equal(text.includes("P R O S P E C T"), false);
  assert.equal(text.includes(PROSPECT_NAME), true);
  assert.match(text, /Salesman: Thamer/);
  assert.match(text, /MADIBA CHEST FREEZER/);
});
