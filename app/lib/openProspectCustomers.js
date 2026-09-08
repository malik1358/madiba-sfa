import { listLocalProspectsAsCustomers, prospectToOrderCustomer } from "./offlineProspects.js";
import {
  hiddenProspectCustomerCodes,
  isOpenProspectForOrderScreens,
  mergeUniqueCustomersByCode,
  prospectDisplayName,
} from "./prospects.js";

export async function fetchServerProspects(accessToken) {
  if (!accessToken) return [];

  const response = await fetch("/api/prospects", {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || "Unable to load prospects.");
  }

  return Array.isArray(payload.prospects) ? payload.prospects : [];
}

export function openProspectsAsCustomers(prospects) {
  return (prospects || [])
    .filter(isOpenProspectForOrderScreens)
    .map((prospect) => {
      const row = prospectToOrderCustomer(prospect);
      if (row.customer_code && !row.customer_name) {
        row.customer_name = prospectDisplayName(prospect) || `Prospect ${prospect.id || ""}`.trim();
      }
      return row;
    })
    .filter((row) => row.customer_code && row.customer_name);
}

export async function loadOpenProspectCustomers(accessToken) {
  let serverProspects = [];
  try {
    serverProspects = await fetchServerProspects(accessToken);
  } catch {
    serverProspects = [];
  }

  const hiddenCodes = hiddenProspectCustomerCodes(serverProspects);
  const localProspects = await listLocalProspectsAsCustomers().catch(() => []);
  const localOpen = (localProspects || []).filter((row) => (
    !hiddenCodes.has(String(row?.customer_code || "").trim().toUpperCase())
  ));

  return mergeUniqueCustomersByCode(
    openProspectsAsCustomers(serverProspects),
    localOpen,
  );
}
