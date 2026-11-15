import {
  OUTSTANDING_DATASET_KEY,
  customerMatchesOutstandingCodeSet,
  findOutstandingForCustomer,
  resolveOutstandingCustomerOwnership,
} from "./outstanding.js";
import { resolveCustomerMasterExportFields } from "./customerCode.js";
import { buildSalesmanScopeMatchers } from "./mutualSalesmanGroups.js";

/** Shape `ensureCustomerVisibleToScope` needs from payment-collections `getSalesScope`. */
export function collectionCustomerAccessScope(scope) {
  const scopeProfiles = Array.isArray(scope?.scopeProfiles) ? scope.scopeProfiles : [];
  return {
    hasAllAccess: Boolean(scope?.hasAllAccess),
    visibleSalesmanCodes: scope?.visibleSalesmanCodes || [],
    sharedCustomerCodes: scope?.sharedCustomerCodes || [],
    visibleMembers: scopeProfiles,
    scopeMatchers: buildSalesmanScopeMatchers(scopeProfiles),
  };
}
import { findCustomerByCode } from "./prospectCustomerLink.js";
import {
  canAccessProspectSalesmanCode,
  findProspectForCustomerCode,
  visibleCustomerFromProspect,
} from "./prospects.js";
import { customerSalesmanAssignmentMatchesScope } from "./salesHierarchy.js";
import { assignedSalesmanCodes } from "./customerSalesmanAssignment.js";
import { customerMatchesSharedCodeSet } from "./customerShares.js";

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

async function readOutstandingDataset(admin) {
  const { data, error } = await admin
    .from("system_settings")
    .select("setting_value")
    .eq("setting_key", OUTSTANDING_DATASET_KEY)
    .maybeSingle();

  if (error) throw error;

  try {
    return JSON.parse(data?.setting_value || "null");
  } catch {
    return null;
  }
}

function outstandingDatasetGrantsAccess(dataset, customerCode, matchedScope) {
  if (!dataset) return false;

  try {
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

export async function customerHasOutstandingAccess(admin, customerCode, scope) {
  const matchedScope = withSalesScopeMatchers(scope);
  const dataset = await readOutstandingDataset(admin);
  return outstandingDatasetGrantsAccess(dataset, customerCode, matchedScope);
}

/**
 * Outstanding uploads often list customers that are missing from the customers
 * table (new Tally parties with no sales yet, so the sales_raw backfill cannot
 * create them). Backfill a master row for them so phone and GPS updates during
 * collection visits can persist instead of failing with "Customer not found."
 * and re-prompting the salesman on every save attempt.
 */
async function ensureOutstandingOnlyCustomerVisible(admin, customerCode, matchedScope) {
  let dataset = null;
  try {
    dataset = await readOutstandingDataset(admin);
  } catch {
    return null;
  }
  if (!dataset) return null;

  const matched = findOutstandingForCustomer(dataset, customerCode, "");
  if (!matched) return null;

  if (!matchedScope.hasAllAccess && !outstandingDatasetGrantsAccess(dataset, customerCode, matchedScope)) {
    return null;
  }

  const display = resolveCustomerMasterExportFields({
    customer_code: matched.customer_code || customerCode,
    customer_name: matched.customer_name || "",
  });
  const payload = {
    customer_code: display.customer_code || normalizeCode(customerCode),
    customer_name: display.customer_name
      || String(matched.customer_name || "").trim()
      || normalizeCode(customerCode),
    is_active: true,
  };
  if (!payload.customer_code) return null;

  const { error: upsertError } = await admin
    .from("customers")
    .upsert(payload, { onConflict: "customer_code" });
  if (upsertError) return null;

  const created = await findCustomerByCode(admin, payload.customer_code);
  return created || payload;
}

async function ensureProspectVisibleToScope(admin, customerCode, scope) {
  const prospect = await findProspectForCustomerCode(admin, customerCode);
  const customer = visibleCustomerFromProspect(prospect, customerCode);
  if (!customer) {
    throw new Error("Customer not found.");
  }

  if (!canAccessProspectSalesmanCode(scope, prospect.salesman_code)) {
    throw new Error("You do not have access to this customer.");
  }

  return customer;
}

export async function ensureCustomerVisibleToScope(admin, customerCode, scope) {
  const matchedScope = withSalesScopeMatchers(scope);
  const normalizedCode = normalizeCode(customerCode);

  const customer = await findCustomerByCode(admin, normalizedCode || customerCode);
  if (!customer) {
    try {
      return await ensureProspectVisibleToScope(admin, normalizedCode || customerCode, matchedScope);
    } catch (prospectError) {
      const outstandingCustomer = await ensureOutstandingOnlyCustomerVisible(
        admin,
        normalizedCode || customerCode,
        matchedScope,
      );
      if (outstandingCustomer) return outstandingCustomer;
      throw prospectError;
    }
  }

  if (matchedScope.hasAllAccess) return customer;

  if (assignedSalesmanCodes(customer).some((code) => customerSalesmanAssignmentMatchesScope(code, matchedScope))) {
    return customer;
  }

  if (customerMatchesSharedCodeSet(customer.customer_code, matchedScope.sharedCustomerCodes)) {
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
