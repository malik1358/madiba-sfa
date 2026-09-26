import {
  RECEIPT_DATASET_KEY,
  normalizeReceiptDataset,
} from "./receiptRegister.js";
import {
  DEFAULT_DATE_WINDOW_DAYS,
  reconcileAppReceiptsToTally,
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

async function loadAppReceiptVisits(admin, { startIso, endIso }) {
  const selectWithMode = "id,customer_code,visit_outcome,payment_status,amount_received,receipt_mode,saved_at,created_by";
  const selectLegacy = "id,customer_code,visit_outcome,payment_status,amount_received,saved_at,created_by";

  let result = await admin
    .from("collection_visits")
    .select(selectWithMode)
    .eq("visit_outcome", "FUNDS_RECEIVED")
    .gt("amount_received", 0)
    .gte("saved_at", startIso)
    .lte("saved_at", endIso)
    .order("saved_at", { ascending: true });

  if (result.error && isMissingColumnError(result.error)) {
    result = await admin
      .from("collection_visits")
      .select(selectLegacy)
      .eq("visit_outcome", "FUNDS_RECEIVED")
      .gt("amount_received", 0)
      .gte("saved_at", startIso)
      .lte("saved_at", endIso)
      .order("saved_at", { ascending: true });
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
    .select("customer_code,customer_name")
    .in("customer_code", codes);

  if (error && !isMissingTableError(error)) throw error;

  return new Map(
    (data || []).map((row) => [
      String(row.customer_code || "").trim().toUpperCase(),
      String(row.customer_name || "").trim(),
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
  };
}

/**
 * Build the receipts-not-in-Tally report for a date range, excluding marked mistakes.
 */
export async function buildReceiptsNotInTallyReport(admin, {
  fromDate,
  toDate,
  windowDays = DEFAULT_DATE_WINDOW_DAYS,
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
      customer_name: customerNames.get(code) || visit.customer_code || "",
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

  const openMissing = filterIgnoredMissing(reconciliation.missingInTally, ignored);
  const ignoredInRange = reconciliation.missingInTally.filter((visit) => (
    Boolean(ignored.byVisitId?.[String(visit.id || "").trim()])
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
      matchedCount: reconciliation.matchedCount,
      missingCount: openMissing.length,
      ignoredCount: ignoredInRange.length,
      ignoredTotalCount: ignoredMistakeCount(ignored),
      duplicateCount: reconciliation.duplicateCount,
      appTotal: reconciliation.appTotal,
      matchedTotal: reconciliation.matchedTotal,
      missingTotal: openMissingTotal,
      tallyCandidateCount: tallyInRange.length,
    },
    missingInTally: openMissing.map(mapMissingRow),
    ignoredInTally: ignoredInRange.map(mapMissingRow),
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
  let next = current;

  if (normalizedAction === "restore" || normalizedAction === "unignore") {
    next = unmarkVisitIgnored(current, id);
  } else {
    next = markVisitIgnored(current, id, {
      ignoredAt: new Date().toISOString(),
      ignoredBy: String(actor.id || actor.userId || "").trim(),
      ignoredByName: String(actor.name || actor.salesman_name || actor.email || "").trim(),
      note: String(note || "mistake").trim() || "mistake",
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
