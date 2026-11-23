/**
 * Customer master book owner is assigned in SFA (transfer, or the first
 * invoice when the customer is new). A later Tally "Sales Person" on one
 * voucher must not replace that owner, and an older voucher must not roll
 * the last-sale date backward.
 */

export function normalizeBookSalesman(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function laterTransactionDate(existingDate, incomingDate) {
  const existing = String(existingDate || "").slice(0, 10);
  const incoming = String(incomingDate || "").slice(0, 10);
  if (!existing) return incoming || null;
  if (!incoming) return existing;
  return incoming > existing ? incoming : existing;
}

/**
 * Prefer the newest transaction_date, then the highest source_row_number on a tie.
 * Used when collapsing many sales lines into one customer-master upsert row.
 */
export function pickLatestCustomerRow(existing, candidate) {
  if (!existing) return candidate;
  if (!candidate) return existing;

  const existingDate = String(existing.transaction_date || "");
  const candidateDate = String(candidate.transaction_date || "");

  if (candidateDate && (!existingDate || candidateDate > existingDate)) {
    return candidate;
  }

  if (
    candidateDate
    && existingDate
    && candidateDate === existingDate
    && Number(candidate.source_row_number || 0) > Number(existing.source_row_number || 0)
  ) {
    return candidate;
  }

  return existing;
}

/**
 * Build the per-customer latest sales row map from in-memory import rows.
 * Prefer this over re-querying sales_raw: PostgREST silently truncates large
 * `.in(customer_code, …)` result sets, which left new parties (e.g. 1704)
 * out of the customer master after a successful sales merge.
 */
export function buildLatestCustomerMapFromRows(rows) {
  const latestCustomer = new Map();

  for (const row of rows || []) {
    const customerCode = String(row?.customer_code || "").trim();
    if (!customerCode) continue;
    latestCustomer.set(
      customerCode,
      pickLatestCustomerRow(latestCustomer.get(customerCode), row),
    );
  }

  return latestCustomer;
}

/**
 * @param {object} input
 * @param {string} [input.existingSalesman] current book owner already stored
 * @param {string} [input.invoiceSalesman] salesman on the imported voucher
 * @param {string} [input.lockedSalesman] owner kept by an explicit transfer
 */
export function resolveImportedBookOwner({
  existingSalesman = "",
  invoiceSalesman = "",
  lockedSalesman = "",
} = {}) {
  const locked = normalizeBookSalesman(lockedSalesman);
  if (locked) return locked;
  const existing = normalizeBookSalesman(existingSalesman);
  if (existing) return existing;
  return normalizeBookSalesman(invoiceSalesman);
}
