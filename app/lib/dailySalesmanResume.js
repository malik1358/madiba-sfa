import { isMidnightAutoLogout, resolveEffectiveLogoutAt } from "./collectionDaySummary.js";
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
    collectionValue: 0,
    visits: 0,
    skuSoldCount: 0,
    loginAt: "",
    lunchOutAt: "",
    lunchInAt: "",
    logoutAt: "",
    logoutAutoClosed: false,
    lastActivityAt: "",
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
      totals.collectionValue += Number(row?.collectionValue || 0);
      totals.visits += Number(row?.visits || 0);
      totals.skuSoldCount += Number(row?.skuSoldCount || 0);
      totals.workingMinutes += Number(row?.workingMinutes || 0);
      return totals;
    },
    {
      orders: 0,
      orderValue: 0,
      collections: 0,
      collectionValue: 0,
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
      + Number(left.collectionValue || 0)
      + Number(left.visits || 0)
      + Number(left.skuSoldCount || 0);
    const rightActivity = Number(right.orders || 0)
      + Number(right.orderValue || 0)
      + Number(right.collections || 0)
      + Number(right.collectionValue || 0)
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

export function formatResumeMoney(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return Math.round(number).toLocaleString("en-US");
}

export function isResumeAutoLogout(row = {}) {
  return Boolean(row.logoutAutoClosed) || isMidnightAutoLogout(row.logoutAt);
}

export function resolveResumeWorkingEndAt(row = {}) {
  return resolveEffectiveLogoutAt({
    logoutAt: row.logoutAt || null,
    logoutAutoClosed: isResumeAutoLogout(row),
    activities: row.lastActivityAt ? [{ saved_at: row.lastActivityAt }] : [],
  }) || row.logoutAt || "";
}

function resumeRowCells(row) {
  const autoLogout = isResumeAutoLogout(row);
  return {
    salesman: salesmanResumeDisplayName(row),
    orders: formatCount(row.orders),
    orderValue: formatResumeMoney(row.orderValue),
    collections: formatCount(row.collections),
    collectionValue: formatResumeMoney(row.collectionValue),
    visits: formatCount(row.visits),
    skuSoldCount: formatCount(row.skuSoldCount),
    loginAt: formatReportTime(row.loginAt),
    lunchOutAt: formatReportTime(row.lunchOutAt),
    lunchInAt: formatReportTime(row.lunchInAt),
    logoutAt: autoLogout && row.logoutAt
      ? `${formatReportTime(row.logoutAt)} auto`
      : formatReportTime(row.logoutAt),
    workingHours: formatWorkingHours(row.workingMinutes),
    autoLogout,
  };
}

export function buildDailySalesmanResumeEmail({ date, rows = [] } = {}) {
  const sorted = sortSalesmanResumeRows(rows);
  const totals = summarizeSalesmanResumeRows(sorted);
  const subject = `Daily salesman resume — ${date}`;

  const textLines = [
    `Daily salesman resume for ${date} (KSA)`,
    "",
    "Salesman | Orders | Order value | Collections | Collection value | Visits | SKU sold | Login | Lunch out | Lunch in | Logout | Working hours",
    ...sorted.map((row) => {
      const cells = resumeRowCells(row);
      return [
        cells.salesman,
        cells.orders,
        cells.orderValue,
        cells.collections,
        cells.collectionValue,
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
      formatResumeMoney(totals.orderValue),
      formatCount(totals.collections),
      formatResumeMoney(totals.collectionValue),
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
    ? sorted.map((row, index) => {
      const cells = resumeRowCells(row);
      const rowBg = index % 2 === 0 ? "#ffffff" : "#eef6fb";
      const logoutColor = cells.autoLogout ? "color:#b45309;" : "";
      return `<tr style="background:${rowBg};">
        <td style="border:1px solid #c5d4de;">${escapeHtml(cells.salesman)}</td>
        <td style="text-align:right;border:1px solid #c5d4de;">${escapeHtml(cells.orders)}</td>
        <td style="text-align:right;border:1px solid #c5d4de;background:#e8f7ee;font-weight:600;">${escapeHtml(cells.orderValue)}</td>
        <td style="text-align:right;border:1px solid #c5d4de;">${escapeHtml(cells.collections)}</td>
        <td style="text-align:right;border:1px solid #c5d4de;background:#fff4d6;font-weight:600;">${escapeHtml(cells.collectionValue)}</td>
        <td style="text-align:right;border:1px solid #c5d4de;">${escapeHtml(cells.visits)}</td>
        <td style="text-align:right;border:1px solid #c5d4de;">${escapeHtml(cells.skuSoldCount)}</td>
        <td style="border:1px solid #c5d4de;">${escapeHtml(cells.loginAt)}</td>
        <td style="border:1px solid #c5d4de;">${escapeHtml(cells.lunchOutAt)}</td>
        <td style="border:1px solid #c5d4de;">${escapeHtml(cells.lunchInAt)}</td>
        <td style="border:1px solid #c5d4de;${logoutColor}">${escapeHtml(cells.logoutAt)}</td>
        <td style="border:1px solid #c5d4de;background:#e7f0ff;font-weight:600;">${escapeHtml(cells.workingHours)}</td>
      </tr>`;
    }).join("")
    : `<tr><td colspan="12" style="padding:10px;">No salesman activity found for this date.</td></tr>`;

  const html = `<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; color: #12263f; line-height: 1.4; background:#f4f8fb; padding: 16px;">
  <div style="max-width:1100px;margin:0 auto;background:#ffffff;border:1px solid #c5d4de;border-radius:8px;padding:18px 18px 12px;">
  <h1 style="font-size: 22px; margin: 0 0 6px; color:#0f4c81;">Daily salesman resume</h1>
  <p style="margin: 0 0 16px; color:#3d5a73;">${escapeHtml(date)} (KSA)</p>
  <table cellpadding="7" cellspacing="0" border="0" style="border-collapse: collapse; font-size: 12px; width: 100%;">
    <thead>
      <tr style="background:#0f4c81;color:#ffffff;">
        <th align="left" style="padding:8px;border:1px solid #0c3d67;">Salesman</th>
        <th align="right" style="padding:8px;border:1px solid #0c3d67;">Orders</th>
        <th align="right" style="padding:8px;border:1px solid #0c3d67;background:#14724a;">Order value</th>
        <th align="right" style="padding:8px;border:1px solid #0c3d67;">Collections</th>
        <th align="right" style="padding:8px;border:1px solid #0c3d67;background:#b7791f;">Collection value</th>
        <th align="right" style="padding:8px;border:1px solid #0c3d67;">Visits</th>
        <th align="right" style="padding:8px;border:1px solid #0c3d67;">SKU sold</th>
        <th align="left" style="padding:8px;border:1px solid #0c3d67;">Login</th>
        <th align="left" style="padding:8px;border:1px solid #0c3d67;">Lunch out</th>
        <th align="left" style="padding:8px;border:1px solid #0c3d67;">Lunch in</th>
        <th align="left" style="padding:8px;border:1px solid #0c3d67;">Logout</th>
        <th align="left" style="padding:8px;border:1px solid #0c3d67;background:#1d4ed8;">Working hours</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr style="font-weight: bold; background: #0f4c81; color:#ffffff;">
        <td style="padding:8px;border:1px solid #0c3d67;">Total</td>
        <td style="text-align:right;padding:8px;border:1px solid #0c3d67;">${escapeHtml(formatCount(totals.orders))}</td>
        <td style="text-align:right;padding:8px;border:1px solid #0c3d67;background:#14724a;">${escapeHtml(formatResumeMoney(totals.orderValue))}</td>
        <td style="text-align:right;padding:8px;border:1px solid #0c3d67;">${escapeHtml(formatCount(totals.collections))}</td>
        <td style="text-align:right;padding:8px;border:1px solid #0c3d67;background:#b7791f;">${escapeHtml(formatResumeMoney(totals.collectionValue))}</td>
        <td style="text-align:right;padding:8px;border:1px solid #0c3d67;">${escapeHtml(formatCount(totals.visits))}</td>
        <td style="text-align:right;padding:8px;border:1px solid #0c3d67;">${escapeHtml(formatCount(totals.skuSoldCount))}</td>
        <td style="padding:8px;border:1px solid #0c3d67;">-</td>
        <td style="padding:8px;border:1px solid #0c3d67;">-</td>
        <td style="padding:8px;border:1px solid #0c3d67;">-</td>
        <td style="padding:8px;border:1px solid #0c3d67;">-</td>
        <td style="padding:8px;border:1px solid #0c3d67;background:#1d4ed8;">${escapeHtml(formatWorkingHours(totals.workingMinutes))}</td>
      </tr>
    </tbody>
  </table>
  <p style="margin:10px 0 0;font-size:11px;color:#5b6f7e;">Auto logout uses the last visit, order, or collection for working hours. Values are rounded to whole numbers.</p>
  </div>
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
