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
