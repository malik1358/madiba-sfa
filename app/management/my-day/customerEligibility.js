export function isDoNotUseCustomer(customerName) {
  return /do\s*not\s*use/i.test(String(customerName || "").trim());
}

export function isVisitStatusCustomer(customer) {
  return customer?.is_active !== false && !isDoNotUseCustomer(customer?.customer_name);
}