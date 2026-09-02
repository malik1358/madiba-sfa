import {
  customerHasStoredLocation,
  isValidLatitude,
  isValidLongitude,
} from "./customerLocationImport.js";
import { normalizeCustomerNameKey, resolveCustomerMasterExportFields } from "./customerCode.js";
import { normalizeCode } from "./outstanding.js";
import { extractMissingProspectsColumn, normalizeProspectSalesmanCode } from "./prospects.js";
import { applyCustomerSalesmanScopeFilter } from "./customerSalesmanAssignment.js";

const CUSTOMER_LOOKUP_FIELDS = "customer_code,customer_name,current_salesman_code,previous_salesman_code,latitude,longitude,city,area";

const PROSPECT_MATCH_STOP_WORDS = new Set([
  "FOR", "THE", "AND", "EST", "CO", "OF", "AL", "EL", "IN", "AT", "TO",
  "LLC", "LTD", "INC", "SA", "BR", "BRANCH",
]);

function normalizeCustomerCode(value) {
  return normalizeCode(value);
}

export function customerRecordMatchesCode(customer, customerCode) {
  const target = normalizeCustomerCode(customerCode);
  if (!target || !customer) return false;

  const storedCode = normalizeCustomerCode(customer.customer_code);
  if (storedCode) {
    if (storedCode === target) return true;
    if (storedCode.replace(/^0+/, "") === target.replace(/^0+/, "")) return true;
  }

  const display = resolveCustomerMasterExportFields(customer);
  const resolvedCode = normalizeCustomerCode(display.customer_code);
  if (!resolvedCode) return false;
  if (resolvedCode === target) return true;
  return resolvedCode.replace(/^0+/, "") === target.replace(/^0+/, "");
}

export function formatCustomerLookupPreview(customer) {
  const display = resolveCustomerMasterExportFields(customer);
  return {
    customer_code: display.customer_code || normalizeCustomerCode(customer?.customer_code),
    customer_name: display.customer_name || String(customer?.customer_name || "").trim(),
  };
}

export async function findCustomerByCode(admin, customerCode) {
  const code = normalizeCustomerCode(customerCode);
  if (!code) return null;

  const { data: exact, error: exactError } = await admin
    .from("customers")
    .select(CUSTOMER_LOOKUP_FIELDS)
    .eq("customer_code", code)
    .maybeSingle();
  if (exactError) throw exactError;
  if (exact && customerRecordMatchesCode(exact, code)) {
    return exact;
  }

  const { data: candidates, error } = await admin
    .from("customers")
    .select(CUSTOMER_LOOKUP_FIELDS)
    .or(`customer_code.ilike.*${code}*,customer_name.ilike.*${code}*`)
    .limit(50);
  if (error) throw error;

  return (candidates || []).find((row) => customerRecordMatchesCode(row, code)) || null;
}

export function buildProspectNameSearchTokens(value) {
  const normalized = normalizeCustomerNameKey(value);
  if (!normalized) return [];

  return normalized
    .split(" ")
    .filter((token) => token.length >= 3 && !PROSPECT_MATCH_STOP_WORDS.has(token));
}

export function scoreProspectCustomerNameMatch(prospect, customer) {
  const prospectName = String(
    prospect?.company_name || prospect?.shop_name || prospect?.customer_name || "",
  ).trim();
  const preview = formatCustomerLookupPreview(customer);
  const customerName = preview.customer_name || String(customer?.customer_name || "").trim();

  const prospectKey = normalizeCustomerNameKey(prospectName);
  const customerKey = normalizeCustomerNameKey(customerName);
  if (!prospectKey || !customerKey) return 0;

  let score = 0;

  if (prospectKey === customerKey) {
    score += 1000;
  } else if (customerKey.includes(prospectKey) || prospectKey.includes(customerKey)) {
    score += 700;
  }

  const prospectTokens = buildProspectNameSearchTokens(prospectName);
  const customerTokens = new Set(buildProspectNameSearchTokens(customerName));
  if (prospectTokens.length > 0) {
    const matched = prospectTokens.filter((token) => customerTokens.has(token));
    score += (matched.length / prospectTokens.length) * 500;
    if (matched.length >= 2 && matched.length === prospectTokens.length) {
      score += 200;
    }
  }

  const prospectCity = normalizeCustomerNameKey(prospect?.city);
  const customerCity = normalizeCustomerNameKey(customer?.city);
  const prospectArea = normalizeCustomerNameKey(prospect?.area);
  const customerArea = normalizeCustomerNameKey(customer?.area);

  if (prospectCity && customerCity && prospectCity === customerCity) score += 40;
  if (
    prospectArea
    && customerArea
    && (prospectArea === customerArea || customerArea.includes(prospectArea) || prospectArea.includes(customerArea))
  ) {
    score += 60;
  }

  const prospectSalesman = normalizeProspectSalesmanCode(prospect?.salesman_code);
  const customerSalesman = normalizeProspectSalesmanCode(customer?.current_salesman_code);
  if (prospectSalesman && customerSalesman && prospectSalesman === customerSalesman) {
    score += 30;
  }

  return score;
}

export function rankProspectLinkCustomerSuggestions(prospect, customers, limit = 8) {
  const maxResults = Number(limit) > 0 ? Number(limit) : 8;

  return (customers || [])
    .filter((customer) => !customerHasStoredLocation(customer))
    .map((customer) => {
      const preview = formatCustomerLookupPreview(customer);
      return {
        customer_code: preview.customer_code,
        customer_name: preview.customer_name,
        city: String(customer?.city || "").trim(),
        area: String(customer?.area || "").trim(),
        current_salesman_code: String(customer?.current_salesman_code || "").trim(),
        match_score: scoreProspectCustomerNameMatch(prospect, customer),
      };
    })
    .filter((row) => row.customer_code && row.match_score > 0)
    .sort((left, right) => {
      if (right.match_score !== left.match_score) {
        return right.match_score - left.match_score;
      }
      return String(left.customer_name || "").localeCompare(String(right.customer_name || ""));
    })
    .slice(0, maxResults);
}

async function loadCustomersWithoutGps(admin, scope, prospect, options = {}) {
  const useNameFilter = options.useNameFilter !== false;
  const prospectName = String(prospect?.company_name || prospect?.shop_name || prospect?.customer_name || "").trim();
  const tokens = buildProspectNameSearchTokens(prospectName);
  const salesmanCode = normalizeProspectSalesmanCode(prospect?.salesman_code);
  const scopedCodes = [...new Set(
    (scope?.visibleSalesmanCodes || [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  )];
  if (salesmanCode) scopedCodes.push(salesmanCode);

  let query = admin
    .from("customers")
    .select(CUSTOMER_LOOKUP_FIELDS)
    .or("latitude.is.null,longitude.is.null,latitude.eq.0,longitude.eq.0");

  if (!scope?.hasAllAccess && scopedCodes.length > 0) {
    query = applyCustomerSalesmanScopeFilter(query, scopedCodes);
  }

  if (useNameFilter && tokens.length > 0) {
    query = query.ilike("customer_name", `%${tokens[0]}%`);
  }

  const { data, error } = await query.limit(Number(options.limit) || 500);
  if (error) throw error;
  return data || [];
}

export async function findProspectLinkCustomerSuggestions(admin, prospect, scope, options = {}) {
  const limit = Number(options.limit) || 8;
  const prospectName = String(prospect?.company_name || prospect?.shop_name || prospect?.customer_name || "").trim();
  const tokens = buildProspectNameSearchTokens(prospectName);

  let customers = await loadCustomersWithoutGps(admin, scope, prospect, {
    useNameFilter: tokens.length > 0,
    limit: 500,
  });

  let suggestions = rankProspectLinkCustomerSuggestions(prospect, customers, limit);

  if (suggestions.length < Math.min(3, limit) && tokens.length > 0) {
    customers = await loadCustomersWithoutGps(admin, scope, prospect, {
      useNameFilter: false,
      limit: 800,
    });
    suggestions = rankProspectLinkCustomerSuggestions(prospect, customers, limit);
  }

  return suggestions;
}

export function prospectHasStoredLocation(prospect) {
  return isValidLatitude(prospect?.latitude) && isValidLongitude(prospect?.longitude);
}

export function buildCustomerGpsUpdateFromProspect(prospect, customer, options = {}) {
  if (!prospectHasStoredLocation(prospect)) {
    return null;
  }

  const copyGps = options.copyGps !== false;
  const overwriteCustomerGps = Boolean(options.overwriteCustomerGps);
  if (!copyGps) return null;
  if (!overwriteCustomerGps && customerHasStoredLocation(customer)) {
    return null;
  }

  const update = {
    latitude: Number(prospect.latitude),
    longitude: Number(prospect.longitude),
    updated_at: new Date().toISOString(),
  };

  if (prospect.city) update.city = prospect.city;
  if (prospect.area) update.area = prospect.area;

  return update;
}

async function updateProspectLinkRecord(admin, prospectId, payload) {
  const workingPayload = { ...payload };
  const maxAttempts = Object.keys(workingPayload).length + 2;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { data, error } = await admin
      .from("prospects")
      .update(workingPayload)
      .eq("id", prospectId)
      .select("id,status,converted_customer_code,salesman_code,company_name,latitude,longitude,city,area")
      .single();

    if (!error) return data;

    const missingColumn = extractMissingProspectsColumn(error.message);
    if (!missingColumn || !Object.prototype.hasOwnProperty.call(workingPayload, missingColumn)) {
      throw error;
    }

    delete workingPayload[missingColumn];
  }

  throw new Error("Unable to link prospect because the prospects table is missing required columns.");
}

export async function linkProspectToCustomer(admin, options = {}) {
  const prospectId = Number(options.prospectId);
  const customerCode = normalizeCustomerCode(options.customerCode);

  if (!Number.isFinite(prospectId) || prospectId <= 0) {
    throw new Error("Prospect id is required.");
  }
  if (!customerCode) {
    throw new Error("Customer code is required.");
  }

  const { data: prospect, error: prospectError } = await admin
    .from("prospects")
    .select("id,salesman_code,company_name,status,converted_customer_code,latitude,longitude,city,area")
    .eq("id", prospectId)
    .maybeSingle();

  if (prospectError) throw prospectError;
  if (!prospect?.id) {
    throw new Error("Prospect not found.");
  }

  if (prospect.converted_customer_code) {
    throw new Error(`Prospect is already linked to customer ${prospect.converted_customer_code}.`);
  }

  const customer = await findCustomerByCode(admin, customerCode);
  if (!customer) {
    throw new Error("Customer not found.");
  }

  const resolvedCustomer = formatCustomerLookupPreview(customer);
  const linkedCustomerCode = resolvedCustomer.customer_code || normalizeCustomerCode(customer.customer_code);

  const gpsUpdate = buildCustomerGpsUpdateFromProspect(prospect, customer, options);
  if (gpsUpdate) {
    const { error: gpsError } = await admin
      .from("customers")
      .update(gpsUpdate)
      .eq("customer_code", customer.customer_code);

    if (gpsError) throw gpsError;
  }

  const linkedProspect = await updateProspectLinkRecord(admin, prospectId, {
    status: "CONVERTED",
    converted_customer_code: linkedCustomerCode,
    updated_at: new Date().toISOString(),
  });

  return {
    prospect: linkedProspect,
    customer: {
      ...customer,
      customer_code: linkedCustomerCode,
      customer_name: resolvedCustomer.customer_name || customer.customer_name,
    },
    gpsCopied: Boolean(gpsUpdate),
    customerCode: linkedCustomerCode,
  };
}
