import { isCashSalesVoucher, matchPaymentsFifo } from "./paymentBehavior.js";
import {
  buyingCustomerCodesFromSales,
  classifyRepeatCustomerSkuExpansion,
  collectionAccountKey,
  isKpiCollectionReceipt,
  unappliedCollectionReceipts,
  isOfficeSuppliesSale,
  isLocalItemSale,
  netKpiSalesAmount,
  normalizeItemCode,
  normalizeSalesmanCode,
} from "./performanceKpis.js";

function detailBase(row, salesmanCode) {
  return {
    date: String(row?.transaction_date || row?.saved_at || "").slice(0, 10),
    reference: String(row?.voucher_number || row?.reference || row?.id || ""),
    customerCode: String(row?.customer_code || "").trim(),
    customerName: String(row?.customer_name || "").trim(),
    salesmanCode: normalizeSalesmanCode(salesmanCode),
  };
}

function salesRowsForKpi(kpiKey, salesRows, priorCustomerCodes, salesmanCode, priorCustomerItemCodes = {}) {
  const sorted = [...(salesRows || [])].sort((left, right) => (
    String(left?.transaction_date || "").localeCompare(String(right?.transaction_date || ""))
    || String(left?.voucher_number || left?.reference || "").localeCompare(String(right?.voucher_number || right?.reference || ""))
  ));

  if (["officeSupplies", "localItemSales", "otherSales", "totalSales"].includes(kpiKey)) {
    return sorted.flatMap((row) => {
      const amount = netKpiSalesAmount(row);
      if (amount === 0) return [];
      const officeSupplies = isOfficeSuppliesSale(row);
      const localItemSales = !officeSupplies && isLocalItemSale(row);
      if (kpiKey === "officeSupplies" && !officeSupplies) return [];
      if (kpiKey === "localItemSales" && !localItemSales) return [];
      if (kpiKey === "otherSales" && (officeSupplies || localItemSales)) return [];
      return [{ ...detailBase(row, salesmanCode), description: row?.item_name || row?.category || "Sales line", amount }];
    });
  }

  if (kpiKey === "newSkusToRepeatCustomers" || kpiKey === "avgSkusPerRepeatCustomer") {
    const expansion = classifyRepeatCustomerSkuExpansion({
      monthSalesRows: sorted,
      priorCustomerCodes,
      priorCustomerItemCodes,
    });
    if (kpiKey === "avgSkusPerRepeatCustomer") {
      return expansion.customerSummaries.map((summary) => {
        const sample = sorted.find((row) => normalizeSalesmanCode(row.customer_code) === summary.customerCode) || {
          customer_code: summary.customerCode,
        };
        return {
          ...detailBase(sample, salesmanCode),
          description: `${summary.monthSkuCount} SKU${summary.monthSkuCount === 1 ? "" : "s"} this month`
            + (summary.newSkuCount ? ` (${summary.newSkuCount} new)` : ""),
          amount: summary.monthSkuCount,
        };
      });
    }
    const newSkuSetByCustomer = new Map(
      expansion.customerSummaries.map((summary) => [summary.customerCode, new Set(summary.newSkuCodes)]),
    );
    const seenPairs = new Set();
    return sorted.flatMap((row) => {
      if (!buyingCustomerCodesFromSales([row]).length) return [];
      const customer = normalizeSalesmanCode(row.customer_code);
      const itemCode = normalizeItemCode(row.item_code);
      const newSkus = newSkuSetByCustomer.get(customer);
      if (!customer || !itemCode || !newSkus?.has(itemCode)) return [];
      const pairKey = `${customer}|${itemCode}`;
      if (seenPairs.has(pairKey)) return [];
      seenPairs.add(pairKey);
      return [{
        ...detailBase(row, salesmanCode),
        description: `${row?.item_name || itemCode} (new SKU)`,
        amount: 1,
      }];
    });
  }

  if (kpiKey !== "newCustomers" && kpiKey !== "repeatCustomers") return [];
  const prior = new Set((priorCustomerCodes || []).map(normalizeSalesmanCode).filter(Boolean));
  const seen = new Set();
  return sorted.flatMap((row) => {
    if (!buyingCustomerCodesFromSales([row]).length) return [];
    const code = normalizeSalesmanCode(row.customer_code);
    const classification = prior.has(code) ? "repeatCustomers" : "newCustomers";
    const alreadySeen = seen.has(code);
    seen.add(code);
    if (alreadySeen || classification !== kpiKey) return [];
    return [{ ...detailBase(row, salesmanCode), description: row?.customer_name || code, amount: 1 }];
  });
}

function pushByAccount(map, code, row) {
  const key = collectionAccountKey(code);
  if (!key) return;
  const rows = map.get(key) || [];
  rows.push(row);
  map.set(key, rows);
}

function collectionRowsForKpi(kpiKey, salesRows, collectionVisits, {
  fromDate,
  toDate,
  salesmanCode,
  receiptRegister = false,
  collectionReceipts = [],
}) {
  if (!["collection", "cashCollection", "totalCashCollected"].includes(kpiKey)) return [];
  const sourceRows = receiptRegister
    ? (collectionReceipts || []).filter(isKpiCollectionReceipt)
    : (collectionVisits || []);
  const rowsByCustomer = new Map();
  sourceRows.forEach((row) => {
    pushByAccount(rowsByCustomer, row?.customer_code, row);
  });
  const salesByCustomer = new Map();
  (salesRows || []).forEach((row) => {
    pushByAccount(salesByCustomer, row?.customer_code, row);
  });
  const includeCredit = kpiKey === "collection" || kpiKey === "totalCashCollected";
  const includeCash = kpiKey === "cashCollection" || kpiKey === "totalCashCollected";
  const includeUnapplied = includeCredit && receiptRegister;

  return [...rowsByCustomer.entries()].flatMap(([customerCode, customerRows]) => {
    const receipts = receiptRegister
      ? customerRows
      : customerRows.map((visit) => ({
        receipt_date: String(visit?.saved_at || "").slice(0, 10),
        amount: Number(visit?.amount_received || 0),
        vch_no: String(visit?.id || ""),
      }));
    const visitById = new Map(customerRows.map((visit) => [String(visit.id || visit.vch_no || ""), visit]));
    const { allocations } = matchPaymentsFifo(salesByCustomer.get(customerCode) || [], receipts, {
      receiptOnOrAfterInvoice: Boolean(receiptRegister),
    });
    const applied = allocations.flatMap((allocation) => {
      const receiptDate = String(allocation?.receipt_date || "").slice(0, 10);
      if ((fromDate && receiptDate < fromDate) || (toDate && receiptDate > toDate)) return [];
      const isCash = isCashSalesVoucher(allocation?.voucher_number);
      if (isCash && !includeCash) return [];
      if (!isCash && !includeCredit) return [];
      const visit = visitById.get(String(allocation.vch_no)) || customerRows[0] || {};
      return [{
        ...detailBase({
          ...visit,
          saved_at: allocation.receipt_date,
          customer_code: visit.customer_code || customerCode,
        }, salesmanCode),
        reference: String(visit.vch_no || visit.id || allocation.vch_no || ""),
        description: `Applied to ${allocation.voucher_number || "invoice"} (${allocation.invoice_date || ""})`,
        invoiceReference: String(allocation.voucher_number || ""),
        invoiceDate: String(allocation.invoice_date || ""),
        amount: Number(allocation.amount || 0),
      }];
    });
    if (!includeUnapplied) return applied;
    const unapplied = unappliedCollectionReceipts(receipts, allocations, { fromDate, toDate }).map((row) => ({
      ...detailBase({
        ...row.row,
        saved_at: row.date,
        customer_code: row.row?.customer_code || customerCode,
      }, salesmanCode),
      reference: row.voucher,
      description: "Collected, not applied to an earlier invoice",
      amount: row.amount,
    }));
    return [...applied, ...unapplied];
  });
}

export function buildKpiActualDetails({
  kpiKey,
  salesmanCode,
  salesRows = [],
  priorCustomerCodes = [],
  priorCustomerItemCodes = {},
  collectionVisits = [],
  collectionReceipts = [],
  receiptRegister = false,
  collectionSalesRows = [],
  fromDate = "",
  toDate = "",
} = {}) {
  const rows = ["collection", "cashCollection", "totalCashCollected"].includes(kpiKey)
    ? collectionRowsForKpi(kpiKey, collectionSalesRows, collectionVisits, {
      fromDate,
      toDate,
      salesmanCode,
      receiptRegister,
      collectionReceipts,
    })
    : salesRowsForKpi(kpiKey, salesRows, priorCustomerCodes, salesmanCode, priorCustomerItemCodes);
  const rawTotal = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const actual = kpiKey === "avgSkusPerRepeatCustomer"
    ? (rows.length ? Math.round((rawTotal / rows.length) * 10) / 10 : 0)
    : Math.round(rawTotal * 100) / 100;
  return {
    rows,
    actual,
  };
}