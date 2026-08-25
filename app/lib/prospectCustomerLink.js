import {
  customerHasStoredLocation,
  isValidLatitude,
  isValidLongitude,
} from "./customerLocationImport.js";
import { resolveCustomerMasterExportFields } from "./customerCode.js";
import { normalizeCode } from "./outstanding.js";
import { extractMissingProspectsColumn } from "./prospects.js";

const CUSTOMER_LOOKUP_FIELDS = "customer_code,customer_name,current_salesman_code,latitude,longitude,city,area";

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
    .or(`customer_code.ilike.%${code}%,customer_name.ilike.${code}%`)
    .limit(50);
  if (error) throw error;

  return (candidates || []).find((row) => customerRecordMatchesCode(row, code)) || null;
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
