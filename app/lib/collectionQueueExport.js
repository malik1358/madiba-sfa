import { resolveInvoiceAgingDays } from "./outstanding.js";
import { isCashQueueCustomer } from "./paymentCollections.js";

function roundAmount(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0;
}

function buildPartyLabel(code, name) {
  const normalizedCode = String(code || "").trim();
  const normalizedName = String(name || "").trim();
  if (normalizedCode && normalizedName) return `${normalizedCode}_${normalizedName}`;
  return normalizedCode || normalizedName || "";
}

function buildCustomerSummaryRow(row, section, priorityByCode) {
  const code = String(row.customer_code || "").trim();
  const codeKey = code.toUpperCase();
  const isNotDue = row.queue_kind === "not_due" || section === "Not Yet Due";

  return {
    "Priority #": priorityByCode.get(codeKey) || "",
    Code: code,
    Customer: String(row.customer_name || "").trim() || code,
    Party: buildPartyLabel(code, row.customer_name),
    "Salesman Code": String(row.salesman_code || "").trim(),
    "Salesman Name": String(row.salesman_name || "").trim(),
    City: String(row.city || "").trim(),
    Area: String(row.area || "").trim(),
    Section: section,
    "Due Amount": roundAmount(isNotDue ? row.total_not_due_amount : row.total_due_amount),
    Cash: roundAmount(row.outstanding_cash),
    "0-30": roundAmount(row.outstanding_0_30),
    "31-60": roundAmount(row.outstanding_30_60),
    "61-90": roundAmount(row.outstanding_61_90),
    "91-120": roundAmount(row.outstanding_91_120),
    ">120": roundAmount(row.outstanding_above_120),
    "Max Overdue Days": Number(row.max_overdue_days || 0),
    "Due Invoices": Number(isNotDue ? row.not_due_invoice_count : row.due_invoice_count) || 0,
    "Payment Probability": isNotDue ? "N/A" : String(row.probability_label || "").trim() || "N/A",
    "Last Outcome": String(row?.latest_collection?.visit_outcome || row?.latest_collection?.payment_status || "").trim(),
    "Last Update": row?.latest_collection?.saved_at ? String(row.latest_collection.saved_at) : "",
    "In Legal": row?.legal_transfer?.is_transferred ? "Yes" : "No",
  };
}

function buildCustomerInvoiceRows(row, section) {
  const code = String(row.customer_code || "").trim();
  const customerName = String(row.customer_name || "").trim() || code;
  const party = buildPartyLabel(code, row.customer_name);
  const salesmanCode = String(row.salesman_code || "").trim();
  const salesmanName = String(row.salesman_name || "").trim();

  return (row.invoices || []).map((invoice) => ({
    Party: party,
    Code: code,
    Customer: customerName,
    "Ref No": String(invoice.ref_no || "").trim(),
    "Invoice Date": String(invoice.invoice_date || "").trim(),
    "Pending Amount": roundAmount(invoice.pending_amount),
    "Due Date": String(invoice.due_date || "").trim(),
    "Overdue Days": resolveInvoiceAgingDays(invoice),
    "Salesman Code": salesmanCode,
    "Salesman Name": salesmanName,
    Section: section,
  }));
}

export function buildDueCollectionQueueExport({
  dueCustomers = [],
  notDueCustomers = [],
  queueToday,
  priorityByCode = new Map(),
  keepRow = () => true,
}) {
  const summaryRows = [];
  const invoiceRows = [];
  const cashRows = [];
  const cashSeen = new Set();

  dueCustomers.filter(keepRow).forEach((row) => {
    summaryRows.push(buildCustomerSummaryRow(row, "Due", priorityByCode));
    invoiceRows.push(...buildCustomerInvoiceRows(row, "Due"));
  });

  notDueCustomers.filter(keepRow).forEach((row) => {
    summaryRows.push(buildCustomerSummaryRow(row, "Not Yet Due", priorityByCode));
    invoiceRows.push(...buildCustomerInvoiceRows(row, "Not Yet Due"));
  });

  [...dueCustomers, ...notDueCustomers]
    .filter((row) => isCashQueueCustomer(row, queueToday))
    .forEach((row) => {
      const codeKey = String(row.customer_code || "").trim().toUpperCase();
      if (!codeKey || cashSeen.has(codeKey)) return;
      cashSeen.add(codeKey);

      cashRows.push({
        Code: String(row.customer_code || "").trim(),
        Customer: String(row.customer_name || "").trim(),
        Party: buildPartyLabel(row.customer_code, row.customer_name),
        "Salesman Code": String(row.salesman_code || "").trim(),
        "Salesman Name": String(row.salesman_name || "").trim(),
        "Cash Due": roundAmount(row.outstanding_cash),
        "Total Due": roundAmount(row.total_due_amount),
        "Max Overdue Days": Number(row.max_overdue_days || 0),
      });
    });

  return { summaryRows, invoiceRows, cashRows };
}
