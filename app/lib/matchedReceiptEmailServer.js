import { getMailerConfig, isEmailConfigured, normalizeDeliverableEmail, parseEmailList, sendEmail } from "./mailer.js";
import { buildMatchedReceiptEmail } from "./matchedReceiptEmail.js";
import { buildReceiptsNotInTallyReport } from "./receiptsNotInTallyServer.js";
import { DEFAULT_DATE_WINDOW_DAYS, shiftIsoDate } from "./receiptsNotInTally.js";
import { resolveReportingChainFromAuth } from "./salesHierarchy.js";
import { addKsaCalendarDays, getKsaDateString } from "./workdayActivity.js";

export const MATCHED_RECEIPT_EMAIL_CLAIM_PREFIX = "matched_receipt_email_claim:";
const SALESMAN_ROLES = new Set(["salesman", "product-promoter"]);

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase().replace(/_/g, "-");
}

function flagEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function reportDateOrPrevious(value, now) {
  const date = String(value || "").trim();
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  if (date) throw new Error("Invalid report date. Use YYYY-MM-DD.");
  return addKsaCalendarDays(getKsaDateString(now), -1);
}

function emptyResult(dateLabel, reason = "") {
  return { date: dateLabel, skipped: Boolean(reason), reason, matchedCount: 0, sentCount: 0, claimedCount: 0 };
}

function normalizeUploadDates(values = []) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)))].sort();
}

async function loadProfiles(admin) {
  const { data, error } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name,email,report_email,is_active");
  if (error) throw error;
  const profiles = data || [];
  const salesmenByCode = new Map(profiles
    .filter((profile) => profile.is_active === true && SALESMAN_ROLES.has(normalizeRole(profile.role)))
    .map((profile) => [normalizeCode(profile.salesman_code), profile]));
  return { profiles, salesmenByCode };
}

async function loadAuthUsers(admin) {
  if (typeof admin?.auth?.admin?.listUsers !== "function") return [];
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data?.users || [];
}

function groupMatchedRows(matches = [], profilesByCode = new Map(), dateFilter = null) {
  const groups = new Map();
  matches.forEach((match) => {
    const visit = match?.visit || {};
    const tally = match?.tally || {};
    const appDate = String(visit.visit_date || "").slice(0, 10);
    const tallyDate = String(tally.receipt_date || "").slice(0, 10);
    if (dateFilter && !dateFilter({ appDate, tallyDate, visit, tally })) return;
    const salesmanCode = normalizeCode(visit.salesman_code);
    const salesman = profilesByCode.get(salesmanCode);
    if (!salesman || !String(visit.id || "").trim()) return;
    const group = groups.get(salesmanCode) || { salesman, rows: [] };
    group.rows.push(match);
    groups.set(salesmanCode, group);
  });
  return groups;
}

async function loadMatches(admin, { fromDate, toDate, windowDays }) {
  const report = await buildReceiptsNotInTallyReport(admin, {
    fromDate,
    toDate,
    windowDays,
    includeMatched: true,
  });
  return Array.isArray(report.matched) ? report.matched : [];
}

function isUniqueViolation(error) {
  return String(error?.code || "") === "23505";
}

async function claimReceipt(admin, claimId, claimedAt, visitId = "") {
  const settingKey = `${MATCHED_RECEIPT_EMAIL_CLAIM_PREFIX}${String(claimId).trim()}`;
  const { error } = await admin.from("system_settings").insert({
    setting_key: settingKey,
    setting_value: JSON.stringify({ status: "sending", visitId: String(visitId), audience: String(claimId).split(":").slice(1).join(":"), claimedAt }),
  });
  if (isUniqueViolation(error)) return false;
  if (error) throw error;
  return true;
}

async function releaseClaims(admin, claimIds) {
  const keys = (claimIds || []).map((id) => `${MATCHED_RECEIPT_EMAIL_CLAIM_PREFIX}${String(id).trim()}`);
  if (!keys.length) return;
  const { error } = await admin.from("system_settings").delete().in("setting_key", keys);
  if (error) throw error;
}

async function completeClaims(admin, claimIds, sentAt, emailId = "") {
  for (const claimId of claimIds) {
    const { error } = await admin.from("system_settings")
      .update({ setting_value: JSON.stringify({ status: "sent", claimId: String(claimId), sentAt, emailId: emailId || null }) })
      .eq("setting_key", `${MATCHED_RECEIPT_EMAIL_CLAIM_PREFIX}${String(claimId).trim()}`);
    if (error) throw error;
  }
}

async function buildGroups(admin, options) {
  const matches = await loadMatches(admin, options);
  const [{ profiles, salesmenByCode }, authUsers] = await Promise.all([
    loadProfiles(admin),
    loadAuthUsers(admin),
  ]);
  const groups = groupMatchedRows(matches, salesmenByCode, options.dateFilter);
  return { matches, groups, profiles, authUsers };
}

function groupMatchedRowsByBoss(groups, profiles = [], authUsers = []) {
  const bosses = new Map();
  for (const group of groups.values()) {
    const chain = resolveReportingChainFromAuth({
      actorUserId: group.salesman?.id,
      profiles,
      authUsers,
    });
    chain.forEach((boss) => {
      if (!boss?.id) return;
      const bossKey = String(boss.id);
      const entry = bosses.get(bossKey) || { boss, salesmen: new Map() };
      entry.salesmen.set(normalizeCode(group.salesman?.salesman_code), group);
      bosses.set(bossKey, entry);
    });
  }

  bosses.forEach((entry) => {
    const bossSalesmanGroup = groups.get(normalizeCode(entry.boss?.salesman_code));
    if (bossSalesmanGroup) {
      entry.salesmen.set(normalizeCode(entry.boss.salesman_code), bossSalesmanGroup);
    }
  });
  return bosses;
}

export async function runMatchedReceiptEmailCycle(admin, {
  date,
  uploadDates = [],
  preview = false,
  to = "",
  now = new Date(),
  env = process.env,
  send = sendEmail,
  loadData = buildGroups,
  claim = claimReceipt,
  release = releaseClaims,
  complete = completeClaims,
} = {}) {
  const parsedUploadDates = normalizeUploadDates(uploadDates);
  const reportDate = reportDateOrPrevious(date, now);
  const testRecipients = parseEmailList(to || env.MATCHED_RECEIPT_EMAIL_TEST_TO);
  const isPreview = preview || testRecipients.length > 0;
  if (!isPreview && !flagEnabled(env.MATCHED_RECEIPT_EMAIL_ENABLED)) {
    return emptyResult(reportDate, "salesman_delivery_disabled_until_preview_approval");
  }
  if (!isEmailConfigured(getMailerConfig(env))) return emptyResult(reportDate, "email_not_configured");

  const windowDays = DEFAULT_DATE_WINDOW_DAYS;
  let fromDate = reportDate;
  let toDate = reportDate;
  let dateLabel = reportDate;
  let dateFilter;

  if (parsedUploadDates.length) {
    fromDate = shiftIsoDate(parsedUploadDates[0], -windowDays);
    toDate = shiftIsoDate(parsedUploadDates[parsedUploadDates.length - 1], windowDays);
    dateLabel = parsedUploadDates.join(", ");
    const uploaded = new Set(parsedUploadDates);
    dateFilter = ({ tallyDate }) => uploaded.has(tallyDate);
  } else if (isPreview && !String(date || "").trim()) {
    const today = getKsaDateString(now);
    fromDate = `${today.slice(0, 7)}-01`;
    toDate = today;
    dateLabel = `${fromDate} to ${toDate}`;
  } else {
    dateFilter = ({ appDate }) => appDate === reportDate;
  }

  const { groups, profiles = [], authUsers = [] } = await loadData(admin, {
    fromDate,
    toDate,
    windowDays,
    dateFilter,
  });
  const salesmanGroups = [...groups.values()];
  const matchedCount = salesmanGroups.reduce((sum, group) => sum + group.rows.length, 0);

  if (isPreview) {
    if (!matchedCount) return { ...emptyResult(dateLabel), matchedCount: 0, preview: true };
    if (!testRecipients.length) throw new Error("A test recipient is required for preview mode.");
    const message = buildMatchedReceiptEmail({ dateLabel, salesmanGroups, preview: true });
    const delivery = await send({ ...message, to: testRecipients, cc: [] }, env);
    return {
      date: dateLabel,
      preview: true,
      skipped: false,
      matchedCount,
      sentCount: 1,
      claimedCount: 0,
      to: testRecipients,
      emailId: delivery?.id || "",
    };
  }

  const isDailyRun = parsedUploadDates.length === 0;
  let bossSourceGroups = groups;
  let bossProfiles = profiles;
  let bossAuthUsers = authUsers;
  if (isDailyRun) {
    const today = getKsaDateString(now);
    const monthStart = `${today.slice(0, 7)}-01`;
    const bossData = await loadData(admin, {
      fromDate: monthStart,
      toDate: today,
      windowDays,
      dateFilter: null,
    });
    bossSourceGroups = bossData.groups;
    bossProfiles = bossData.profiles || profiles;
    bossAuthUsers = bossData.authUsers || authUsers;
  }
  const bossGroups = isDailyRun
    ? groupMatchedRowsByBoss(bossSourceGroups, bossProfiles, bossAuthUsers)
    : new Map();
  const bossIds = new Set(bossGroups.keys());
  const bossReceiptCount = [...bossGroups.values()].reduce((sum, boss) => (
    sum + [...boss.salesmen.values()].reduce((salesmanTotal, group) => salesmanTotal + group.rows.length, 0)
  ), 0);
  if (!matchedCount && !bossReceiptCount) {
    return { ...emptyResult(dateLabel), matchedCount: 0, preview: false };
  }
  const sentSalesmen = [];
  const sentBosses = [];
  const failures = [];
  let claimedCount = 0;
  for (const [salesmanCode, group] of groups) {
    const salesmanId = String(group.salesman.id || salesmanCode);
    if (bossIds.has(salesmanId)) continue;
    const recipient = normalizeDeliverableEmail(group.salesman.report_email)
      || normalizeDeliverableEmail(group.salesman.email);
    if (!recipient) {
      failures.push({ salesmanCode, error: "No deliverable salesman email." });
      continue;
    }

    const claimedRows = [];
    for (const row of group.rows) {
      const visitId = String(row.visit?.id || "").trim();
      const claimId = `${visitId}:salesman:${salesmanId}`;
      if (await claim(admin, claimId, now.toISOString(), visitId)) claimedRows.push({ ...row, claimId });
    }
    if (!claimedRows.length) continue;
    claimedCount += claimedRows.length;

    const message = buildMatchedReceiptEmail({
      dateLabel,
      salesmanGroups: [{ salesman: group.salesman, rows: claimedRows }],
    });
    let emailAccepted = false;
    try {
      const delivery = await send({ ...message, to: [recipient] }, env);
      emailAccepted = true;
      await complete(admin, claimedRows.map((row) => row.claimId), now.toISOString(), delivery?.id || "");
      sentSalesmen.push(salesmanCode);
    } catch (error) {
      if (!emailAccepted) await release(admin, claimedRows.map((row) => row.claimId));
      failures.push({ salesmanCode, error: String(error?.message || error) });
    }
  }

  for (const [bossId, bossGroup] of bossGroups) {
    if (bossGroup.boss?.is_active === false) continue;
    const recipient = normalizeDeliverableEmail(bossGroup.boss?.report_email)
      || normalizeDeliverableEmail(bossGroup.boss?.email);
    if (!recipient) continue;

    const claimedSalesmanGroups = [];
    const claimedRows = [];
    for (const [salesmanCode, group] of bossGroup.salesmen) {
      const rows = [];
      for (const row of group.rows) {
        const visitId = String(row.visit?.id || "").trim();
        const claimId = `${visitId}:boss:${bossId}`;
        if (await claim(admin, claimId, now.toISOString(), visitId)) {
          const claimed = { ...row, claimId };
          rows.push(claimed);
          claimedRows.push(claimed);
        }
      }
      if (rows.length) claimedSalesmanGroups.push({ salesman: group.salesman, rows });
    }
    if (!claimedRows.length) continue;
    claimedCount += claimedRows.length;

    const message = buildMatchedReceiptEmail({
      dateLabel,
      salesmanGroups: claimedSalesmanGroups,
      digest: true,
    });
    let emailAccepted = false;
    try {
      const delivery = await send({ ...message, to: [recipient] }, env);
      emailAccepted = true;
      await complete(admin, claimedRows.map((row) => row.claimId), now.toISOString(), delivery?.id || "");
      sentBosses.push(bossId);
    } catch (error) {
      if (!emailAccepted) await release(admin, claimedRows.map((row) => row.claimId));
      failures.push({ bossId, error: String(error?.message || error) });
    }
  }

  return {
    date: dateLabel,
    skipped: false,
    preview: false,
    matchedCount,
    sentCount: sentSalesmen.length + sentBosses.length,
    claimedCount,
    sentSalesmen,
    sentBosses,
    failedCount: failures.length,
    failures,
  };
}