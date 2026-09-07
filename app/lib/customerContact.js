import { resolveCustomerMasterExportFields } from "./customerCode.js";

export const CUSTOMER_MOBILE_REQUIRED_ERROR = "Please update the customer phone number before posting.";
const CUSTOMER_CONTACT_FETCH_TIMEOUT_MS = 8000;

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

export function normalizeKsaMobile(value) {
  let digits = digitsOnly(value);
  if (!digits) return "";

  if (digits.startsWith("00966")) digits = digits.slice(2);
  if (digits.startsWith("966") && digits.length >= 12) {
    digits = `0${digits.slice(3)}`;
  }
  if (digits.startsWith("5") && digits.length === 9) {
    digits = `0${digits}`;
  }

  return digits;
}

export function isValidKsaMobile(value) {
  return /^05\d{8}$/.test(normalizeKsaMobile(value));
}

export function customerHasMobile(customer) {
  return isValidKsaMobile(customer?.mobile);
}

export function mobilesMatch(left, right) {
  const a = normalizeKsaMobile(left);
  const b = normalizeKsaMobile(right);
  return Boolean(a && b && a === b);
}

export function mobileLookupVariants(value) {
  const normalized = normalizeKsaMobile(value);
  if (!isValidKsaMobile(normalized)) return [];

  const national = normalized;
  const withoutZero = national.slice(1);
  const intl = `966${withoutZero}`;

  return [...new Set([
    national,
    withoutZero,
    intl,
    `+${intl}`,
    `00${intl}`,
  ])];
}

export function findCustomersByNormalizedMobile(customers, mobile) {
  if (!isValidKsaMobile(mobile)) return [];
  return (customers || []).filter((row) => mobilesMatch(row?.mobile, mobile));
}

function isProspectCode(value) {
  return /^PROSPECT-/i.test(String(value || "").trim());
}

function customerPreview(customer) {
  const preview = resolveCustomerMasterExportFields(customer || {});
  return {
    customer_code: preview.customer_code || String(customer?.customer_code || "").trim(),
    customer_name: preview.customer_name || String(customer?.customer_name || "").trim(),
  };
}

export function formatExistingCustomerDuplicateMessage({ language = "en", customer } = {}) {
  const preview = customerPreview(customer);
  const code = preview.customer_code;
  const name = preview.customer_name;
  const salesman = String(customer?.current_salesman_code || "").trim();

  if (language === "ar") {
    return `هذا العميل موجود مسبقاً. الكود: ${code}. الاسم: ${name}${salesman ? `. المندوب: ${salesman}` : ""}. لا تسجّل عميلاً جديداً.`;
  }

  return `This customer already exists. Code: ${code}. Name: ${name}${salesman ? `. Salesman: ${salesman}` : ""}. Do not register a new customer.`;
}

export function formatMissingCustomerMobilePrompt({ language = "en", customerCode = "", customerName = "" } = {}) {
  const displayName = String(customerName || customerCode || "this customer").trim();
  const code = String(customerCode || "").trim();
  const label = code ? `${displayName} (${code})` : displayName;

  if (language === "ar") {
    return `لا يوجد رقم جوال للعميل ${label}. أدخل رقم الجوال (05xxxxxxxx) لتحديثه قبل ترحيل القيد.`;
  }

  return `${label} has no phone number. Enter a KSA mobile (05xxxxxxxx) to update it before posting.`;
}

export async function findCustomersByMobile(admin, mobile) {
  const normalized = normalizeKsaMobile(mobile);
  if (!isValidKsaMobile(normalized) || !admin) return [];

  const variants = mobileLookupVariants(normalized).filter((variant) => /^[0-9]+$/.test(variant));
  const lastNine = normalized.slice(-9);
  const orFilter = [
    ...variants.map((variant) => `mobile.eq.${variant}`),
    `mobile.ilike.%${lastNine}`,
  ].join(",");

  const { data, error } = await admin
    .from("customers")
    .select("customer_code,customer_name,current_salesman_code,previous_salesman_code,city,area,mobile,is_active")
    .or(orFilter)
    .limit(25);

  if (error) throw error;

  const matched = [];
  const seen = new Set();
  for (const row of data || []) {
    if (!mobilesMatch(row?.mobile, normalized)) continue;
    const preview = customerPreview(row);
    const key = String(preview.customer_code || row.customer_code || "").trim().toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    matched.push({
      ...row,
      customer_code: preview.customer_code || row.customer_code,
      customer_name: preview.customer_name || row.customer_name,
      mobile: normalizeKsaMobile(row.mobile),
    });
  }

  return matched;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = CUSTOMER_CONTACT_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupExistingCustomersByMobile({
  accessToken = "",
  mobile,
  localCustomers = [],
} = {}) {
  const localMatches = findCustomersByNormalizedMobile(localCustomers, mobile);
  const normalized = normalizeKsaMobile(mobile);
  if (!isValidKsaMobile(normalized)) return [];

  if (!accessToken) return localMatches;

  try {
    const response = await fetchWithTimeout(
      `/api/customers/lookup?mobile=${encodeURIComponent(normalized)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.success && Array.isArray(payload.customers) && payload.customers.length) {
      return payload.customers;
    }
  } catch {
    // Offline lookup falls back to locally cached customers.
  }

  return localMatches;
}

export async function fetchCustomerContact(accessToken, customerCode) {
  const code = String(customerCode || "").trim();
  if (!code || !accessToken) return null;

  const response = await fetchWithTimeout(`/api/customers/contact?customerCode=${encodeURIComponent(code)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) return null;
  return payload.customer || null;
}

export async function updateCustomerMobile(accessToken, customerCode, mobile) {
  const normalized = normalizeKsaMobile(mobile);
  if (!isValidKsaMobile(normalized)) {
    throw new Error("Mobile must be a valid KSA number with 10 digits starting with 05.");
  }

  const response = await fetchWithTimeout("/api/customers/contact", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      customerCode,
      mobile: normalized,
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) {
    throw new Error(result.error || "Unable to update customer phone number.");
  }

  return result.customer;
}

export async function promptCustomerMobileUpdateIfMissing({
  language = "en",
  customer = null,
  customerCode = "",
  customerName = "",
  accessToken = "",
  promptFn = null,
  scope = null,
} = {}) {
  const code = String(customerCode || customer?.customer_code || "").trim();
  if (!code || isProspectCode(code)) {
    return customer;
  }

  let current = customer;
  if (!customerHasMobile(current) && accessToken) {
    const fetched = await fetchCustomerContact(accessToken, code);
    if (fetched) {
      current = { ...(current || {}), ...fetched };
    }
  }

  if (customerHasMobile(current)) {
    return current;
  }

  const ask = typeof promptFn === "function"
    ? promptFn
    : (message, initialValue) => window.prompt(message, initialValue);

  const entered = ask(
    formatMissingCustomerMobilePrompt({
      language,
      customerCode: code,
      customerName: customerName || current?.customer_name || "",
    }),
    "",
  );

  if (entered == null || !String(entered).trim()) {
    throw new Error(
      language === "ar"
        ? "حدّث رقم جوال العميل قبل ترحيل القيد."
        : CUSTOMER_MOBILE_REQUIRED_ERROR,
    );
  }

  if (!isValidKsaMobile(entered)) {
    throw new Error("Mobile must be a valid KSA number with 10 digits starting with 05.");
  }

  const normalized = normalizeKsaMobile(entered);
  if (accessToken) {
    const updated = await updateCustomerMobile(accessToken, code, normalized);
    current = { ...(current || {}), ...updated, mobile: normalized };
  } else {
    current = { ...(current || {}), customer_code: code, mobile: normalized };
  }

  if (scope) {
    try {
      const { upsertLocalVisibleCustomer } = await import("./mobileDataCache.js");
      await upsertLocalVisibleCustomer(scope, current);
    } catch {
      // Local cache update is best-effort.
    }
  }

  if (customer && typeof customer === "object") {
    customer.mobile = normalized;
  }

  return current;
}
