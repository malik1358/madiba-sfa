import { readCacheEntry, writeCacheEntry } from "./localDataStore.js";
import {
  buildOfflineProspectCustomerCode,
  extractOfflineIdFromRemarks,
  resolveProspectCustomerCode,
} from "./prospects.js";

const LOCAL_PROSPECTS_KEY = "prospects:local:v1";
const LOCAL_PROSPECTS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function prospectToOrderCustomer(prospect) {
  const offlineId = String(prospect?.offline_id || extractOfflineIdFromRemarks(prospect?.remarks) || "").trim();
  const customerCode = resolveProspectCustomerCode(prospect) || buildOfflineProspectCustomerCode(offlineId);
  return {
    customer_code: customerCode,
    customer_name: String(prospect?.company_name || prospect?.customer_name || prospect?.shop_name || "").trim(),
    current_salesman_code: String(prospect?.salesman_code || "").trim(),
    salesman_code: String(prospect?.salesman_code || "").trim(),
    city: prospect?.city || "",
    area: prospect?.area || "",
    latitude: prospect?.latitude,
    longitude: prospect?.longitude,
    is_prospect: true,
    offline_id: offlineId,
  };
}

export async function readLocalProspects() {
  const entry = await readCacheEntry(LOCAL_PROSPECTS_KEY);
  return Array.isArray(entry?.value) ? entry.value : [];
}

export async function writeLocalProspects(prospects) {
  return writeCacheEntry(LOCAL_PROSPECTS_KEY, prospects || [], { ttlMs: LOCAL_PROSPECTS_TTL_MS });
}

export async function upsertLocalProspect(prospect) {
  if (!prospect) return [];
  const current = await readLocalProspects();
  const offlineId = String(prospect.offline_id || "").trim();
  const next = [
    prospect,
    ...current.filter((row) => String(row.offline_id || "") !== offlineId && Number(row.id) !== Number(prospect.id)),
  ];
  await writeLocalProspects(next);
  return next;
}

export async function listLocalProspectsAsCustomers() {
  const prospects = await readLocalProspects();
  return prospects.map(prospectToOrderCustomer).filter((row) => row.customer_code && row.customer_name);
}
