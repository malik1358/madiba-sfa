import { isCreditNoteTransaction } from "./paymentBehavior.js";
import { normalizeCode, parseOutstandingSheetDate, resolveCustomerAccountCode } from "./outstanding.js";

export async function loadPotentialSalesTargetCustomers(admin, { records = [], todayKey } = {}) {
  if (!records.length) return [];
  const customers = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from("customers")
      .select("customer_code,customer_name,current_salesman_code,previous_salesman_code,latest_transaction_date,city,area,is_active")
      .eq("is_active", true)
      .order("customer_code")
      .range(offset, offset + 999);
    if (error) throw error;
    customers.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  const recordByCode = new Map(records.map((row) => [normalizeCode(resolveCustomerAccountCode(row.customer_code)), row]));
  const candidates = customers.filter((row) => recordByCode.has(normalizeCode(resolveCustomerAccountCode(row.customer_code))));
  const codes = [...new Set(candidates.map((row) => row.customer_code))];
  const lastInvoiceByCode = new Map();
  for (let index = 0; index < codes.length; index += 80) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.from("active_sales")
        .select("customer_code,transaction_date,sales_amount,voucher_number,voucher_type,reference,quantity")
        .in("customer_code", codes.slice(index, index + 80))
        .gt("sales_amount", 0)
        .lte("transaction_date", todayKey)
        .order("transaction_date", { ascending: false })
        .range(offset, offset + 999);
      if (error) throw error;
      for (const sale of data || []) {
        if (isCreditNoteTransaction(sale)) continue;
        const code = normalizeCode(resolveCustomerAccountCode(sale.customer_code));
        const date = parseOutstandingSheetDate(sale.transaction_date);
        if (date && date > (lastInvoiceByCode.get(code) || "")) lastInvoiceByCode.set(code, date);
      }
      if ((data || []).length < 1000) break;
    }
  }
  return candidates.map((customer) => {
    const code = normalizeCode(resolveCustomerAccountCode(customer.customer_code));
    const record = recordByCode.get(code);
    const dates = [customer.latest_transaction_date, lastInvoiceByCode.get(code),
      ...(record.invoices || []).map((invoice) => invoice.invoice_date)]
      .map(parseOutstandingSheetDate).filter(Boolean).sort();
    const totalOutstanding = (record.invoices || []).reduce((sum, invoice) => (
      sum + Math.max(0, Number(invoice.pending_amount) || 0)
    ), 0);
    return { ...record, ...customer, total_outstanding: totalOutstanding, last_invoice_date: dates.at(-1) || "" };
  });
}