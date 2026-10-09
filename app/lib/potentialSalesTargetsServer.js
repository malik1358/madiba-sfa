import { isCreditNoteTransaction } from "./paymentBehavior.js";
import {
  buildPotentialSalesTargetLastVisitMap,
  potentialTargetAccountCode,
  potentialSalesTargetMonthKeys,
  sumPotentialSalesByCustomerAndMonth,
} from "./potentialSalesTargets.js";
import { promoterCoverageCustomerCodeVariants } from "./promoterCoverage.js";
import { isMissingSchemaColumn } from "./performanceKpis.js";
import { parseOutstandingSheetDate } from "./outstanding.js";

const PAGE_SIZE = 1000;

function dateOnly(value) {
  return parseOutstandingSheetDate(value) || String(value || "").slice(0, 10);
}

async function loadSubmittedOrderDates(admin, customerCodes) {
  const latestByCode = new Map();
  const queryCodes = [...new Set(customerCodes.flatMap(promoterCoverageCustomerCodeVariants))];
  for (let start = 0; start < queryCodes.length; start += 200) {
    const batch = queryCodes.slice(start, start + 200);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await admin.from("sales_orders")
        .select("customer_code,submitted_at,created_at")
        .eq("status", "SUBMITTED")
        .in("customer_code", batch)
        .order("submitted_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      (data || []).forEach((order) => {
        const code = potentialTargetAccountCode(order.customer_code);
        const date = dateOnly(order.submitted_at || order.created_at);
        if (code && date > (latestByCode.get(code) || "")) latestByCode.set(code, date);
      });
      if ((data || []).length < PAGE_SIZE) break;
    }
  }
  return latestByCode;
}

async function loadBrowserVisitData(admin, customers, profiles = []) {
  const queryCodes = [...new Set(customers.flatMap((customer) => promoterCoverageCustomerCodeVariants(customer.customer_code)))];
  const collectionVisits = [];
  for (let start = 0; start < queryCodes.length; start += 200) {
    const batch = queryCodes.slice(start, start + 200);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let result = await admin.from("collection_visits")
        .select("customer_code,created_by,saved_at,latitude,longitude")
        .in("customer_code", batch)
        .order("saved_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (result.error && isMissingSchemaColumn(result.error)) {
        result = await admin.from("collection_visits")
          .select("customer_code,created_by,saved_at")
          .in("customer_code", batch)
          .order("saved_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);
      }
      if (result.error) throw result.error;
      collectionVisits.push(...(result.data || []));
      if ((result.data || []).length < PAGE_SIZE) break;
    }
  }

  const activityLogs = [];
  const maxActivityRows = 50000;
  const actorIds = [...new Set((profiles || []).map((profile) => String(profile.id || "")).filter(Boolean))];
  for (let start = 0; start < actorIds.length && activityLogs.length < maxActivityRows; start += 100) {
    const actorBatch = actorIds.slice(start, start + 100);
    for (let offset = 0; offset < maxActivityRows - activityLogs.length; offset += PAGE_SIZE) {
      const { data, error } = await admin.from("daily_activity_logs")
        .select("user_id,entry_type,note,created_at")
        .in("user_id", actorBatch)
        .in("entry_type", ["VISIT_REPORT", "PROSPECT_FOLLOW_UP"])
        .order("created_at", { ascending: false })
        .range(offset, Math.min(offset + PAGE_SIZE, maxActivityRows - activityLogs.length) - 1);
      if (error) throw error;
      activityLogs.push(...(data || []));
      if ((data || []).length < PAGE_SIZE) break;
    }
  }

  return buildPotentialSalesTargetLastVisitMap({ customers, collectionVisits, activityLogs, profiles });
}

export async function loadPotentialSalesTargetCustomers(admin, {
  records = [],
  todayKey,
  includeBrowserDetails = false,
  profiles = [],
} = {}) {
  if (!records.length) return [];
  const customers = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from("customers")
      .select("customer_code,customer_name,current_salesman_code,previous_salesman_code,latest_transaction_date,city,area,latitude,longitude,is_active")
      .eq("is_active", true)
      .order("customer_code")
      .range(offset, offset + 999);
    if (error) throw error;
    customers.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  const recordByCode = new Map(records.map((row) => [potentialTargetAccountCode(row.customer_code), row]));
  const candidates = customers.filter((row) => recordByCode.has(potentialTargetAccountCode(row.customer_code)));
  const codes = [...new Set(candidates.map((row) => row.customer_code))];
  const lastInvoiceByCode = new Map();
  const salesRows = [];
  const queryCodes = includeBrowserDetails
    ? [...new Set(codes.flatMap(promoterCoverageCustomerCodeVariants))]
    : codes;
  const codeBatchSize = includeBrowserDetails ? 200 : 80;
  for (let index = 0; index < queryCodes.length; index += codeBatchSize) {
    for (let offset = 0; ; offset += 1000) {
      let query = admin.from("active_sales")
        .select("customer_code,transaction_date,sales_amount,voucher_number,voucher_type,reference,quantity")
        .in("customer_code", queryCodes.slice(index, index + codeBatchSize))
        .lte("transaction_date", todayKey)
        .order("transaction_date", { ascending: false })
      if (!includeBrowserDetails) query = query.gt("sales_amount", 0);
      const { data, error } = await query.range(offset, offset + 999);
      if (error) throw error;
      if (includeBrowserDetails) salesRows.push(...(data || []));
      for (const sale of data || []) {
        if (isCreditNoteTransaction(sale)) continue;
        const code = potentialTargetAccountCode(sale.customer_code);
        const date = parseOutstandingSheetDate(sale.transaction_date);
        if (date && date > (lastInvoiceByCode.get(code) || "")) lastInvoiceByCode.set(code, date);
      }
      if ((data || []).length < 1000) break;
    }
  }
  const browserMonthKeys = includeBrowserDetails ? potentialSalesTargetMonthKeys(todayKey) : [];
  const monthlySales = includeBrowserDetails
    ? sumPotentialSalesByCustomerAndMonth(salesRows, browserMonthKeys)
    : new Map();
  const submittedOrderDates = includeBrowserDetails ? await loadSubmittedOrderDates(admin, codes) : new Map();
  const lastVisitDates = includeBrowserDetails ? await loadBrowserVisitData(admin, candidates, profiles) : new Map();

  return candidates.map((customer) => {
    const code = potentialTargetAccountCode(customer.customer_code);
    const record = recordByCode.get(code);
    const dates = [customer.latest_transaction_date, lastInvoiceByCode.get(code),
      ...(record.invoices || []).map((invoice) => invoice.invoice_date)]
      .map(parseOutstandingSheetDate).filter(Boolean).sort();
    const totalOutstanding = (record.invoices || []).reduce((sum, invoice) => (
      sum + Math.max(0, Number(invoice.pending_amount) || 0)
    ), 0);
    const salesmanCode = String(record.salesman_code || customer.current_salesman_code || customer.previous_salesman_code || "")
      .trim().toUpperCase();
    const invoiceDate = dates.at(-1) || "";
    const orderDate = submittedOrderDates.get(code) || "";
    const visitBySalesman = {};
    [record.salesman_code, customer.current_salesman_code, customer.previous_salesman_code]
      .map((value) => String(value || "").trim().toUpperCase())
      .filter(Boolean)
      .forEach((salesman) => {
        visitBySalesman[salesman] = lastVisitDates.get(`${code}::${salesman}`) || "";
      });
    return {
      ...record,
      ...customer,
      salesman_code: salesmanCode,
      total_outstanding: totalOutstanding,
      last_invoice_date: invoiceDate,
      last_order_invoice_date: [invoiceDate, orderDate].filter(Boolean).sort().at(-1) || "",
      ...(includeBrowserDetails ? {
        sales_by_month: monthlySales.get(code) || Object.fromEntries(browserMonthKeys.map((month) => [month, 0])),
        last_visit_by_salesman: visitBySalesman,
      } : {}),
    };
  });
}