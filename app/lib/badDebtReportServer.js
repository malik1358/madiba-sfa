import { formatCollectionUserDisplayName } from "./geo.js";
import {
  POTENTIAL_BAD_DEBT_RECEIPT_LOOKBACK_DAYS,
  buildLegalTransferRows,
  buildPotentialBadDebtRows,
  fundsReceivedWindow,
  summarizeDebtRows,
} from "./badDebtReport.js";
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

async function loadActorNames(admin, transfers = []) {
  const ids = [...new Set(transfers.map((row) => String(row?.transferred_by || "").trim()).filter(Boolean))];
  if (!ids.length) return {};
  const { data, error } = await admin
    .from("profiles")
    .select("id,role,salesman_code,salesman_name,email")
    .in("id", ids);
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

  const actorNames = await loadActorNames(admin, transfers);
  const customers = await loadCustomersByCodes(
    admin,
    transfers.map((row) => row?.customer_code),
  );
  const context = {
    fundsReceived,
    transfers,
    records: Array.isArray(records) ? records : [],
    customers,
    actorNames,
    todayKey,
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
