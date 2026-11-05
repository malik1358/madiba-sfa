/** True when the salesman confirmed replacing the customer pin on this row. */
export function isAcceptedCustomerGpsUpdate(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.gpsLocationUpdateAccepted === true || entry.customerGpsUpdateAccepted === true) {
    return true;
  }
  const meta = entry.meta;
  if (!meta || typeof meta !== "object") return false;
  return meta.gpsLocationUpdateAccepted === true
    || meta.customerGpsUpdateAccepted === true
    || meta.customer_gps_update_accepted === true;
}
