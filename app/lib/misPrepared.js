export const MIS_PREPARED_KEY = "mis_report_prepared_v1";
export const MIS_PREPARED_VERSION = 1;

export function serializePreparedMis({
  asOfDate = "",
  builtAt = "",
  batchId = "",
  report = null,
} = {}) {
  return {
    version: MIS_PREPARED_VERSION,
    asOfDate: String(asOfDate || "").slice(0, 10),
    builtAt: String(builtAt || new Date().toISOString()),
    batchId: String(batchId || ""),
    report,
  };
}

export function deserializePreparedMis(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (Number(payload.version || 0) !== MIS_PREPARED_VERSION) return null;
  if (!payload.report || typeof payload.report !== "object") return null;
  const asOfDate = String(payload.asOfDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) return null;
  return {
    version: MIS_PREPARED_VERSION,
    asOfDate,
    builtAt: String(payload.builtAt || ""),
    batchId: String(payload.batchId || ""),
    report: payload.report,
  };
}

/** Last day of the previous KSA calendar month (default month-end pack). */
export function defaultMisAsOfDate(todayYmd) {
  const today = String(todayYmd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return "";
  const [year, month] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
}
