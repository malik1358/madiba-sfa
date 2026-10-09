function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeKey(value) {
  return String(value || "").trim().toUpperCase();
}

function amountOf(receipt) {
  const amount = Number(receipt?.amount_received || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function summarizeBy(receipts, keyFor, labelFor) {
  const groups = new Map();
  receipts.forEach((receipt) => {
    const label = String(labelFor(receipt) || "Unassigned").trim() || "Unassigned";
    const key = keyFor(receipt) || label.toUpperCase();
    const group = groups.get(key) || { label, count: 0, amount: 0, customers: new Set() };
    group.count += 1;
    group.amount += amountOf(receipt);
    const customer = normalizeKey(receipt.customer_code || receipt.customer_name);
    if (customer) group.customers.add(customer);
    groups.set(key, group);
  });
  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export function buildDailyReceiptEmail({ date, salesman = {}, receipts = [] } = {}) {
  const rows = (Array.isArray(receipts) ? receipts : []).filter((receipt) => amountOf(receipt) > 0);
  const salesmanName = String(salesman.salesman_name || salesman.salesman_code || "Salesman").trim();
  const customerCollectorGroups = new Map();

  rows.forEach((receipt) => {
    const customerCode = String(receipt.customer_code || "").trim();
    const customerName = String(receipt.customer_name || customerCode || "Unknown customer").trim();
    const collectorName = String(receipt.collector_name || "Unidentified collector").trim();
    const key = `${normalizeKey(customerCode)}\u0000${normalizeKey(collectorName)}`;
    const group = customerCollectorGroups.get(key) || {
      customerCode,
      customerName,
      collectorName,
      count: 0,
      amount: 0,
      receiptModes: new Set(),
    };
    group.count += 1;
    group.amount += amountOf(receipt);
    if (receipt.receipt_mode) group.receiptModes.add(String(receipt.receipt_mode).trim());
    customerCollectorGroups.set(key, group);
  });

  const customerRows = [...customerCollectorGroups.values()]
    .sort((left, right) => left.customerName.localeCompare(right.customerName)
      || left.collectorName.localeCompare(right.collectorName));
  const collectorRows = summarizeBy(
    rows,
    (receipt) => normalizeKey(receipt.created_by || receipt.collector_name),
    (receipt) => receipt.collector_name,
  );
  const totalAmount = rows.reduce((total, receipt) => total + amountOf(receipt), 0);
  const th = "padding:8px;border:1px solid #cbd5d8;background:#0f4c5c;color:#fff;text-align:left";
  const td = "padding:8px;border:1px solid #d7dfe1;text-align:left";

  const customerHtml = customerRows.map((row) => `<tr>
    <td style="${td}">${escapeHtml(row.customerName)}</td>
    <td style="${td}">${escapeHtml(row.customerCode)}</td>
    <td style="${td}">${escapeHtml(row.collectorName)}</td>
    <td style="${td}">${row.count}</td>
    <td style="${td}">${escapeHtml([...row.receiptModes].join(", "))}</td>
    <td style="${td};text-align:right">${formatAmount(row.amount)}</td>
  </tr>`).join("");
  const collectorHtml = collectorRows.map((row) => `<tr>
    <td style="${td}">${escapeHtml(row.label)}</td>
    <td style="${td}">${row.customers.size}</td>
    <td style="${td}">${row.count}</td>
    <td style="${td};text-align:right">${formatAmount(row.amount)}</td>
  </tr>`).join("");

  const textCustomerRows = customerRows.map((row) =>
    `${row.customerName} (${row.customerCode}) | ${row.collectorName} | ${row.count} receipts | ${formatAmount(row.amount)}`,
  );
  const textCollectorRows = collectorRows.map((row) =>
    `${row.label} | ${row.customers.size} customers | ${row.count} receipts | ${formatAmount(row.amount)}`,
  );

  return {
    subject: `Daily receipts - ${salesmanName} - ${date}`,
    html: `<div style="font-family:Arial,sans-serif;color:#172326">
      <h2 style="margin:0 0 8px">Daily receipts</h2>
      <p style="margin:0 0 16px">${escapeHtml(salesmanName)} | ${escapeHtml(date)}</p>
      <p><strong>${rows.length}</strong> receipts | <strong>${formatAmount(totalAmount)}</strong> total</p>
      <h3>Customer-wise</h3>
      <table style="border-collapse:collapse;width:100%"><thead><tr>
        <th style="${th}">Customer</th><th style="${th}">Code</th><th style="${th}">Collector</th>
        <th style="${th}">Receipts</th><th style="${th}">Mode</th><th style="${th};text-align:right">Amount</th>
      </tr></thead><tbody>${customerHtml || `<tr><td style="${td}" colspan="6">No receipts</td></tr>`}</tbody></table>
      <h3>Collector-wise</h3>
      <table style="border-collapse:collapse;width:100%"><thead><tr>
        <th style="${th}">Collector</th><th style="${th}">Customers</th><th style="${th}">Receipts</th><th style="${th};text-align:right">Amount</th>
      </tr></thead><tbody>${collectorHtml || `<tr><td style="${td}" colspan="4">No receipts</td></tr>`}</tbody></table>
    </div>`,
    text: [
      `Daily receipts - ${salesmanName} - ${date}`,
      `${rows.length} receipts | ${formatAmount(totalAmount)} total`,
      "",
      "Customer-wise:",
      ...(textCustomerRows.length ? textCustomerRows : ["No receipts"]),
      "",
      "Collector-wise:",
      ...(textCollectorRows.length ? textCollectorRows : ["No receipts"]),
    ].join("\n"),
    receiptCount: rows.length,
    totalAmount,
  };
}