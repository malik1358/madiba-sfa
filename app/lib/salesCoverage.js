/**
 * Sales coverage health.
 *
 * A sales upload replaces every row whose transaction date appears in the file
 * (`sql/merge_sales_batch_by_dates.sql`). A file that only holds one salesman's
 * invoices for a date therefore deletes every other salesman's invoices for that
 * whole date. These helpers detect that before it happens (upload guard) and
 * after it happened (coverage gap report).
 */

/** A date is only worth comparing when the neighbouring days have this many salesmen. */
export const SALES_COVERAGE_MIN_BASELINE = 3;
/** Neighbouring sales days inspected on each side when building the baseline. */
export const SALES_COVERAGE_WINDOW = 7;
/** A day is suspect when it keeps this share or less of the baseline salesmen. */
export const SALES_COVERAGE_DROP_RATIO = 0.5;
/** An upload is suspect when it keeps this share or less of the stored lines for a date. */
export const PARTIAL_UPLOAD_LINE_DROP_RATIO = 0.5;
/** Dates with fewer stored lines than this are too small to judge. */
export const PARTIAL_UPLOAD_MIN_LINES = 3;

function normalizeName(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeDate(value) {
  return String(value || "").trim().slice(0, 10);
}

function median(values) {
  const list = [...values].sort((left, right) => left - right);
  if (!list.length) return 0;
  const middle = Math.floor(list.length / 2);
  return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
}

/**
 * Accumulates per-date counts while streaming sales rows, so a caller that already
 * walks `sales_raw` does not need a second pass.
 */
export function createSalesCoverageCollector() {
  const byDate = new Map();

  return {
    add(row) {
      const date = normalizeDate(row?.transaction_date);
      if (!date) return;
      let day = byDate.get(date);
      if (!day) {
        day = { date, lines: 0, vouchers: new Set(), salesmen: new Set() };
        byDate.set(date, day);
      }
      day.lines += 1;
      const voucher = normalizeName(row?.voucher_number);
      if (voucher) day.vouchers.add(voucher);
      const salesman = normalizeName(row?.salesman_name || row?.salesman_code);
      if (salesman) day.salesmen.add(salesman);
    },
    days() {
      return [...byDate.values()]
        .map((day) => ({
          date: day.date,
          lines: day.lines,
          vouchers: day.vouchers.size,
          salesmen: day.salesmen.size,
          salesman_names: [...day.salesmen].sort(),
        }))
        .sort((left, right) => left.date.localeCompare(right.date));
    },
  };
}

export function summarizeSalesDays(rows = []) {
  const collector = createSalesCoverageCollector();
  (Array.isArray(rows) ? rows : []).forEach((row) => collector.add(row));
  return collector.days();
}

/**
 * Flags sales days that kept far fewer salesmen than the days around them, which is
 * what a partial-day upload leaves behind.
 *
 * @param {Array<{date: string, lines: number, vouchers: number, salesmen: number, salesman_names: string[]}>} days
 */
export function detectSalesCoverageGaps(days = [], options = {}) {
  const window = Number(options.window) || SALES_COVERAGE_WINDOW;
  const minBaseline = Number(options.minBaseline) || SALES_COVERAGE_MIN_BASELINE;
  const dropRatio = Number(options.dropRatio) || SALES_COVERAGE_DROP_RATIO;

  const list = (Array.isArray(days) ? days : [])
    .filter((day) => day && normalizeDate(day.date))
    .map((day) => ({
      date: normalizeDate(day.date),
      lines: Number(day.lines || 0),
      vouchers: Number(day.vouchers || 0),
      salesmen: Number(day.salesmen || 0),
      salesman_names: Array.isArray(day.salesman_names) ? day.salesman_names.map(normalizeName) : [],
    }))
    .sort((left, right) => left.date.localeCompare(right.date));

  const gaps = [];

  list.forEach((day, index) => {
    const neighbours = [
      ...list.slice(Math.max(0, index - window), index),
      ...list.slice(index + 1, index + 1 + window),
    ];
    if (!neighbours.length) return;

    const baseline = median(neighbours.map((entry) => entry.salesmen));
    if (baseline < minBaseline) return;
    if (day.salesmen > baseline * dropRatio) return;

    const present = new Set(day.salesman_names);
    const missing = [...new Set(neighbours.flatMap((entry) => entry.salesman_names))]
      .filter((name) => !present.has(name))
      .sort();

    gaps.push({
      date: day.date,
      lines: day.lines,
      vouchers: day.vouchers,
      salesmen: day.salesmen,
      expected_salesmen: baseline,
      salesman_names: [...day.salesman_names].sort(),
      missing_salesmen: missing,
    });
  });

  return gaps;
}

export function summarizeSalesCoverageGaps(gaps = []) {
  const list = Array.isArray(gaps) ? gaps : [];
  return {
    count: list.length,
    dates: list.map((gap) => gap.date),
    first_date: list.length ? list[0].date : "",
    last_date: list.length ? list[list.length - 1].date : "",
  };
}

export function isSalesCoverageGapDate(gaps, date) {
  const target = normalizeDate(date);
  if (!target) return false;
  return (Array.isArray(gaps) ? gaps : []).some((gap) => normalizeDate(gap?.date) === target);
}

/**
 * Compares the dates in an upload against what is already stored for those dates.
 * Returns the dates where the upload would delete salesmen or most of the lines.
 *
 * @param {object} input
 * @param {Array} input.incoming Per-date summary of the file being uploaded.
 * @param {Array} input.existing Per-date summary of the rows already in the active batch.
 */
export function detectPartialDateOverwrites({ incoming = [], existing = [] } = {}) {
  const lineRatio = PARTIAL_UPLOAD_LINE_DROP_RATIO;
  const incomingByDate = new Map();
  (Array.isArray(incoming) ? incoming : []).forEach((day) => {
    const date = normalizeDate(day?.date);
    if (date) incomingByDate.set(date, day);
  });

  const warnings = [];

  (Array.isArray(existing) ? existing : []).forEach((day) => {
    const date = normalizeDate(day?.date);
    if (!date) return;
    const next = incomingByDate.get(date);
    // Dates absent from the file are not touched by the merge.
    if (!next) return;

    const storedLines = Number(day.lines || 0);
    if (storedLines < PARTIAL_UPLOAD_MIN_LINES) return;

    const storedSalesmen = (Array.isArray(day.salesman_names) ? day.salesman_names : []).map(normalizeName);
    const nextSalesmen = new Set((Array.isArray(next.salesman_names) ? next.salesman_names : []).map(normalizeName));
    const missingSalesmen = [...new Set(storedSalesmen)].filter((name) => !nextSalesmen.has(name)).sort();

    const incomingLines = Number(next.lines || 0);
    const bigLineDrop = incomingLines < storedLines * lineRatio;

    if (!missingSalesmen.length && !bigLineDrop) return;

    warnings.push({
      date,
      stored_lines: storedLines,
      stored_salesmen: new Set(storedSalesmen).size,
      incoming_lines: incomingLines,
      incoming_salesmen: nextSalesmen.size,
      missing_salesmen: missingSalesmen,
    });
  });

  return warnings.sort((left, right) => left.date.localeCompare(right.date));
}

export function describePartialDateOverwrites(warnings = []) {
  const list = Array.isArray(warnings) ? warnings : [];
  if (!list.length) return "";
  const details = list
    .map((warning) => {
      const lost = warning.missing_salesmen.length
        ? ` and remove ${warning.missing_salesmen.length} salesman(s): ${warning.missing_salesmen.join(", ")}`
        : "";
      return `${warning.date}: replaces ${warning.stored_lines} stored line(s) with ${warning.incoming_lines}${lost}`;
    })
    .join(" | ");
  return `This file looks like a partial export. Uploading it deletes the existing sales of ${list.length} date(s). ${details}`;
}
