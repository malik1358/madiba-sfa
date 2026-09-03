import { resolveCustomerMasterExportFields } from "./customerCode.js";
import {
  customerHasSavedGps,
  fetchAllFilteredCustomers,
  readOutstandingDataset,
} from "./customerMasterQuery.js";
import {
  findOutstandingForCustomer,
  hydrateOutstandingInvoices,
  laterDateOnly,
  latestOutstandingInvoiceDate,
  pickOutstandingSalesmanName,
} from "./outstanding.js";

const VISIT_REPORT_LATEST_PREFIX = "visit_report_latest:";

export function dateOnly(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(input)) return input.slice(0, 10);
  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
}

export function laterVisitAt(...values) {
  let latest = "";
  let latestMs = Number.NEGATIVE_INFINITY;

  (values || []).forEach((value) => {
    const raw = String(value || "").trim();
    if (!raw) return;
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) {
      if (ms >= latestMs) {
        latestMs = ms;
        latest = raw;
      }
      return;
    }
    const only = dateOnly(raw);
    if (only && only > dateOnly(latest)) {
      latest = only;
      latestMs = Date.parse(`${only}T00:00:00Z`);
    }
  });

  return latest;
}

export function formatSalesmanDisplay(code, name) {
  const salesmanCode = String(code || "").trim();
  const salesmanName = String(name || "").trim();
  if (salesmanName && salesmanCode && salesmanName.toUpperCase() !== salesmanCode.toUpperCase()) {
    return `${salesmanName} (${salesmanCode})`;
  }
  return salesmanName || salesmanCode || "";
}

export function normalizeSalesmanFilter(value) {
  return String(value || "").trim().toUpperCase();
}

export function customerMatchesSalesmanFilter(row, salesmanFilter) {
  const needle = normalizeSalesmanFilter(salesmanFilter);
  if (!needle || needle === "ALL") return true;

  const haystack = [
    row?.current_salesman_code,
    row?.salesman_code,
    row?.salesman_name,
    row?.salesman_display,
    row?.outstanding_salesman,
  ]
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean)
    .join(" ");

  return haystack.includes(needle);
}

export function sortOutstandingNoGpsRows(rows, sortKey = "outstanding") {
  const key = String(sortKey || "outstanding").toLowerCase();
  const copy = [...(rows || [])];

  copy.sort((left, right) => {
    if (key === "invoice") {
      return String(right.last_invoice_date || "").localeCompare(String(left.last_invoice_date || ""));
    }
    if (key === "visit") {
      return String(right.last_visit_date || "").localeCompare(String(left.last_visit_date || ""));
    }
    if (key === "name") {
      return String(left.customer_name || "").localeCompare(String(right.customer_name || ""));
    }
    const amountDiff = Number(right.total_outstanding || 0) - Number(left.total_outstanding || 0);
    if (amountDiff !== 0) return amountDiff;
    return String(left.customer_name || "").localeCompare(String(right.customer_name || ""));
  });

  return copy;
}

export function uniqueOutstandingNoGpsSalesmen(rows) {
  const byCode = new Map();

  (rows || []).forEach((row) => {
    const code = String(row.current_salesman_code || row.salesman_code || "").trim();
    const name = String(row.salesman_name || row.outstanding_salesman || "").trim();
    const key = code || name;
    if (!key) return;
    if (!byCode.has(key)) {
      byCode.set(key, {
        salesman_code: code,
        salesman_name: name || code,
        salesman_display: formatSalesmanDisplay(code, name || code),
      });
    }
  });

  return [...byCode.values()].sort((left, right) =>
    String(left.salesman_display || "").localeCompare(String(right.salesman_display || "")),
  );
}

export function enrichOutstandingNoGpsRow(row, {
  outstandingDataset = { rows: [], invoices: [] },
  invoices = [],
  salesmanNameByCode = new Map(),
  lastVisitByCustomer = new Map(),
  todayIso = new Date().toISOString(),
} = {}) {
  const display = resolveCustomerMasterExportFields(row);
  const customerCode = display.customer_code || String(row?.customer_code || "").trim();
  const customerName = display.customer_name || String(row?.customer_name || "").trim();
  const outstanding = findOutstandingForCustomer(outstandingDataset, customerCode, customerName);
  const outstandingInvoices = (invoices || []).length
    ? invoices
    : hydrateOutstandingInvoices(outstandingDataset);
  const lastInvoiceDate = laterDateOnly(
    row?.latest_transaction_date,
    latestOutstandingInvoiceDate(outstandingInvoices, customerCode, customerName, todayIso),
  );
  const salesmanCode = String(row?.current_salesman_code || "").trim();
  const salesmanName = String(
    salesmanNameByCode.get(salesmanCode.toUpperCase())
    || outstanding?.salesman
    || pickOutstandingSalesmanName(
      outstandingInvoices.filter((invoice) => {
        const invoiceCode = String(invoice?.customer_code || "").trim().toUpperCase();
        return invoiceCode === customerCode.toUpperCase() || invoiceCode.startsWith(`${customerCode.toUpperCase()} `);
      }),
    )
    || "",
  ).trim();
  const lookupCodes = [
    customerCode.toUpperCase(),
    String(row?.customer_code || "").trim().toUpperCase(),
  ].filter(Boolean);

  let lastVisit = "";
  lookupCodes.forEach((code) => {
    lastVisit = laterVisitAt(lastVisit, lastVisitByCustomer.get(code));
  });

  return {
    ...row,
    customer_code: customerCode,
    customer_name: customerName,
    total_outstanding: Number(row?.total_outstanding || outstanding?.total_outstanding || 0),
    last_invoice_date: lastInvoiceDate || "",
    last_visit_date: dateOnly(lastVisit) || "",
    salesman_code: salesmanCode,
    salesman_name: salesmanName,
    salesman_display: formatSalesmanDisplay(salesmanCode, salesmanName),
    outstanding_salesman: String(outstanding?.salesman || "").trim(),
    missing_gps: !customerHasSavedGps(row),
  };
}

export function outstandingNoGpsExportRows(rows) {
  return (rows || []).map((row) => {
    const display = resolveCustomerMasterExportFields(row);
    return {
      "Customer Code": display.customer_code || row.customer_code || "",
      "Customer Name": display.customer_name || row.customer_name || "",
      Salesman: row.salesman_display || formatSalesmanDisplay(row.current_salesman_code, row.salesman_name),
      "Salesman Code": row.current_salesman_code || row.salesman_code || "",
      City: row.city || "",
      Area: row.area || "",
      "Outstanding Amount": Number(row.total_outstanding || 0),
      "Last Invoice Date": row.last_invoice_date || "",
      "Last Visit Date": row.last_visit_date || "",
    };
  });
}

function isMissingRelationError(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || (message.includes("relation") && message.includes("does not exist"))
    || message.includes("could not find the table");
}

function chunk(values, size) {
  const items = [...values];
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function loadSalesmanNameByCode(admin) {
  const { data, error } = await admin
    .from("profiles")
    .select("salesman_code,salesman_name");
  if (error) throw error;

  const map = new Map();
  (data || []).forEach((profile) => {
    const code = String(profile?.salesman_code || "").trim().toUpperCase();
    const name = String(profile?.salesman_name || "").trim();
    if (!code || !name) return;
    map.set(code, name);
  });
  return map;
}

async function loadLastVisitByCustomer(admin, customerCodes) {
  const latest = new Map();
  const codes = [...new Set(
    (customerCodes || [])
      .map((code) => String(code || "").trim().toUpperCase())
      .filter(Boolean),
  )];

  if (codes.length === 0) return latest;

  for (const batch of chunk(codes, 80)) {
    const settingKeys = batch.map((code) => `${VISIT_REPORT_LATEST_PREFIX}${code}`);
    const { data, error } = await admin
      .from("system_settings")
      .select("setting_key,setting_value")
      .in("setting_key", settingKeys);

    if (error && !isMissingRelationError(error)) throw error;

    (data || []).forEach((row) => {
      try {
        const parsed = JSON.parse(String(row?.setting_value || "null"));
        const customerCode = String(parsed?.customer_code || String(row?.setting_key || "").slice(VISIT_REPORT_LATEST_PREFIX.length))
          .trim()
          .toUpperCase();
        const visitAt = parsed?.captured_at || parsed?.saved_at || "";
        if (!customerCode || !visitAt) return;
        latest.set(customerCode, laterVisitAt(latest.get(customerCode), visitAt));
      } catch {
        // Ignore malformed visit fallback records.
      }
    });
  }

  for (const batch of chunk(codes, 80)) {
    const { data, error } = await admin
      .from("collection_visits")
      .select("customer_code,saved_at")
      .in("customer_code", batch)
      .order("saved_at", { ascending: false })
      .limit(4000);

    if (error && isMissingRelationError(error)) break;
    if (error) throw error;

    (data || []).forEach((row) => {
      const customerCode = String(row?.customer_code || "").trim().toUpperCase();
      if (!customerCode) return;
      latest.set(customerCode, laterVisitAt(latest.get(customerCode), row?.saved_at));
    });
  }

  return latest;
}

export async function fetchOutstandingNoGpsCustomers(admin, {
  search = "",
  sort = "outstanding",
  activeFilter = "all",
} = {}) {
  const customers = await fetchAllFilteredCustomers(admin, {
    search,
    gpsFilter: "without",
    outstandingFilter: "with",
    activeFilter,
  });

  const outstandingDataset = await readOutstandingDataset(admin);
  const invoices = hydrateOutstandingInvoices(outstandingDataset);
  const [salesmanNameByCode, lastVisitByCustomer] = await Promise.all([
    loadSalesmanNameByCode(admin),
    loadLastVisitByCustomer(
      admin,
      customers.map((row) => row.customer_code),
    ),
  ]);

  const enriched = customers.map((row) => enrichOutstandingNoGpsRow(row, {
    outstandingDataset,
    invoices,
    salesmanNameByCode,
    lastVisitByCustomer,
  }));

  return sortOutstandingNoGpsRows(enriched, sort);
}
