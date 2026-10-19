import { formatCollectionUserDisplayName } from "./geo.js";
import {
  POTENTIAL_BAD_DEBT_RECEIPT_LOOKBACK_DAYS,
  buildLegalTransferRows,
  buildPotentialBadDebtRows,
  collapseVisitsByAccount,
  debtReportVisitCodes,
  describeCollectionVisit,
  describeFieldVisit,
  fundsReceivedWindow,
  summarizeDebtRows,
} from "./badDebtReport.js";
import { resolveCustomerAccountCode } from "./outstanding.js";
import { addKsaCalendarDays, getKsaDateString, ksaDayBounds } from "./workdayActivity.js";

const PAGE_SIZE = 1000;

function isMissingSchemaError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || error?.code === "42703"
    || message.includes("could not find the table")
    || message.includes("does not exist");
}

async function readPages(queryPage) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await queryPage(from, from + PAGE_SIZE - 1);
    if (error) {
      if (isMissingSchemaError(error)) return [];
      throw error;
    }
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

export async function loadFundsReceivedVisits(admin, {
  todayKey = getKsaDateString(),
  lookbackDays,
} = {}) {
  const window = fundsReceivedWindow(todayKey, lookbackDays);
  const startIso = ksaDayBounds(window.start).startIso;
  const endIso = ksaDayBounds(addKsaCalendarDays(window.today, 1)).startIso;
  return readPages((from, to) => admin
    .from("collection_visits")
    .select("customer_code,amount_received,saved_at,visit_outcome")
    .eq("visit_outcome", "FUNDS_RECEIVED")
    .gt("amount_received", 0)
    .gte("saved_at", startIso)
    .lt("saved_at", endIso)
    .order("saved_at", { ascending: false })
    .range(from, to));
}

export async function loadLegalTransferRows(admin) {
  const withActor = await admin
    .from("legal_transfers")
    .select("customer_code,is_transferred,transferred_at,transferred_by,note");
  if (!withActor.error) return Array.isArray(withActor.data) ? withActor.data : [];
  if (!isMissingSchemaError(withActor.error)) throw withActor.error;

  const legacy = await admin
    .from("legal_transfers")
    .select("customer_code,is_transferred,transferred_at,note");
  if (legacy.error) {
    if (isMissingSchemaError(legacy.error)) return [];
    throw legacy.error;
  }
  return Array.isArray(legacy.data) ? legacy.data : [];
}

async function loadCustomersByCodes(admin, codes = []) {
  const unique = [...new Set(codes.map((code) => String(code || "").trim()).filter(Boolean))];
  const rows = [];
  for (let index = 0; index < unique.length; index += 200) {
    const batch = unique.slice(index, index + 200);
    const { data, error } = await admin
      .from("customers")
      .select("customer_code,customer_name,current_salesman_code,city,area")
      .in("customer_code", batch);
    if (error) {
      if (isMissingSchemaError(error)) return rows;
      throw error;
    }
    if (Array.isArray(data)) rows.push(...data);
  }
  return rows;
}

function chunk(values, size) {
  const list = [...values];
  const batches = [];
  for (let index = 0; index < list.length; index += size) batches.push(list.slice(index, index + size));
  return batches;
}

function customerCodeAliases(code) {
  const raw = String(code || "").trim().toUpperCase();
  const account = resolveCustomerAccountCode(raw);
  const aliases = new Set([raw, account].filter(Boolean));
  const stripped = raw.replace(/[A-Z]$/, "");
  if (/^\d{3,6}$/.test(stripped)) aliases.add(stripped);
  if (/^\d{3,6}$/.test(raw)) aliases.add(`${raw}C`);
  return [...aliases];
}

export async function loadLatestDebtVisits(admin, codes = []) {
  const aliases = [...new Set((codes || []).flatMap(customerCodeAliases))];
  const candidates = [];

  for (const batch of chunk(aliases, 20)) {
    const pages = await Promise.all(batch.map(async (code) => {
      const { data, error } = await admin
        .from("collection_visits")
        .select("customer_code,saved_at,remark_arabic,remark_english,created_by")
        .eq("customer_code", code)
        .order("saved_at", { ascending: false })
        .limit(1);
      if (error) {
        if (isMissingSchemaError(error)) return null;
        throw error;
      }
      return describeCollectionVisit(Array.isArray(data) ? data[0] : null);
    }));
    candidates.push(...pages.filter(Boolean));
  }

  for (const batch of chunk(aliases, 80)) {
    const { data, error } = await admin
      .from("system_settings")
      .select("setting_key,setting_value")
      .in("setting_key", batch.map((code) => `visit_report_latest:${code}`));
    if (error) {
      if (isMissingSchemaError(error)) break;
      throw error;
    }
    (data || []).forEach((row) => {
      let parsed = row.setting_value;
      if (typeof parsed === "string") {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          parsed = null;
        }
      }
      const visit = describeFieldVisit(parsed);
      if (visit) candidates.push(visit);
    });
  }

  return collapseVisitsByAccount(candidates);
}

async function loadActorNames(admin, ids = []) {
  const uniqueIds = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!uniqueIds.length) return {};
  const { data, error } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name,email")
    .in("id", uniqueIds);
  if (error) {
    if (isMissingSchemaError(error)) return {};
    throw error;
  }
  const names = {};
  (data || []).forEach((profile) => {
    names[profile.id] = formatCollectionUserDisplayName(profile);
  });
  return names;
}

export async function loadDebtReports(admin, {
  now = new Date(),
  fetchOutstandingAndCollectionRecords = null,
} = {}) {
  const todayKey = getKsaDateString(now instanceof Date ? now : new Date(now));
  let fetchRecords = fetchOutstandingAndCollectionRecords;
  if (!fetchRecords) {
    ({ fetchOutstandingAndCollectionRecords: fetchRecords } = await import("../api/payment-collections/route.js"));
  }

  const scope = {
    hasAllAccess: true,
    visibleSalesmanCodes: [],
    scopeProfiles: [],
    sharedCustomerCodes: [],
    userRole: "admin",
    userId: null,
    canSeeAllSchedulers: true,
    visibleSchedulerUserIds: null,
  };

  const [records, transfers, fundsReceived] = await Promise.all([
    fetchRecords(admin, scope),
    loadLegalTransferRows(admin),
    loadFundsReceivedVisits(admin, { todayKey }),
  ]);

  const reportRecords = Array.isArray(records) ? records : [];
  const visits = await loadLatestDebtVisits(admin, debtReportVisitCodes(
    reportRecords,
    transfers,
    fundsReceived,
    { todayKey },
  ));
  const actorNames = await loadActorNames(admin, [
    ...(transfers || []).map((row) => row?.transferred_by),
    ...visits.map((visit) => visit.personId),
  ]);
  const customers = await loadCustomersByCodes(
    admin,
    transfers.map((row) => row?.customer_code),
  );
  const todayIso = (now instanceof Date ? now : new Date(now)).toISOString();
  const context = {
    fundsReceived,
    transfers,
    records: reportRecords,
    customers,
    actorNames,
    visits,
    todayKey,
    todayIso,
  };
  const badDebts = buildPotentialBadDebtRows(context.records, context);
  const legalTransfers = buildLegalTransferRows(context);

  return {
    asOf: todayKey,
    lookbackDays: POTENTIAL_BAD_DEBT_RECEIPT_LOOKBACK_DAYS,
    badDebts,
    legalTransfers,
    badDebtSummary: summarizeDebtRows(badDebts),
    legalSummary: summarizeDebtRows(legalTransfers),
  };
}
