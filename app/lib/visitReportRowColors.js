const ROW_BACKGROUNDS = {
  login: "#dcfce7",
  logout: "#e0e7ff",
  lunch: "#ffedd5",
  visit: "#dbeafe",
  order: "#f3e8ff",
  collection: "#ccfbf1",
  idle: "#fef9c3",
  "unlogged-idle": "#fecaca",
};

function entryTimestamp(entry) {
  const ts = Date.parse(String(entry?.savedAt || entry?.saved_at || ""));
  return Number.isFinite(ts) ? ts : 0;
}

export function isEntryInUnloggedIdle(entry, idleGaps = []) {
  const ts = entryTimestamp(entry);
  if (!ts) return false;
  return (idleGaps || []).some((gap) => {
    const from = Date.parse(String(gap?.fromAt || ""));
    const to = Date.parse(String(gap?.toAt || ""));
    return Number.isFinite(from) && Number.isFinite(to) && ts >= from && ts <= to;
  });
}

export function visitReportRowTone(entry, idleGaps = []) {
  const type = String(entry?.transactionType || entry?.transaction_type || "").trim().toUpperCase();
  if (type === "MORNING_ATTENDANCE") return "login";
  if (type === "END_OF_DAY") return "logout";
  if (type === "LUNCH_BREAK_OUT" || type === "LUNCH_BREAK_IN") return "lunch";
  if (type === "VISIT_REPORT") return "visit";
  if (type === "COLLECTION_VISIT") return "collection";
  if (type.startsWith("ORDER_")) return "order";
  if (type === "GPS_PING") {
    return isEntryInUnloggedIdle(entry, idleGaps) ? "unlogged-idle" : "idle";
  }
  return "default";
}

export function visitReportRowClassName(entry, idleGaps = []) {
  const tone = visitReportRowTone(entry, idleGaps);
  const far = entry?.isFarFromCustomer ? " visitReportRow-far" : "";
  return `visitReportRow visitReportRow-${tone}${far}`;
}

export function visitReportRowBackground(entry, idleGaps = []) {
  return ROW_BACKGROUNDS[visitReportRowTone(entry, idleGaps)] || "";
}

export const VISIT_REPORT_ROW_LEGEND = [
  { tone: "login", label: "Login", background: ROW_BACKGROUNDS.login },
  { tone: "lunch", label: "Lunch", background: ROW_BACKGROUNDS.lunch },
  { tone: "visit", label: "Visit report", background: ROW_BACKGROUNDS.visit },
  { tone: "order", label: "Order", background: ROW_BACKGROUNDS.order },
  { tone: "collection", label: "Collection", background: ROW_BACKGROUNDS.collection },
  { tone: "idle", label: "Idle GPS", background: ROW_BACKGROUNDS.idle },
  { tone: "unlogged-idle", label: "Unlogged idle", background: ROW_BACKGROUNDS["unlogged-idle"] },
  { tone: "logout", label: "Logout", background: ROW_BACKGROUNDS.logout },
];
