import { buildPaymentBehavior } from "./paymentBehavior.js";
import {
  customerAccountCodesMatch,
  resolveCustomerAccountCode,
  toNumber,
} from "./outstanding.js";

const SALES_SELECT = [
  "transaction_date",
  "voucher_number",
  "reference",
  "customer_code",
  "customer_name",
  "sales_amount",
  "item_code",
  "item_name",
  "category",
  "quantity",
  "rate",
].join(",");

const SALES_CODE_CHUNK = 60;
const SALES_PAGE_SIZE = 1000;

function parseJson(value) {
  try {
    return JSON.parse(value || "null");
  } catch {
    return null;
  }
}

function canonicalCustomerCode(value) {
  return resolveCustomerAccountCode(value);
}

function pushByCustomerCode(map, customerCode, row) {
  const key = canonicalCustomerCode(customerCode);
  if (!key) return;
  const list = map.get(key) || [];
  list.push(row);
  map.set(key, list);
}

function lookupByCustomerCode(map, customerCode) {
  const key = canonicalCustomerCode(customerCode);
  if (!key) return [];
  if (map.has(key)) return map.get(key) || [];

  for (const [candidate, rows] of map.entries()) {
    if (customerAccountCodesMatch(candidate, key)) return rows || [];
  }
  return [];
}

export async function loadReceiptRowsByCustomer(admin) {
  const byCode = new Map();
  try {
    const {
      RECEIPT_DATASET_KEY,
      buildReceiptRow,
      normalizeReceiptDataset,
    } = await import("./receiptRegister.js");

    const { data, error } = await admin
      .from("system_settings")
      .select("setting_value")
      .eq("setting_key", RECEIPT_DATASET_KEY)
      .maybeSingle();
    if (error) throw error;

    const dataset = normalizeReceiptDataset(parseJson(data?.setting_value));
    (dataset.rows || []).forEach((raw) => {
      pushByCustomerCode(byCode, raw.customer_code, buildReceiptRow(raw));
    });
  } catch (error) {
    console.error("Unable to load receipt register for collection avg days:", error);
  }
  return byCode;
}

function salesLookupCodes(customerCode) {
  const raw = String(customerCode || "").trim().toUpperCase().replace(/\s+/g, " ");
  const canonical = canonicalCustomerCode(customerCode);
  const leading = raw.match(/^([A-Z0-9]+)/)?.[1] || "";
  return [...new Set([raw, canonical, leading].filter(Boolean))];
}

export async function loadSalesRowsByCustomer(admin, customerCodes = []) {
  const byCode = new Map();
  const codes = [...new Set(
    (customerCodes || []).flatMap((code) => salesLookupCodes(code)),
  )];
  if (!admin || codes.length === 0) return byCode;

  try {
    for (let index = 0; index < codes.length; index += SALES_CODE_CHUNK) {
      const chunk = codes.slice(index, index + SALES_CODE_CHUNK);
      let from = 0;
      while (true) {
        const { data, error } = await admin
          .from("sales_raw")
          .select(SALES_SELECT)
          .in("customer_code", chunk)
          .order("transaction_date", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + SALES_PAGE_SIZE - 1);
        if (error) throw error;

        const page = Array.isArray(data) ? data : [];
        page.forEach((row) => {
          pushByCustomerCode(byCode, row.customer_code, row);
        });
        if (page.length < SALES_PAGE_SIZE) break;
        from += SALES_PAGE_SIZE;
      }
    }
  } catch (error) {
    console.error("Unable to load sales for collection avg days:", error);
  }

  return byCode;
}

export function resolveCollectionAvgDaysToPay({
  transactions = [],
  receipts = [],
  invoices = [],
  totalOutstanding = 0,
  todayIso = new Date().toISOString(),
} = {}) {
  const behavior = buildPaymentBehavior({
    transactions,
    receipts,
    outstandingCustomer: {
      total_outstanding: toNumber(totalOutstanding),
      open_invoices: Array.isArray(invoices) ? invoices.length : 0,
    },
    outstandingInvoices: Array.isArray(invoices) ? invoices : [],
    todayIso,
  });
  return behavior?.avgDaysToPay ?? null;
}

/** Attach avg_days_to_pay using preloaded sales + receipt maps. */
export function attachAvgDaysToPayToRecords(records, {
  salesByCustomer = new Map(),
  receiptsByCustomer = new Map(),
  todayIso = new Date().toISOString(),
} = {}) {
  return (records || []).map((record) => {
    const code = record?.customer_code;
    const invoices = Array.isArray(record?.invoices) ? record.invoices : [];
    const totalOutstanding = invoices.reduce(
      (sum, invoice) => sum + toNumber(invoice?.pending_amount),
      0,
    );
    const avgDaysToPay = resolveCollectionAvgDaysToPay({
      transactions: lookupByCustomerCode(salesByCustomer, code),
      receipts: lookupByCustomerCode(receiptsByCustomer, code),
      invoices,
      totalOutstanding,
      todayIso,
    });
    return {
      ...record,
      avg_days_to_pay: avgDaysToPay,
    };
  });
}

export async function enrichCollectionRecordsWithAvgDays(admin, records, {
  todayIso = new Date().toISOString(),
} = {}) {
  const list = Array.isArray(records) ? records : [];
  if (!admin || list.length === 0) return list;

  const customerCodes = list.map((row) => row?.customer_code).filter(Boolean);
  const [receiptsByCustomer, salesByCustomer] = await Promise.all([
    loadReceiptRowsByCustomer(admin),
    loadSalesRowsByCustomer(admin, customerCodes),
  ]);

  return attachAvgDaysToPayToRecords(list, {
    salesByCustomer,
    receiptsByCustomer,
    todayIso,
  });
}
