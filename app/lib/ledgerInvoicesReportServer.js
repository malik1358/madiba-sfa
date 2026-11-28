import { mergeSalesSnapshots } from "./salesHistory.js";
import {
  buildLedgerInvoicesReport,
  resolveLedgerInvoiceFetchWindow,
} from "./ledgerInvoicesReport.js";
import { resolveSalesInvoiceDateRange } from "./salesInvoices.js";
import { getKsaDateString } from "./workdayActivity.js";

export const LEDGER_INVOICES_SELECT = [
  "id",
  "import_batch_id",
  "transaction_date",
  "voucher_number",
  "voucher_type",
  "reference",
  "customer_code",
  "customer_name",
  "salesman_code",
  "salesman_name",
  "item_code",
  "item_name",
  "category",
  "quantity",
  "sales_amount",
].join(",");

const PAGE_SIZE = 1000;

function isMissingRelation(error) {
  const message = String(error?.message || error?.details || "").toLowerCase();
  return error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
}

async function fetchSalesRowsFromTable(admin, table, { from, to }) {
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await admin
      .from(table)
      .select(LEDGER_INVOICES_SELECT)
      .gte("transaction_date", from)
      .lte("transaction_date", to)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

async function fetchSalesRows(admin, options) {
  try {
    return await fetchSalesRowsFromTable(admin, "active_sales", options);
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
    return mergeSalesSnapshots(await fetchSalesRowsFromTable(admin, "sales_raw", options));
  }
}

export async function loadLedgerInvoicesReport(admin, { from, to, todayIso } = {}) {
  const range = resolveSalesInvoiceDateRange({
    from,
    to,
    todayIso: todayIso || getKsaDateString(),
  });
  const fetchWindow = resolveLedgerInvoiceFetchWindow(range);
  const transactions = await fetchSalesRows(admin, fetchWindow);
  return buildLedgerInvoicesReport(transactions, range);
}
