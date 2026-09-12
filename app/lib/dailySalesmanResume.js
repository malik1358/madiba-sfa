import { isMidnightAutoLogout, resolveEffectiveLogoutAt } from "./collectionDaySummary.js";
import { escapeHtml, formatReportTime } from "./dailyVisitReportEmail.js";
import { parseEmailList, isLikelyEmail } from "./mailer.js";
import { findHeadProfile, resolveReportingChainFromAuth } from "./salesHierarchy.js";
import { formatWorkingHours } from "./workdayActivity.js";

export const DEFAULT_DAILY_SALESMAN_RESUME_TO = "malik@pinasz.com";
export const DEFAULT_DAILY_SALESMAN_RESUME_EXTRA_TO = [
  "soyeb@noorshukran.com",
  "fazlur.rahiman@noorshukran.com",
];

export function resolveDailySalesmanResumeRecipients(env = process.env) {
  const configured = parseEmailList(env.DAILY_SALESMAN_RESUME_TO);
  const defaults = [DEFAULT_DAILY_SALESMAN_RESUME_TO, ...DEFAULT_DAILY_SALESMAN_RESUME_EXTRA_TO]
    .flatMap((value) => parseEmailList(value))
    .filter((email) => isLikelyEmail(email));
  return [...new Set([...defaults, ...configured])];
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
    invoiceCount: 0,
    invoiceAmount: 0,
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
    bossUserId: "",
    bossName: "",
    bossCode: "",
    teamLeaderUserId: "",
    teamLeaderName: "",
    teamLeaderCode: "",
    isFirstLevelTeamLeader: false,
  };
}

export const NO_BOSS_RESUME_TEAM_KEY = "__no_boss__";

export function resumeTeamLabel(group = {}) {
  if (group.key === NO_BOSS_RESUME_TEAM_KEY || (!group.bossUserId && !group.bossName && !group.bossCode)) {
    return "No boss";
  }
  return `Team — ${salesmanResumeDisplayName({
    salesmanName: group.bossName,
    salesmanCode: group.bossCode,
  })}`;
}

export function resolveResumeRowBoss(row = {}, { profiles = [], authUsers = [] } = {}) {
  const userId = String(row.userId || "").trim();
  if (userId && !userId.startsWith("code:")) {
    const chain = resolveReportingChainFromAuth({
      actorUserId: userId,
      profiles,
      authUsers,
    });
    const boss = chain[0];
    if (boss) {
      return {
        bossUserId: String(boss.id || "").trim(),
        bossName: String(boss.salesman_name || "").trim(),
        bossCode: String(boss.salesman_code || "").trim(),
      };
    }
  }

  const authById = new Map((authUsers || []).map((entry) => [String(entry?.id || ""), entry]));
  const metadata = authById.get(userId)?.user_metadata || authById.get(userId)?.app_metadata || {};
  const head = findHeadProfile(metadata, profiles);
  const bossCode = String(head?.salesman_code || metadata.head_salesman_code || "").trim();
  const bossName = String(head?.salesman_name || metadata.head_salesman_name || "").trim();
  if (!head?.id && !bossCode && !bossName) {
    return { bossUserId: "", bossName: "", bossCode: "" };
  }
  return {
    bossUserId: String(head?.id || "").trim(),
    bossName,
    bossCode,
  };
}

export function classifyResumeTeamLeaders({ profiles = [], authUsers = [] } = {}) {
  const reportsByBossId = new Map();
  (authUsers || []).forEach((authUser) => {
    const userId = String(authUser?.id || "").trim();
    if (!userId) return;
    const chain = resolveReportingChainFromAuth({
      actorUserId: userId,
      profiles,
      authUsers,
    });
    const bossId = String(chain[0]?.id || "").trim();
    if (!bossId || bossId === userId) return;
    if (!reportsByBossId.has(bossId)) reportsByBossId.set(bossId, new Set());
    reportsByBossId.get(bossId).add(userId);
  });

  const firstLevelIds = new Set();
  const secondTierIds = new Set();
  reportsByBossId.forEach((subs, bossId) => {
    const leadsOtherLeaders = [...subs].some((id) => reportsByBossId.has(id));
    if (leadsOtherLeaders) secondTierIds.add(bossId);
    else firstLevelIds.add(bossId);
  });

  return { reportsByBossId, firstLevelIds, secondTierIds };
}

export function resolveResumeTeamLeader(row = {}, {
  profiles = [],
  authUsers = [],
  firstLevelIds = new Set(),
} = {}) {
  const userId = String(row.userId || "").trim();
  const profileById = new Map((profiles || []).map((profile) => [String(profile?.id || ""), profile]));

  const fromProfile = (id, fallback = {}) => {
    const profile = profileById.get(id) || {};
    return {
      teamLeaderUserId: id,
      teamLeaderName: String(profile.salesman_name || fallback.salesmanName || fallback.salesman_name || "").trim(),
      teamLeaderCode: String(profile.salesman_code || fallback.salesmanCode || fallback.salesman_code || "").trim(),
      isFirstLevelTeamLeader: Boolean(userId) && id === userId,
    };
  };

  if (userId && firstLevelIds.has(userId)) {
    return fromProfile(userId, row);
  }

  if (userId && !userId.startsWith("code:")) {
    const firstLevel = resolveReportingChainFromAuth({
      actorUserId: userId,
      profiles,
      authUsers,
    }).find((boss) => firstLevelIds.has(boss.id));
    if (firstLevel) return fromProfile(firstLevel.id, firstLevel);
  }

  return {
    teamLeaderUserId: "",
    teamLeaderName: "",
    teamLeaderCode: "",
    isFirstLevelTeamLeader: false,
  };
}

export function attachResumeRowBosses(rows = [], { profiles = [], authUsers = [] } = {}) {
  const { firstLevelIds } = classifyResumeTeamLeaders({ profiles, authUsers });
  return (rows || []).map((row) => ({
    ...row,
    ...resolveResumeRowBoss(row, { profiles, authUsers }),
    ...resolveResumeTeamLeader(row, { profiles, authUsers, firstLevelIds }),
  }));
}

function resumeTeamGroupMeta(row = {}) {
  const bossUserId = String(row.teamLeaderUserId || row.bossUserId || "").trim();
  const bossName = String(row.teamLeaderName || row.bossName || "").trim();
  const bossCode = String(row.teamLeaderCode || row.bossCode || "").trim();
  const key = bossUserId || bossCode.toUpperCase() || NO_BOSS_RESUME_TEAM_KEY;
  return { key, bossUserId, bossName, bossCode };
}

export function groupSalesmanResumeRowsByBoss(rows = []) {
  const included = sortSalesmanResumeRows((rows || []).filter(shouldIncludeSalesmanResumeRow));
  const groups = new Map();

  included.forEach((row) => {
    const meta = resumeTeamGroupMeta(row);
    if (!groups.has(meta.key)) {
      groups.set(meta.key, {
        key: meta.key,
        bossUserId: meta.bossUserId,
        bossName: meta.bossName,
        bossCode: meta.bossCode,
        rows: [],
      });
    }
    const group = groups.get(meta.key);
    if (!group.bossName && meta.bossName) group.bossName = meta.bossName;
    if (!group.bossCode && meta.bossCode) group.bossCode = meta.bossCode;
    if (!group.bossUserId && meta.bossUserId) group.bossUserId = meta.bossUserId;
    group.rows.push(row);
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      label: resumeTeamLabel(group),
      totals: summarizeSalesmanResumeRows(group.rows),
    }))
    .sort((left, right) => {
      if (left.key === NO_BOSS_RESUME_TEAM_KEY) return 1;
      if (right.key === NO_BOSS_RESUME_TEAM_KEY) return -1;
      return left.label.localeCompare(right.label);
    });
}

export const OCCASIONAL_RESUME_SALESMEN = [
  "AHMED NABIL",
  "FAZLUR RAHMAN",
  "SOYEB",
];

export const HIDDEN_RESUME_SALESMEN = [
  "NOON",
  "TRENDYOL",
];

function comparableResumeName(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resumeIdentities(row = {}) {
  const identities = new Set();
  [row.salesmanCode, row.salesmanName, row.salesman_code, row.salesman_name].forEach((value) => {
    const comparable = comparableResumeName(value);
    if (comparable) identities.add(comparable);
    const parenthetical = String(value || "").match(/\(([^)]+)\)/);
    if (parenthetical) {
      const alias = comparableResumeName(parenthetical[1]);
      if (alias) identities.add(alias);
    }
  });
  return identities;
}

export function isOccasionalResumeSalesman(row = {}) {
  const identities = resumeIdentities(row);
  return OCCASIONAL_RESUME_SALESMEN.some((name) => identities.has(comparableResumeName(name)));
}

export function isHiddenResumeSalesman(row = {}) {
  const identities = resumeIdentities(row);
  if (HIDDEN_RESUME_SALESMEN.some((name) => identities.has(comparableResumeName(name)))) {
    return true;
  }
  const display = comparableResumeName(salesmanResumeDisplayName(row));
  return display === "UNKNOWN USER"
    || display === "UNKNOWN SALESMAN"
    || identities.has("UNKNOWN USER")
    || identities.has("UNKNOWN SALESMAN");
}

export function resumeRowHasLogin(row = {}) {
  return Boolean(String(row?.loginAt || "").trim());
}

export function resumeRowHasOrderOrCollection(row = {}) {
  return Number(row?.orders || 0) > 0
    || Number(row?.orderValue || 0) > 0
    || Number(row?.collections || 0) > 0
    || Number(row?.collectionValue || 0) > 0;
}

export function shouldIncludeSalesmanResumeRow(row = {}) {
  if (isHiddenResumeSalesman(row)) return false;
  if (row.isFirstLevelTeamLeader) return true;
  if (isOccasionalResumeSalesman(row) && !resumeRowHasOrderOrCollection(row)) {
    return false;
  }
  return true;
}

export function partitionSalesmanResumeRows(rows = []) {
  const included = (rows || []).filter(shouldIncludeSalesmanResumeRow);
  return {
    loggedIn: included.filter(resumeRowHasLogin),
    notLoggedIn: included.filter((row) => !resumeRowHasLogin(row)),
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
      totals.invoiceCount += Number(row?.invoiceCount || 0);
      totals.invoiceAmount += Number(row?.invoiceAmount || 0);
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
      invoiceCount: 0,
      invoiceAmount: 0,
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
      + Number(left.invoiceCount || 0)
      + Number(left.invoiceAmount || 0)
      + Number(left.collections || 0)
      + Number(left.collectionValue || 0)
      + Number(left.visits || 0)
      + Number(left.skuSoldCount || 0);
    const rightActivity = Number(right.orders || 0)
      + Number(right.orderValue || 0)
      + Number(right.invoiceCount || 0)
      + Number(right.invoiceAmount || 0)
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

export function uniqueSkuCountFromOrderLines(lines = []) {
  const codes = new Set();
  (lines || []).forEach((line) => {
    const code = String(line?.item_code || line?.itemCode || "").trim().toUpperCase();
    if (!code) return;
    const quantity = Number(line?.quantity);
    if (Number.isFinite(quantity) && quantity <= 0) return;
    codes.add(code);
  });
  return codes.size;
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
    invoiceCount: formatCount(row.invoiceCount),
    invoiceAmount: formatResumeMoney(row.invoiceAmount),
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

function resumeSummaryTextRow(label, totals) {
  return [
    label,
    formatCount(totals.orders),
    formatResumeMoney(totals.orderValue),
    formatCount(totals.invoiceCount),
    formatResumeMoney(totals.invoiceAmount),
    formatCount(totals.collections),
    formatResumeMoney(totals.collectionValue),
    formatCount(totals.visits),
    formatCount(totals.skuSoldCount),
    "-",
    "-",
    "-",
    "-",
    formatWorkingHours(totals.workingMinutes),
  ].join(" | ");
}

function resumeDataRowHtml(row, index) {
  const cells = resumeRowCells(row);
  const rowBg = index % 2 === 0 ? "#ffffff" : "#eef6fb";
  const logoutColor = cells.autoLogout ? "color:#b45309;" : "";
  return `<tr style="background:${rowBg};">
        <td style="border:1px solid #c5d4de;">${escapeHtml(cells.salesman)}</td>
        <td style="text-align:right;border:1px solid #c5d4de;">${escapeHtml(cells.orders)}</td>
        <td style="text-align:right;border:1px solid #c5d4de;background:#e8f7ee;font-weight:600;">${escapeHtml(cells.orderValue)}</td>
        <td style="text-align:right;border:1px solid #c5d4de;">${escapeHtml(cells.invoiceCount)}</td>
        <td style="text-align:right;border:1px solid #c5d4de;background:#f3e8ff;font-weight:600;">${escapeHtml(cells.invoiceAmount)}</td>
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
}

function resumeSummaryRowHtml(label, totals, { team = false } = {}) {
  const background = team ? "#d7e6f4" : "#0f4c81";
  const color = team ? "#0f4c81" : "#ffffff";
  const border = team ? "#9bb6cc" : "#0c3d67";
  const orderValueBg = team ? "#c8ead4" : "#14724a";
  const invoiceBg = team ? "#e4d4fb" : "#6d28d9";
  const collectionBg = team ? "#f6e4b3" : "#b7791f";
  const hoursBg = team ? "#c9d8f8" : "#1d4ed8";
  return `<tr style="font-weight: bold; background: ${background}; color:${color};">
        <td style="padding:8px;border:1px solid ${border};">${escapeHtml(label)}</td>
        <td style="text-align:right;padding:8px;border:1px solid ${border};">${escapeHtml(formatCount(totals.orders))}</td>
        <td style="text-align:right;padding:8px;border:1px solid ${border};background:${orderValueBg};">${escapeHtml(formatResumeMoney(totals.orderValue))}</td>
        <td style="text-align:right;padding:8px;border:1px solid ${border};">${escapeHtml(formatCount(totals.invoiceCount))}</td>
        <td style="text-align:right;padding:8px;border:1px solid ${border};background:${invoiceBg};">${escapeHtml(formatResumeMoney(totals.invoiceAmount))}</td>
        <td style="text-align:right;padding:8px;border:1px solid ${border};">${escapeHtml(formatCount(totals.collections))}</td>
        <td style="text-align:right;padding:8px;border:1px solid ${border};background:${collectionBg};">${escapeHtml(formatResumeMoney(totals.collectionValue))}</td>
        <td style="text-align:right;padding:8px;border:1px solid ${border};">${escapeHtml(formatCount(totals.visits))}</td>
        <td style="text-align:right;padding:8px;border:1px solid ${border};">${escapeHtml(formatCount(totals.skuSoldCount))}</td>
        <td style="padding:8px;border:1px solid ${border};">-</td>
        <td style="padding:8px;border:1px solid ${border};">-</td>
        <td style="padding:8px;border:1px solid ${border};">-</td>
        <td style="padding:8px;border:1px solid ${border};">-</td>
        <td style="padding:8px;border:1px solid ${border};background:${hoursBg};">${escapeHtml(formatWorkingHours(totals.workingMinutes))}</td>
      </tr>`;
}

function resumeTextRow(row) {
  const cells = resumeRowCells(row);
  return [
    cells.salesman,
    cells.orders,
    cells.orderValue,
    cells.invoiceCount,
    cells.invoiceAmount,
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
}

function appendResumeTextSection(textLines, {
  heading,
  groups,
  sorted,
  useTeams,
  totals,
  totalLabel = "Total",
}) {
  if (heading) textLines.push("", heading, "");
  textLines.push("Salesman | Orders | Order value | Invoices | Invoice amount | Collections | Collection value | Visits | SKU sold | Login | Lunch out | Lunch in | Logout | Working hours");
  if (useTeams) {
    groups.forEach((group) => {
      textLines.push("", group.label);
      group.rows.forEach((row) => textLines.push(resumeTextRow(row)));
      textLines.push(resumeSummaryTextRow(`${group.label} total`, group.totals));
    });
  } else {
    sorted.forEach((row) => textLines.push(resumeTextRow(row)));
  }
  textLines.push("", resumeSummaryTextRow(totalLabel, totals));
}

function resumeTableHeaderHtml() {
  return `<thead>
      <tr style="background:#0f4c81;color:#ffffff;">
        <th align="left" style="padding:8px;border:1px solid #0c3d67;">Salesman</th>
        <th align="right" style="padding:8px;border:1px solid #0c3d67;">Orders</th>
        <th align="right" style="padding:8px;border:1px solid #0c3d67;background:#14724a;">Order value</th>
        <th align="right" style="padding:8px;border:1px solid #0c3d67;">Invoices</th>
        <th align="right" style="padding:8px;border:1px solid #0c3d67;background:#6d28d9;">Invoice amount</th>
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
    </thead>`;
}

function resumeTableBodyRows({ groups, sorted, useTeams, emptyMessage }) {
  if (!sorted.length) {
    return `<tr><td colspan="14" style="padding:10px;">${escapeHtml(emptyMessage)}</td></tr>`;
  }
  if (useTeams) {
    return groups.map((group) => {
      const header = `<tr style="background:#1f5f8b;color:#ffffff;">
        <td colspan="14" style="padding:8px;border:1px solid #174a6c;font-weight:700;">${escapeHtml(group.label)}</td>
      </tr>`;
      const memberRows = group.rows.map((row, index) => resumeDataRowHtml(row, index)).join("");
      return `${header}${memberRows}${resumeSummaryRowHtml(`${group.label} total`, group.totals, { team: true })}`;
    }).join("");
  }
  return sorted.map((row, index) => resumeDataRowHtml(row, index)).join("");
}

function resumeTableHtml({
  groups,
  sorted,
  useTeams,
  totals,
  emptyMessage,
  totalLabel = "Total",
}) {
  return `<table cellpadding="7" cellspacing="0" border="0" style="border-collapse: collapse; font-size: 12px; width: 100%;">
    ${resumeTableHeaderHtml()}
    <tbody>
      ${resumeTableBodyRows({ groups, sorted, useTeams, emptyMessage })}
      ${resumeSummaryRowHtml(totalLabel, totals)}
    </tbody>
  </table>`;
}

export function buildDailySalesmanResumeEmail({ date, rows = [] } = {}) {
  const { loggedIn, notLoggedIn } = partitionSalesmanResumeRows(rows);
  const groups = groupSalesmanResumeRowsByBoss(loggedIn);
  const sorted = groups.flatMap((group) => group.rows);
  const totals = summarizeSalesmanResumeRows(sorted);
  const useTeams = groups.some((group) => group.key !== NO_BOSS_RESUME_TEAM_KEY);
  const absentGroups = groupSalesmanResumeRowsByBoss(notLoggedIn);
  const absentSorted = absentGroups.flatMap((group) => group.rows);
  const absentTotals = summarizeSalesmanResumeRows(absentSorted);
  const useAbsentTeams = absentGroups.some((group) => group.key !== NO_BOSS_RESUME_TEAM_KEY);
  const subject = `Daily salesman resume — ${date}`;

  const textLines = [`Daily salesman resume for ${date} (KSA)`];
  appendResumeTextSection(textLines, {
    groups,
    sorted,
    useTeams,
    totals,
  });
  if (absentSorted.length) {
    appendResumeTextSection(textLines, {
      heading: "Not logged in",
      groups: absentGroups,
      sorted: absentSorted,
      useTeams: useAbsentTeams,
      totals: absentTotals,
      totalLabel: "Not logged in total",
    });
  }

  const absentTable = absentSorted.length
    ? `<h2 style="font-size: 18px; margin: 22px 0 10px; color:#0f4c81;">Not logged in</h2>
  <p style="margin: 0 0 12px; color:#3d5a73;">Salesmen with no login on this date.</p>
  ${resumeTableHtml({
    groups: absentGroups,
    sorted: absentSorted,
    useTeams: useAbsentTeams,
    totals: absentTotals,
    emptyMessage: "Every included salesman logged in.",
    totalLabel: "Not logged in total",
  })}`
    : "";

  const html = `<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; color: #12263f; line-height: 1.4; background:#f4f8fb; padding: 16px;">
  <div style="max-width:1100px;margin:0 auto;background:#ffffff;border:1px solid #c5d4de;border-radius:8px;padding:18px 18px 12px;">
  <h1 style="font-size: 22px; margin: 0 0 6px; color:#0f4c81;">Daily salesman resume</h1>
  <p style="margin: 0 0 16px; color:#3d5a73;">${escapeHtml(date)} (KSA)</p>
  ${resumeTableHtml({
    groups,
    sorted,
    useTeams,
    totals,
    emptyMessage: "No salesman activity found for this date.",
  })}
  ${absentTable}
  <p style="margin:10px 0 0;font-size:11px;color:#5b6f7e;">Auto logout uses the last visit, order, or collection for working hours. Values are rounded to whole numbers.${useTeams ? " Rows are grouped by each salesman's direct boss." : ""} People who did not log in are listed in a separate table.</p>
  </div>
</body>
</html>`;

  return {
    subject,
    html,
    text: textLines.join("\n"),
    totals,
    absentTotals,
    rowCount: sorted.length,
    absentRowCount: absentSorted.length,
    groups: useTeams ? groups : [],
  };
}
