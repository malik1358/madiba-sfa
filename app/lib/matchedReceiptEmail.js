function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function amount(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function dateTime(value) {
  const parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function groupBy(rows, selectKey, selectLabel) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = String(selectKey(row) || "unassigned").trim().toUpperCase();
    const label = String(selectLabel(row) || "Unassigned").trim();
    const group = groups.get(key) || { label, count: 0, total: 0, customers: new Set() };
    group.count += 1;
    group.total += Number(row.visit?.amount_received || 0);
    const customerCode = String(row.visit?.customer_code || "").trim().toUpperCase();
    if (customerCode) group.customers.add(customerCode);
    groups.set(key, group);
  });
  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function renderSalesmanSection(salesman, rows) {
  const name = String(salesman.salesman_name || salesman.salesman_code || "Salesman").trim();
  const total = rows.reduce((sum, row) => sum + Number(row.visit?.amount_received || 0), 0);
  const collectorGroups = groupBy(
    rows,
    (row) => row.visit?.created_by || row.visit?.collector_name,
    (row) => row.visit?.collector_name,
  );
  const th = "padding:8px;border:1px solid #cbd5d8;background:#0f4c5c;color:#fff;text-align:left";
  const td = "padding:8px;border:1px solid #d7dfe1;text-align:left";

  const detailRows = rows.map((row) => `<tr>
    <td style="${td}">${escapeHtml(row.visit?.visit_date)}</td>
    <td style="${td}">${escapeHtml(dateTime(row.visit?.saved_at))}</td>
    <td style="${td}">${escapeHtml(row.visit?.customer_name)}</td>
    <td style="${td}">${escapeHtml(row.visit?.customer_code)}</td>
    <td style="${td}">${escapeHtml(row.visit?.collector_name || "Unidentified collector")}</td>
    <td style="${td}">${escapeHtml(row.tally?.vch_no || "-")}</td>
    <td style="${td}">${escapeHtml(row.tally?.receipt_date || "")}</td>
    <td style="${td};text-align:right">${amount(row.visit?.amount_received)}</td>
  </tr>`).join("");
  const collectorRows = collectorGroups.map((group) => `<tr>
    <td style="${td}">${escapeHtml(group.label)}</td>
    <td style="${td}">${group.customers.size}</td>
    <td style="${td}">${group.count}</td>
    <td style="${td};text-align:right">${amount(group.total)}</td>
  </tr>`).join("");

  return {
    name,
    total,
    count: rows.length,
    html: `<section style="margin:24px 0">
      <h2 style="margin:0 0 8px">${escapeHtml(name)} (${escapeHtml(salesman.salesman_code || "")})</h2>
      <p><strong>${rows.length}</strong> matched receipts | <strong>${amount(total)}</strong></p>
      <h3>Customer-wise matched receipts</h3>
      <table style="border-collapse:collapse;width:100%"><thead><tr>
        <th style="${th}">App date</th><th style="${th}">Entered</th><th style="${th}">Customer</th>
        <th style="${th}">Code</th><th style="${th}">Collector</th><th style="${th}">Tally voucher</th>
        <th style="${th}">Tally date</th><th style="${th};text-align:right">Amount</th>
      </tr></thead><tbody>${detailRows}</tbody></table>
      <h3>Collector-wise</h3>
      <table style="border-collapse:collapse;width:100%"><thead><tr>
        <th style="${th}">Collector</th><th style="${th}">Customers</th><th style="${th}">Matched receipts</th>
        <th style="${th};text-align:right">Amount</th>
      </tr></thead><tbody>${collectorRows}</tbody></table>
    </section>`,
    text: [
      `${name} (${salesman.salesman_code || ""})`,
      `${rows.length} matched receipts | ${amount(total)}`,
      ...rows.map((row) => `${row.visit?.visit_date} | ${row.visit?.customer_name} (${row.visit?.customer_code}) | ${row.visit?.collector_name || "Unidentified collector"} | Tally ${row.tally?.vch_no || "-"} ${row.tally?.receipt_date || ""} | ${amount(row.visit?.amount_received)}`),
      "Collector-wise:",
      ...collectorGroups.map((group) => `${group.label} | ${group.customers.size} customers | ${group.count} receipts | ${amount(group.total)}`),
    ].join("\n"),
  };
}

export function buildMatchedReceiptEmail({ dateLabel, salesmanGroups = [], preview = false } = {}) {
  const groups = (salesmanGroups || [])
    .map((group) => ({ ...group, rows: Array.isArray(group.rows) ? group.rows : [] }))
    .filter((group) => group.rows.length > 0)
    .sort((left, right) => String(left.salesman?.salesman_name || left.salesman?.salesman_code || "")
      .localeCompare(String(right.salesman?.salesman_name || right.salesman?.salesman_code || "")));
  const sections = groups.map((group) => renderSalesmanSection(group.salesman || {}, group.rows));
  const receiptCount = sections.reduce((sum, section) => sum + section.count, 0);
  const totalAmount = sections.reduce((sum, section) => sum + section.total, 0);
  const title = preview ? "TEST PREVIEW: matched app receipts" : "Matched app receipts";

  return {
    subject: `${preview ? "TEST PREVIEW - " : ""}Matched app receipts - ${dateLabel}`,
    html: `<div style="font-family:Arial,sans-serif;color:#172326">
      <h1 style="margin:0 0 8px">${escapeHtml(title)}</h1>
      <p>${escapeHtml(dateLabel)} | ${receiptCount} matched receipts | ${amount(totalAmount)}</p>
      <p>Only app receipts matched to rows in the uploaded Tally receipt register are included.</p>
      ${sections.length ? sections.map((section) => section.html).join("") : "<p>No matched app receipts in this period.</p>"}
    </div>`,
    text: [
      title,
      `${dateLabel} | ${receiptCount} matched receipts | ${amount(totalAmount)}`,
      "Only app receipts matched to rows in the uploaded Tally receipt register are included.",
      ...sections.map((section) => section.text),
    ].join("\n\n"),
    receiptCount,
    totalAmount,
  };
}