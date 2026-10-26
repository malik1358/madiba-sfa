import { isCashSalesVoucher, matchPaymentsFifo } from "./paymentBehavior.js";
import {
  buyingCustomerCodesFromSales,
  collectionAccountKey,
  isKpiCollectionReceipt,
  unappliedCollectionReceipts,
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
    : salesRowsForKpi(kpiKey, salesRows, priorCustomerCodes, salesmanCode);
  return {
    rows,
    actual: Math.round(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0) * 100) / 100,
  };
}