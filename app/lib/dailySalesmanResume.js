import { escapeHtml } from "./dailyVisitReportEmail.js";
import { parseEmailList, isLikelyEmail } from "./mailer.js";

export const DEFAULT_DAILY_SALESMAN_RESUME_TO = "malik@pinasz.com";

export function resolveDailySalesmanResumeRecipients(env = process.env) {
  const configured = parseEmailList(env.DAILY_SALESMAN_RESUME_TO);
  if (configured.length) return configured;
  return isLikelyEmail(DEFAULT_DAILY_SALESMAN_RESUME_TO)
    ? [DEFAULT_DAILY_SALESMAN_RESUME_TO]
    : [];
}

export function emptySalesmanResumeRow({
  userId = "",
  salesmanName = "",
  salesmanCode = "",
  role = "",
} = {}) {
  return {
    userId: String(userId || "").trim(),
    salesmanName: String(salesmanName || "").trim(),
    salesmanCode: String(salesmanCode || "").trim(),
    role: String(role || "").trim(),
    orders: 0,
    collections: 0,
    visits: 0,
    skuSoldCount: 0,
  };
}

export function salesmanResumeDisplayName(row = {}) {
  const name = String(row.salesmanName || "").trim();
  const code = String(row.salesmanCode || "").trim();
  if (name && code) return `${name} (${code})`;
  if (name) return name;
  if (code) return code;
  return "Unknown salesman";
}

export function summarizeSalesmanResumeRows(rows = []) {
  return (rows || []).reduce(
    (totals, row) => {
      totals.orders += Number(row?.orders || 0);
      totals.collections += Number(row?.collections || 0);
      totals.visits += Number(row?.visits || 0);
      totals.skuSoldCount += Number(row?.skuSoldCount || 0);
      return totals;
    },
    { orders: 0, collections: 0, visits: 0, skuSoldCount: 0 },
  );
}

export function sortSalesmanResumeRows(rows = []) {
  return [...(rows || [])].sort((left, right) => {
    const leftActivity = Number(left.orders || 0)
      + Number(left.collections || 0)
      + Number(left.visits || 0)
      + Number(left.skuSoldCount || 0);
    const rightActivity = Number(right.orders || 0)
      + Number(right.collections || 0)
      + Number(right.visits || 0)
      + Number(right.skuSoldCount || 0);
    if (rightActivity !== leftActivity) return rightActivity - leftActivity;
    return salesmanResumeDisplayName(left).localeCompare(salesmanResumeDisplayName(right));
  });
}

function formatCount(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return Number.isInteger(number)
    ? String(number)
    : number.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function buildDailySalesmanResumeEmail({ date, rows = [] } = {}) {
  const sorted = sortSalesmanResumeRows(rows);
  const totals = summarizeSalesmanResumeRows(sorted);
  const subject = `Daily salesman resume — ${date}`;

  const textLines = [
    `Daily salesman resume for ${date} (KSA)`,
    "",
    "Salesman | Orders | Collections | Visits | SKU sold",
    ...sorted.map((row) => [
      salesmanResumeDisplayName(row),
      formatCount(row.orders),
      formatCount(row.collections),
      formatCount(row.visits),
      formatCount(row.skuSoldCount),
    ].join(" | ")),
    "",
    [
      "Total",
      formatCount(totals.orders),
      formatCount(totals.collections),
      formatCount(totals.visits),
      formatCount(totals.skuSoldCount),
    ].join(" | "),
  ];

  const bodyRows = sorted.length
    ? sorted.map((row) => `<tr>
        <td>${escapeHtml(salesmanResumeDisplayName(row))}</td>
        <td style="text-align:right;">${escapeHtml(formatCount(row.orders))}</td>
        <td style="text-align:right;">${escapeHtml(formatCount(row.collections))}</td>
        <td style="text-align:right;">${escapeHtml(formatCount(row.visits))}</td>
        <td style="text-align:right;">${escapeHtml(formatCount(row.skuSoldCount))}</td>
      </tr>`).join("")
    : `<tr><td colspan="5">No salesman activity found for this date.</td></tr>`;

  const html = `<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; color: #12263f; line-height: 1.4;">
  <h1 style="font-size: 20px; margin-bottom: 8px;">Daily salesman resume</h1>
  <p style="margin: 0 0 16px;">${escapeHtml(date)} (KSA)</p>
  <table cellpadding="8" cellspacing="0" border="1" style="border-collapse: collapse; font-size: 13px; width: 100%;">
    <thead style="background: #f4f7fb;">
      <tr>
        <th align="left">Salesman</th>
        <th align="right">Orders</th>
        <th align="right">Collections</th>
        <th align="right">Visits</th>
        <th align="right">SKU sold</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr style="font-weight: bold; background: #f8fafc;">
        <td>Total</td>
        <td style="text-align:right;">${escapeHtml(formatCount(totals.orders))}</td>
        <td style="text-align:right;">${escapeHtml(formatCount(totals.collections))}</td>
        <td style="text-align:right;">${escapeHtml(formatCount(totals.visits))}</td>
        <td style="text-align:right;">${escapeHtml(formatCount(totals.skuSoldCount))}</td>
      </tr>
    </tbody>
  </table>
</body>
</html>`;

  return {
    subject,
    html,
    text: textLines.join("\n"),
    totals,
    rowCount: sorted.length,
  };
}
