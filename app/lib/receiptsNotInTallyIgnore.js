export const RECEIPTS_NOT_IN_TALLY_IGNORED_KEY = "receipts_not_in_tally_ignored_v1";

function parseJson(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    return JSON.parse(String(value || "null"));
  } catch {
    return null;
  }
}

function normalizeEntry(raw, visitId) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      visitId,
      ignoredAt: "",
      ignoredBy: "",
      ignoredByName: "",
      note: "mistake",
    };
  }
  return {
    visitId: String(raw.visitId || visitId || "").trim(),
    ignoredAt: String(raw.ignoredAt || raw.ignored_at || "").trim(),
    ignoredBy: String(raw.ignoredBy || raw.ignored_by || "").trim(),
    ignoredByName: String(raw.ignoredByName || raw.ignored_by_name || "").trim(),
    note: String(raw.note || "mistake").trim() || "mistake",
    visitDate: String(raw.visitDate || raw.visit_date || "").trim(),
    customerCode: String(raw.customerCode || raw.customer_code || "").trim(),
    customerName: String(raw.customerName || raw.customer_name || "").trim(),
    amountReceived: Number(raw.amountReceived ?? raw.amount_received) || 0,
  };
}

/**
 * Parse the system_settings JSON map of visit ids marked as mistakes.
 * Shape: { byVisitId: { [visitId]: { ignoredAt, ignoredBy, ... } } }
 */
export function parseIgnoredMistakes(value) {
  const parsed = parseJson(value);
  const source = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed.byVisitId && typeof parsed.byVisitId === "object" ? parsed.byVisitId : parsed)
    : {};

  const byVisitId = {};
  Object.entries(source || {}).forEach(([key, entry]) => {
    const visitId = String(key || "").trim();
    if (!visitId) return;
    if (entry === false || entry === null) return;
    byVisitId[visitId] = normalizeEntry(entry === true ? {} : entry, visitId);
  });

  return { byVisitId };
}

export function serializeIgnoredMistakes(dataset) {
  const byVisitId = {};
  Object.entries(dataset?.byVisitId || {}).forEach(([visitId, entry]) => {
    const id = String(visitId || "").trim();
    if (!id) return;
    byVisitId[id] = normalizeEntry(entry, id);
  });
  return { byVisitId };
}

export function isVisitIgnored(dataset, visitId) {
  const id = String(visitId || "").trim();
  if (!id) return false;
  return Boolean(dataset?.byVisitId?.[id]);
}

export function filterIgnoredMissing(rows = [], dataset) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const id = String(row?.id || row?.visitId || "").trim();
    return id && !isVisitIgnored(dataset, id);
  });
}

export function markVisitIgnored(dataset, visitId, meta = {}) {
  const id = String(visitId || "").trim();
  if (!id) return serializeIgnoredMistakes(dataset);
  const next = serializeIgnoredMistakes(dataset);
  next.byVisitId[id] = normalizeEntry({
    ...next.byVisitId[id],
    ...meta,
    visitId: id,
    ignoredAt: meta.ignoredAt || new Date().toISOString(),
    note: meta.note || "mistake",
  }, id);
  return next;
}

export function unmarkVisitIgnored(dataset, visitId) {
  const id = String(visitId || "").trim();
  const next = serializeIgnoredMistakes(dataset);
  if (id && next.byVisitId[id]) delete next.byVisitId[id];
  return next;
}

export function ignoredMistakeCount(dataset) {
  return Object.keys(dataset?.byVisitId || {}).length;
}
