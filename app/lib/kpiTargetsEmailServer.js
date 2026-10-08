import { buildKpiTargetsEmail, resolveKpiTargetEmailRecipients } from "./kpiTargetsEmail.js";
import { resolveReportingChainFromAuth } from "./salesHierarchy.js";
import { loadPerformanceSnapshotsForSalesmen } from "./performanceKpisServer.js";
import { isEmailConfigured, getMailerConfig, normalizeDeliverableEmail, sendEmail } from "./mailer.js";
import { isKpiTargetProfile } from "./kpiTargetsTable.js";
import { normalizeSalesmanCode } from "./performanceKpis.js";

async function loadProfiles(admin) {
  const full = "id,role,salesman_code,salesman_name,email,report_email,is_active";
  const fallback = "id,role,salesman_code,salesman_name,email,is_active";
  let result = await admin.from("profiles").select(full);
  if (result.error?.code === "42703" || String(result.error?.message || "").toLowerCase().includes("schema cache")) {
    result = await admin.from("profiles").select(fallback);
  }
  if (result.error) throw result.error;
  return (result.data || []).filter((profile) => profile.is_active !== false);
}

async function loadAuthUsers(admin) {
  const result = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (result.error) throw result.error;
  return result.data?.users || [];
}

export async function runKpiTargetsEmailCycle(admin, {
  month,
  salesmanCodes = [],
  changedLabelsBySalesman = {},
  trigger = "change",
  env = process.env,
  send = sendEmail,
  getProfiles = loadProfiles,
  listAuthUsers = loadAuthUsers,
  loadSnapshots = loadPerformanceSnapshotsForSalesmen,
} = {}) {
  const profiles = await getProfiles(admin);
  const requestedCodes = new Set((salesmanCodes || []).map(normalizeSalesmanCode).filter(Boolean));
  const eligibleProfiles = profiles.filter(isKpiTargetProfile);
  const recipients = eligibleProfiles.filter((profile) => (
    !requestedCodes.size || requestedCodes.has(normalizeSalesmanCode(profile.salesman_code))
  ));
  if (!recipients.length) return { month, trigger, sentCount: 0, failedCount: 0, skippedCount: 0, results: [] };
  if (!isEmailConfigured(getMailerConfig(env))) {
    return {
      month,
      trigger,
      sentCount: 0,
      failedCount: 0,
      skippedCount: recipients.length,
      results: recipients.map((profile) => ({ salesmanCode: profile.salesman_code, skipped: true, reason: "email_not_configured" })),
    };
  }

  const authUsers = await listAuthUsers(admin);
  const snapshots = await loadSnapshots(admin, {
    salesmen: recipients.map((profile) => ({ salesmanCode: profile.salesman_code, salesmanName: profile.salesman_name })),
    reportDate: `${month}-01`,
  });
  const profilesByCode = new Map(recipients.map((profile) => [normalizeSalesmanCode(profile.salesman_code), profile]));
  const results = [];
  for (const snapshot of snapshots) {
    const profile = profilesByCode.get(normalizeSalesmanCode(snapshot.salesmanCode));
    if (!profile) continue;
    const chainEmails = resolveReportingChainFromAuth({
      actorUserId: profile.id,
      profiles,
      authUsers,
    }).map((boss) => normalizeDeliverableEmail(boss.report_email) || normalizeDeliverableEmail(boss.email)).filter(Boolean);
    const emailRecipients = resolveKpiTargetEmailRecipients({
      reportEmail: profile.report_email,
      email: profile.email,
      chainEmails,
    });
    if (!emailRecipients.to.length) {
      results.push({ salesmanCode: profile.salesman_code, skipped: true, reason: "no_salesman_email" });
      continue;
    }
    try {
      const changedLabels = changedLabelsBySalesman[normalizeSalesmanCode(profile.salesman_code)] || [];
      const personalizedMessage = buildKpiTargetsEmail({ snapshot, month, changedLabels });
      await send({ ...personalizedMessage, ...emailRecipients }, env);
      results.push({ salesmanCode: profile.salesman_code, sent: true, ccCount: emailRecipients.cc.length });
    } catch (error) {
      results.push({ salesmanCode: profile.salesman_code, failed: true, error: error.message || "Email send failed." });
    }
  }
  return {
    month,
    trigger,
    sentCount: results.filter((result) => result.sent).length,
    failedCount: results.filter((result) => result.failed).length,
    skippedCount: results.filter((result) => result.skipped).length,
    results,
  };
}