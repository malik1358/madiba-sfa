import * as XLSX from "xlsx";
import { excelDateToIso } from "./receiptRegister.js";
import { toNumber } from "./outstanding.js";

export const TALLY_STATEMENT_TOLERANCE = 0.05;
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

const MONEY_TEXT = /^\d{1,3}(?:,\d{3})*\.\d{2}$/;

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
  return String(value || "").replace(/\s+(dr|cr)\.?$/i, "").trim();
}

function closingSide(text) {
  const label = String(text || "").toLowerCase();
  if (/\bcr\b/.test(label)) return "credit";
  if (/\bdr\b/.test(label)) return "debit";
  return "";
}

/**
 * Read a Tally ledger PDF after text items have positions.
 * Amount column decides debit vs credit. The Dr/Cr printed beside the date
 * is the other ledger, so it is not the customer's side.
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

export function buildSfaStatementEntries({
  invoices = [],
  reversedInvoices = [],
  creditNotes = [],
  receipts = [],
  purchases = [],
} = {}) {
  const entries = [];

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
    });
  });

  (Array.isArray(receipts) ? receipts : []).forEach((receipt) => {
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
  };
}

export function compareTallyStatement(tallyParsed, sfaEntries = []) {
  const tallyEntries = Array.isArray(tallyParsed?.entries) ? tallyParsed.entries : [];
  const dated = tallyEntries.map((row) => row.date).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  const from = dated[0] || "";
  const to = dated[dated.length - 1] || "";
  const windowedSfa = (Array.isArray(sfaEntries) ? sfaEntries : []).filter((row) => {
    if (!from || !to || !row?.date) return true;
    return row.date >= from && row.date <= to;
  });

  const pool = windowedSfa.map((row, index) => ({ ...row, used: false, index }));

  function rankAgainst(row, tally) {
    const sidePenalty = row.side === tally.side ? 0 : 1000;
    const amountPenalty = Math.abs(toNumber(row.amount) - toNumber(tally.amount));
    return sidePenalty + amountPenalty + (dayGap(row.date, tally.date) * 0.01);
  }

  const pairs = tallyEntries.map((tally) => {
    const key = voucherKey(tally.voucher);
    let sfa = null;
    if (key) {
      const exact = pool.filter((row) => !row.used && voucherKey(row.voucher) === key);
      exact.forEach((row) => { row.rank = rankAgainst(row, tally); });
      sfa = takeMatch(pool, (row) => exact.includes(row));
      if (!sfa) {
        const fuzzy = pool.filter((row) => !row.used && vouchersMatch(voucherKey(row.voucher), key));
        fuzzy.forEach((row) => { row.rank = rankAgainst(row, tally); });
        sfa = takeMatch(pool, (row) => fuzzy.includes(row));
      }
    }
    if (!sfa) {
      const loose = pool.filter((row) => (
        !row.used
        && row.date === tally.date
        && row.side === tally.side
        && amountsClose(row.amount, tally.amount)
      ));
      if (loose.length === 1 && !key) {
        loose[0].used = true;
        sfa = loose[0];
      }
    }
    return { tally, sfa };
  });

  pool.filter((row) => !row.used).forEach((sfa) => {
    pairs.push({ tally: null, sfa });
  });

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

  const settledRows = settleRoundOffRows(rows);

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
