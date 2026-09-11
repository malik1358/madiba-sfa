import { growthPercent } from "./categoryGrowth.js";
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
    if (isExcludedSalesmanMomRow(row)) return;
    const member = assignSalesmanRowToTeam(row, members);
    const team = member
      ? ensure(member.teamKey, member.teamLabel)
      : ensure(NO_TEAM_MOM_KEY, "No team");
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

export function buildTeamMomRows(report = {}, members = []) {
  const groups = Array.isArray(report.teamGroups) && report.teamGroups.length
    ? report.teamGroups
    : rollupTeamGrowthGroups(report.groups || report.categories || [], members, report);
  return decorateMomRows(groups, report);
}
