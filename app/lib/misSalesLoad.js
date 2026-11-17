/** Time budget for paging active_sales during MIS prepare (then fall back to BI cube). */
export const MIS_ACTIVE_SALES_SCAN_MS = 50_000;

/**
 * @param {{ timedOut?: boolean, errored?: boolean, rowCount?: number }} attempt
 * @returns {boolean}
 */
export function misSalesShouldUseCube(attempt) {
  if (attempt?.timedOut) return true;
  if (attempt?.errored) return true;
  const count = Number(attempt?.rowCount ?? 0);
  if (!Number.isFinite(count) || count <= 0) return true;
  return false;
}
