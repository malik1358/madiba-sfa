import { normalizeCustomerNameKey } from "../../lib/customerCode.js";

export function isDoNotUseCustomer(customerName) {
  return /do\s*not\s*use/i.test(String(customerName || "").trim());
}

function compactLatin(value) {
  return String(value || "").toLowerCase().replace(/[^a-z]/g, "");
}

export function isBuildingMaterialText(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  const compact = compactLatin(text);
  if (compact.includes("buildingmaterial") || compact.includes("buidingmaterial")) return true;
  return /مواد\s*ال?بناء/.test(text);
}

export function isBuildingMaterialCustomer(customer) {
  if (!customer || typeof customer !== "object") {
    return isBuildingMaterialText(customer);
  }

  return [
    customer.customer_type,
    customer.customer_name,
    customer.customer_name_ar,
    customer.current_salesman_code,
    customer.previous_salesman_code,
    customer.salesman_code,
    customer.salesman_name,
  ].some((value) => isBuildingMaterialText(value));
}

export function isVisitStatusCustomer(customer) {
  return customer?.is_active !== false && !isDoNotUseCustomer(customer?.customer_name);
}

export function removeDuplicateNameCodeCustomers(customers = []) {
  const rows = Array.isArray(customers) ? customers : [];
  const codedNameKeys = new Set();

  rows.forEach((customer) => {
    const codeKey = normalizeCustomerNameKey(customer?.customer_code);
    const nameKey = normalizeCustomerNameKey(customer?.customer_name);
    if (codeKey && nameKey && codeKey !== nameKey) codedNameKeys.add(nameKey);
  });

  return rows.filter((customer) => {
    const codeKey = normalizeCustomerNameKey(customer?.customer_code);
    const nameKey = normalizeCustomerNameKey(customer?.customer_name);
    return !codeKey || codeKey !== nameKey || !codedNameKeys.has(nameKey);
  });
}
