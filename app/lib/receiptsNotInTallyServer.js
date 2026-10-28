import {
  RECEIPT_DATASET_KEY,
  normalizeReceiptDataset,
} from "./receiptRegister.js";
import {
  DEFAULT_DATE_WINDOW_DAYS,
  ORDER_PDF_PENDING_TALLY_WORKING_DAYS,
  isSameReceiptCustomer,
  recentKsaOrderDayWindowStart,
  reconcileAppReceiptsToTally,
  selectRecentReceiptsMissingFromTally,
  shiftIsoDate,
} from "./receiptsNotInTally.js";
import {
  RECEIPTS_NOT_IN_TALLY_IGNORED_KEY,
  filterIgnoredMissing,
  ignoredMistakeCount,
  markVisitIgnored,
  parseIgnoredMistakes,
  serializeIgnoredMistakes,
  unmarkVisitIgnored,
} from "./receiptsNotInTallyIgnore.js";
import { formatCollectorDisplayName } from "./geo.js";
import { getKsaDateString, ksaDayBounds } from "./workdayActivity.js";

function parseJson(value) {
  try {
    return JSON.parse(value || "null");
  } catch {
    return null;
  }
}

function isMissingTableError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
}

function isMissingColumnError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42703" || (message.includes("column") && message.includes("does not exist"));
}

export function defaultReceiptsNotInTallyFromDate(today = getKsaDateString()) {
  return `${today.slice(0, 7)}-01`;
}

export function parseReceiptsNotInTallyWindowDays(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return DEFAULT_DATE_WINDOW_DAYS;
  return Math.max(0, Math.min(30, Math.round(raw)));
}

async function readReceiptDataset(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", RECEIPT_DATASET_KEY)
    .maybeSingle();

  if (error) throw error;
  return normalizeReceiptDataset(parseJson(data?.setting_value));
}

export async function loadIgnoredMistakes(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", RECEIPTS_NOT_IN_TALLY_IGNORED_KEY)
    .maybeSingle();

  if (error) throw error;
  return parseIgnoredMistakes(data?.setting_value);
}

export async function saveIgnoredMistakes(admin, dataset) {
  const { error } = await admin.from("system_settings").upsert({
    setting_key: RECEIPTS_NOT_IN_TALLY_IGNORED_KEY,
    setting_value: JSON.stringify(serializeIgnoredMistakes(dataset)),
  }, { onConflict: "setting_key" });
  if (error) throw error;
}

async function loadAppReceiptVisits(admin, { startIso, endIso, customerCode = "" }) {
  const selectWithMode = "id,customer_code,visit_outcome,payment_status,amount_received,receipt_mode,saved_at,created_by";
  const selectLegacy = "id,customer_code,visit_outcome,payment_status,amount_received,saved_at,created_by";
  const code = String(customerCode || "").trim().toUpperCase();

  function buildQuery(selectColumns) {
    let query = admin
      .from("collection_visits")
      .select(selectColumns)
      .eq("visit_outcome", "FUNDS_RECEIVED")
      .gt("amount_received", 0)
      .gte("saved_at", startIso)
      .lte("saved_at", endIso)
      .order("saved_at", { ascending: true });
    if (code) query = query.eq("customer_code", code);
    return query;
  }

  let result = await buildQuery(selectWithMode);

  if (result.error && isMissingColumnError(result.error)) {
    result = await buildQuery(selectLegacy);
  }

  if (result.error) {
    if (isMissingTableError(result.error)) {
      throw new Error("Collection tables are not initialized in this environment yet.");
    }
    throw result.error;
  }

  return Array.isArray(result.data) ? result.data : [];
}

async function loadCustomerNames(admin, customerCodes) {
  const codes = [...new Set((customerCodes || []).map((code) => String(code || "").trim().toUpperCase()).filter(Boolean))];
  if (!codes.length) return new Map();

  const { data, error } = await admin
    .from("customers")
    .select("customer_code,customer_name,current_salesman_code")
    .in("customer_code", codes);

  if (error && !isMissingTableError(error)) throw error;

  return new Map(
    (data || []).map((row) => [
      String(row.customer_code || "").trim().toUpperCase(),
      {
        customerName: String(row.customer_name || "").trim(),
        salesmanCode: String(row.current_salesman_code || "").trim(),
      },
    ]),
  );
}

async function loadCollectorNames(admin, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const { data, error } = await admin
    .from("profiles")
    .select("id,salesman_code,salesman_name,role,email")
    .in("id", ids);

  if (error) throw error;

  return new Map(
    (data || []).map((row) => [row.id, formatCollectorDisplayName(row)]),
  );
}

function mapMissingRow(visit) {
  return {
    id: visit.id,
    visitDate: visit.visit_date,
    savedAt: visit.saved_at,
    customerCode: visit.customer_code,
    customerName: visit.customer_name,
    amountReceived: visit.amount_received,
    receiptMode: visit.receipt_mode,
    paymentStatus: visit.payment_status,
    collectorName: visit.collector_name,
    createdBy: visit.created_by,
    salesmanCode: visit.salesman_code || "",
  };
}

/**
 * Customer-scoped pending app receipts from the last N KSA order days that are
 * still missing from the uploaded Tally receipt register (for Order PDF).
 */
export async function buildCustomerPendingTallyReceipts(admin, {
  customerCode = "",
  customerName = "",
  workingDays = ORDER_PDF_PENDING_TALLY_WORKING_DAYS,
  todayKey = getKsaDateString(),
  windowDays = DEFAULT_DATE_WINDOW_DAYS,
} = {}) {
  const code = String(customerCode || "").trim();
  const name = String(customerName || "").trim();
  if (!code && !name) {
    throw new Error("customerCode or customerName is required.");
  }

  const today = String(todayKey || "").trim() || getKsaDateString();
  const limit = Math.max(1, Number(workingDays) || ORDER_PDF_PENDING_TALLY_WORKING_DAYS);
  const windowStart = recentKsaOrderDayWindowStart(today, limit);
  const resolvedWindow = parseReceiptsNotInTallyWindowDays(windowDays);
  // Widen visit load slightly so ±windowDays Tally lag still soft-matches.
  const visitFrom = shiftIsoDate(windowStart, -resolvedWindow);
  const { startIso } = ksaDayBounds(visitFrom);
  const { endIso } = ksaDayBounds(today);

  // Load the short calendar window without a code filter so related account
  // codes (1106 vs 1106C) still soft-match via isSameReceiptCustomer.
  const [visits, dataset, ignored] = await Promise.all([
    loadAppReceiptVisits(admin, { startIso, endIso }),
    readReceiptDataset(admin),
    loadIgnoredMistakes(admin),
  ]);

  const customerCodes = visits.map((row) => row.customer_code);
  if (code) customerCodes.push(code);
  const collectorIds = visits.map((row) => row.created_by);
  const [customerNames, collectorNames] = await Promise.all([
    loadCustomerNames(admin, customerCodes),
    loadCollectorNames(admin, collectorIds),
  ]);

  const resolvedName = name
    || customerNames.get(String(code || "").trim().toUpperCase())?.customerName
    || code
    || "";

  const enrichedVisits = visits
    .map((visit) => {
      const visitCode = String(visit.customer_code || "").trim().toUpperCase();
      return {
        ...visit,
        customer_name: customerNames.get(visitCode)?.customerName || visit.customer_code || "",
        salesman_code: customerNames.get(visitCode)?.salesmanCode || "",
        collector_name: collectorNames.get(visit.created_by) || "",
        visit_date: getKsaDateString(new Date(visit.saved_at)),
      };
    })
    .filter((visit) => isSameReceiptCustomer(
      visit.customer_code,
      visit.customer_name,
      code,
      resolvedName,
    ));

  const tallyFrom = shiftIsoDate(visitFrom, -resolvedWindow);
  const tallyTo = shiftIsoDate(today, resolvedWindow);
  const tallyInRange = (dataset.rows || []).filter((row) => {
    const date = String(row.receipt_date || "").slice(0, 10);
    if (date < tallyFrom || date > tallyTo) return false;
    return isSameReceiptCustomer(
      row.customer_code,
      row.customer_name || row.particulars,
      code,
      resolvedName,
    );
  });

  const recent = selectRecentReceiptsMissingFromTally({
    appVisits: enrichedVisits,
    tallyReceipts: tallyInRange,
    workingDays: limit,
    todayKey: today,
    windowDays: resolvedWindow,
  });
  const openMissing = filterIgnoredMissing(recent.missingInTally, ignored);

  return {
    customerCode: code,
    customerName: resolvedName,
    today: today,
    workingDays: limit,
    windowStart: recent.windowStart,
    windowDays: recent.windowDays,
    amountTolerance: recent.amountTolerance,
    pendingTallyReceipts: openMissing.map(mapMissingRow),
  };
}

/**
 * Build the receipts-not-in-Tally report for a date range, excluding marked mistakes.
 */
export async function buildReceiptsNotInTallyReport(admin, {
  fromDate,
  toDate,
  windowDays = DEFAULT_DATE_WINDOW_DAYS,
  includeMatched = false,
} = {}) {
  const from = String(fromDate || "").trim();
  const to = String(toDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error("Invalid from/to date. Use YYYY-MM-DD.");
  }
  if (from > to) {
    throw new Error("From date must be on or before to date.");
  }

  const resolvedWindow = parseReceiptsNotInTallyWindowDays(windowDays);
  const { startIso } = ksaDayBounds(from);
  const { endIso } = ksaDayBounds(to);

  const [visits, dataset, ignored] = await Promise.all([
    loadAppReceiptVisits(admin, { startIso, endIso }),
    readReceiptDataset(admin),
    loadIgnoredMistakes(admin),
  ]);

  const customerCodes = visits.map((row) => row.customer_code);
  const collectorIds = visits.map((row) => row.created_by);
  const [customerNames, collectorNames] = await Promise.all([
    loadCustomerNames(admin, customerCodes),
    loadCollectorNames(admin, collectorIds),
  ]);

  const enrichedVisits = visits.map((visit) => {
    const code = String(visit.customer_code || "").trim().toUpperCase();
    return {
      ...visit,
      customer_name: customerNames.get(code)?.customerName || visit.customer_code || "",
      salesman_code: customerNames.get(code)?.salesmanCode || "",
      collector_name: collectorNames.get(visit.created_by) || "",
      visit_date: getKsaDateString(new Date(visit.saved_at)),
    };
  });

  const tallyFrom = shiftIsoDate(from, -resolvedWindow);
  const tallyTo = shiftIsoDate(to, resolvedWindow);
  const tallyInRange = (dataset.rows || []).filter((row) => {
    const date = String(row.receipt_date || "").slice(0, 10);
    return date >= tallyFrom && date <= tallyTo;
  });

  const reconciliation = reconcileAppReceiptsToTally({
    appVisits: enrichedVisits,
    tallyReceipts: tallyInRange,
    windowDays: resolvedWindow,
  });

  const ignoredInRange = [
    ...reconciliation.missingInTally,
    ...reconciliation.matched.map((row) => row.visit),
  ].filter((visit) => (
    Boolean(ignored.byVisitId?.[String(visit.id || "").trim()])
  ));
  const openMissing = filterIgnoredMissing(reconciliation.missingInTally, ignored);
  const matchedForEmail = reconciliation.matched.filter((row) => (
    !ignored.byVisitId?.[String(row.visit?.id || "").trim()]
  ));
  const openMissingTotal = openMissing.reduce((sum, visit) => sum + Number(visit.amount_received || 0), 0);

  return {
    from,
    to,
    windowDays: reconciliation.windowDays,
    amountTolerance: reconciliation.amountTolerance,
    tallyUpload: {
      uploadedAt: dataset.uploadedAt || "",
      fileName: dataset.fileName || "",
      rowsCount: dataset.rowsCount || dataset.rows.length,
      matchedCount: dataset.matchedCount,
      unmatchedCount: dataset.unmatchedCount,
      datesUpdated: dataset.datesUpdated || [],
    },
    summary: {
      appCount: reconciliation.appCount,
      matchedCount: matchedForEmail.length,
      missingCount: openMissing.length,
      ignoredCount: ignoredInRange.length,
      ignoredTotalCount: ignoredMistakeCount(ignored),
      duplicateCount: reconciliation.duplicateCount,
      appTotal: reconciliation.appTotal,
      matchedTotal: matchedForEmail.reduce((sum, row) => sum + Number(row.visit.amount_received || 0), 0),
      missingTotal: openMissingTotal,
      tallyCandidateCount: tallyInRange.length,
    },
    missingInTally: openMissing.map(mapMissingRow),
    ignoredInTally: ignoredInRange.map((visit) => ({
      ...mapMissingRow(visit),
      resolution: ignored.byVisitId?.[String(visit.id || "").trim()]?.note || "error",
    })),
    duplicatesInApp: reconciliation.duplicatesDropped.map((visit) => ({
      id: visit.id,
      visitDate: visit.visit_date,
      savedAt: visit.saved_at,
      customerCode: visit.customer_code,
      customerName: visit.customer_name || visit.customer_code,
      amountReceived: visit.amount_received,
      collectorName: visit.collector_name || "",
      resolution: "duplicate",
      duplicateOf: visit.duplicateOf,
    })),
    ...(includeMatched ? { matched: matchedForEmail } : {}),
    ...(includeMatched ? { duplicatesDropped: reconciliation.duplicatesDropped } : {}),
  };
}

export async function markReceiptAsMistake(admin, {
  visitId,
  action = "ignore",
  note = "mistake",
  actor = {},
  snapshot = {},
} = {}) {
  const id = String(visitId || "").trim();
  if (!id) throw new Error("visitId is required.");

  const current = await loadIgnoredMistakes(admin);
  const normalizedAction = String(action || "ignore").trim().toLowerCase();
  const resolution = ["error", "duplicate"].includes(String(note || "").trim().toLowerCase())
    ? String(note).trim().toLowerCase()
    : "error";
  let next = current;

  if (normalizedAction === "restore" || normalizedAction === "unignore") {
    next = unmarkVisitIgnored(current, id);
  } else {
    next = markVisitIgnored(current, id, {
      ignoredAt: new Date().toISOString(),
      ignoredBy: String(actor.id || actor.userId || "").trim(),
      ignoredByName: String(actor.name || actor.salesman_name || actor.email || "").trim(),
      note: resolution,
      visitDate: String(snapshot.visitDate || snapshot.visit_date || "").trim(),
      customerCode: String(snapshot.customerCode || snapshot.customer_code || "").trim(),
      customerName: String(snapshot.customerName || snapshot.customer_name || "").trim(),
      amountReceived: Number(snapshot.amountReceived ?? snapshot.amount_received) || 0,
    });
  }

  await saveIgnoredMistakes(admin, next);
  return {
    visitId: id,
    action: normalizedAction === "restore" || normalizedAction === "unignore" ? "restore" : "ignore",
    ignored: Boolean(next.byVisitId[id]),
    ignoredCount: ignoredMistakeCount(next),
  };
}
