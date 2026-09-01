import {
  OUTSTANDING_DATASET_KEY,
  customerMatchesOutstandingCodeSet,
  resolveOutstandingCustomerOwnership,
} from "./outstanding.js";
import { buildSalesmanScopeMatchers } from "./mutualSalesmanGroups.js";
import { findCustomerByCode } from "./prospectCustomerLink.js";
import { customerSalesmanAssignmentMatchesScope } from "./salesHierarchy.js";
import { assignedSalesmanCodes } from "./customerSalesmanAssignment.js";

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function withSalesScopeMatchers(scope) {
  if (!scope) return { visibleSalesmanCodes: [], scopeMatchers: buildSalesmanScopeMatchers([]) };
  if (scope.scopeMatchers) return scope;
  return {
    ...scope,
    scopeMatchers: buildSalesmanScopeMatchers(scope.visibleMembers || []),
  };
}

function customerCodeCandidates(customerCode) {
  const normalizedInput = normalizeCode(customerCode);
  const leadingCode = normalizeCode(normalizedInput.match(/^([A-Z0-9]+)/)?.[1] || "");
  return [...new Set([normalizedInput, leadingCode].filter(Boolean))];
}

export async function customerHasHistoricalSalesAccess(admin, customerCode, scope) {
  const salesmanCodes = [...new Set((scope?.visibleSalesmanCodes || []).map(normalizeCode).filter(Boolean))];
  if (salesmanCodes.length === 0) return false;

  for (const codeCandidate of customerCodeCandidates(customerCode)) {
    const { data, error } = await admin
      .from("active_sales")
      .select("id")
      .eq("customer_code", codeCandidate)
      .in("salesman_code", salesmanCodes)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (data?.id) return true;
  }

  return false;
}

export async function customerHasOutstandingAccess(admin, customerCode, scope) {
  const matchedScope = withSalesScopeMatchers(scope);
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", OUTSTANDING_DATASET_KEY)
    .maybeSingle();

  if (error) throw error;

  try {
    const dataset = JSON.parse(data?.setting_value || "null");
    const ownership = resolveOutstandingCustomerOwnership(
      dataset,
      matchedScope.visibleSalesmanCodes,
      matchedScope.scopeMatchers,
    );
    return customerMatchesOutstandingCodeSet(customerCode, ownership.ownedCustomerCodes);
  } catch {
    return false;
  }
}

export async function ensureCustomerVisibleToScope(admin, customerCode, scope) {
  const matchedScope = withSalesScopeMatchers(scope);
  const normalizedCode = normalizeCode(customerCode);

  const { data: exactCustomer, error } = await admin
    .from("customers")
    .select("customer_code,customer_name,current_salesman_code,previous_salesman_code,latitude,longitude,city,area")
    .eq("customer_code", normalizedCode)
    .maybeSingle();

  if (error) throw error;

  const customer = exactCustomer || await findCustomerByCode(admin, customerCode);
  if (!customer) {
    throw new Error("Customer not found.");
  }

  if (matchedScope.hasAllAccess) return customer;

  if (assignedSalesmanCodes(customer).some((code) => customerSalesmanAssignmentMatchesScope(code, matchedScope))) {
    return customer;
  }

  const lookupCodes = [...new Set([
    customer.customer_code,
    customerCode,
    normalizedCode,
  ].filter(Boolean))];

  for (const lookupCode of lookupCodes) {
    if (await customerHasHistoricalSalesAccess(admin, lookupCode, matchedScope)) {
      return customer;
    }
    if (await customerHasOutstandingAccess(admin, lookupCode, matchedScope)) {
      return customer;
    }
  }

  throw new Error("You do not have access to this customer.");
}
