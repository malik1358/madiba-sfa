/**
 * Single customer → salesman ownership for BI.
 * Customer master `current_salesman_code` is the source of truth.
 */

export function normalizeCustomerCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function normalizeSalesmanCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * Build Map<customer_code, { salesman_code, salesman_name }> from master assignment.
 * Profile name is preferred when the code matches a salesman profile.
 */
export function buildCustomerSalesmanOwnershipMap(customers = [], salesmanProfiles = []) {
  const nameByCode = new Map();
  (salesmanProfiles || []).forEach((profile) => {
    const code = normalizeSalesmanCode(profile?.salesman_code);
    if (!code) return;
    const name = String(profile?.salesman_name || "").trim();
    if (!nameByCode.has(code) || (name && !nameByCode.get(code))) {
      nameByCode.set(code, name || code);
    }
  });

  const ownership = new Map();
  (customers || []).forEach((customer) => {
    const customerCode = normalizeCustomerCode(customer?.customer_code);
    const salesmanCode = normalizeSalesmanCode(customer?.current_salesman_code);
    if (!customerCode || !salesmanCode) return;
    ownership.set(customerCode, {
      salesman_code: salesmanCode,
      salesman_name: nameByCode.get(salesmanCode) || salesmanCode,
    });
  });
  return ownership;
}

/** Overwrite row salesman from master when known; otherwise keep sales-line values. */
export function applyCustomerSalesmanOwnership(row, ownershipMap) {
  if (!row || !(ownershipMap instanceof Map)) return row;
  const customerCode = normalizeCustomerCode(row.customer_code);
  if (!customerCode) return row;
  const owner = ownershipMap.get(customerCode);
  if (!owner) return row;
  return {
    ...row,
    salesman_code: owner.salesman_code,
    salesman_name: owner.salesman_name,
  };
}

export function applyCustomerSalesmanOwnershipToRows(rows = [], ownershipMap) {
  if (!(ownershipMap instanceof Map) || ownershipMap.size === 0) {
    return Array.isArray(rows) ? rows : [];
  }
  return (rows || []).map((row) => applyCustomerSalesmanOwnership(row, ownershipMap));
}
