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

function filterGroupsByAppDate(groups = new Map(), appDate = "") {
  const target = String(appDate || "").slice(0, 10);
  const filtered = new Map();
  for (const [salesmanCode, group] of groups) {
    const rows = (group.rows || []).filter((row) => (
      String(row?.visit?.visit_date || "").slice(0, 10) === target
    ));
    if (!rows.length) continue;
    filtered.set(salesmanCode, { ...group, rows });
  }
  return filtered;
}

async function claimRows(admin, claim, rows, audienceKey, claimedAt) {
  const results = await Promise.all((rows || []).map(async (row) => {
    const visitId = String(row.visit?.id || "").trim();
    if (!visitId) return null;
    const claimId = `${visitId}:${audienceKey}`;
    if (!(await claim(admin, claimId, claimedAt, visitId))) return null;
    return { ...row, claimId };
  }));
  return results.filter(Boolean);
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
  const ids = (claimIds || []).map((claimId) => String(claimId).trim()).filter(Boolean);
  if (!ids.length) return;
  await Promise.all(ids.map(async (claimId) => {
    const { error } = await admin.from("system_settings")
      .update({ setting_value: JSON.stringify({ status: "sent", claimId, sentAt, emailId: emailId || null }) })
      .eq("setting_key", `${MATCHED_RECEIPT_EMAIL_CLAIM_PREFIX}${claimId}`);
    if (error) throw error;
  }));
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
  const isDailyRun = parsedUploadDates.length === 0 && !isPreview;
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
  } else if (isDailyRun || (isPreview && !String(date || "").trim())) {
    // One month-to-date reconciliation for daily/boss digests (and default preview).
    // Salesman mail still filters to reportDate after the load.
    const today = getKsaDateString(now);
    fromDate = `${today.slice(0, 7)}-01`;
    toDate = today;
    dateLabel = isDailyRun ? reportDate : `${fromDate} to ${toDate}`;
    dateFilter = null;
  } else {
    dateFilter = ({ appDate }) => appDate === reportDate;
  }

  const { groups: loadedGroups, profiles = [], authUsers = [] } = await loadData(admin, {
    fromDate,
    toDate,
    windowDays,
    dateFilter,
  });
  const groups = isDailyRun
    ? filterGroupsByAppDate(loadedGroups, reportDate)
    : loadedGroups;
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

  const bossGroups = isDailyRun
    ? groupMatchedRowsByBoss(loadedGroups, profiles, authUsers)
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
  const claimedAt = now.toISOString();
  for (const [salesmanCode, group] of groups) {
    const salesmanId = String(group.salesman.id || salesmanCode);
    if (bossIds.has(salesmanId)) continue;
    const recipient = normalizeDeliverableEmail(group.salesman.report_email)
      || normalizeDeliverableEmail(group.salesman.email);
    if (!recipient) {
      failures.push({ salesmanCode, error: "No deliverable salesman email." });
      continue;
    }

    const claimedRows = await claimRows(admin, claim, group.rows, `salesman:${salesmanId}`, claimedAt);
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
      await complete(admin, claimedRows.map((row) => row.claimId), claimedAt, delivery?.id || "");
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
    for (const [, group] of bossGroup.salesmen) {
      const rows = await claimRows(admin, claim, group.rows, `boss:${bossId}`, claimedAt);
      if (!rows.length) continue;
      claimedSalesmanGroups.push({ salesman: group.salesman, rows });
      claimedRows.push(...rows);
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
      await complete(admin, claimedRows.map((row) => row.claimId), claimedAt, delivery?.id || "");
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