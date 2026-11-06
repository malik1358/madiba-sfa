/**
 * Customer + item pairs on active_sales where credit-note / return value
 * exceeds sales value from the first imported day. Voucher numbers stay on
 * the row so the sales and the returns can be traced in Tally.
 */

export const RETURNS_ABOVE_SALES_SELECT = [
  "transaction_date",
  "voucher_number",
  "voucher_type",
  "reference",
  "customer_code",
  "customer_name",
  "item_code",
  "item_name",
  "quantity",
  "sales_amount",
].join(",");

/** Ignore sub-fils noise when deciding that returns exceed sales. */
export const RETURNS_ABOVE_SALES_EPSILON = 0.02;

export const RETURNS_ABOVE_SALES_FILTER_KEYS = [
  "customerName",
  "customerCode",
  "itemName",
  "itemCode",
  "salesQuantity",
  "returnQuantity",
  "salesAmount",
  "returnAmount",
  "salesVouchers",
  "returnVouchers",
  "excessAmount",
];

function roundMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function roundQty(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return 0;
  return Math.round(quantity * 1000) / 1000;
}

export function normalizeReturnsAboveSalesCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function normalizeReturnsAboveSalesDate(value) {
  const text = String(value || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export function isReturnsAboveSalesFooter(row = {}) {
  return String(row?.voucher_number || "").trim().toLowerCase() === "total";
}

/**
 * A return is a credit note / sales-return voucher type, or a negative qty or amount.
 * A sales voucher whose reference merely mentions a credit note stays a sale.
 */
export function isReturnsAboveSalesReturn(row = {}) {
  const type = String(row?.voucher_type || "").trim().toUpperCase();
  if (
    type.includes("CREDIT NOTE")
    || type.includes("CREDITNOTE")
    || type.includes("SALES RETURN")
    || type.includes("RETURN")
  ) {
    return true;
  }
  const amount = Number(row?.sales_amount);
  if (Number.isFinite(amount) && amount < 0) return true;
  const quantity = Number(row?.quantity);
  if (Number.isFinite(quantity) && quantity < 0) return true;
  return false;
}

function preferCustomerName(current, candidate) {
  const next = String(candidate || "").trim();
  const prev = String(current || "").trim();
  if (!next) return prev;
  if (!prev) return next;
  return next.length > prev.length ? next : prev;
}

function isDoNotUseName(name) {
  return /do\s*not\s*use+/i.test(String(name || "").trim());
}

function preferItemName(current, candidate, itemCode) {
  const next = String(candidate || "").trim();
  const prev = String(current || "").trim();
  const code = normalizeReturnsAboveSalesCode(itemCode);
  if (!next) return prev;
  if (!prev) return next;
  const nextDoNotUse = isDoNotUseName(next);
  const prevDoNotUse = isDoNotUseName(prev);
  if (prevDoNotUse && !nextDoNotUse) return next;
  if (!prevDoNotUse && nextDoNotUse) return prev;
  const nextIsCode = Boolean(code) && normalizeReturnsAboveSalesCode(next) === code;
  const prevIsCode = Boolean(code) && normalizeReturnsAboveSalesCode(prev) === code;
  if (prevIsCode && !nextIsCode) return next;
  if (!prevIsCode && nextIsCode) return prev;
  return next.length > prev.length ? next : prev;
}

function voucherKey(date, voucherNumber) {
  return `${date}|${voucherNumber}`;
}

function formatVoucher(entry) {
  const parts = [entry.voucherNumber];
  if (entry.date) parts.push(entry.date);
  if (entry.reference) parts.push(entry.reference);
  return parts.join(" · ");
}

function addVoucher(map, row, amount) {
  const voucherNumber = String(row?.voucher_number || "").trim() || "(no voucher)";
  const date = normalizeReturnsAboveSalesDate(row?.transaction_date);
  const reference = String(row?.reference || "").trim();
  const key = voucherKey(date, voucherNumber);
  const current = map.get(key);
  if (current) {
    current.amount = roundMoney(current.amount + amount);
    if (!current.reference && reference) current.reference = reference;
    return;
  }
  map.set(key, {
    voucherNumber,
    date,
    reference,
    amount: roundMoney(amount),
  });
}

function voucherList(map) {
  return [...map.values()]
    .sort((left, right) => (
      String(left.date).localeCompare(String(right.date))
      || String(left.voucherNumber).localeCompare(String(right.voucherNumber), undefined, { numeric: true })
    ))
    .map(formatVoucher)
    .join("; ");
}

function emptyGroup(customerCode, itemCode) {
  return {
    customerCode,
    customerName: "",
    itemCode,
    itemName: "",
    salesAmount: 0,
    returnAmount: 0,
    salesQuantity: 0,
    returnQuantity: 0,
    salesVouchers: new Map(),
    returnVouchers: new Map(),
  };
}

export function buildReturnsAboveSalesReport(sourceRows = []) {
  const groups = new Map();
  let firstDate = "";
  let lastDate = "";

  (sourceRows || []).forEach((row) => {
    if (isReturnsAboveSalesFooter(row)) return;
    const customerCode = normalizeReturnsAboveSalesCode(row?.customer_code);
    if (!customerCode) return;
    const itemCode = normalizeReturnsAboveSalesCode(row?.item_code);
    const date = normalizeReturnsAboveSalesDate(row?.transaction_date);
    if (date && (!firstDate || date < firstDate)) firstDate = date;
    if (date && (!lastDate || date > lastDate)) lastDate = date;

    const key = `${customerCode}\u0000${itemCode}`;
    const group = groups.get(key) || emptyGroup(customerCode, itemCode);
    group.customerName = preferCustomerName(group.customerName, row?.customer_name);
    group.itemName = preferItemName(group.itemName, row?.item_name, itemCode);

    const amount = Math.abs(Number(row?.sales_amount) || 0);
    const quantity = Math.abs(Number(row?.quantity) || 0);
    if (isReturnsAboveSalesReturn(row)) {
      group.returnAmount += amount;
      group.returnQuantity += quantity;
      addVoucher(group.returnVouchers, row, amount);
    } else {
      group.salesAmount += amount;
      group.salesQuantity += quantity;
      addVoucher(group.salesVouchers, row, amount);
    }
    groups.set(key, group);
  });

  const rows = [...groups.values()]
    .map((group) => {
      const salesAmount = roundMoney(group.salesAmount);
      const returnAmount = roundMoney(group.returnAmount);
      const excessAmount = roundMoney(returnAmount - salesAmount);
      return {
        customerCode: group.customerCode,
        customerName: group.customerName || group.customerCode,
        itemCode: group.itemCode,
        itemName: group.itemName || group.itemCode,
        salesQuantity: roundQty(group.salesQuantity),
        returnQuantity: roundQty(group.returnQuantity),
        salesAmount,
        returnAmount,
        excessAmount,
        salesVouchers: voucherList(group.salesVouchers),
        returnVouchers: voucherList(group.returnVouchers),
      };
    })
    .filter((row) => row.excessAmount > RETURNS_ABOVE_SALES_EPSILON)
    .sort((left, right) => (
      right.excessAmount - left.excessAmount
      || String(left.customerName).localeCompare(String(right.customerName))
      || String(left.itemCode).localeCompare(String(right.itemCode))
    ));

  const summary = rows.reduce((totals, row) => {
    totals.salesAmount = roundMoney(totals.salesAmount + row.salesAmount);
    totals.returnAmount = roundMoney(totals.returnAmount + row.returnAmount);
    totals.excessAmount = roundMoney(totals.excessAmount + row.excessAmount);
    totals.salesQuantity = roundQty(totals.salesQuantity + row.salesQuantity);
    totals.returnQuantity = roundQty(totals.returnQuantity + row.returnQuantity);
    totals.customers.add(row.customerCode);
    return totals;
  }, {
    itemCount: 0,
    customerCount: 0,
    salesAmount: 0,
    returnAmount: 0,
    excessAmount: 0,
    salesQuantity: 0,
    returnQuantity: 0,
    customers: new Set(),
  });

  return {
    rows,
    summary: {
      itemCount: rows.length,
      customerCount: summary.customers.size,
      salesAmount: summary.salesAmount,
      returnAmount: summary.returnAmount,
      excessAmount: summary.excessAmount,
      salesQuantity: summary.salesQuantity,
      returnQuantity: summary.returnQuantity,
    },
    span: {
      firstDate,
      lastDate,
    },
  };
}
