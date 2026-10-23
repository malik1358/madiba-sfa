function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatOptionalMoney(value) {
  return value == null ? "—" : formatMoney(value);
}

function appliedTargetLabel(application) {
  const target = application.target_kind === "purchase" ? "Purchase" : "Invoice";
  const voucher = application.voucher_number ? ` ${application.voucher_number}` : "";
  return `${target}${voucher} (${formatMoney(application.amount)})`;
}

function purchaseDetail(purchase) {
  const applications = Array.isArray(purchase.applications) ? purchase.applications : [];
  const amount = formatMoney(purchase.amount);
  if (!applications.length) return amount;
  const applied = applications.reduce((total, application) => total + Number(application.amount || 0), 0);
  const unapplied = Math.max(0, Number(purchase.amount || 0) - applied);
  const targets = applications.map((application) => {
    const voucher = application.voucher_number ? ` ${application.voucher_number}` : "";
    return `Invoice${voucher} (${formatMoney(application.amount)})`;
  });
  if (unapplied > 0.009) targets.push(`unapplied ${formatMoney(unapplied)}`);
  return `${amount} → ${targets.join(", ")}`;
}

function receiptDetail(receipt) {
  const applications = Array.isArray(receipt.applications) ? receipt.applications : [];
  const isPayment = receipt.kind === "payment" || Number(receipt.amount) < 0;
  if (!applications.length) return isPayment ? "Not adjusted against an invoice" : "";
  return applications.map(appliedTargetLabel).join(", ");
}

export function flattenDatewiseLines(days) {
  const lines = [];
  (Array.isArray(days) ? days : []).forEach((day) => {
    const date = day?.date || "";
    (Array.isArray(day?.invoices) ? day.invoices : []).forEach((invoice, index) => {
      lines.push({
        id: `${date}|invoice|${invoice.voucher_number || "—"}|${index}`,
        date,
        kind: "Invoice",
        voucher: invoice.voucher_number || "—",
        sales_excl_vat: Number(invoice.amount_excl_vat || 0),
        sales_incl_vat: Number(invoice.amount_incl_vat || 0),
        collected_amount: null,
        open_amount: Number(invoice.remaining || 0),
        detail: invoice.status || "",
      });
    });
    (Array.isArray(day?.purchases) ? day.purchases : []).forEach((purchase, index) => {
      lines.push({
        id: `${date}|purchase|${purchase.vch_no || "—"}|${index}`,
        date,
        kind: "Purchase",
        voucher: purchase.vch_no || "—",
        sales_excl_vat: null,
        sales_incl_vat: null,
        collected_amount: null,
        open_amount: null,
        detail: purchaseDetail(purchase),
      });
    });
    (Array.isArray(day?.receipts) ? day.receipts : []).forEach((receipt, index) => {
      const isPayment = receipt.kind === "payment" || Number(receipt.amount) < 0;
      lines.push({
        id: `${date}|${isPayment ? "payment" : "receipt"}|${receipt.vch_no || "—"}|${index}`,
        date,
        kind: isPayment ? "Payment" : "Receipt",
        voucher: receipt.vch_no || "—",
        sales_excl_vat: null,
        sales_incl_vat: null,
        collected_amount: Number(isPayment ? receipt.ar_amount : receipt.amount) || 0,
        open_amount: null,
        detail: receiptDetail(receipt),
      });
    });
  });
  return lines;
}

export function datewiseFilterValue(row, key) {
  if (key === "date") return row.date || "—";
  if (key === "kind") return row.kind || "—";
  if (key === "voucher") return row.voucher || "—";
  if (key === "excl") return formatOptionalMoney(row.sales_excl_vat);
  if (key === "incl") return formatOptionalMoney(row.sales_incl_vat);
  if (key === "collected") return formatOptionalMoney(row.collected_amount);
  if (key === "open") return formatOptionalMoney(row.open_amount);
  return row.detail || "—";
}

export function sumDatewise(rows, key) {
  return rows.reduce((total, row) => total + (row[key] == null ? 0 : Number(row[key]) || 0), 0);
}
