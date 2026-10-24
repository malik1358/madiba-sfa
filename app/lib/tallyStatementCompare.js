import * as XLSX from "xlsx";
import { excelDateToIso } from "./receiptRegister.js";
import { toNumber } from "./outstanding.js";

/** Float noise only. A posted halala (0.01) is a real difference and stays on its voucher. */
export const TALLY_STATEMENT_TOLERANCE = 0.005;

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

function plainVoucherNumber(value) {
  const key = voucherKey(value);
  const stripped = key.replace(/^(?:SI|INV|BILL|P)(?=\d+$)/, "");
  return stripped || key;
}

function sameVoucherNumber(left, right) {
  const a = plainVoucherNumber(left);
  const b = plainVoucherNumber(right);
  return Boolean(a && b && a === b);
}

function amountsClose(left, right, tolerance = TALLY_STATEMENT_TOLERANCE) {
  return Math.abs(toNumber(left) - toNumber(right)) <= tolerance;
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

function claimSfaLine(pool, tally) {
  const hits = pool.filter((row) => !row.used && sameVoucherNumber(row.voucher, tally.voucher));
  if (!hits.length) return null;
  hits.sort((left, right) => {
    const leftSide = left.side === tally.side ? 0 : 1;
    const rightSide = right.side === tally.side ? 0 : 1;
    if (leftSide !== rightSide) return leftSide - rightSide;
    return Math.abs(toNumber(left.amount) - toNumber(tally.amount)) - Math.abs(toNumber(right.amount) - toNumber(tally.amount));
  });
  hits[0].used = true;
  return hits[0];
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

  const pairs = tallyEntries.map((tally) => ({
    tally,
    sfa: String(tally?.voucher || "").trim() ? claimSfaLine(pool, tally) : null,
  }));
  if (!pendingBills) {
    pool.filter((row) => !row.used).forEach((sfa) => {
      pairs.push({ tally: null, sfa });
    });
  }

  const rows = pairs.map((pair, index) => lineFromPair(pair.tally, pair.sfa, index));
  rows.sort((left, right) => {
    const leftDate = left.date || "9999-99-99";
    const rightDate = right.date || "9999-99-99";
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    return String(left.voucher).localeCompare(String(right.voucher));
  });

  let running = 0;
  let leadIndex = -1;
  rows.forEach((row, index) => {
    running = roundMoney(running + row.difference);
    row.runningGap = running;
    if (leadIndex < 0 && row.status !== "matched" && Math.abs(row.difference) > TALLY_STATEMENT_TOLERANCE) {
      leadIndex = index;
      row.leadsGap = true;
    }
  });

  const sum = (pick) => roundMoney(rows.reduce((total, row) => total + pick(row), 0));
  const tallyDebit = sum((row) => row.tallyDebit);
  const tallyCredit = sum((row) => row.tallyCredit);
  const sfaDebit = sum((row) => row.sfaDebit);
  const sfaCredit = sum((row) => row.sfaCredit);
  const difference = roundMoney((tallyDebit - tallyCredit) - (sfaDebit - sfaCredit));
  const issueCount = rows.filter((row) => row.status !== "matched").length;

  return {
    from,
    to,
    opening: tallyParsed?.opening || null,
    closing: tallyParsed?.closing || null,
    sheetName: tallyParsed?.sheetName || "",
    rows,
    lead: leadIndex >= 0 ? rows[leadIndex] : null,
    totals: {
      tallyDebit,
      tallyCredit,
      sfaDebit,
      sfaCredit,
      tallyNet: roundMoney(tallyDebit - tallyCredit),
      sfaNet: roundMoney(sfaDebit - sfaCredit),
      difference,
      matchedCount: rows.length - issueCount,
      issueCount,
      agrees: Math.abs(difference) <= TALLY_STATEMENT_TOLERANCE && issueCount === 0,
    },
  };
}
