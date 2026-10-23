import * as XLSX from "xlsx";
import { excelDateToIso } from "./receiptRegister.js";
import { toNumber } from "./outstanding.js";
import { settlementTransactionDelta } from "./settlementOpenDelta.js";

/** Float noise only. A posted halala (0.01) is a real difference and stays on its voucher. */
export const TALLY_STATEMENT_TOLERANCE = 0.005;
const VAT_RATIO = 1.15;
const VAT_RATIO_SLACK = 0.03;

const HEADER_ALIASES = {
  date: ["date", "voucher date", "vch date", "transaction date", "txn date"],
  particulars: ["particulars", "ledger name", "narration", "description", "account"],
  vchType: ["voucher type name", "voucher type", "vch type", "vch. type"],
  vchNo: ["voucher number", "voucher no", "voucher no.", "vch no", "vch no.", "vch. no.", "bill no", "invoice no"],
  debit: ["debit amount", "debit", "dr amount", "dr."],
  credit: ["credit amount", "credit", "cr amount", "cr."],
  balance: ["running balance", "closing balance", "balance"],
};

function cellText(value) {
  if (value === undefined || value === null) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return excelDateToIso(value) || "";
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function compactHeader(value) {
  return cellText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findColumnIndex(headerRow, aliases, { exact = false } = {}) {
  const compacted = (headerRow || []).map(compactHeader);
  for (const alias of aliases) {
    const aliasCompact = compactHeader(alias);
    if (!aliasCompact) continue;
    const index = compacted.findIndex((cell) => {
      if (!cell) return false;
      if (cell === aliasCompact) return true;
      if (exact || aliasCompact.length < 4) return false;
      return cell.includes(aliasCompact);
    });
    if (index >= 0) return index;
  }
  return -1;
}

function findExactShortColumn(headerRow, token) {
  const compacted = (headerRow || []).map(compactHeader);
  return compacted.findIndex((cell) => cell === token);
}

export function findTallyStatementHeader(sheetRows) {
  const rows = Array.isArray(sheetRows) ? sheetRows : [];
  for (let index = 0; index < Math.min(rows.length, 40); index += 1) {
    const row = rows[index] || [];
    const date = findColumnIndex(row, HEADER_ALIASES.date);
    let debit = findColumnIndex(row, HEADER_ALIASES.debit);
    let credit = findColumnIndex(row, HEADER_ALIASES.credit);
    if (debit < 0) debit = findExactShortColumn(row, "dr");
    if (credit < 0) credit = findExactShortColumn(row, "cr");
    if (date < 0 || (debit < 0 && credit < 0)) continue;
    return {
      headerRowIndex: index,
      columns: {
        date,
        particulars: findColumnIndex(row, HEADER_ALIASES.particulars),
        vchType: findColumnIndex(row, HEADER_ALIASES.vchType),
        vchNo: findColumnIndex(row, HEADER_ALIASES.vchNo),
        debit,
        credit,
        balance: findColumnIndex(row, HEADER_ALIASES.balance),
      },
    };
  }
  return null;
}

function labelText(particulars, vchType) {
  return `${particulars} ${vchType}`.toLowerCase();
}

function isOpeningLabel(text) {
  return /opening\s*bal/.test(text);
}

function isClosingLabel(text) {
  const normalized = String(text || "").trim().toLowerCase();
  return /closing\s*bal/.test(normalized)
    || /grand\s*total/.test(normalized)
    || normalized === "total"
    || normalized === "current total";
}

function readMoney(value) {
  const text = cellText(value).toLowerCase();
  const amount = Math.abs(toNumber(value));
  const negative = toNumber(value) < 0;
  let side = "";
  if (/\bcr\b|credit/.test(text)) side = "credit";
  else if (/\bdr\b|debit/.test(text)) side = "debit";
  return { amount, negative, side };
}

function pushSide(target, side, amount) {
  if (!amount) return;
  if (side === "debit") target.debit += amount;
  else target.credit += amount;
}

function balanceFromSides(debit, credit, balanceCell) {
  const fromBalance = readMoney(balanceCell);
  if (fromBalance.amount && fromBalance.side) {
    return { amount: fromBalance.amount, side: fromBalance.side };
  }
  if (debit > 0 && credit <= 0) return { amount: debit, side: "debit" };
  if (credit > 0 && debit <= 0) return { amount: credit, side: "credit" };
  if (fromBalance.amount) return { amount: fromBalance.amount, side: fromBalance.side || "debit" };
  return null;
}

export function parseTallyStatementMatrix(sheetRows) {
  const rows = Array.isArray(sheetRows) ? sheetRows : [];
  const header = findTallyStatementHeader(rows);
  if (!header) {
    return {
      entries: [],
      opening: null,
      closing: null,
      error: "Could not find Date and Debit/Credit columns. Export the Tally ledger as Excel with those columns.",
    };
  }

  const { columns } = header;
  const entries = [];
  let opening = null;
  let closing = null;

  for (let index = header.headerRowIndex + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const particulars = columns.particulars >= 0 ? cellText(row[columns.particulars]) : "";
    const vchType = columns.vchType >= 0 ? cellText(row[columns.vchType]) : "";
    const voucher = columns.vchNo >= 0 ? cellText(row[columns.vchNo]) : "";
    const date = excelDateToIso(row[columns.date]);
    const debitCell = columns.debit >= 0 ? readMoney(row[columns.debit]) : { amount: 0, negative: false };
    const creditCell = columns.credit >= 0 ? readMoney(row[columns.credit]) : { amount: 0, negative: false };
    let debit = debitCell.negative ? 0 : debitCell.amount;
    let credit = creditCell.negative ? 0 : creditCell.amount;
    if (debitCell.negative) credit += debitCell.amount;
    if (creditCell.negative) debit += creditCell.amount;

    const label = labelText(particulars, vchType);
    if (!date && !particulars && !voucher && !debit && !credit) continue;

    if (isOpeningLabel(label)) {
      opening = balanceFromSides(debit, credit, columns.balance >= 0 ? row[columns.balance] : "");
      continue;
    }
    if (isClosingLabel(label) || isClosingLabel(particulars)) {
      closing = balanceFromSides(debit, credit, columns.balance >= 0 ? row[columns.balance] : "");
      continue;
    }
    if (!debit && !credit) continue;

    const side = debit >= credit ? "debit" : "credit";
    const amount = side === "debit" ? debit : credit;
    if (debit > 0 && credit > 0 && Math.abs(debit - credit) > TALLY_STATEMENT_TOLERANCE) {
      entries.push({
        date,
        particulars,
        vchType,
        voucher,
        side: "debit",
        amount: debit,
      });
      entries.push({
        date,
        particulars,
        vchType,
        voucher,
        side: "credit",
        amount: credit,
      });
      continue;
    }

    entries.push({
      date,
      particulars,
      vchType,
      voucher,
      side,
      amount,
    });
  }

  return { entries, opening, closing, error: "" };
}

const MONEY_TEXT = /^(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}$/;
const LEDGER_SIDE_MARKER = /^(?:to|by|dr|cr)\.?$/i;

function positionedBox(item) {
  const x = Number(item?.x ?? item?.transform?.[4] ?? 0);
  const y = Number(item?.y ?? item?.transform?.[5] ?? 0);
  const width = Number(item?.width || 0);
  return {
    x,
    y,
    width,
    right: x + width,
    text: cellText(item?.text ?? item?.str ?? ""),
  };
}

function clusterPositionedRows(items) {
  const boxes = (Array.isArray(items) ? items : [])
    .map(positionedBox)
    .filter((item) => item.text);
  boxes.sort((left, right) => right.y - left.y || left.x - right.x);
  const rows = [];
  boxes.forEach((item) => {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - item.y) <= 2) {
      last.items.push(item);
      return;
    }
    rows.push({ y: item.y, items: [item] });
  });
  rows.forEach((row) => row.items.sort((left, right) => left.x - right.x));
  return rows;
}

function headerFromRow(row) {
  const found = {};
  row.items.forEach((item) => {
    const key = compactHeader(item.text);
    if (key === "date") found.date = item;
    if (key === "particulars") found.particulars = item;
    if (key === "vchtype" || key === "vouchertype") found.vchType = item;
    if (key === "vchno" || key === "voucherno" || key === "vouchernumber") found.vchNo = item;
    if (key === "debit") found.debit = item;
    if (key === "credit") found.credit = item;
  });
  if (!found.date || (!found.debit && !found.credit)) return null;
  return found;
}

function nearestTextColumn(item, headers) {
  const keys = ["date", "particulars", "vchType", "vchNo"].filter((key) => headers[key]);
  let bestKey = "";
  let bestDistance = Infinity;
  keys.forEach((key) => {
    const distance = Math.abs(item.x - headers[key].x);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestKey = key;
    }
  });
  return bestKey;
}

function amountColumn(item, headers) {
  // Tally right-aligns each money column. A wide debit still ends before the
  // Credit heading, while a credit amount ends to the right of that heading.
  const creditX = headers.credit?.x;
  if (creditX == null) return "debit";
  return item.right > creditX + 4 ? "credit" : "debit";
}

function joinColumn(items) {
  return items.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
}

function datedText(value) {
  return String(value || "").replace(/(?:\s+(?:dr|cr|to|by)\.?)+$/i, "").trim();
}

function closingSide(text) {
  const label = String(text || "").toLowerCase();
  if (/\bcr\b/.test(label)) return "credit";
  if (/\bdr\b/.test(label)) return "debit";
  return "";
}

const PENDING_HEADER_KEYS = {
  date: new Set(["date"]),
  ref: new Set(["refno", "refnumber", "billno", "billrefno"]),
  person: new Set(["salesperson", "salesman"]),
  amount: new Set(["pending", "pendingamount", "amount"]),
  due: new Set(["dueon", "duedate"]),
  overdue: new Set(["overdue", "overduebydays", "bydays"]),
};

function pendingHeaderKey(text) {
  const key = compactHeader(text);
  const found = Object.entries(PENDING_HEADER_KEYS).find(([, aliases]) => aliases.has(key));
  return found ? found[0] : "";
}

function nearestPendingColumn(item, headers) {
  let bestKey = "";
  let bestDistance = Infinity;
  Object.entries(headers).forEach(([key, header]) => {
    const distance = Math.abs(item.x - header.x);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestKey = key;
    }
  });
  return bestKey;
}

/**
 * Tally Bills Receivable prints Date, Ref. No., and Pending Amount instead of
 * Debit and Credit. Each row is still an open customer bill.
 */
export function parsePendingBillsPositionedPages(pages) {
  const pageList = Array.isArray(pages) ? pages : [];
  const rows = pageList.flatMap((page) => clusterPositionedRows(page));
  const banner = rows.map((row) => joinColumn(row.items)).join(" ").toLowerCase();
  const headers = {};
  rows.forEach((row) => {
    row.items.forEach((item) => {
      const key = pendingHeaderKey(item.text);
      if (!key) return;
      const current = headers[key];
      if (!current || item.y > current.y) headers[key] = item;
    });
  });
  const recognized = Boolean(headers.date && headers.ref && headers.amount && (
    headers.due || headers.overdue || /pending bills|bills receivable/.test(banner)
  ));
  if (!recognized) return null;

  const headerFloor = Math.min(...Object.values(headers).map((item) => item.y)) - 4;
  const entries = [];
  let closing = null;
  rows.forEach((row) => {
    if (row.y >= headerFloor) return;
    const buckets = { date: [], ref: [], person: [], amount: [], due: [], overdue: [] };
    row.items.forEach((item) => {
      if (pendingHeaderKey(item.text)) return;
      const column = nearestPendingColumn(item, headers);
      if (column) buckets[column].push(item);
    });
    const date = excelDateToIso(datedText(joinColumn(buckets.date)));
    const voucher = joinColumn(buckets.ref);
    const person = joinColumn(buckets.person);
    const due = excelDateToIso(joinColumn(buckets.due));
    const overdueDays = toNumber(joinColumn(buckets.overdue));
    const amount = buckets.amount.reduce((total, item) => total + toNumber(item.text), 0);
    if (!amount) return;
    if (!date && !voucher) {
      closing = { amount, side: "debit" };
      return;
    }
    const particulars = [
      person,
      due ? `due ${due}` : "",
      overdueDays ? `${overdueDays}d overdue` : "",
    ].filter(Boolean).join(" · ");
    entries.push({
      date,
      particulars,
      vchType: "Pending bill",
      voucher,
      side: "debit",
      amount,
    });
  });

  if (!entries.length) return null;
  const partial = /page\s+([2-9]|\d{2,})/i.test(banner);
  return {
    entries,
    opening: null,
    closing,
    error: "",
    report: "pending_bills",
    partial,
  };
}

/**
 * Read a Tally ledger PDF after text items have positions.
 * Amount column decides debit vs credit. To/By and Dr/Cr printed beside the
 * date name the other side, so they are not the customer's side.
 */
export function parseTallyStatementPositionedPages(pages) {
  const entries = [];
  let opening = null;
  let closing = null;
  let lastDate = "";
  let sawHeader = false;
  const pageList = Array.isArray(pages) ? pages : [];

  pageList.forEach((page) => {
    let headers = null;
    clusterPositionedRows(page).forEach((row) => {
      const found = headerFromRow(row);
      if (found) {
        headers = found;
        sawHeader = true;
        return;
      }
      if (!headers) return;

      const buckets = {
        date: [],
        particulars: [],
        vchType: [],
        vchNo: [],
        debit: [],
        credit: [],
      };
      row.items.forEach((item) => {
        if (LEDGER_SIDE_MARKER.test(item.text)) return;
        if (MONEY_TEXT.test(item.text)) {
          buckets[amountColumn(item, headers)].push(item);
          return;
        }
        const column = nearestTextColumn(item, headers);
        if (column) buckets[column].push(item);
      });

      const particulars = joinColumn(buckets.particulars);
      const vchType = joinColumn(buckets.vchType);
      const voucher = joinColumn(buckets.vchNo);
      const date = excelDateToIso(datedText(joinColumn(buckets.date)));
      if (date) lastDate = date;
      const label = labelText(particulars, vchType);
      const debit = buckets.debit.reduce((total, item) => total + toNumber(item.text), 0);
      const credit = buckets.credit.reduce((total, item) => total + toNumber(item.text), 0);

      if (/carried over|brought forward/.test(label)) return;
      if (isOpeningLabel(label)) {
        opening = balanceFromSides(debit, credit, "");
        return;
      }
      if (isClosingLabel(label)) {
        const amount = debit || credit;
        const side = closingSide(row.items.map((item) => item.text).join(" "))
          || (debit ? "debit" : "credit");
        if (amount) closing = { amount, side };
        return;
      }
      if (!debit && !credit) return;
      if (!particulars && !voucher) return;

      const side = debit > 0 && credit <= 0 ? "debit" : "credit";
      entries.push({
        date: date || lastDate,
        particulars,
        vchType,
        voucher,
        side,
        amount: side === "debit" ? debit : credit,
      });
    });
  });

  if (!sawHeader || !entries.length) {
    const pending = parsePendingBillsPositionedPages(pageList);
    if (pending?.entries?.length) return pending;
    return {
      entries,
      opening,
      closing,
      error: "Could not read a Tally ledger. Export the customer ledger with Date, Debit, and Credit columns.",
    };
  }
  return { entries, opening, closing, error: "" };
}

export function parseTallyStatementWorkbook(workbook) {
  const names = Array.isArray(workbook?.SheetNames) ? workbook.SheetNames : [];
  let best = null;
  names.forEach((name) => {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      raw: true,
      defval: "",
    });
    const parsed = parseTallyStatementMatrix(matrix);
    if (!best || parsed.entries.length > best.entries.length) {
      best = { ...parsed, sheetName: name };
    }
  });
  if (!best || !best.entries.length) {
    return {
      entries: [],
      opening: null,
      closing: null,
      sheetName: best?.sheetName || "",
      error: best?.error || "No ledger lines found in this file.",
    };
  }
  return best;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function voucherKey(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function vouchersMatch(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length < 3 || !longer.endsWith(shorter)) return false;
  const prefix = longer.slice(0, longer.length - shorter.length);
  return /[A-Z]/.test(prefix);
}

function amountsClose(left, right, tolerance = TALLY_STATEMENT_TOLERANCE) {
  return Math.abs(toNumber(left) - toNumber(right)) <= tolerance;
}

function amountsNear(left, right) {
  const a = toNumber(left);
  const b = toNumber(right);
  if (Math.abs(a - b) <= 1) return true;
  if (a <= 0 || b <= 0) return false;
  const ratio = a / b;
  return Math.abs(ratio - VAT_RATIO) <= VAT_RATIO_SLACK
    || Math.abs(ratio - (1 / VAT_RATIO)) <= VAT_RATIO_SLACK;
}

function dayGap(left, right) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(left) || !/^\d{4}-\d{2}-\d{2}$/.test(right)) return 99;
  const from = Date.parse(`${left}T00:00:00Z`);
  const to = Date.parse(`${right}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 99;
  return Math.abs(Math.round((to - from) / 86400000));
}

function signedAmount(side, amount) {
  const value = toNumber(amount);
  return side === "credit" ? -value : value;
}

function isPurchaseType(value) {
  const text = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  return text === "purchase" || text.startsWith("purchase ") || text.includes("purchase voucher");
}

export function buildSfaStatementEntries({
  invoices = [],
  reversedInvoices = [],
  creditNotes = [],
  receipts = [],
  purchases = [],
  openOnly = false,
} = {}) {
  const entries = [];

  if (openOnly) {
    (Array.isArray(invoices) ? invoices : []).forEach((invoice) => {
      if (invoice?.open_source === "outstanding" || invoice?.tally_only) return;
      const voucher = String(invoice?.voucher_number || "").trim();
      const date = String(invoice?.invoice_date || "").slice(0, 10);
      if (!voucher || !date) return;
      const amount = toNumber(invoice.gross_amount_incl_vat ?? invoice.amount_incl_vat);
      if (amount <= 0) return;
      entries.push({
        date,
        voucher,
        particulars: "Sales",
        vchType: "Sales",
        side: "debit",
        amount,
      });
    });
    return entries;
  }

  (Array.isArray(invoices) ? invoices : []).forEach((invoice) => {
    if (invoice?.open_source === "outstanding" || invoice?.tally_only) return;
    const amount = toNumber(invoice?.amount_incl_vat);
    if (amount <= 0) return;
    const cashSale = Boolean(invoice.cash_sale || invoice.is_cash);
    entries.push({
      date: String(invoice.invoice_date || "").slice(0, 10),
      voucher: String(invoice.voucher_number || "").trim(),
      particulars: cashSale ? "Cash sale" : "Sales",
      vchType: cashSale ? "Cash sale" : "Sales",
      side: "debit",
      amount: toNumber(invoice.gross_amount_incl_vat || invoice.amount_incl_vat),
    });
  });

  (Array.isArray(reversedInvoices) ? reversedInvoices : []).forEach((invoice) => {
    const salesAmount = toNumber(invoice?.amount_incl_vat);
    if (salesAmount > 0) {
      entries.push({
        date: String(invoice.invoice_date || "").slice(0, 10),
        voucher: String(invoice.voucher_number || "").trim(),
        particulars: "Sales",
        vchType: "Sales",
        side: "debit",
        amount: salesAmount,
      });
    }
    const creditAmount = toNumber(invoice?.credit_note_amount);
    if (creditAmount > 0) {
      entries.push({
        date: String(invoice.credit_note_date || invoice.invoice_date || "").slice(0, 10),
        voucher: String(invoice.credit_note_voucher || "").trim(),
        particulars: "Credit note",
        vchType: "Credit Note",
        side: "credit",
        amount: creditAmount,
        reversesVoucher: String(invoice.voucher_number || "").trim(),
      });
    }
  });

  (Array.isArray(creditNotes) ? creditNotes : []).forEach((note) => {
    const amount = toNumber(note?.amount_incl_vat ?? note?.amount);
    if (amount <= 0) return;
    entries.push({
      date: String(note.credit_date || "").slice(0, 10),
      voucher: String(note.voucher_number || "").trim(),
      particulars: String(note.kind || note.voucher_type || "Credit note"),
      vchType: String(note.voucher_type || note.kind || "Credit Note"),
      side: "credit",
      amount,
      reversesVoucher: String(note.reference || note.ref_no || "").trim(),
    });
  });

  (Array.isArray(receipts) ? receipts : []).forEach((receipt) => {
    if (isPurchaseType(receipt?.vch_type)) return;
    const signed = toNumber(receipt?.amount);
    const date = String(receipt?.receipt_date || "").slice(0, 10);
    if (!date || !signed) return;
    const payment = signed < 0;
    entries.push({
      date,
      voucher: String(receipt.vch_no || "").trim(),
      particulars: payment ? "Payment" : "Receipt",
      vchType: String(receipt.vch_type || (payment ? "Payment" : "Receipt")),
      side: payment ? "debit" : "credit",
      amount: Math.abs(signed),
    });
  });

  (Array.isArray(purchases) ? purchases : []).forEach((purchase) => {
    const amount = toNumber(purchase?.amount);
    const date = String(purchase?.purchase_date || purchase?.date || "").slice(0, 10);
    if (!date || amount <= 0) return;
    entries.push({
      date,
      voucher: String(purchase.vch_no || purchase.voucher_number || "").trim(),
      particulars: "Purchase",
      vchType: String(purchase.vch_type || "Purchase"),
      side: "credit",
      amount,
    });
  });

  return entries;
}

function takeMatch(pool, predicate) {
  const hits = pool.filter((row) => !row.used && predicate(row));
  if (!hits.length) return null;
  hits.sort((left, right) => left.rank - right.rank);
  hits[0].used = true;
  return hits[0];
}

function detectVatScale(pairs) {
  const ratios = pairs
    .filter((pair) => pair.tallyAmount > 1 && pair.sfaAmount > 1 && pair.sameSide)
    .map((pair) => pair.tallyAmount / pair.sfaAmount);
  if (ratios.length < 3) return "";
  const sorted = [...ratios].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)];
  const near = (target) => ratios.filter((ratio) => Math.abs(ratio - target) <= VAT_RATIO_SLACK).length;
  if (Math.abs(median - VAT_RATIO) <= VAT_RATIO_SLACK && near(VAT_RATIO) >= Math.ceil(ratios.length * 0.6)) {
    return "tally_gross";
  }
  if (Math.abs(median - (1 / VAT_RATIO)) <= VAT_RATIO_SLACK && near(1 / VAT_RATIO) >= Math.ceil(ratios.length * 0.6)) {
    return "sfa_gross";
  }
  return "";
}

function isRoundOffRow(row) {
  const type = `${row?.vchType || ""} ${row?.particulars || ""}`.toLowerCase();
  const voucher = String(row?.voucher || "");
  return type.includes("round off") || type.includes("roundoff") || /^RO[\s/-]*\d/i.test(voucher);
}

function roundOffBaseKey(row) {
  return voucherKey(row?.voucher).replace(/^RO/, "");
}

function roundOffAmount(row) {
  return roundMoney(Math.max(
    toNumber(row?.tallyDebit),
    toNumber(row?.tallyCredit),
    toNumber(row?.sfaDebit),
    toNumber(row?.sfaCredit),
  ));
}

// RO-1076 is the fils rounding of voucher 1076. When that fils equals the
// invoice gap, the two lines are one rounding and leave the mismatch list.
function settleRoundOffRows(rows) {
  const consumed = new Set();
  rows.forEach((roundOff) => {
    if (consumed.has(roundOff) || !isRoundOffRow(roundOff)) return;
    const baseKey = roundOffBaseKey(roundOff);
    const amount = roundOffAmount(roundOff);
    if (!baseKey || amount <= TALLY_STATEMENT_TOLERANCE) return;
    const base = rows.find((row) => (
      row !== roundOff
      && !consumed.has(row)
      && !isRoundOffRow(row)
      && voucherKey(row.voucher) === baseKey
      && Math.abs(Math.abs(row.difference) - amount) <= TALLY_STATEMENT_TOLERANCE
    ));
    if (!base) return;
    if (base.difference > 0) {
      base.sfaDebit = roundMoney(base.sfaDebit + base.difference);
    } else if (base.difference < 0) {
      base.sfaCredit = roundMoney(base.sfaCredit + Math.abs(base.difference));
    }
    base.difference = roundMoney((base.tallyDebit - base.tallyCredit) - (base.sfaDebit - base.sfaCredit));
    base.status = "matched";
    base.leadsGap = false;
    consumed.add(roundOff);
  });
  return rows.filter((row) => !consumed.has(row));
}

function numericVoucherTail(value) {
  const match = String(value || "").match(/(\d+)\s*$/);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : null;
}

function entryAmount(row) {
  return roundMoney(Math.max(
    toNumber(row?.tallyDebit),
    toNumber(row?.tallyCredit),
    toNumber(row?.sfaDebit),
    toNumber(row?.sfaCredit),
  ));
}

function entryIsCredit(row) {
  const credit = toNumber(row?.tallyCredit) + toNumber(row?.sfaCredit);
  const debit = toNumber(row?.tallyDebit) + toNumber(row?.sfaDebit);
  return credit > debit;
}

// JV/MAY/00001 is already matched, so DG-JV/MAY/00001 on the same day and amount
// is a second copy. Receipt 1880 likewise already covers receipt 1879.
function dropMatchedSfaCopies(rows) {
  const matched = rows.filter((row) => row.status === "matched");
  return rows.filter((row) => {
    if (row.status !== "sfa_only") return true;
    const amount = entryAmount(row);
    const credit = entryIsCredit(row);
    return !matched.some((other) => {
      if (other.date !== row.date || entryIsCredit(other) !== credit) return false;
      if (Math.abs(entryAmount(other) - amount) > TALLY_STATEMENT_TOLERANCE) return false;
      const copyKey = voucherKey(row.voucher);
      const baseKey = voucherKey(other.voucher);
      if (baseKey && copyKey !== baseKey && (copyKey === `DG${baseKey}` || copyKey === `VATDG${baseKey}` || copyKey.endsWith(baseKey))) {
        return true;
      }
      const copyNo = numericVoucherTail(row.voucher);
      const baseNo = numericVoucherTail(other.voucher);
      return copyNo != null && baseNo != null && Math.abs(copyNo - baseNo) === 1;
    });
  });
}

function sameVoucher(left, right) {
  const a = voucherKey(left);
  const b = voucherKey(right);
  return Boolean(a && b && (a === b || vouchersMatch(a, b)));
}

// Credit note 33 reverses sales 1583. A +0.10 fils on the sale and −0.10 on
// the note are the same rounding and leave the mismatch list together.
function settleCrossedReversals(rows) {
  rows.forEach((credit) => {
    const target = credit.reversesVoucher;
    if (!target || Math.abs(credit.difference) <= TALLY_STATEMENT_TOLERANCE) return;
    const sale = rows.find((row) => (
      row !== credit
      && sameVoucher(row.voucher, target)
      && (row.tallyDebit > 0 || row.sfaDebit > 0)
      && Math.abs(row.difference) > TALLY_STATEMENT_TOLERANCE
      && Math.abs(row.difference + credit.difference) <= TALLY_STATEMENT_TOLERANCE
    ));
    if (!sale) return;
    sale.status = "matched";
    credit.status = "matched";
    sale.difference = 0;
    credit.difference = 0;
    sale.leadsGap = false;
    credit.leadsGap = false;
  });
  return rows;
}

function voucherTail(value) {
  const match = String(value || "").trim().match(/(\d+)\s*$/);
  if (!match) return "";
  return match[1].replace(/^0+(?=\d)/, "");
}

function clearCrossedRow(row) {
  row.status = "matched";
  row.difference = 0;
  row.leadsGap = false;
}

// Invoice 1769 is reversed by credit note 48, so DG-1769 and VAT-DG-1769
// cross DG-48 and VAT-DG-48 when the amounts are equal and opposite.
function settleReversedFamilies(rows) {
  const pairs = [];
  rows.forEach((row) => {
    const invoiceTail = voucherTail(row.reversesVoucher);
    const creditTail = voucherTail(row.voucher);
    if (!invoiceTail || !creditTail || invoiceTail === creditTail) return;
    if (pairs.some((pair) => pair.invoiceTail === invoiceTail && pair.creditTail === creditTail)) return;
    pairs.push({ invoiceTail, creditTail });
  });

  pairs.forEach(({ invoiceTail, creditTail }) => {
    const invoiceRows = rows.filter((row) => (
      voucherTail(row.voucher) === invoiceTail
      && Math.abs(row.difference) > TALLY_STATEMENT_TOLERANCE
    ));
    const creditRows = rows.filter((row) => (
      voucherTail(row.voucher) === creditTail
      && Math.abs(row.difference) > TALLY_STATEMENT_TOLERANCE
    ));
    invoiceRows.forEach((invoiceRow) => {
      if (Math.abs(invoiceRow.difference) <= TALLY_STATEMENT_TOLERANCE) return;
      const match = creditRows.find((creditRow) => (
        Math.abs(creditRow.difference) > TALLY_STATEMENT_TOLERANCE
        && Math.abs(invoiceRow.difference + creditRow.difference) <= TALLY_STATEMENT_TOLERANCE
      ));
      if (!match) return;
      clearCrossedRow(invoiceRow);
      clearCrossedRow(match);
    });
  });
  return rows;
}

// Sales 1825, discount 1825, and VAT-DG-1825 are one voucher. When their
// differences add up to zero they leave the mismatch list together.
function settleNetZeroVoucherGroups(rows) {
  const groups = [];
  rows.forEach((row) => {
    if (!voucherKey(row.voucher)) return;
    const group = groups.find((items) => items.some((other) => sameVoucher(other.voucher, row.voucher)));
    if (group) group.push(row);
    else groups.push([row]);
  });
  groups.forEach((group) => {
    const open = group.filter((row) => Math.abs(row.difference) > TALLY_STATEMENT_TOLERANCE);
    if (open.length < 2) return;
    const net = roundMoney(open.reduce((total, row) => total + row.difference, 0));
    if (Math.abs(net) > TALLY_STATEMENT_TOLERANCE) return;
    open.forEach((row) => {
      row.status = "matched";
      row.difference = 0;
      row.leadsGap = false;
    });
  });
  return rows;
}

function lineFromPair(tally, sfa, index) {
  const tallyDebit = tally?.side === "debit" ? roundMoney(tally.amount) : 0;
  const tallyCredit = tally?.side === "credit" ? roundMoney(tally.amount) : 0;
  const sfaDebit = sfa?.side === "debit" ? roundMoney(sfa.amount) : 0;
  const sfaCredit = sfa?.side === "credit" ? roundMoney(sfa.amount) : 0;
  const difference = roundMoney((tallyDebit - tallyCredit) - (sfaDebit - sfaCredit));
  let status = "matched";
  if (!tally) status = "sfa_only";
  else if (!sfa) status = "tally_only";
  else if (!amountsClose(Math.abs(tallyDebit - tallyCredit), Math.abs(sfaDebit - sfaCredit)) || Math.sign(difference) !== 0 && Math.abs(difference) > TALLY_STATEMENT_TOLERANCE) {
    status = "amount";
  }
  if (tally && sfa && tally.side !== sfa.side) status = "amount";
  if (Math.abs(difference) <= TALLY_STATEMENT_TOLERANCE && tally && sfa && tally.side === sfa.side) {
    status = "matched";
  }

  return {
    id: `${index}-${tally?.date || sfa?.date || ""}-${tally?.voucher || sfa?.voucher || ""}`,
    date: tally?.date || sfa?.date || "",
    voucher: tally?.voucher || sfa?.voucher || "",
    vchType: tally?.vchType || sfa?.vchType || "",
    particulars: tally?.particulars || sfa?.particulars || "",
    status,
    tallyDebit,
    tallyCredit,
    sfaDebit,
    sfaCredit,
    difference,
    runningGap: 0,
    leadsGap: false,
    reversesVoucher: sfa?.reversesVoucher || "",
  };
}

export function compareTallyStatement(tallyParsed, sfaEntries = []) {
  const tallyEntries = Array.isArray(tallyParsed?.entries) ? tallyParsed.entries : [];
  const dated = tallyEntries.map((row) => row.date).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  const from = dated[0] || "";
  const to = dated[dated.length - 1] || "";
  const pendingBills = tallyParsed?.report === "pending_bills";
  const windowedSfa = (Array.isArray(sfaEntries) ? sfaEntries : []).filter((row) => {
    if (pendingBills || !from || !to || !row?.date) return true;
    return row.date >= from && row.date <= to;
  });

  const pool = windowedSfa.map((row, index) => ({ ...row, used: false, index }));

  function rankAgainst(row, tally) {
    const sidePenalty = row.side === tally.side ? 0 : 1000;
    const amountPenalty = Math.abs(toNumber(row.amount) - toNumber(tally.amount));
    return sidePenalty + amountPenalty + (dayGap(row.date, tally.date) * 0.01);
  }

  function claim(tally, predicate) {
    const hits = pool.filter((row) => !row.used && predicate(row));
    hits.forEach((row) => { row.rank = rankAgainst(row, tally); });
    return takeMatch(pool, (row) => hits.includes(row));
  }

  const pairs = [];
  const unmatchedTally = [];
  tallyEntries.forEach((tally) => {
    const key = voucherKey(tally.voucher);
    const sfa = key ? claim(tally, (row) => voucherKey(row.voucher) === key) : null;
    if (sfa) pairs.push({ tally, sfa });
    else unmatchedTally.push(tally);
  });

  // The same receipt is often stored under a different voucher number.
  // Pair it once, by date, side, and amount, before a short number can grab another document.
  const afterAmount = [];
  unmatchedTally.forEach((tally) => {
    const sfa = claim(tally, (row) => (
      row.date === tally.date
      && row.side === tally.side
      && amountsClose(row.amount, tally.amount)
    ));
    if (sfa) pairs.push({ tally, sfa });
    else afterAmount.push(tally);
  });

  afterAmount.forEach((tally) => {
    const key = voucherKey(tally.voucher);
    let sfa = key
      ? claim(tally, (row) => vouchersMatch(voucherKey(row.voucher), key) && amountsNear(row.amount, tally.amount))
      : null;
    if (!sfa && !key) {
      const loose = pool.filter((row) => (
        !row.used
        && row.date === tally.date
        && row.side === tally.side
        && amountsClose(row.amount, tally.amount)
      ));
      if (loose.length === 1) {
        loose[0].used = true;
        sfa = loose[0];
      }
    }
    pairs.push({ tally, sfa });
  });

  if (!pendingBills) {
    pool.filter((row) => !row.used).forEach((sfa) => {
      pairs.push({ tally: null, sfa });
    });
  }

  const vatScale = detectVatScale(pairs.map((pair) => ({
    tallyAmount: toNumber(pair.tally?.amount),
    sfaAmount: toNumber(pair.sfa?.amount),
    sameSide: Boolean(pair.tally && pair.sfa && pair.tally.side === pair.sfa.side),
  })));

  const rows = pairs.map((pair, index) => {
    const line = lineFromPair(pair.tally, pair.sfa, index);
    if (vatScale && line.status === "amount" && pair.tally && pair.sfa && pair.tally.side === pair.sfa.side) {
      const ratio = toNumber(pair.tally.amount) / toNumber(pair.sfa.amount);
      const target = vatScale === "tally_gross" ? VAT_RATIO : 1 / VAT_RATIO;
      if (Math.abs(ratio - target) <= VAT_RATIO_SLACK) line.status = "vat";
    }
    return line;
  });

  rows.sort((left, right) => {
    const leftDate = left.date || "9999-99-99";
    const rightDate = right.date || "9999-99-99";
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    return String(left.voucher).localeCompare(String(right.voucher));
  });

  const settledRows = dropMatchedSfaCopies(settleNetZeroVoucherGroups(
    settleReversedFamilies(settleCrossedReversals(settleRoundOffRows(rows))),
  ));

  let running = 0;
  let leadIndex = -1;
  settledRows.forEach((row, index) => {
    running = roundMoney(running + row.difference);
    row.runningGap = running;
    if (leadIndex < 0 && Math.abs(running) > TALLY_STATEMENT_TOLERANCE) {
      leadIndex = index;
      row.leadsGap = true;
    }
  });

  const sum = (pick) => roundMoney(settledRows.reduce((total, row) => total + pick(row), 0));
  const tallyDebit = sum((row) => row.tallyDebit);
  const tallyCredit = sum((row) => row.tallyCredit);
  const sfaDebit = sum((row) => row.sfaDebit);
  const sfaCredit = sum((row) => row.sfaCredit);
  const difference = roundMoney((tallyDebit - tallyCredit) - (sfaDebit - sfaCredit));
  const issueCount = settledRows.filter((row) => row.status !== "matched").length;

  return {
    from,
    to,
    opening: tallyParsed?.opening || null,
    closing: tallyParsed?.closing || null,
    sheetName: tallyParsed?.sheetName || "",
    vatScale,
    rows: settledRows,
    lead: leadIndex >= 0 ? settledRows[leadIndex] : null,
    totals: {
      tallyDebit,
      tallyCredit,
      sfaDebit,
      sfaCredit,
      tallyNet: roundMoney(tallyDebit - tallyCredit),
      sfaNet: roundMoney(sfaDebit - sfaCredit),
      difference,
      matchedCount: settledRows.length - issueCount,
      issueCount,
      agrees: Math.abs(difference) <= TALLY_STATEMENT_TOLERANCE,
    },
  };
}

function subsetSumIndexes(items, targetCents) {
  const limit = items.length > 18 ? 18 : items.length;
  const pool = items
    .slice()
    .sort((left, right) => Math.abs(right.cents) - Math.abs(left.cents))
    .slice(0, limit);
  let best = null;
  const chosen = [];

  function walk(start, sum) {
    if (Math.abs(sum - targetCents) <= 5) {
      if (!best || chosen.length < best.length) best = chosen.slice();
      return;
    }
    if (best && chosen.length >= best.length) return;
    for (let index = start; index < pool.length; index += 1) {
      if (best && chosen.length + 1 >= best.length) break;
      chosen.push(pool[index].index);
      walk(index + 1, sum + pool[index].cents);
      chosen.pop();
    }
  }

  walk(0, 0);
  return best;
}

/**
 * Customer Audit Open Δ is Machine Open minus the outstanding-file total.
 * The statement movement also includes ledger lines that are not in that file
 * (a later sale, an unallocated receipt, a purchase). Those lines are returned
 * separately so the statement difference equals Open Δ.
 * Difference is SFA minus Tally, the same sign as Open Δ.
 */
export function reconcileStatementToOpenDelta(result, { machineOpen, tallyOpen } = {}) {
  const machine = Number(machineOpen);
  const tally = Number(tallyOpen);
  if (!result?.rows || !Number.isFinite(machine) || !Number.isFinite(tally)) return result;

  const openDelta = roundMoney(machine - tally);
  const tallyNet = Number(result.totals?.tallyNet || 0);
  const sfaNet = Number(result.totals?.sfaNet || 0);
  const bridgeTarget = roundMoney((tallyNet - tally) - (sfaNet - machine));
  const rows = result.rows.map((row) => ({ ...row, leadsGap: false }));

  let bridgeIndexes = [];
  if (Math.abs(bridgeTarget) > TALLY_STATEMENT_TOLERANCE) {
    const candidates = [];
    rows.forEach((row, index) => {
      const tallyAmount = Math.abs(row.tallyDebit) + Math.abs(row.tallyCredit);
      const sfaAmount = Math.abs(row.sfaDebit) + Math.abs(row.sfaCredit);
      const oneSided = tallyAmount <= TALLY_STATEMENT_TOLERANCE || sfaAmount <= TALLY_STATEMENT_TOLERANCE;
      if (!oneSided || Math.abs(row.difference) <= TALLY_STATEMENT_TOLERANCE) return;
      candidates.push({ index, cents: Math.round(Number(row.difference) * 100) });
    });
    const picked = subsetSumIndexes(candidates, Math.round(bridgeTarget * 100));
    if (!picked) return result;
    bridgeIndexes = picked;
  }

  const bridgeSet = new Set(bridgeIndexes);
  const bridgeRows = [];
  const kept = [];
  rows.forEach((row, index) => {
    const next = { ...row, difference: roundMoney(-Number(row.difference || 0)) };
    if (bridgeSet.has(index)) bridgeRows.push(next);
    else kept.push(next);
  });

  let running = 0;
  let leadIndex = -1;
  kept.forEach((row, index) => {
    running = roundMoney(running + row.difference);
    row.runningGap = running;
    if (leadIndex < 0 && row.status !== "matched" && Math.abs(running) > TALLY_STATEMENT_TOLERANCE) {
      leadIndex = index;
      row.leadsGap = true;
    }
  });

  const difference = roundMoney(kept.reduce((total, row) => total + row.difference, 0));
  if (Math.abs(difference - openDelta) > TALLY_STATEMENT_TOLERANCE) return result;

  return {
    ...result,
    rows: kept,
    bridgeRows,
    lead: leadIndex >= 0 ? kept[leadIndex] : null,
    reconciledToOpenDelta: true,
    totals: {
      ...result.totals,
      difference,
      openDelta: difference,
      issueCount: kept.filter((row) => row.status !== "matched").length,
      agrees: Math.abs(difference) <= TALLY_STATEMENT_TOLERANCE,
    },
  };
}

function tallyTransactionForVoucher(rows, voucher) {
  const key = voucherKey(voucher);
  if (!key) return null;
  return (Array.isArray(rows) ? rows : []).find((row) => (
    voucherKey(row.voucher) === key
    && (Number(row.tallyDebit) > 0 || Number(row.tallyCredit) > 0)
  )) || null;
}

/**
 * The statement difference is the same total as invoice Open Δ.
 * The debit columns show the Tally transaction and the SFA sales amount.
 * Voucher lines that do not add up to that total stay in the bridge.
 */
export function alignStatementToInvoiceOpen(result, invoices = [], { machineOpen, tallyOpen } = {}) {
  const machine = Number(machineOpen);
  const tally = Number(tallyOpen);
  if (!result?.rows || !Number.isFinite(machine) || !Number.isFinite(tally)) return result;

  const openDelta = roundMoney(machine - tally);
  if (result.reconciledToOpenDelta && Math.abs(Number(result.totals?.difference) - openDelta) <= TALLY_STATEMENT_TOLERANCE) {
    return result;
  }

  const openRows = [];
  (Array.isArray(invoices) ? invoices : []).forEach((invoice, index) => {
    const delta = settlementTransactionDelta(invoice);
    if (delta == null || Math.abs(delta) <= TALLY_STATEMENT_TOLERANCE) return;
    const tallyAmount = roundMoney(invoice.outstanding_pending);
    const machineAmount = roundMoney(invoice.remaining);
    const sales = roundMoney(invoice.gross_amount_incl_vat ?? invoice.amount_incl_vat ?? 0);
    const tallyLine = tallyTransactionForVoucher(result.rows, invoice.voucher_number);
    openRows.push({
      id: `open-${index}-${invoice.voucher_number || ""}`,
      date: String(invoice.invoice_date || "").slice(0, 10),
      voucher: String(invoice.voucher_number || ""),
      vchType: tallyLine?.vchType || "Sales",
      particulars: "SFA sales",
      status: "amount",
      tallyDebit: tallyLine ? roundMoney(tallyLine.tallyDebit) : (tallyAmount > 0 ? tallyAmount : 0),
      tallyCredit: tallyLine ? roundMoney(tallyLine.tallyCredit) : 0,
      sfaDebit: sales > 0 ? sales : (machineAmount > 0 ? machineAmount : 0),
      sfaCredit: 0,
      difference: delta,
      runningGap: 0,
      leadsGap: false,
    });
  });
  openRows.sort((left, right) => String(left.date).localeCompare(String(right.date))
    || String(left.voucher).localeCompare(String(right.voucher)));

  let running = 0;
  let leadIndex = -1;
  openRows.forEach((row, index) => {
    running = roundMoney(running + row.difference);
    row.runningGap = running;
    if (leadIndex < 0 && Math.abs(running) > TALLY_STATEMENT_TOLERANCE) {
      leadIndex = index;
      row.leadsGap = true;
    }
  });

  const bridgeRows = [
    ...(Array.isArray(result.bridgeRows) ? result.bridgeRows : []),
    ...result.rows.filter((row) => row.status !== "matched").map((row) => ({
      ...row,
      leadsGap: false,
      difference: roundMoney(result.reconciledToOpenDelta ? Number(row.difference) : -Number(row.difference || 0)),
    })),
  ];
  const difference = roundMoney(openRows.reduce((total, row) => total + row.difference, 0));

  return {
    ...result,
    rows: openRows,
    bridgeRows,
    lead: leadIndex >= 0 ? openRows[leadIndex] : null,
    reconciledToOpenDelta: true,
    totals: {
      ...result.totals,
      difference,
      openDelta: difference,
      issueCount: openRows.length,
      agrees: Math.abs(difference) <= TALLY_STATEMENT_TOLERANCE,
    },
  };
}
