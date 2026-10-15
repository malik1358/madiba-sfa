import { customerAccountCodesMatch, customerCodeCandidates } from "./outstanding.js";
import { isMissingSchemaColumn } from "./performanceKpis.js";
import { normalizeSalesmanCode, normalizeSalesmanName } from "./mutualSalesmanGroups.js";

function normalizeCustomerCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function isMissingRelation(error) {
  const message = String(error?.message || error?.details || error?.hint || "").toLowerCase();
  const code = String(error?.code || "").toUpperCase();
  return code === "42P01"
    || code === "PGRST205"
    || (message.includes("relation") && message.includes("does not exist"))
    || (message.includes("could not find") && message.includes("customer_shares"));
}

export function customerMatchesSharedCodeSet(customerCode, sharedCodes) {
  const list = sharedCodes instanceof Set
    ? [...sharedCodes]
    : [...(sharedCodes || [])].map(normalizeCustomerCode).filter(Boolean);
  if (list.length === 0) return false;

  const candidates = customerCodeCandidates(customerCode).map(normalizeCustomerCode).filter(Boolean);
  if (candidates.some((code) => list.includes(code))) return true;

  return list.some((shared) => customerAccountCodesMatch(customerCode, shared));
}

export async function loadActiveCustomerShareRows(admin) {
  if (!admin) return null;

  const { data, error } = await admin
    .from("customer_shares")
    .select("id,customer_code,viewer_salesman_id,is_active,created_at,updated_at,created_by")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingSchemaColumn(error) || isMissingRelation(error)) return null;
    throw error;
  }

  return data || [];
}

export async function loadAllCustomerShareRows(admin) {
  if (!admin) return null;

  const { data, error } = await admin
    .from("customer_shares")
    .select("id,customer_code,viewer_salesman_id,is_active,created_at,updated_at,created_by")
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingSchemaColumn(error) || isMissingRelation(error)) return null;
    throw error;
  }

  return data || [];
}

export async function loadSharedCustomerCodesForViewer(admin, viewerProfileId) {
  const viewerId = String(viewerProfileId || "").trim();
  if (!admin || !viewerId) return [];

  const { data, error } = await admin
    .from("customer_shares")
    .select("customer_code")
    .eq("viewer_salesman_id", viewerId)
    .eq("is_active", true);

  if (error) {
    if (isMissingSchemaColumn(error) || isMissingRelation(error)) return [];
    throw error;
  }

  return [...new Set(
    (data || [])
      .map((row) => normalizeCustomerCode(row.customer_code))
      .filter(Boolean),
  )];
}

export function salesmanLabel(profile) {
  const name = normalizeSalesmanName(profile?.salesman_name);
  const code = normalizeSalesmanCode(profile?.salesman_code);
  if (name && code && name !== code) return `${name} (${code})`;
  return name || code || "Unknown";
}

export { normalizeCustomerCode };
