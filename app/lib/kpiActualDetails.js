import { isCashSalesVoucher, matchPaymentsFifo } from "./paymentBehavior.js";
import {
  buyingCustomerCodesFromSales,
  isOfficeSuppliesSale,
  isLocalItemSale,
  netKpiSalesAmount,
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

function salesRowsForKpi(kpiKey, salesRows, priorCustomerCodes, salesmanCode) {
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

function collectionRowsForKpi(kpiKey, salesRows, collectionVisits, { fromDate, toDate, salesmanCode }) {
  if (kpiKey !== "collection" && kpiKey !== "cashCollection") return [];
  const visitsByCustomer = new Map();
  (collectionVisits || []).forEach((visit) => {
    const customerCode = normalizeSalesmanCode(visit?.customer_code);
    if (!customerCode) return;
    const rows = visitsByCustomer.get(customerCode) || [];
    rows.push(visit);
    visitsByCustomer.set(customerCode, rows);
  });
  const salesByCustomer = new Map();
  (salesRows || []).forEach((row) => {
    const customerCode = normalizeSalesmanCode(row?.customer_code);
    if (!customerCode) return;
    const rows = salesByCustomer.get(customerCode) || [];
    rows.push(row);
    salesByCustomer.set(customerCode, rows);
  });

  return [...visitsByCustomer.entries()].flatMap(([customerCode, customerVisits]) => {
    const receipts = customerVisits.map((visit) => ({
      receipt_date: String(visit?.saved_at || "").slice(0, 10),
      amount: Number(visit?.amount_received || 0),
      vch_no: String(visit?.id || ""),
    }));
    const visitById = new Map(customerVisits.map((visit) => [String(visit.id), visit]));
    const { allocations } = matchPaymentsFifo(salesByCustomer.get(customerCode) || [], receipts);
    return allocations.flatMap((allocation) => {
      const receiptDate = String(allocation?.receipt_date || "").slice(0, 10);
      if ((fromDate && receiptDate < fromDate) || (toDate && receiptDate > toDate)) return [];
      const isCash = isCashSalesVoucher(allocation?.voucher_number);
      if (kpiKey === "collection" && isCash) return [];
      if (kpiKey === "cashCollection" && !isCash) return [];
      const visit = visitById.get(String(allocation.vch_no)) || {};
      return [{
        ...detailBase({
          ...visit,
          saved_at: allocation.receipt_date,
          customer_code: visit.customer_code,
        }, salesmanCode),
        reference: String(visit.id || allocation.vch_no || ""),
        description: `Applied to ${allocation.voucher_number || "invoice"} (${allocation.invoice_date || ""})`,
        invoiceReference: String(allocation.voucher_number || ""),
        invoiceDate: String(allocation.invoice_date || ""),
        amount: Number(allocation.amount || 0),
      }];
    });
  });
}

export function buildKpiActualDetails({
  kpiKey,
  salesmanCode,
  salesRows = [],
  priorCustomerCodes = [],
  collectionVisits = [],
  collectionSalesRows = [],
  fromDate = "",
  toDate = "",
} = {}) {
  const rows = ["collection", "cashCollection"].includes(kpiKey)
    ? collectionRowsForKpi(kpiKey, collectionSalesRows, collectionVisits, { fromDate, toDate, salesmanCode })
    : salesRowsForKpi(kpiKey, salesRows, priorCustomerCodes, salesmanCode);
  return {
    rows,
    actual: Math.round(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0) * 100) / 100,
  };
}