import { getKsaDateTimeParts, KSA_TIMEZONE } from "./workdayActivity.js";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeCityKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^al[\s-]+/, "")
    .replace(/\s+/g, " ");
}

function displayCity(value) {
  const key = normalizeCityKey(value);
  if (!key) return "";
  return key
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function isSuccessfulCollection(visit) {
  const outcome = String(visit?.visit_outcome || visit?.visitOutcome || "").trim().toUpperCase();
  const amount = Number(visit?.amount_received ?? visit?.amountReceived ?? 0);
  return outcome === "FUNDS_RECEIVED" || amount > 0;
}

function visitTimestamp(visit) {
  const ts = Date.parse(String(visit?.saved_at || visit?.savedAt || ""));
  return Number.isFinite(ts) ? ts : 0;
}

export function formatNarrativeTime(value) {
  const ts = typeof value === "number" ? value : Date.parse(String(value || ""));
  if (!Number.isFinite(ts) || ts <= 0) return "";

  const { hour, minute } = getKsaDateTimeParts(new Date(ts));
  const hour12 = hour % 12 || 12;
  const ampm = hour < 12 ? "am" : "pm";
  if (minute === 0) return `${hour12} ${ampm}`;
  return `${hour12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

function resolveVisitLocation(visit, customerLocationByCode) {
  const code = normalizeCode(visit?.customer_code || visit?.customerCode);
  const location = customerLocationByCode?.get?.(code)
    || customerLocationByCode?.[code]
    || {};

  const city = String(location.city || "").trim();
  const area = String(location.area || "").trim();
  const street = String(location.street || "").trim();
  const cityKey = normalizeCityKey(city || area || street);

  return {
    cityKey,
    city: displayCity(city || area || street),
  };
}

function computeStats(visits) {
  const customerCodes = new Set();
  let successfulCollections = 0;
  let totalCollected = 0;

  (visits || []).forEach((visit) => {
    const code = normalizeCode(visit?.customer_code || visit?.customerCode);
    if (code) customerCodes.add(code);
    if (isSuccessfulCollection(visit)) {
      successfulCollections += 1;
      totalCollected += Number(visit?.amount_received ?? visit?.amountReceived ?? 0);
    }
  });

  return {
    uniqueCustomers: customerCodes.size,
    totalVisits: (visits || []).length,
    successfulCollections,
    totalCollected,
  };
}

function describeCollections(visits, labels) {
  const successful = (visits || []).filter(isSuccessfulCollection);
  const collectedCount = successful.length;
  const amount = successful.reduce(
    (sum, visit) => sum + Number(visit?.amount_received ?? visit?.amountReceived ?? 0),
    0,
  );

  if (!collectedCount) {
    return labels.withoutCollection;
  }

  if (collectedCount === 1) {
    return labels.withCollectionSingle.replace("{amount}", formatMoney(amount));
  }

  return labels.withCollectionMultiple
    .replace("{count}", String(collectedCount))
    .replace("{amount}", formatMoney(amount));
}

function getKsaHour(value) {
  const ts = typeof value === "number" ? value : Date.parse(String(value || ""));
  if (!Number.isFinite(ts) || ts <= 0) return 0;
  return getKsaDateTimeParts(new Date(ts)).hour;
}

function getVisitTimeWindow(value) {
  const hour = getKsaHour(value);
  if (hour < 14) return "before_afternoon";
  if (hour < 20) return "afternoon";
  return "evening";
}

function splitVisitsByTimeWindow(visits) {
  if ((visits || []).length <= 1) return [visits || []];

  const groups = [];
  let current = [];
  let currentWindow = "";

  (visits || []).forEach((visit) => {
    const window = getVisitTimeWindow(visit.saved_at || visit.savedAt);
    if (current.length && window !== currentWindow) {
      groups.push(current);
      current = [];
    }
    currentWindow = window;
    current.push(visit);
  });

  if (current.length) groups.push(current);
  return groups;
}

function buildLocationSegments(visits, customerLocationByCode) {
  const sorted = [...(visits || [])].sort((left, right) => visitTimestamp(left) - visitTimestamp(right));
  const citySegments = [];

  sorted.forEach((visit) => {
    const ts = visitTimestamp(visit);
    const location = resolveVisitLocation(visit, customerLocationByCode);
    const last = citySegments[citySegments.length - 1];

    if (!last || last.cityKey !== location.cityKey) {
      citySegments.push({
        cityKey: location.cityKey,
        city: location.city,
        visits: [visit],
        startTs: ts,
        endTs: ts,
      });
      return;
    }

    last.visits.push(visit);
    last.endTs = ts;
  });

  const segments = [];
  citySegments.forEach((citySegment) => {
    splitVisitsByTimeWindow(citySegment.visits).forEach((visitGroup) => {
      if (!visitGroup.length) return;
      segments.push({
        cityKey: citySegment.cityKey,
        city: citySegment.city,
        visits: visitGroup,
        startTs: visitTimestamp(visitGroup[0]),
        endTs: visitTimestamp(visitGroup[visitGroup.length - 1]),
      });
    });
  });

  return segments;
}

function isReturnToCity(segmentIndex, segments) {
  if (segmentIndex <= 0) return false;
  const cityKey = segments[segmentIndex].cityKey;
  const previous = segments[segmentIndex - 1];
  if (!cityKey || previous.cityKey === cityKey) return false;
  return segments.slice(0, segmentIndex - 1).some((segment) => segment.cityKey === cityKey);
}

export const COLLECTION_DAY_SUMMARY_LABELS_AR = {
  visitedCustomers: "تمت زيارة {count} عميل.",
  lunchBreak: "استراحة غداء من {from} إلى {to}.",
  startedTill: "بدأ عند {start} وحتى {end} زار {count} عميل{collections}",
  betweenTill: "بين {start} إلى {end} زار {count} عميل{collections}",
  inCityTill: "في {city} زار {count} عميل حتى {end}{collections}",
  cameBack: "عاد إلى {city} وزار {count} عميل{collections}",
  wentTo: " ثم ذهب إلى {city}",
  withoutCollection: " بدون أي تحصيل",
  withCollectionSingle: " مع تحصيل من عميل واحد بمبلغ {amount} ريال",
  withCollectionMultiple: " مع تحصيل من {count} عملاء بإجمالي {amount} ريال",
  collectedAmount: " وتم تحصيل {amount} ريال",
  totalFooter: "إجمالي {visits} زيارة، {collections} تحصيل ناجح.",
  noVisits: "لا توجد زيارات تحصيل مسجلة في هذا اليوم.",
  aggregateHeader: "{count} مستخدم نشط: {visits} زيارة، {collections} تحصيل ناجح، {amount} ريال.",
};

export const COLLECTION_DAY_SUMMARY_LABELS = {
  visitedCustomers: "Visited {count} customer(s).",
  lunchBreak: "Lunch break from {from} to {to}.",
  startedTill: "Started at {start} and till {end} visited {count} customer(s){collections}",
  betweenTill: "Between {start} to {end} visited {count} customer(s){collections}",
  inCityTill: "In {city} visited {count} customer(s) till {end}{collections}",
  cameBack: "Came back to {city} and visited {count} customer(s){collections}",
  wentTo: " and then went to {city}",
  withoutCollection: " without any collection",
  withCollectionSingle: " with collection only from 1 customer of {amount} SAR",
  withCollectionMultiple: " with collection from {count} customers totalling {amount} SAR",
  collectedAmount: " and collected {amount} SAR",
  totalFooter: "Total {visits} visit(s), {collections} successful collection(s).",
  noVisits: "No collection visits recorded for this day.",
  aggregateHeader: "{count} active user(s): {visits} visit(s), {collections} successful collection(s), {amount} SAR collected.",
};

function fill(template, values) {
  return Object.entries(values).reduce(
    (line, [key, value]) => line.replaceAll(`{${key}}`, String(value ?? "")),
    template,
  );
}

function describeSegment(segment, segmentIndex, segments, labels) {
  const count = segment.visits.length;
  const start = formatNarrativeTime(segment.startTs);
  const end = formatNarrativeTime(segment.endTs);
  const collections = describeCollections(segment.visits, labels);
  const next = segments[segmentIndex + 1];
  const transition = next && next.cityKey !== segment.cityKey && next.city
    ? fill(labels.wentTo, { city: next.city })
    : "";

  let line = "";
  if (segmentIndex === 0) {
    line = fill(labels.startedTill, { start, end, count, collections: collections + transition });
  } else if (isReturnToCity(segmentIndex, segments)) {
    const successful = segment.visits.filter(isSuccessfulCollection);
    const collectionText = successful.length === 1 && count === 1
      ? fill(labels.collectedAmount, {
        amount: formatMoney(successful[0]?.amount_received ?? successful[0]?.amountReceived ?? 0),
      })
      : collections;
    line = fill(labels.cameBack, { city: segment.city, count, collections: collectionText });
  } else if (segments[segmentIndex - 1]?.cityKey === segment.cityKey) {
    line = fill(labels.betweenTill, { start, end, count, collections: collections + transition });
  } else {
    line = fill(labels.inCityTill, { city: segment.city, end, count, collections: collections + transition });
  }

  if (!line.endsWith(".")) line += ".";
  return line;
}

export function buildCollectionDaySummary(visits, customerLocationByCode = {}, lunchEvents = null, labels = COLLECTION_DAY_SUMMARY_LABELS) {
  const sorted = [...(visits || [])].sort((left, right) => visitTimestamp(left) - visitTimestamp(right));
  const stats = computeStats(sorted);

  if (!sorted.length) {
    return {
      lines: [labels.noVisits],
      stats,
    };
  }

  const lines = [
    fill(labels.visitedCustomers, { count: stats.uniqueCustomers }),
  ];

  if (lunchEvents?.lunchOutAt && lunchEvents?.lunchInAt) {
    lines.push(fill(labels.lunchBreak, {
      from: formatNarrativeTime(lunchEvents.lunchOutAt),
      to: formatNarrativeTime(lunchEvents.lunchInAt),
    }));
  }

  const segments = buildLocationSegments(sorted, customerLocationByCode);
  segments.forEach((segment, index) => {
    lines.push(describeSegment(segment, index, segments, labels));
  });

  lines.push(fill(labels.totalFooter, {
    visits: stats.totalVisits,
    collections: stats.successfulCollections,
  }));

  return { lines, stats, segments };
}

export function buildAggregateCollectionDaySummary(collectorSummaries, labels = COLLECTION_DAY_SUMMARY_LABELS) {
  const summaries = (collectorSummaries || []).filter((entry) => entry?.stats?.totalVisits > 0);
  if (!summaries.length) {
    return {
      lines: [labels.noVisits],
      stats: {
        uniqueCustomers: 0,
        totalVisits: 0,
        successfulCollections: 0,
        totalCollected: 0,
        collectorCount: 0,
      },
    };
  }

  const stats = summaries.reduce((acc, entry) => {
    acc.totalVisits += Number(entry.stats?.totalVisits || 0);
    acc.successfulCollections += Number(entry.stats?.successfulCollections || 0);
    acc.totalCollected += Number(entry.stats?.totalCollected || 0);
    return acc;
  }, {
    uniqueCustomers: 0,
    totalVisits: 0,
    successfulCollections: 0,
    totalCollected: 0,
    collectorCount: summaries.length,
  });

  const lines = [
    fill(labels.aggregateHeader || "{count} active user(s): {visits} visit(s), {collections} successful collection(s), {amount} SAR collected.", {
      count: stats.collectorCount,
      visits: stats.totalVisits,
      collections: stats.successfulCollections,
      amount: formatMoney(stats.totalCollected),
    }),
  ];

  summaries.forEach((entry) => {
    const openerLine = labels === COLLECTION_DAY_SUMMARY_LABELS_AR
      ? entry.daySummary?.linesAr?.[0]
      : entry.daySummary?.lines?.[0];
    if (entry.collectorName && openerLine) {
      lines.push(`${entry.collectorName}: ${openerLine}`);
    }
  });

  return { lines, stats };
}

export function formatDaySummaryTimestamp(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("en-GB", {
    timeZone: KSA_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}
