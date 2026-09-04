import { buildUserVisitReportEmail, resolveVisitReportRecipients } from "./dailyVisitReportEmail.js";
import {
  buildDailyVisitReport,
  loadProfilesForVisitReportEmails,
  shouldEmailVisitReportForRole,
} from "./dailyVisitReportServer.js";
import { formatCollectorDisplayName } from "./geo.js";
import { loadCollectionDaySummaryForUser } from "./collectionDaySummaryServer.js";
import { loadPerformanceSnapshotsForSalesmen } from "./performanceKpisServer.js";
import { getMailerConfig, isEmailConfigured, parseEmailList, sendEmail } from "./mailer.js";
import { getPreviousKsaDateString } from "./workdayActivity.js";

export function parseReportDateParam(value, now = new Date()) {
  const date = String(value || "").trim();
  if (!date) return getPreviousKsaDateString(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid report date. Use YYYY-MM-DD.");
  }
  return date;
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
    visitCount: 0,
    farFromCustomerCount: 0,
    totalRouteDistanceKm: 0,
    entries: [],
    daySummary: null,
  };
}

export async function runDailyVisitReportEmailCycle(admin, {
  date,
  now = new Date(),
  env = process.env,
  send = sendEmail,
  loadReport = buildDailyVisitReport,
  loadProfiles = loadProfilesForVisitReportEmails,
  loadSummary = loadCollectionDaySummaryForUser,
  loadKpis = loadPerformanceSnapshotsForSalesmen,
} = {}) {
  const reportDate = parseReportDateParam(date, now);
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

  const [report, profiles] = await Promise.all([
    loadReport(admin, { date: reportDate }),
    loadProfiles(admin),
  ]);

  const reportByUserId = new Map((report.users || []).map((user) => [user.userId, user]));
  const recipients = [];
  const seen = new Set();

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

    const { to } = resolveVisitReportRecipients({
      userEmail: profile.email || userReport.email,
      managerEmails,
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
        provider: sent?.provider || null,
      });
    } catch (error) {
      results.push({
        userId: userReport.userId,
        userName: userReport.userName,
        status: "failed",
        to,
        error: error.message || "Unable to send email",
      });
    }
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
