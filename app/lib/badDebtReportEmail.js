import { customerAccountCodesMatch } from "./outstanding.js";
import { parseEmailList } from "./mailer.js";

export const BAD_DEBT_REPORT_EMAIL_KEY_PREFIX = "bad_debt_report_email:";
export const BAD_DEBT_REPORT_EMAIL_SNAPSHOT_KEY = "bad_debt_report_email_snapshot_v1";
export const DEFAULT_BAD_DEBT_REPORT_EMAIL_TO = [
  "malik@pinasz.com",
  "fazlur.rahiman@noorshukran.com",
  "soyeb@noorshukran.com",
];

const NEW_ROW_COLOR = "#fff4c2";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || "-";
  const [year, month, day] = text.split("-");
  return `${day}/${month}/${year}`;
}

export function badDebtReportEmailRecipients(env = {}) {
  const testTo = String(env.BAD_DEBT_REPORT_EMAIL_TEST_TO || "").trim();
  const override = String(env.BAD_DEBT_REPORT_EMAIL_TO || "").trim();
  return [...new Set(parseEmailList(testTo || override || DEFAULT_BAD_DEBT_REPORT_EMAIL_TO.join(",")))];
}

export function debtCustomerWasListed(customerCode, knownCodes = []) {
  return (knownCodes || []).some((code) => customerAccountCodesMatch(code, customerCode));
}

export function markDebtRowsAddedToday(rows = [], previousCodes, reportDate = "") {
  const hasSnapshot = Array.isArray(previousCodes);
  return (rows || []).map((row) => {
    const addedSinceLastEmail = hasSnapshot && !debtCustomerWasListed(row.customerCode, previousCodes);
    const transferredToday = Boolean(reportDate) && String(row.transferredAt || "") === reportDate;
    return {
      ...row,
      isNewToday: addedSinceLastEmail || transferredToday,
    };
  });
}

export function groupBadDebtRowsBySalesman(rows = []) {
  const groups = new Map();
  (rows || []).filter((row) => !row.transferredToLegal).forEach((row) => {
    const salesman = String(row.salesman || "").trim() || "Unassigned";
    const key = salesman.toUpperCase();
    if (!groups.has(key)) groups.set(key, { salesman, rows: [] });
    groups.get(key).rows.push(row);
  });
  return [...groups.values()]
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort((left, right) => (
        Number(right.outstandingAbove120 || 0) - Number(left.outstandingAbove120 || 0)
        || String(left.customerName || "").localeCompare(String(right.customerName || ""))
      )),
    }))
    .sort((left, right) => left.salesman.localeCompare(right.salesman));
}

function sumRows(rows = []) {
  return (rows || []).reduce((totals, row) => ({
    customers: totals.customers + 1,
    above120: totals.above120 + Number(row.outstandingAbove120 || 0),
    total: totals.total + Number(row.totalOutstanding || 0),
    addedToday: totals.addedToday + (row.isNewToday ? 1 : 0),
  }), { customers: 0, above120: 0, total: 0, addedToday: 0 });
}

function rowBackground(row, index) {
  if (row.isNewToday) return NEW_ROW_COLOR;
  return index % 2 ? "#f4fafa" : "#ffffff";
}

function customerCell(row) {
  const name = escapeHtml(row.customerName || row.customerCode || "");
  const code = escapeHtml(row.customerCode || "");
  const badge = row.isNewToday
    ? " <span style=\"display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;background:#b45309;color:#ffffff;font-size:11px;font-weight:700;\">New</span>"
    : "";
  return `${name}${badge}<div style="color:#52656c;font-size:12px;">${code}</div>`;
}

function renderTable(headers, body, footer) {
  return `<table style="border-collapse:collapse;width:100%;font-size:13px;margin:0 0 18px;">
    <thead><tr style="background:#0f4c5c;color:#ffffff;">${headers.map((header) => `<th style="padding:10px 8px;text-align:${header.align || "left"};border:1px solid #0a3a45;">${escapeHtml(header.label)}</th>`).join("")}</tr></thead>
    <tbody>${body}</tbody>
    <tfoot>${footer}</tfoot>
  </table>`;
}

function moneyCell(value, emphasize = false) {
  const color = emphasize ? "color:#b91c1c;font-weight:700;" : "";
  return `<td style="padding:8px;border:1px solid #d7e4e8;text-align:right;${color}">${escapeHtml(formatMoney(value))}</td>`;
}

function badDebtTable(rows) {
  const totals = sumRows(rows);
  const body = rows.length
    ? rows.map((row, index) => `<tr style="background:${rowBackground(row, index)};">
        <td style="padding:8px;border:1px solid #d7e4e8;">${customerCell(row)}</td>
        <td style="padding:8px;border:1px solid #d7e4e8;">${escapeHtml(row.cityArea || "-")}</td>
        ${moneyCell(row.outstandingAbove120, true)}
        ${moneyCell(row.totalOutstanding)}
      </tr>`).join("")
    : `<tr><td colspan="4" style="padding:12px;border:1px solid #d7e4e8;">No customers.</td></tr>`;
  const footer = rows.length
    ? `<tr style="background:#0f4c5c;color:#ffffff;font-weight:700;">
        <td style="padding:10px 8px;border:1px solid #0a3a45;">Total (${totals.customers})</td>
        <td style="padding:10px 8px;border:1px solid #0a3a45;"></td>
        <td style="padding:10px 8px;border:1px solid #0a3a45;text-align:right;">${escapeHtml(formatMoney(totals.above120))}</td>
        <td style="padding:10px 8px;border:1px solid #0a3a45;text-align:right;">${escapeHtml(formatMoney(totals.total))}</td>
      </tr>`
    : "";
  return renderTable(
    [
      { label: "Customer" },
      { label: "City / Area" },
      { label: ">120", align: "right" },
      { label: "Total outstanding", align: "right" },
    ],
    body,
    footer,
  );
}

function legalTable(rows) {
  const totals = sumRows(rows);
  const sorted = [...rows].sort((left, right) => (
    String(left.salesman || "").localeCompare(String(right.salesman || ""))
    || Number(right.outstandingAbove120 || 0) - Number(left.outstandingAbove120 || 0)
    || String(left.customerName || "").localeCompare(String(right.customerName || ""))
  ));
  const body = sorted.length
    ? sorted.map((row, index) => `<tr style="background:${rowBackground(row, index)};">
        <td style="padding:8px;border:1px solid #d7e4e8;">${customerCell(row)}</td>
        <td style="padding:8px;border:1px solid #d7e4e8;">${escapeHtml(row.salesman || "-")}</td>
        <td style="padding:8px;border:1px solid #d7e4e8;">${escapeHtml(row.cityArea || "-")}</td>
        ${moneyCell(row.outstandingAbove120, true)}
        ${moneyCell(row.totalOutstanding)}
        <td style="padding:8px;border:1px solid #d7e4e8;">${escapeHtml(formatDate(row.transferredAt))}</td>
        <td style="padding:8px;border:1px solid #d7e4e8;">${escapeHtml(row.legalNote || "-")}</td>
      </tr>`).join("")
    : `<tr><td colspan="7" style="padding:12px;border:1px solid #d7e4e8;">No customers are transferred to legal.</td></tr>`;
  const footer = sorted.length
    ? `<tr style="background:#0f4c5c;color:#ffffff;font-weight:700;">
        <td style="padding:10px 8px;border:1px solid #0a3a45;">Total (${totals.customers})</td>
        <td colspan="2" style="padding:10px 8px;border:1px solid #0a3a45;"></td>
        <td style="padding:10px 8px;border:1px solid #0a3a45;text-align:right;">${escapeHtml(formatMoney(totals.above120))}</td>
        <td style="padding:10px 8px;border:1px solid #0a3a45;text-align:right;">${escapeHtml(formatMoney(totals.total))}</td>
        <td colspan="2" style="padding:10px 8px;border:1px solid #0a3a45;"></td>
      </tr>`
    : "";
  return renderTable(
    [
      { label: "Customer" },
      { label: "Salesman" },
      { label: "City / Area" },
      { label: ">120", align: "right" },
      { label: "Total outstanding", align: "right" },
      { label: "Transferred on" },
      { label: "Legal note" },
    ],
    body,
    footer,
  );
}

export function buildBadDebtReportEmail({
  date,
  badDebts = [],
  legalTransfers = [],
  previousBadDebtCodes = null,
  previousLegalCodes = null,
} = {}) {
  const openRows = markDebtRowsAddedToday(
    (badDebts || []).filter((row) => !row.transferredToLegal),
    previousBadDebtCodes,
    date,
  );
  const legalRows = markDebtRowsAddedToday(legalTransfers || [], previousLegalCodes, date);
  const groups = groupBadDebtRowsBySalesman(openRows);
  const openTotals = sumRows(openRows);
  const legalTotals = sumRows(legalRows);
  const salesmanSections = groups.length
    ? groups.map((group) => `<h3 style="margin:18px 0 8px;color:#0f4c5c;">${escapeHtml(group.salesman)} (${group.rows.length})</h3>${badDebtTable(group.rows)}`).join("")
    : `<p style="margin:12px 0;">No potential bad debts outside the legal list.</p>`;
  const addedToday = openTotals.addedToday + legalTotals.addedToday;
  return {
    subject: `Potential bad debts - ${date} (${openTotals.customers} open, ${legalTotals.customers} legal)`,
    addedToday,
    openCustomers: openTotals.customers,
    legalCustomers: legalTotals.customers,
    html: `<div style="font-family:Arial,sans-serif;color:#14323a;">
      <h2 style="margin:0 0 8px;">Potential bad debts - ${escapeHtml(date)}</h2>
      <p style="margin:0 0 12px;">Outstanding older than 120 days and no Funds Received in the last 10 days. Customers already transferred to legal are in their own table. A yellow row marked New was added since the previous email, or was transferred to legal today.</p>
      <p style="margin:0 0 12px;">Open customers: ${openTotals.customers}. Above 120: ${escapeHtml(formatMoney(openTotals.above120))}. Transferred to legal: ${legalTotals.customers}. New today: ${addedToday}.</p>
      ${salesmanSections}
      <h3 style="margin:22px 0 8px;color:#0f4c5c;">Transferred to legal (${legalTotals.customers})</h3>
      ${legalTable(legalRows)}
    </div>`,
    text: [
      `Potential bad debts - ${date}`,
      `Open customers: ${openTotals.customers}. Above 120: ${formatMoney(openTotals.above120)}. Transferred to legal: ${legalTotals.customers}. New today: ${addedToday}.`,
      ...groups.flatMap((group) => [
        `${group.salesman}`,
        ...group.rows.map((row) => `${row.isNewToday ? "NEW " : ""}${row.customerCode} ${row.customerName} >120 ${formatMoney(row.outstandingAbove120)}`),
      ]),
      "Transferred to legal",
      ...legalRows.map((row) => `${row.isNewToday ? "NEW " : ""}${row.customerCode} ${row.customerName} ${row.salesman || ""} ${formatDate(row.transferredAt)}`),
    ].join("\n"),
  };
}

export function snapshotCodes(rows = []) {
  return [...new Set((rows || []).map((row) => String(row.customerCode || "").trim()).filter(Boolean))];
}
