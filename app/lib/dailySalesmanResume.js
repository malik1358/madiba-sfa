import { escapeHtml, formatReportTime } from "./dailyVisitReportEmail.js";
import { parseEmailList, isLikelyEmail } from "./mailer.js";
import { formatWorkingHours } from "./workdayActivity.js";

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
    orderValue: 0,
    collections: 0,
    visits: 0,
    skuSoldCount: 0,
    loginAt: "",
    lunchOutAt: "",
    lunchInAt: "",
    logoutAt: "",
    workingMinutes: null,
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
      totals.orderValue += Number(row?.orderValue || 0);
      totals.collections += Number(row?.collections || 0);
      totals.visits += Number(row?.visits || 0);
      totals.skuSoldCount += Number(row?.skuSoldCount || 0);
      totals.workingMinutes += Number(row?.workingMinutes || 0);
      return totals;
    },
    {
      orders: 0,
      orderValue: 0,
      collections: 0,
      visits: 0,
      skuSoldCount: 0,
      workingMinutes: 0,
    },
  );
}

export function sortSalesmanResumeRows(rows = []) {
  return [...(rows || [])].sort((left, right) => {
    const leftActivity = Number(left.orders || 0)
      + Number(left.orderValue || 0)
      + Number(left.collections || 0)
      + Number(left.visits || 0)
      + Number(left.skuSoldCount || 0);
    const rightActivity = Number(right.orders || 0)
      + Number(right.orderValue || 0)
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

function formatMoney(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0 SAR";
  return `${number.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} SAR`;
}

function resumeRowCells(row) {
  return {
    salesman: salesmanResumeDisplayName(row),
    orders: formatCount(row.orders),
    orderValue: formatMoney(row.orderValue),
    collections: formatCount(row.collections),
    visits: formatCount(row.visits),
    skuSoldCount: formatCount(row.skuSoldCount),
    loginAt: formatReportTime(row.loginAt),
    lunchOutAt: formatReportTime(row.lunchOutAt),
    lunchInAt: formatReportTime(row.lunchInAt),
    logoutAt: formatReportTime(row.logoutAt),
    workingHours: formatWorkingHours(row.workingMinutes),
  };
}

export function buildDailySalesmanResumeEmail({ date, rows = [] } = {}) {
  const sorted = sortSalesmanResumeRows(rows);
  const totals = summarizeSalesmanResumeRows(sorted);
  const subject = `Daily salesman resume — ${date}`;

  const textLines = [
    `Daily salesman resume for ${date} (KSA)`,
    "",
    "Salesman | Orders | Order value | Collections | Visits | SKU sold | Login | Lunch out | Lunch in | Logout | Working hours",
    ...sorted.map((row) => {
      const cells = resumeRowCells(row);
      return [
        cells.salesman,
        cells.orders,
        cells.orderValue,
        cells.collections,
        cells.visits,
        cells.skuSoldCount,
        cells.loginAt,
        cells.lunchOutAt,
        cells.lunchInAt,
        cells.logoutAt,
        cells.workingHours,
      ].join(" | ");
    }),
    "",
    [
      "Total",
      formatCount(totals.orders),
      formatMoney(totals.orderValue),
      formatCount(totals.collections),
      formatCount(totals.visits),
      formatCount(totals.skuSoldCount),
      "-",
      "-",
      "-",
      "-",
      formatWorkingHours(totals.workingMinutes),
    ].join(" | "),
  ];

  const bodyRows = sorted.length
    ? sorted.map((row) => {
      const cells = resumeRowCells(row);
      return `<tr>
        <td>${escapeHtml(cells.salesman)}</td>
        <td style="text-align:right;">${escapeHtml(cells.orders)}</td>
        <td style="text-align:right;">${escapeHtml(cells.orderValue)}</td>
        <td style="text-align:right;">${escapeHtml(cells.collections)}</td>
        <td style="text-align:right;">${escapeHtml(cells.visits)}</td>
        <td style="text-align:right;">${escapeHtml(cells.skuSoldCount)}</td>
        <td>${escapeHtml(cells.loginAt)}</td>
        <td>${escapeHtml(cells.lunchOutAt)}</td>
        <td>${escapeHtml(cells.lunchInAt)}</td>
        <td>${escapeHtml(cells.logoutAt)}</td>
        <td>${escapeHtml(cells.workingHours)}</td>
      </tr>`;
    }).join("")
    : `<tr><td colspan="11">No salesman activity found for this date.</td></tr>`;

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
        <th align="right">Order value</th>
        <th align="right">Collections</th>
        <th align="right">Visits</th>
        <th align="right">SKU sold</th>
        <th align="left">Login</th>
        <th align="left">Lunch out</th>
        <th align="left">Lunch in</th>
        <th align="left">Logout</th>
        <th align="left">Working hours</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr style="font-weight: bold; background: #f8fafc;">
        <td>Total</td>
        <td style="text-align:right;">${escapeHtml(formatCount(totals.orders))}</td>
        <td style="text-align:right;">${escapeHtml(formatMoney(totals.orderValue))}</td>
        <td style="text-align:right;">${escapeHtml(formatCount(totals.collections))}</td>
        <td style="text-align:right;">${escapeHtml(formatCount(totals.visits))}</td>
        <td style="text-align:right;">${escapeHtml(formatCount(totals.skuSoldCount))}</td>
        <td>-</td>
        <td>-</td>
        <td>-</td>
        <td>-</td>
        <td>${escapeHtml(formatWorkingHours(totals.workingMinutes))}</td>
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
