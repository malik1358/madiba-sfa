export async function fetchCustomerOrderBlockStatus(accessToken, customerCode, customerName = "") {
  const query = new URLSearchParams({
    customerCode: String(customerCode || "").trim(),
    customerName: String(customerName || "").trim(),
  });

  const response = await fetch(`/api/customer-order-block?${query.toString()}`, {
    headers: { Authorization: "Bearer " + accessToken },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    throw new Error(payload.error || "Unable to load order block status.");
  }
  return payload;
}
