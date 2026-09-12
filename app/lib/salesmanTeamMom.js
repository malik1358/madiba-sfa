import {
  buildCategoryGrowthReport,
  createCategoryGrowthAccumulator,
  dimensionValue,
  growthPercent,
  ingestCategoryGrowthRows,
  normalizeGrowthFilters,
  rowMatchesGrowthFilters,
} from "./categoryGrowth.js";
import {
  buildSalesmanScopeMatchers,
  normalizeSalesmanCode,
  normalizeSalesmanName,
} from "./mutualSalesmanGroups.js";
import {
  decorateMomRows,
  isExcludedSalesmanMomRow,
  monthSeriesAmount,
  resolveMomComparisonMonths,
} from "./salesmanMom.js";

export const NO_TEAM_MOM_KEY = "__no_team__";
export const ECOM_SALES_KEY = "__ecom_sales__";
export const STORE_SALES_KEY = "__store_sales__";
export const ECOM_SALES_LABEL = "Ecom sales";
export const STORE_SALES_LABEL = "Store sales";

const ECOM_SALESMAN_TOKENS = new Set(["TRENDYOL", "NOON"]);
const STORE_VOUCHER_TOKENS = new Set(["RIYADH STORE SALES"]);

function normalizeTeamToken(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function teamMomLabel(member = {}) {
  const name = String(member.teamLeaderName || member.salesmanName || "").trim();
  const code = String(member.teamLeaderCode || member.salesmanCode || "").trim();
  const display = name && code && name.toUpperCase() !== code.toUpperCase()
    ? `${name} · ${code}`
    : (name || code);
  return display ? `Team — ${display}` : "No team";
}

export function salesmanMomIdentityValues(row = {}) {
  const label = String(row.label || row.category || "").trim();
  const parts = label.split(/\s*·\s*/).map((part) => part.trim()).filter(Boolean);
  return [...new Set([label, ...parts].filter(Boolean))];
}

function comparableValue(value) {
  return normalizeSalesmanName(value).replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function memberMatchesSalesmanRow(member, row) {
  const matchers = member?.matchers;
  if (!matchers) return false;
  return salesmanMomIdentityValues(row).some((value) => {
    const code = normalizeSalesmanCode(value);
    if (code && matchers.codes?.has(code)) return true;
    const name = normalizeSalesmanName(value);
    if (name && matchers.comparableNames?.has(name)) return true;
    const compact = comparableValue(value);
    if (compact && matchers.comparableNames?.has(compact)) return true;
    return false;
  });
}

export function assignSalesmanRowToTeam(row, members = []) {
  return (members || []).find((member) => memberMatchesSalesmanRow(member, row)) || null;
}

export function salesmanRowIdentity(row = {}) {
  const label = String(row.label || row.category || "").trim()
    || dimensionValue(row, "salesman");
  return {
    ...row,
    label,
    category: row.category || label,
    voucher_type: row.voucher_type,
  };
}

export function isEcomSalesmanIdentity(row = {}) {
  return salesmanMomIdentityValues(salesmanRowIdentity(row)).some((value) => (
    ECOM_SALESMAN_TOKENS.has(normalizeTeamToken(value))
  ));
}

export function isStoreSalesVoucher(row = {}) {
  return STORE_VOUCHER_TOKENS.has(normalizeTeamToken(row?.voucher_type || dimensionValue(row, "voucher_type")));
}

export function resolveTeamBucket(row = {}, members = []) {
  const identity = salesmanRowIdentity(row);
  if (isStoreSalesVoucher(identity)) {
    return { teamKey: STORE_SALES_KEY, teamLabel: STORE_SALES_LABEL };
  }
  if (isEcomSalesmanIdentity(identity)) {
    return { teamKey: ECOM_SALES_KEY, teamLabel: ECOM_SALES_LABEL };
  }
  const member = assignSalesmanRowToTeam(identity, members);
  if (member?.teamKey && member.teamKey !== NO_TEAM_MOM_KEY) {
    return { teamKey: member.teamKey, teamLabel: member.teamLabel };
  }
  const label = identity.label || "Unnamed";
  return { teamKey: `solo:${normalizeTeamToken(label)}`, teamLabel: label };
}

function addSeries(target, source) {
  Object.entries(source || {}).forEach(([key, value]) => {
    target[key] = Number(target[key] || 0) + Number(value || 0);
  });
}

export function buildTeamDirectoryMembers(profiles = [], resolveTeam) {
  return (profiles || []).map((profile) => {
    const team = resolveTeam(profile) || {};
    const teamKey = String(team.teamKey || team.teamLeaderUserId || "").trim() || NO_TEAM_MOM_KEY;
    const member = {
      id: profile.id,
      salesmanCode: String(profile.salesman_code || "").trim(),
      salesmanName: String(profile.salesman_name || "").trim(),
      teamKey,
      teamLeaderUserId: String(team.teamLeaderUserId || "").trim(),
      teamLeaderCode: String(team.teamLeaderCode || "").trim(),
      teamLeaderName: String(team.teamLeaderName || "").trim(),
      matchers: buildSalesmanScopeMatchers([profile]),
    };
    member.teamLabel = teamKey === NO_TEAM_MOM_KEY ? "No team" : teamMomLabel(member);
    return member;
  }).filter((member) => member.salesmanCode || member.salesmanName);
}

export function rollupTeamGrowthGroups(salesmanRows = [], members = [], report = {}) {
  const { latestCompleteMonth, priorCompleteMonth } = resolveMomComparisonMonths(report);
  const teams = new Map();

  const ensure = (key, label) => {
    if (!teams.has(key)) {
      teams.set(key, {
        label,
        category: label,
        teamKey: key,
        monthValues: {},
        quarterValues: {},
        lifetime: 0,
        memberCount: 0,
        members: [],
      });
    }
    return teams.get(key);
  };

  (salesmanRows || []).forEach((row) => {
    const identity = salesmanRowIdentity(row);
    if (isExcludedSalesmanMomRow(identity) && !isEcomSalesmanIdentity(identity) && !isStoreSalesVoucher(identity)) {
      return;
    }
    const bucket = resolveTeamBucket(identity, members);
    const team = ensure(bucket.teamKey, bucket.teamLabel);
    team.lifetime += Number(row.lifetime || 0);
    team.memberCount += 1;
    team.members.push(row.label || row.category);
    addSeries(team.monthValues, row.monthValues);
    addSeries(team.quarterValues, row.quarterValues);
  });

  return [...teams.values()].map((team) => ({
    ...team,
    momPercent: growthPercent(
      monthSeriesAmount(team.monthValues, latestCompleteMonth),
      monthSeriesAmount(team.monthValues, priorCompleteMonth),
    ),
  }));
}

export function rollupTeamGrowthFromRows(rows = [], members = [], options = {}) {
  const filters = normalizeGrowthFilters(options.filters || options.report?.filters || {});
  const measure = options.measure || options.report?.measure || "sales";
  const matched = (rows || []).filter((row) => rowMatchesGrowthFilters(row, filters));
  const remapped = matched.map((row) => {
    const identity = salesmanRowIdentity(row);
    if (isExcludedSalesmanMomRow(identity) && !isEcomSalesmanIdentity(identity) && !isStoreSalesVoucher(identity)) {
      return null;
    }
    const bucket = resolveTeamBucket(identity, members);
    return {
      ...row,
      salesman_name: bucket.teamLabel,
      salesman_code: "",
    };
  }).filter(Boolean);

  const acc = createCategoryGrowthAccumulator();
  ingestCategoryGrowthRows(acc, remapped, {
    filters: {
      ...filters,
      groupBy: "salesman",
      values: {
        ...filters.values,
        salesman: [],
        salesman_name: [],
        salesman_code: [],
      },
    },
    measure,
  });
  const built = buildCategoryGrowthReport(acc, { asOfDate: options.asOfDate || options.report?.lastDate || "" });
  return built.groups || [];
}

export function buildTeamMomRows(report = {}, members = []) {
  const groups = Array.isArray(report.teamGroups) && report.teamGroups.length
    ? report.teamGroups
    : rollupTeamGrowthGroups(report.groups || report.categories || [], members, report);
  return decorateMomRows(groups, report);
}
