import { compareOrderLinesWithInvoiceText } from "./invoiceOrderCompare.js";
import { extractPdfText } from "./extractPdfText.js";

export const INVOICE_BUCKET = "order-invoices";

export async function loadOrderLines(admin, orderId) {
  const { data, error } = await admin
    .from("sales_order_items")
    .select("item_code,item_name,quantity,rate")
    .eq("order_id", orderId)
    .order("item_name");

  if (error) throw error;
  return data || [];
}

export async function compareInvoiceBufferWithOrder(admin, orderId, pdfBuffer) {
  const orderLines = await loadOrderLines(admin, orderId);
  const pdfText = await extractPdfText(pdfBuffer);
  const comparisonDiffs = compareOrderLinesWithInvoiceText(orderLines, pdfText);

  return {
    comparisonDiffs,
    comparisonCheckedAt: new Date().toISOString(),
    comparisonMatch: comparisonDiffs.length === 0,
  };
}

export async function compareStoredInvoiceWithOrder(admin, orderId, invoiceFilePath) {
  const { data, error } = await admin.storage.from(INVOICE_BUCKET).download(invoiceFilePath);
  if (error) throw error;

  const buffer = await data.arrayBuffer();
  return compareInvoiceBufferWithOrder(admin, orderId, buffer);
}

export function attachComparisonToMeta(meta, comparison) {
  return {
    ...meta,
    comparisonDiffs: comparison.comparisonDiffs,
    comparisonCheckedAt: comparison.comparisonCheckedAt,
    comparisonMatch: comparison.comparisonMatch,
  };
}
