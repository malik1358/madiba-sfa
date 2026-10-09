const THAMER_REPORT_ALIASES = new Set([
  "SM002",
  "THAMER",
  "THAMER SM002",
  "THAMER MOHAMMAD AHMED QASEM",
  "THAMER MOHAMMAD AHMED QASEM SM002",
]);

export const THAMER_REPORT_CODE = "SM002";
export const THAMER_REPORT_NAME = "Thamer";

function comparableIdentity(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeReportSalesmanCode(value) {
  const comparable = comparableIdentity(value);
  if (!comparable) return "";
  if (THAMER_REPORT_ALIASES.has(comparable)) return THAMER_REPORT_CODE;
  return String(value).trim().toUpperCase().replace(/\s+/g, " ");
}

export function reportSalesmanCodeAliases(value) {
  const code = normalizeReportSalesmanCode(value);
  if (code !== THAMER_REPORT_CODE) return code ? [code] : [];
  return [THAMER_REPORT_CODE, "THAMER", "THAMER MOHAMMAD AHMED QASEM"];
}

export function normalizeReportSalesmanName(value) {
  const comparable = comparableIdentity(value);
  if (!comparable) return "";
  return THAMER_REPORT_ALIASES.has(comparable) ? THAMER_REPORT_NAME : String(value).trim();
}

export function reportSalesmanLabel(row = {}) {
  const code = normalizeReportSalesmanCode(row.salesman_code);
  const name = normalizeReportSalesmanName(row.salesman_name);
  if (code === THAMER_REPORT_CODE || name === THAMER_REPORT_NAME) {
    return `${THAMER_REPORT_NAME} · ${THAMER_REPORT_CODE}`;
  }
  const rawCode = String(row.salesman_code || "").trim();
  const rawName = String(row.salesman_name || "").trim();
  if (rawName && rawCode && rawName.toUpperCase() !== rawCode.toUpperCase()) {
    return `${rawName} · ${rawCode}`;
  }
  return rawName || rawCode || "Unclassified";
}