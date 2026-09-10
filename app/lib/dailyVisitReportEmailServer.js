import { buildTeamVisitReportEmail, buildUserVisitReportEmail, resolveUserReportEmail, resolveVisitReportRecipients } from "./dailyVisitReportEmail.js";
import { resolveReportingChainFromAuth, resolveSubordinateUserIds } from "./salesHierarchy.js";
import {
  buildDailyVisitReport,
  loadProfilesForVisitReportEmails,
  shouldEmailVisitReportForRole,
} from "./dailyVisitReportServer.js";
import { formatCollectorDisplayName } from "./geo.js";
import { loadCollectionDaySummaryForUser } from "./collectionDaySummaryServer.js";
import { loadKpiTargetsBySalesman, loadPerformanceSnapshotsForSalesmen } from "./performanceKpisServer.js";
import { getMailerConfig, isEmailConfigured, parseEmailList, sendEmail } from "./mailer.js";
import { consolidatePerformanceSnapshots, isMissingSchemaColumn, normalizeSalesmanCode } from "./performanceKpis.js";
import { isCollectionOnlyAccess } from "./moduleAccess.js";
import {
  addKsaCalendarDays,
  getKsaWeekdayIndex,
  getKsaWeekdayIndexForDateString,
  getPreviousKsaDateString,
  isKsaOrderDay,
} from "./workdayActivity.js";

export function parseReportDateParam(value, now = new Date()) {
  const date = String(value || "").trim();
  if (!date) return getPreviousKsaDateString(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid report date. Use YYYY-MM-DD.");
  }
  return date;
}

export function resolveDailyVisitReportEmailSchedule(date, now = new Date()) {
  const explicit = String(date || "").trim();
  if (explicit) {
    return { date: parseReportDateParam(explicit, now), skipped: false, reason: "" };
  }

  const previousDate = getPreviousKsaDateString(now);
  const previousWeekday = getKsaWeekdayIndexForDateString(previousDate);

  // Friday is the KSA holiday. Thursday's report goes out at Friday midnight
  // (Saturday 00:10 KSA), not at the start of Friday.
  if (previousWeekday === 5) {
    return { date: addKsaCalendarDays(previousDate, -1), skipped: false, reason: "" };
  }

  if (getKsaWeekdayIndex(now) === 5) {
    return { date: previousDate, skipped: true, reason: "friday_holiday" };
  }

  if (!isKsaOrderDay(previousDate)) {
    return { date: previousDate, skipped: true, reason: "not_order_day" };
  }

  return { date: previousDate, skipped: false, reason: "" };
}

export function normalizeVisitReportEmailUserIds(value) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(raw.map((id) => String(id || "").trim()).filter(Boolean))];
}

function envFlagEnabled(value, defaultValue = true) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw !== "0" && raw !== "false" && raw !== "no";
}

function reportDisplayName(profile) {
  const name = String(profile?.salesman_name || "").trim();
  const code = String(profile?.salesman_code || "").trim();
  if (name && code) return `${name} (${code})`;
  if (name) return name;
  return formatCollectorDisplayName(profile);
}

function stubUserReport(profile) {
  return {
    userId: profile.id,
    userName: reportDisplayName(profile),
    email: String(profile.email || "").trim(),
    reportEmail: String(profile.report_email || "").trim(),
    visitCount: 0,
    farFromCustomerCount: 0,
    totalRouteDistanceKm: 0,
    entries: [],
    idleGaps: [],
    routePoints: [],
    daySummary: null,
  };
}

export function parseReportEmailOverrides(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const next = {};
  Object.entries(source).forEach(([userId, email]) => {
    const id = String(userId || "").trim();
    const normalized = resolveUserReportEmail({ reportEmail: email });
    if (!id || !normalized) return;
    next[id] = normalized;
  });
  return next;
}

export function resolveVisitReportChainEmails(chain = []) {
  return (chain || [])
    .map((boss) => resolveUserReportEmail({
      reportEmail: boss?.report_email || boss?.reportEmail,
      email: boss?.email,
    }))
    .filter(Boolean);
}

function snapshotHasKpis(snapshot) {
  return Array.isArray(snapshot?.kpis) && snapshot.kpis.length > 0;
}

function leaderTeamTargetCodes(bossCode) {
  const code = normalizeSalesmanCode(bossCode);
  if (!code) return [];
  return [`TEAM::${code}`, `TEAM:${code}`, `${code}::TEAM`];
}

function teamTargetsForLeader(map, bossCode) {
  for (const key of leaderTeamTargetCodes(bossCode)) {
    const row = map.get(key);
    if (row) return row;
  }
  return null;
}

export function collectVisitReportTeamLeaders({ recipients = [], profiles = [], authUsers = [] } = {}) {
  const leaders = new Map();

  recipients.forEach(({ user }) => {
    resolveReportingChainFromAuth({
      actorUserId: user?.userId,
      profiles,
      authUsers,
    }).forEach((boss) => {
      if (boss?.id && !leaders.has(boss.id)) leaders.set(boss.id, boss);
    });
  });

  profiles.forEach((profile) => {
    if (leaders.has(profile.id)) return;
    const role = String(profile?.role || "").toLowerCase();
    if (role !== "admin" && role !== "manager") return;
    const subIds = resolveSubordinateUserIds(authUsers, profile, profiles);
    const hasTeam = recipients.some(({ user }) => subIds.has(user.userId));
    if (hasTeam) leaders.set(profile.id, profile);
  });

  return [...leaders.values()];
}

export function teamKpiSnapshotsForLeader({
  leader,
  recipients = [],
  profiles = [],
  authUsers = [],
  kpiByUserId = new Map(),
} = {}) {
  const subIds = resolveSubordinateUserIds(authUsers, leader, profiles);
  const snapshots = [];
  const seen = new Set();

  recipients.forEach(({ profile, user }) => {
    const isSelf = user.userId === leader?.id;
    if (!isSelf && !subIds.has(user.userId)) return;
    if (isCollectionOnlyAccess({
      role: profile?.role,
      salesmanCode: profile?.salesman_code || user?.salesmanCode,
    })) return;
    const snapshot = kpiByUserId.get(user.userId);
    if (!snapshotHasKpis(snapshot)) return;
    const code = String(snapshot.salesmanCode || profile?.salesman_code || "").trim();
    if (code && seen.has(code)) return;
    if (code) seen.add(code);
    snapshots.push(snapshot);
  });

  snapshots.sort((left, right) => (
    String(left.salesmanName || left.salesmanCode || "").localeCompare(
      String(right.salesmanName || right.salesmanCode || ""),
    )
  ));
  return snapshots;
}

async function loadAuthUsersForReportingChain(admin) {
  if (typeof admin?.auth?.admin?.listUsers !== "function") return [];
  const usersRes = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersRes.error) throw usersRes.error;
  return usersRes.data?.users || [];
}

async function persistReportEmails(admin, reportEmails) {
  if (typeof admin?.from !== "function") return;
  const entries = Object.entries(reportEmails || {});
  for (const [userId, email] of entries) {
    const result = await admin
      .from("profiles")
      .update({ report_email: email || null })
      .eq("id", userId);
    if (result.error && !isMissingSchemaColumn(result.error)) throw result.error;
  }
}

export async function runDailyVisitReportEmailCycle(admin, {
  date,
  userIds,
  reportEmails,
  now = new Date(),
  env = process.env,
  send = sendEmail,
  loadReport = buildDailyVisitReport,
  loadProfiles = loadProfilesForVisitReportEmails,
  loadAuthUsers = loadAuthUsersForReportingChain,
  loadSummary = loadCollectionDaySummaryForUser,
  loadKpis = loadPerformanceSnapshotsForSalesmen,
  loadTeamTargets = loadKpiTargetsBySalesman,
} = {}) {
  const schedule = resolveDailyVisitReportEmailSchedule(date, now);
  const reportDate = schedule.date;
  const requestedUserIds = normalizeVisitReportEmailUserIds(userIds);
  const reportEmailOverrides = parseReportEmailOverrides(reportEmails);
  if (Object.keys(reportEmailOverrides).length) {
    await persistReportEmails(admin, reportEmailOverrides);
  }
  if (schedule.skipped) {
    return {
      date: reportDate,
      skipped: true,
      reason: schedule.reason,
      sentCount: 0,
      skippedCount: 0,
      results: [],
    };
  }
  if (!isEmailConfigured(getMailerConfig(env))) {
    return {
      date: reportDate,
      skipped: true,
      reason: "email_not_configured",
      sentCount: 0,
      skippedCount: 0,
      results: [],
    };
  }

  const managerEmails = parseEmailList(env.DAILY_VISIT_REPORT_TO);
  const sendToUser = envFlagEnabled(env.DAILY_VISIT_REPORT_SEND_TO_USERS, true);

  const [report, profiles, authUsers] = await Promise.all([
    loadReport(admin, { date: reportDate }),
    loadProfiles(admin),
    loadAuthUsers(admin),
  ]);

  const reportByUserId = new Map((report.users || []).map((user) => [user.userId, user]));
  const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));
  let recipients = [];
  const seen = new Set();

  if (requestedUserIds.length) {
    requestedUserIds.forEach((userId) => {
      if (seen.has(userId)) return;
      seen.add(userId);
      const reportUser = reportByUserId.get(userId);
      const profile = profileById.get(userId) || {
        id: userId,
        email: reportUser?.email,
        salesman_name: reportUser?.userName,
      };
      recipients.push({
        profile,
        user: reportUser || stubUserReport(profile),
      });
    });
  } else {
    profiles.forEach((profile) => {
      if (!shouldEmailVisitReportForRole(profile.role) && !reportByUserId.has(profile.id)) {
        return;
      }
      if (seen.has(profile.id)) return;
      seen.add(profile.id);
      recipients.push({
        profile,
        user: reportByUserId.get(profile.id) || stubUserReport(profile),
      });
    });

    report.users.forEach((user) => {
      if (seen.has(user.userId)) return;
      seen.add(user.userId);
      recipients.push({
        profile: { id: user.userId, email: user.email, salesman_name: user.userName },
        user,
      });
    });
  }

  recipients.sort((left, right) => String(left.user.userName || "").localeCompare(String(right.user.userName || "")));

  const kpiSalesmen = recipients
    .map(({ profile, user }) => ({
      userId: user.userId,
      salesmanCode: profile.salesman_code,
      salesmanName: user.userName || profile.salesman_name,
    }))
    .filter((row) => row.salesmanCode);

  let kpiByUserId = new Map();
  if (kpiSalesmen.length) {
    try {
      const snapshots = await loadKpis(admin, {
        salesmen: kpiSalesmen,
        reportDate,
      });
      kpiByUserId = new Map(kpiSalesmen.map((row, index) => [row.userId, snapshots[index]]));
    } catch {
      kpiByUserId = new Map();
    }
  }

  const results = [];

  for (const { profile, user } of recipients) {
    let userReport = {
      ...user,
      performance: user.performance || kpiByUserId.get(user.userId) || null,
    };
    if (!userReport.daySummary) {
      const summaryPayload = await loadSummary(admin, userReport.userId, reportDate);
      userReport = { ...userReport, daySummary: summaryPayload.daySummary };
    }

    const chainEmails = resolveVisitReportChainEmails(resolveReportingChainFromAuth({
      actorUserId: user.userId,
      profiles,
      authUsers,
    }));
    const { to } = resolveVisitReportRecipients({
      reportEmail: reportEmailOverrides[user.userId] || profile.report_email,
      userEmail: profile.email || userReport.email,
      managerEmails,
      chainEmails,
      sendToUser,
    });

    if (!to.length) {
      results.push({
        userId: userReport.userId,
        userName: userReport.userName,
        status: "skipped",
        reason: "no_recipients",
      });
      continue;
    }

    const message = buildUserVisitReportEmail({
      date: reportDate,
      user: userReport,
      thresholdKm: report.thresholdKm,
    });

    try {
      const sent = await send({ ...message, to }, env);
      results.push({
        userId: userReport.userId,
        userName: userReport.userName,
        status: "sent",
        to,
        kind: "user",
        provider: sent?.provider || null,
      });
    } catch (error) {
      results.push({
        userId: userReport.userId,
        userName: userReport.userName,
        status: "failed",
        to,
        kind: "user",
        error: error.message || "Unable to send email",
      });
    }
  }

  const leaders = collectVisitReportTeamLeaders({ recipients, profiles, authUsers });
  let teamTargetByCode = new Map();
  try {
    const teamCodes = [...new Set(
      leaders.flatMap((leader) => leaderTeamTargetCodes(leader.salesman_code)),
    )];
    if (teamCodes.length) {
      teamTargetByCode = await loadTeamTargets(admin, { salesmanCodes: teamCodes, reportDate }) || new Map();
    }
  } catch {
    teamTargetByCode = new Map();
  }

  async function sendTeamKpiEmail({ userId, userName, to, message }) {
    if (!to.length) {
      results.push({
        userId,
        userName,
        status: "skipped",
        reason: "no_recipients",
        kind: "team_kpi",
      });
      return [];
    }
    try {
      const sent = await send({ ...message, to }, env);
      results.push({
        userId,
        userName,
        status: "sent",
        to,
        kind: "team_kpi",
        provider: sent?.provider || null,
      });
      return to;
    } catch (error) {
      results.push({
        userId,
        userName,
        status: "failed",
        to,
        kind: "team_kpi",
        error: error.message || "Unable to send email",
      });
      return [];
    }
  }

  const coveredCompanyEmails = new Set();
  const allKpiSnapshots = [...kpiByUserId.values()].filter(snapshotHasKpis);

  for (const leader of leaders) {
    const subIds = resolveSubordinateUserIds(authUsers, leader, profiles);
    const hasSubordinate = recipients.some(({ user }) => subIds.has(user.userId));
    if (!hasSubordinate) continue;

    const memberSnapshots = teamKpiSnapshotsForLeader({
      leader,
      recipients,
      profiles,
      authUsers,
      kpiByUserId,
    });
    if (!memberSnapshots.length) continue;

    const team = consolidatePerformanceSnapshots(memberSnapshots, {
      reportDate,
      salesmanName: `${leader.salesman_name || leader.salesman_code || "Team"} — team`,
      teamTargets: teamTargetsForLeader(teamTargetByCode, leader.salesman_code)?.targets || null,
    });
    const inbox = resolveUserReportEmail({
      reportEmail: leader.report_email,
      email: leader.email,
    });
    const delivered = await sendTeamKpiEmail({
      userId: leader.id,
      userName: reportDisplayName(leader),
      to: inbox ? [inbox] : [],
      message: buildTeamVisitReportEmail({
        date: reportDate,
        bossName: leader.salesman_name || leader.salesman_code || "Team",
        team,
        members: memberSnapshots,
      }),
    });
    if (delivered.length && memberSnapshots.length >= allKpiSnapshots.length) {
      delivered.forEach((email) => coveredCompanyEmails.add(email));
    }
  }

  const companyTo = managerEmails.filter((email) => !coveredCompanyEmails.has(email));
  if (allKpiSnapshots.length && companyTo.length) {
    const companySnapshots = [...allKpiSnapshots].sort((left, right) => (
      String(left.salesmanName || left.salesmanCode || "").localeCompare(
        String(right.salesmanName || right.salesmanCode || ""),
      )
    ));
    await sendTeamKpiEmail({
      userId: "all-teams",
      userName: "All teams",
      to: companyTo,
      message: buildTeamVisitReportEmail({
        date: reportDate,
        bossName: "All teams",
        team: consolidatePerformanceSnapshots(companySnapshots, {
          reportDate,
          salesmanName: "All teams",
        }),
        members: companySnapshots,
      }),
    });
  }

  const sentCount = results.filter((row) => row.status === "sent").length;
  const failedCount = results.filter((row) => row.status === "failed").length;
  const skippedCount = results.filter((row) => row.status === "skipped").length;

  return {
    date: reportDate,
    skipped: false,
    userCount: recipients.length,
    sentCount,
    failedCount,
    skippedCount,
    results,
  };
}
