import {
  isAdminRole,
  isCollectionOnlyAccess,
  isInvoiceMakerRole,
  normalizeAccessRole,
} from "./moduleAccess.js";

/**
 * Company-wide sales/customer visibility (not limited to the viewer's salesman_code).
 * Collectors match Payment Collections: they are not book owners (CL* / SM001), so
 * salesman-scoped customer search would always return empty once Customer Audit is enabled.
 */
export function profileHasCompanyWideSalesScope({
  role,
  salesmanCode,
  collectionOnlyMetadata = false,
} = {}) {
  const normalized = normalizeAccessRole(role);
  if (isAdminRole(normalized) || normalized === "manager" || normalized === "report-user") {
    return true;
  }
  if (isInvoiceMakerRole(normalized)) return true;
  return isCollectionOnlyAccess({ role, salesmanCode, collectionOnlyMetadata });
}
