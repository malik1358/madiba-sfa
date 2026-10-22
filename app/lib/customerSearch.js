import { withSalesScopeMatchers } from "./customerAccess.js";
import { customerMatchesSharedCodeSet } from "./customerShares.js";
import {
  applyCustomerSalesmanScopeFilter,
  customerAssignmentMatchesScope,
} from "./customerSalesmanAssignment.js";

const SEARCH_SELECT = "customer_code,customer_name,current_salesman_code,previous_salesman_code,latest_transaction_date,is_active";
const SEARCH_LIMIT = 20;

function normalizeSearchText(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function customerSearchOrFilter(query) {
  const needle = String(query || "").trim().replace(/[%_,()*"]/g, "");
  if (needle.length < 2) return "";
  const pattern = /[^A-Za-z0-9]/.test(needle) ? `"%${needle}%"` : `%${needle}%`;
  return `customer_code.ilike.${pattern},customer_name.ilike.${pattern}`;
}

export function customerMatchesSearchScope(customer, scope) {
  if (!customer?.customer_code) return false;
  const matched = withSalesScopeMatchers(scope);
  if (matched.hasAllAccess) return true;
  if (customerAssignmentMatchesScope(customer, matched.scopeMatchers, matched.visibleSalesmanCodes)) {
    return true;
  }
  return customerMatchesSharedCodeSet(customer.customer_code, matched.sharedCustomerCodes);
}

function searchScore(customer, needle) {
  const code = normalizeSearchText(customer?.customer_code);
  const name = normalizeSearchText(customer?.customer_name);
  if (!needle) return 0;
  if (code === needle) return 100;
  if (code.startsWith(needle)) return 80;
  if (code.includes(needle)) return 60;
  if (name.startsWith(needle)) return 40;
  if (name.includes(needle)) return 20;
  return 0;
}

export function rankCustomerSearchRows(rows, query) {
  const needle = normalizeSearchText(query);
  return [...(rows || [])].sort((left, right) => {
    const scoreDelta = searchScore(right, needle) - searchScore(left, needle);
    if (scoreDelta) return scoreDelta;
    return normalizeSearchText(left?.customer_code).localeCompare(normalizeSearchText(right?.customer_code));
  });
}

async function readCustomerRows(request) {
  const { data, error } = await request;
  if (error) throw error;
  return data || [];
}

export async function findCustomersForSettlementSearch(admin, scope, query) {
  const filter = customerSearchOrFilter(query);
  if (!filter || !admin) return [];

  const matched = withSalesScopeMatchers(scope);
  const salesmanCodes = [...new Set((matched.visibleSalesmanCodes || []).map((code) => String(code || "").trim()).filter(Boolean))];
  const sharedCodes = [...new Set((matched.sharedCustomerCodes || []).map((code) => normalizeSearchText(code)).filter(Boolean))];

  let primary = null;
  if (matched.hasAllAccess || salesmanCodes.length) {
    primary = admin.from("customers").select(SEARCH_SELECT).or(filter);
    if (!matched.hasAllAccess) {
      primary = applyCustomerSalesmanScopeFilter(primary, salesmanCodes);
    }
    primary = primary.order("customer_code").limit(SEARCH_LIMIT);
  } else if (!sharedCodes.length) {
    return [];
  }

  const primaryRows = primary ? await readCustomerRows(primary) : [];
  let sharedRows = [];
  if (!matched.hasAllAccess && sharedCodes.length) {
    sharedRows = await readCustomerRows(
      admin.from("customers").select(SEARCH_SELECT).or(filter).in("customer_code", sharedCodes).limit(SEARCH_LIMIT),
    );
  }

  const seen = new Set();
  const merged = [];
  for (const row of [...primaryRows, ...sharedRows]) {
    const code = normalizeSearchText(row?.customer_code);
    if (!code || seen.has(code) || !customerMatchesSearchScope(row, matched)) continue;
    seen.add(code);
    merged.push(row);
  }

  return rankCustomerSearchRows(merged, query).slice(0, SEARCH_LIMIT).map((row) => ({
    customer_code: row.customer_code,
    customer_name: row.customer_name || "",
    current_salesman_code: row.current_salesman_code || "",
    previous_salesman_code: row.previous_salesman_code || "",
    latest_transaction_date: row.latest_transaction_date || "",
  }));
}
