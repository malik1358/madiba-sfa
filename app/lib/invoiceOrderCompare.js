export function normalizeItemCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function parseInvoiceLineNumbers(lineText) {
  const matches = String(lineText || "").match(/-?\d[\d,]*(?:\.\d+)?/g) || [];
  return matches
    .map((value) => Number(String(value).replace(/,/g, "")))
    .filter((value) => Number.isFinite(value));
}

export function extractQtyRateFromNumbers(numbers, orderQty, orderRate) {
  const values = (numbers || []).filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return { qty: null, rate: null };
  }

  const exactQty = values.find((value) => Math.abs(value - orderQty) < 0.001);
  const exactRate = values.find((value) => Math.abs(value - orderRate) < 0.05);

  if (Number.isFinite(exactQty) && Number.isFinite(exactRate)) {
    return { qty: exactQty, rate: exactRate };
  }

  if (values.length >= 3) {
    return {
      qty: values[values.length - 3],
      rate: values[values.length - 2],
    };
  }

  if (values.length === 2) {
    return { qty: values[0], rate: values[1] };
  }

  return {
    qty: exactQty ?? values[0],
    rate: exactRate ?? values[values.length - 1],
  };
}

export function compareOrderLinesWithInvoiceText(orderLines, pdfText) {
  const diffs = [];
  const lines = String(pdfText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  (orderLines || []).forEach((orderLine) => {
    const code = normalizeItemCode(orderLine?.item_code);
    if (!code) return;

    const orderQty = Number(orderLine.quantity || 0);
    const orderRate = Number(orderLine.rate || 0);
    const matchingLines = lines.filter((line) => line.toUpperCase().includes(code));

    if (matchingLines.length === 0) {
      diffs.push({
        type: "missing_item",
        item_code: code,
        item_name: String(orderLine.item_name || "").trim(),
        order_quantity: orderQty,
        order_rate: orderRate,
        invoice_quantity: null,
        invoice_rate: null,
      });
      return;
    }

    const numbers = parseInvoiceLineNumbers(matchingLines[0]);
    const { qty: invoiceQty, rate: invoiceRate } = extractQtyRateFromNumbers(numbers, orderQty, orderRate);

    if (!Number.isFinite(invoiceQty) || Math.abs(invoiceQty - orderQty) > 0.001) {
      diffs.push({
        type: "quantity",
        item_code: code,
        item_name: String(orderLine.item_name || "").trim(),
        order_quantity: orderQty,
        order_rate: orderRate,
        invoice_quantity: Number.isFinite(invoiceQty) ? invoiceQty : null,
        invoice_rate: Number.isFinite(invoiceRate) ? invoiceRate : null,
      });
    }

    if (!Number.isFinite(invoiceRate) || Math.abs(invoiceRate - orderRate) > 0.05) {
      diffs.push({
        type: "price",
        item_code: code,
        item_name: String(orderLine.item_name || "").trim(),
        order_quantity: orderQty,
        order_rate: orderRate,
        invoice_quantity: Number.isFinite(invoiceQty) ? invoiceQty : null,
        invoice_rate: Number.isFinite(invoiceRate) ? invoiceRate : null,
      });
    }
  });

  return diffs;
}

export function formatComparisonDiff(diff) {
  if (!diff) return "";
  if (diff.type === "missing_item") {
    return `${diff.item_code} missing from invoice (order qty ${diff.order_quantity}, rate ${diff.order_rate})`;
  }
  if (diff.type === "quantity") {
    return `${diff.item_code} qty order ${diff.order_quantity} vs invoice ${diff.invoice_quantity ?? "?"}`;
  }
  if (diff.type === "price") {
    return `${diff.item_code} price order ${diff.order_rate} vs invoice ${diff.invoice_rate ?? "?"}`;
  }
  return `${diff.item_code || "Item"} difference detected`;
}
