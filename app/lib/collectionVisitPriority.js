import {
  buildCollectionPriority,
  buildCollectionQueues,
  customerMatchesCollectionScope,
  isCashOnlyQueueCustomer,
  isCashQueueCustomer,
  sortCashQueueCustomers,
} from "./paymentCollections.js";
import { buildSalesmanScopeMatchers } from "./mutualSalesmanGroups.js";

function normalizeCustomerCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function extractQueuePriorityFromSummary(summaryText) {
  const match = String(summaryText || "").match(/Queue priority:\s*(\d+)/i);
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function extractProbabilityLabelFromSummary(summaryText) {
  const match = String(summaryText || "").match(/Payment probability:\s*(High|Medium|Low|N\/A)/i);
  return match ? match[1] : "";
}

export function buildVisibleDueQueuePriorityMap(dueCustomers, todayIso = new Date().toISOString()) {
  const visibleDueQueuePriority = new Map();
  let priority = 0;

  (dueCustomers || [])
    .filter((row) => row.queue_kind !== "not_due")
    .filter((row) => !isCashOnlyQueueCustomer(row, todayIso))
    .forEach((row) => {
      const code = normalizeCustomerCode(row.customer_code);
      if (!code) return;
      priority += 1;
      visibleDueQueuePriority.set(code, priority);
    });

  return visibleDueQueuePriority;
}

export function buildCollectionQueuePriorityMaps(records, todayIso = new Date().toISOString()) {
  const queues = buildCollectionQueues(records, todayIso);
  const dueQueuePriority = new Map();
  const visibleDueQueuePriority = buildVisibleDueQueuePriorityMap(queues.dueCustomers, todayIso);
  const probabilityByCode = new Map();
  const recordByCode = new Map();

  (records || []).forEach((record) => {
    const code = normalizeCustomerCode(record?.customer_code);
    if (code) recordByCode.set(code, record);
  });

  queues.dueCustomers
    .filter((row) => row.queue_kind !== "not_due")
    .forEach((row, index) => {
      const code = normalizeCustomerCode(row.customer_code);
      if (!code) return;
      dueQueuePriority.set(code, index + 1);
      probabilityByCode.set(code, {
        score: Number(row.probability_score || 0),
        label: String(row.probability_label || "").trim(),
      });
    });

  queues.notDueCustomers.forEach((row) => {
    const code = normalizeCustomerCode(row.customer_code);
    if (!code || probabilityByCode.has(code)) return;
    probabilityByCode.set(code, {
      score: Number(row.probability_score || 0),
      label: String(row.probability_label || "N/A").trim(),
    });
  });

  const cashQueuePriority = new Map();
  const cashRows = sortCashQueueCustomers(
    [...queues.dueCustomers, ...queues.notDueCustomers].filter((row) => isCashQueueCustomer(row, todayIso)),
  );
  cashRows.forEach((row, index) => {
    const code = normalizeCustomerCode(row.customer_code);
    if (code) cashQueuePriority.set(code, index + 1);
  });

  return {
    dueQueuePriority,
    visibleDueQueuePriority,
    cashQueuePriority,
    probabilityByCode,
    recordByCode,
    dueQueueSize: visibleDueQueuePriority.size || dueQueuePriority.size,
  };
}

export function filterCollectionRecordsForScope(records, scope = {}) {
  if (scope.hasAllAccess) return Array.isArray(records) ? records : [];

  const scopeMatchers = buildSalesmanScopeMatchers(scope.scopeProfiles || []);
  const normalizedScopeCodes = (scope.visibleSalesmanCodes || [])
    .map((code) => normalizeCustomerCode(code))
    .filter(Boolean);

  return (records || []).filter((record) => customerMatchesCollectionScope({
    customer: record,
    customerInvoices: record?.invoices || [],
    scopeMatchers,
    normalizedScopeCodes,
    hasAllAccess: false,
  }));
}

export function buildScopedCollectionQueuePriorityMaps(records, scope, todayIso = new Date().toISOString()) {
  return buildCollectionQueuePriorityMaps(
    filterCollectionRecordsForScope(records, scope),
    todayIso,
  );
}

export function resolveVisitPriorityMeta(visit, maps, options = {}) {
  const code = normalizeCustomerCode(visit?.customer_code);
  const storedPriority = Number(visit?.queue_priority || 0);
  let queuePriority = storedPriority;
  let probabilityScore = Number(visit?.probability_score || 0);
  let probabilityLabel = String(visit?.probability_label || "").trim();
  let prioritySource = storedPriority > 0 ? "stored" : "unknown";
  const storedSummary = String(visit?.summary_text || "").trim();
  const visibleDueRank = maps.visibleDueQueuePriority?.get(code) || 0;
  const dueRank = maps.dueQueuePriority.get(code) || 0;
  const cashRank = maps.cashQueuePriority.get(code) || 0;
  const authoritativeDueRank = visibleDueRank || dueRank;

  if (!queuePriority && storedSummary) {
    const fromSummary = extractQueuePriorityFromSummary(storedSummary);
    if (fromSummary) {
      queuePriority = fromSummary;
      prioritySource = "summary_text";
    }
  }

  if (!probabilityLabel && storedSummary) {
    probabilityLabel = extractProbabilityLabelFromSummary(storedSummary);
    if (probabilityLabel) prioritySource = prioritySource === "stored" ? "summary_text" : prioritySource;
  }

  if (authoritativeDueRank > 0) {
    if (queuePriority !== authoritativeDueRank) {
      queuePriority = authoritativeDueRank;
      prioritySource = storedPriority > 0 || prioritySource === "summary_text"
        ? "reconstructed"
        : "reconstructed";
    }
  } else if (!queuePriority) {
    queuePriority = cashRank || 0;
    if (queuePriority) prioritySource = "reconstructed";
  }

  if (!probabilityLabel || probabilityLabel === "N/A") {
    const fromMap = maps.probabilityByCode.get(code);
    if (fromMap?.label && fromMap.label !== "N/A") {
      probabilityLabel = fromMap.label;
      probabilityScore = Number(fromMap.score || 0);
      if (prioritySource === "stored") prioritySource = "reconstructed";
    }
  }

  if ((!probabilityLabel || probabilityLabel === "N/A") && maps.recordByCode.has(code)) {
    const priority = buildCollectionPriority({
      ...maps.recordByCode.get(code),
      today: String(options.reportDate || new Date().toISOString()).slice(0, 10),
    });
    if (priority?.label && priority.label !== "N/A") {
      probabilityLabel = priority.label;
      probabilityScore = Number(priority.score || 0);
      if (prioritySource === "stored") prioritySource = "reconstructed";
    }
  }

  const visitNumberForDay = Number(
    options.visitNumberForDay
    || visit?.visit_number_for_day
    || 0,
  );
  const queueRankGap = queuePriority > 0 && visitNumberForDay > 0
    ? queuePriority - visitNumberForDay
    : null;

  let queueCompliance = "unknown";
  if (queueRankGap !== null) {
    if (queueRankGap <= 0) queueCompliance = "on_priority";
    else if (queueRankGap <= 10) queueCompliance = "slightly_delayed";
    else queueCompliance = "off_priority";
  }

  return {
    queuePriority: queuePriority || null,
    probabilityScore: probabilityScore || null,
    probabilityLabel: probabilityLabel || null,
    prioritySource,
    visitNumberForDay: visitNumberForDay || null,
    queueRankGap,
    queueCompliance,
    dueQueueSize: maps.dueQueueSize || null,
  };
}
