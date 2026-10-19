import { isPlaceholderSalesmanValue } from "./outstanding.js";
import { salesmanValueMatchesScope } from "./mutualSalesmanGroups.js";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function assignedSalesmanCodes(customer = {}) {
  return [...new Set(
    [customer?.current_salesman_code, customer?.previous_salesman_code]
      .map((value) => String(value || "").trim())
      .filter((value) => value && !isPlaceholderSalesmanValue(value)),
  )];
}

export function customerHasActiveSalesmanTransfer(customer = {}) {
  return Boolean(String(customer?.previous_salesman_code || "").trim())
    && !isPlaceholderSalesmanValue(customer.previous_salesman_code);
}

export function customerAssignmentMatchesScope(customer, scopeMatchers, scopeCodeSet) {
  const codes = assignedSalesmanCodes(customer);
  if (codes.length === 0) return false;

  return codes.some((code) => (
    (scopeMatchers && salesmanValueMatchesScope(code, scopeMatchers))
    || (scopeCodeSet instanceof Set && scopeCodeSet.has(normalizeCode(code)))
    || (Array.isArray(scopeCodeSet) && scopeCodeSet.some((item) => normalizeCode(item) === normalizeCode(code)))
  ));
}

export function applyCustomerSalesmanScopeFilter(query, scopedCodes) {
  const codes = [...new Set((scopedCodes || []).map((value) => String(value || "").trim()).filter(Boolean))];
  if (codes.length === 0) return query;
  const quoted = codes.map((code) => `"${code.replace(/"/g, "\\\"")}"`).join(",");
  return query.or(`current_salesman_code.in.(${quoted}),previous_salesman_code.in.(${quoted})`);
}
