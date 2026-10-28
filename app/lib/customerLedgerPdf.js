import { addPdfBuildFooter, getClientBuildId } from "./buildInfo.js";
import {
  flattenLedgerLinesExcludingReversed,
  openSettlementInvoices,
} from "./datewiseLines.js";
import { getKsaDateString } from "./workdayActivity.js";

const COLORS = {
  headerBg: [15, 76, 92],
  headerText: [255, 255, 255],
  zebraBg: [242, 248, 249],
  bodyText: [20, 20, 20],
  mutedText: [74, 100, 107],
  totalBg: [232, 241, 243],
  border: [164, 183, 188],
  accent: [15, 76, 92],
  open: [180, 35, 24],
};

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function formatLedgerMoney(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatBalanceSide(value) {
  const amount = roundMoney(value);
  if (Math.abs(amount) <= 0.009) return "0.00";
  const abs = formatLedgerMoney(Math.abs(amount));
  return amount > 0 ? `${abs} Dr` : `${abs} Cr`;
}

function formatDisplayDate(isoDate) {
  const raw = String(isoDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw || "—";
  const [year, month, day] = raw.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day}-${months[Number(month) - 1]}-${year}`;
}

/**
 * Map one datewise ledger line to party-ledger Debit / Credit.
 * Customer AR: sales debit; receipts / CN / purchase settlements credit;
 * Payment leftovers that increase AR (negative collected) debit.
 */
export function ledgerLineDebitCredit(row) {
  const kind = String(row?.kind || "").trim();
  const sales = row?.sales_incl_vat == null ? null : Number(row.sales_incl_vat);
  const collected = row?.collected_amount == null ? null : Number(row.collected_amount);
  const purchaseAmount = Number(row?.purchase_amount || 0);

  if (kind === "Invoice") {
    return { debit: roundMoney(Math.max(0, sales || 0)), credit: 0 };
  }
  if (/credit|return/i.test(kind)) {
    const amount = sales == null ? 0 : Math.abs(sales);
    return { debit: 0, credit: roundMoney(amount) };
  }
  if (kind === "Receipt") {
    return { debit: 0, credit: roundMoney(Math.max(0, collected || 0)) };
  }
  if (kind === "Payment") {
    const amount = collected || 0;
    if (amount < -0.009) return { debit: roundMoney(Math.abs(amount)), credit: 0 };
    if (amount > 0.009) return { debit: 0, credit: roundMoney(amount) };
    return { debit: 0, credit: 0 };
  }
  if (kind === "Purchase") {
    return { debit: 0, credit: roundMoney(Math.max(0, purchaseAmount)) };
  }
  return { debit: 0, credit: 0 };
}

export function ledgerLineParticulars(row) {
  const kind = String(row?.kind || "Entry").trim() || "Entry";
  const detail = String(row?.detail || "").trim();
  if (!detail || detail === "—") return kind;
  if (kind === "Invoice") return `Sales — ${detail}`;
  return `${kind} — ${detail}`;
}

/**
 * Running-balance party ledger rows for balance confirmation.
 * Balance is positive when the customer owes (Dr).
 */
export function buildBalanceConfirmationLedgerRows(lines = []) {
  let balance = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows = [];

  (Array.isArray(lines) ? lines : []).forEach((line) => {
    const { debit, credit } = ledgerLineDebitCredit(line);
    if (debit <= 0.009 && credit <= 0.009) return;
    balance = roundMoney(balance + debit - credit);
    totalDebit = roundMoney(totalDebit + debit);
    totalCredit = roundMoney(totalCredit + credit);
    rows.push({
      date: line.date || "",
      particulars: ledgerLineParticulars(line),
      voucher: line.voucher || "—",
      debit,
      credit,
      balance,
    });
  });

  return {
    rows,
    totalDebit,
    totalCredit,
    closingBalance: balance,
  };
}

export function buildCustomerLedgerPdfModel({
  customer = null,
  ledger = null,
  asOfDate = "",
  lines = null,
} = {}) {
  if (!customer || !ledger) return null;

  const code = String(customer.customer_code || "").trim();
  const name = String(customer.customer_name || "").trim();
  const ledgerLines = Array.isArray(lines)
    ? lines
    : flattenLedgerLinesExcludingReversed(ledger.datewise || []);
  const statement = buildBalanceConfirmationLedgerRows(ledgerLines);
  const openInvoices = openSettlementInvoices(ledger.invoices || []);
  const reversedInvoices = Array.isArray(ledger.reversedInvoices) ? ledger.reversedInvoices : [];
  const dates = statement.rows.map((row) => row.date).filter(Boolean).sort();
  const statementDate = String(asOfDate || getKsaDateString() || "").trim();
  const openTotal = roundMoney(openInvoices.reduce((total, row) => total + Number(row.remaining || 0), 0));
  const closing = statement.closingBalance;

  return {
    companyName: "MADIBA",
    title: "Customer Account Statement",
    subtitle: "Balance Confirmation",
    customerCode: code,
    customerName: name,
    customerLabel: name ? `${code} — ${name}` : code,
    statementDate,
    periodFrom: dates[0] || "",
    periodTo: dates[dates.length - 1] || statementDate,
    ledger: statement,
    openInvoices: openInvoices.map((row) => ({
      invoice_date: row.invoice_date || "",
      voucher_number: row.voucher_number || "—",
      amount_incl_vat: roundMoney(row.amount_incl_vat),
      paid_amount: roundMoney(row.paid_amount),
      remaining: roundMoney(row.remaining),
      status: row.status || "Open",
      days: row.payment_days != null
        ? String(row.payment_days)
        : (row.open_days > 0 ? `Open ${row.open_days}d` : "—"),
    })),
    openTotal,
    reversedInvoices: reversedInvoices.map((row) => ({
      invoice_date: row.invoice_date || "",
      voucher_number: row.voucher_number || "—",
      amount_incl_vat: roundMoney(row.amount_incl_vat),
      credit_note_date: row.credit_note_date || "",
      credit_note_voucher: row.credit_note_voucher || "—",
      credit_note_amount: roundMoney(row.credit_note_amount),
    })),
    confirmationText: [
      `As per our books, the account of ${name || code || "the customer"}`,
      `(Code ${code || "—"}) shows a closing balance of SAR ${formatBalanceSide(closing)}`,
      `as on ${formatDisplayDate(statementDate)}.`,
      "Immediate credit-note reversals are excluded from this ledger and listed separately.",
      "Kindly confirm that this balance agrees with your records and return a signed copy.",
    ].join(" "),
    filename: `balance-confirmation-${code || "customer"}-${statementDate || "statement"}`,
  };
}

function fillHeader(doc, x, y, width, height) {
  doc.setFillColor(...COLORS.headerBg);
  doc.rect(x, y, width, height, "F");
  doc.setDrawColor(...COLORS.border);
  doc.rect(x, y, width, height);
}

function drawCellText(doc, text, x, y, width, { align = "left", color = COLORS.bodyText } = {}) {
  doc.setTextColor(...color);
  if (align === "right") {
    doc.text(String(text || ""), x + width - 3, y, { align: "right" });
  } else {
    doc.text(String(text || ""), x + 3, y);
  }
}

function moneyOrBlank(value) {
  return Number(value || 0) > 0.009 ? formatLedgerMoney(value) : "";
}

/**
 * Render a professional balance-confirmation PDF (A4) and return the jsPDF doc.
 */
export async function createCustomerLedgerPdfDoc(model) {
  if (!model) throw new Error("Customer ledger PDF model is required.");
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 36;
  const contentWidth = pageWidth - marginX * 2;
  const rowHeight = 15;
  const headerHeight = 17;
  let cursorY = 40;

  const ensureSpace = (needed) => {
    if (cursorY + needed <= pageHeight - 42) return;
    doc.addPage();
    cursorY = 40;
  };

  // Title block
  doc.setDrawColor(...COLORS.accent);
  doc.setLineWidth(1.2);
  doc.roundedRect(marginX, cursorY, contentWidth, 78, 4, 4);
  doc.setFont(undefined, "bold");
  doc.setFontSize(16);
  doc.setTextColor(...COLORS.accent);
  doc.text(model.companyName, marginX + 14, cursorY + 24);
  doc.setFontSize(12);
  doc.setTextColor(...COLORS.bodyText);
  doc.text(model.title, marginX + 14, cursorY + 44);
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.mutedText);
  doc.text(model.subtitle, marginX + 14, cursorY + 60);

  doc.setFont(undefined, "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.bodyText);
  const rightX = marginX + contentWidth - 14;
  doc.text(`Statement date: ${formatDisplayDate(model.statementDate)}`, rightX, cursorY + 24, { align: "right" });
  doc.text(
    `Period: ${formatDisplayDate(model.periodFrom)} to ${formatDisplayDate(model.periodTo)}`,
    rightX,
    cursorY + 40,
    { align: "right" },
  );
  cursorY += 96;

  doc.setFont(undefined, "bold");
  doc.setFontSize(10);
  doc.text("Party", marginX, cursorY);
  doc.setFont(undefined, "normal");
  const partyLines = doc.splitTextToSize(model.customerLabel || "—", contentWidth - 50);
  doc.text(partyLines, marginX + 42, cursorY);
  cursorY += Math.max(18, partyLines.length * 12 + 8);

  // Ledger table
  const ledgerCols = [
    { key: "date", label: "Date", width: 62, align: "left" },
    { key: "particulars", label: "Particulars", width: 190, align: "left" },
    { key: "voucher", label: "Voucher", width: 70, align: "left" },
    { key: "debit", label: "Debit", width: 68, align: "right" },
    { key: "credit", label: "Credit", width: 68, align: "right" },
    { key: "balance", label: "Balance", width: contentWidth - (62 + 190 + 70 + 68 + 68), align: "right" },
  ];

  const drawLedgerHeader = () => {
    ensureSpace(headerHeight + rowHeight);
    fillHeader(doc, marginX, cursorY, contentWidth, headerHeight);
    doc.setFont(undefined, "bold");
    doc.setFontSize(8);
    let colX = marginX;
    ledgerCols.forEach((col) => {
      drawCellText(doc, col.label, colX, cursorY + 12, col.width, {
        align: col.align,
        color: COLORS.headerText,
      });
      colX += col.width;
    });
    cursorY += headerHeight;
  };

  doc.setFont(undefined, "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.bodyText);
  ensureSpace(24);
  doc.text("Account Ledger", marginX, cursorY);
  cursorY += 16;
  doc.setFont(undefined, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.mutedText);
  doc.text("Amounts in Saudi Riyals. Closing balance Dr = amount receivable from the party.", marginX, cursorY);
  cursorY += 14;

  drawLedgerHeader();

  const ledgerRows = model.ledger.rows || [];
  if (!ledgerRows.length) {
    ensureSpace(rowHeight);
    doc.setFont(undefined, "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.mutedText);
    doc.text("No ledger movements for this customer.", marginX + 4, cursorY + 11);
    cursorY += rowHeight;
  }

  ledgerRows.forEach((row, index) => {
    ensureSpace(rowHeight + 2);
    if (cursorY === 40) drawLedgerHeader();
    if (index % 2 === 1) {
      doc.setFillColor(...COLORS.zebraBg);
      doc.rect(marginX, cursorY, contentWidth, rowHeight, "F");
    }
    doc.setDrawColor(...COLORS.border);
    doc.rect(marginX, cursorY, contentWidth, rowHeight);
    doc.setFont(undefined, "normal");
    doc.setFontSize(8);
    const values = {
      date: formatDisplayDate(row.date),
      particulars: row.particulars,
      voucher: row.voucher,
      debit: moneyOrBlank(row.debit),
      credit: moneyOrBlank(row.credit),
      balance: formatBalanceSide(row.balance),
    };
    let colX = marginX;
    ledgerCols.forEach((col) => {
      let text = values[col.key];
      if (col.key === "particulars") {
        const clipped = doc.splitTextToSize(String(text || ""), col.width - 6);
        text = Array.isArray(clipped) ? clipped[0] : text;
      }
      drawCellText(doc, text, colX, cursorY + 11, col.width, { align: col.align });
      colX += col.width;
    });
    cursorY += rowHeight;
  });

  // Totals
  ensureSpace(rowHeight + 8);
  doc.setFillColor(...COLORS.totalBg);
  doc.rect(marginX, cursorY, contentWidth, rowHeight, "F");
  doc.rect(marginX, cursorY, contentWidth, rowHeight);
  doc.setFont(undefined, "bold");
  doc.setFontSize(8);
  let totalX = marginX;
  [
    { text: "Total", width: 62 + 190 + 70, align: "left" },
    { text: formatLedgerMoney(model.ledger.totalDebit), width: 68, align: "right" },
    { text: formatLedgerMoney(model.ledger.totalCredit), width: 68, align: "right" },
    { text: formatBalanceSide(model.ledger.closingBalance), width: ledgerCols[5].width, align: "right" },
  ].forEach((cell) => {
    drawCellText(doc, cell.text, totalX, cursorY + 11, cell.width, { align: cell.align });
    totalX += cell.width;
  });
  cursorY += rowHeight + 16;

  ensureSpace(36);
  doc.setFont(undefined, "bold");
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.bodyText);
  doc.text(`Closing balance as on ${formatDisplayDate(model.statementDate)}: SAR ${formatBalanceSide(model.ledger.closingBalance)}`, marginX, cursorY);
  cursorY += 18;

  // Confirmation
  ensureSpace(90);
  doc.setDrawColor(...COLORS.accent);
  doc.setLineWidth(0.8);
  doc.roundedRect(marginX, cursorY, contentWidth, 78, 3, 3);
  doc.setFont(undefined, "bold");
  doc.setFontSize(10);
  doc.text("Balance Confirmation", marginX + 10, cursorY + 16);
  doc.setFont(undefined, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.bodyText);
  const confirmLines = doc.splitTextToSize(model.confirmationText, contentWidth - 20);
  doc.text(confirmLines, marginX + 10, cursorY + 32);
  cursorY += 94;

  // Signatures
  ensureSpace(70);
  const sigWidth = (contentWidth - 24) / 3;
  ["Prepared by", "Authorised signatory", "Customer confirmation"].forEach((label, index) => {
    const x = marginX + index * (sigWidth + 12);
    doc.setDrawColor(...COLORS.border);
    doc.line(x, cursorY + 36, x + sigWidth, cursorY + 36);
    doc.setFont(undefined, "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.mutedText);
    doc.text(label, x, cursorY + 50);
  });
  cursorY += 70;

  // Open invoices schedule
  ensureSpace(40);
  doc.setFont(undefined, "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.bodyText);
  doc.text("Schedule A — Open Invoices", marginX, cursorY);
  cursorY += 14;
  doc.setFont(undefined, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.mutedText);
  doc.text("Bills still open as per FIFO settlement (excluded reversals not listed here).", marginX, cursorY);
  cursorY += 12;

  const openCols = [
    { key: "invoice_date", label: "Date", width: 62, align: "left" },
    { key: "voucher_number", label: "Voucher", width: 78, align: "left" },
    { key: "amount_incl_vat", label: "Sales incl VAT", width: 78, align: "right" },
    { key: "paid_amount", label: "Paid", width: 68, align: "right" },
    { key: "remaining", label: "Open", width: 68, align: "right" },
    { key: "status", label: "Status", width: 56, align: "left" },
    { key: "days", label: "Days", width: contentWidth - (62 + 78 + 78 + 68 + 68 + 56), align: "right" },
  ];

  const drawOpenHeader = () => {
    ensureSpace(headerHeight + rowHeight);
    fillHeader(doc, marginX, cursorY, contentWidth, headerHeight);
    doc.setFont(undefined, "bold");
    doc.setFontSize(8);
    let colX = marginX;
    openCols.forEach((col) => {
      drawCellText(doc, col.label, colX, cursorY + 12, col.width, {
        align: col.align,
        color: COLORS.headerText,
      });
      colX += col.width;
    });
    cursorY += headerHeight;
  };

  drawOpenHeader();
  if (!model.openInvoices.length) {
    ensureSpace(rowHeight);
    doc.setFont(undefined, "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.mutedText);
    doc.text("No open invoices.", marginX + 4, cursorY + 11);
    cursorY += rowHeight;
  }
  model.openInvoices.forEach((row, index) => {
    ensureSpace(rowHeight + 2);
    if (cursorY === 40) drawOpenHeader();
    if (index % 2 === 1) {
      doc.setFillColor(...COLORS.zebraBg);
      doc.rect(marginX, cursorY, contentWidth, rowHeight, "F");
    }
    doc.setDrawColor(...COLORS.border);
    doc.rect(marginX, cursorY, contentWidth, rowHeight);
    doc.setFont(undefined, "normal");
    doc.setFontSize(8);
    const values = {
      invoice_date: formatDisplayDate(row.invoice_date),
      voucher_number: row.voucher_number,
      amount_incl_vat: formatLedgerMoney(row.amount_incl_vat),
      paid_amount: formatLedgerMoney(row.paid_amount),
      remaining: formatLedgerMoney(row.remaining),
      status: row.status,
      days: row.days,
    };
    let colX = marginX;
    openCols.forEach((col) => {
      drawCellText(doc, values[col.key], colX, cursorY + 11, col.width, {
        align: col.align,
        color: col.key === "remaining" ? COLORS.open : COLORS.bodyText,
      });
      colX += col.width;
    });
    cursorY += rowHeight;
  });

  ensureSpace(rowHeight + 10);
  doc.setFillColor(...COLORS.totalBg);
  doc.rect(marginX, cursorY, contentWidth, rowHeight, "F");
  doc.rect(marginX, cursorY, contentWidth, rowHeight);
  doc.setFont(undefined, "bold");
  doc.setFontSize(8);
  drawCellText(doc, "Total open", marginX, cursorY + 11, 140, { align: "left" });
  drawCellText(doc, formatLedgerMoney(model.openTotal), marginX + 286, cursorY + 11, 68, {
    align: "right",
    color: COLORS.open,
  });
  cursorY += rowHeight + 18;

  // Reversed schedule
  ensureSpace(40);
  doc.setFont(undefined, "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.bodyText);
  doc.text("Schedule B — Reversed Invoices (excluded from ledger)", marginX, cursorY);
  cursorY += 14;
  doc.setFont(undefined, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.mutedText);
  doc.text("Same-day / next-day full credit-note reversals. Not included in the account ledger above.", marginX, cursorY);
  cursorY += 12;

  const revCols = [
    { key: "invoice_date", label: "Sales Date", width: 62, align: "left" },
    { key: "voucher_number", label: "Invoice", width: 72, align: "left" },
    { key: "amount_incl_vat", label: "Sales incl VAT", width: 78, align: "right" },
    { key: "credit_note_date", label: "CN Date", width: 62, align: "left" },
    { key: "credit_note_voucher", label: "CN Voucher", width: 72, align: "left" },
    { key: "credit_note_amount", label: "CN Amount", width: contentWidth - (62 + 72 + 78 + 62 + 72), align: "right" },
  ];

  const drawRevHeader = () => {
    ensureSpace(headerHeight + rowHeight);
    fillHeader(doc, marginX, cursorY, contentWidth, headerHeight);
    doc.setFont(undefined, "bold");
    doc.setFontSize(8);
    let colX = marginX;
    revCols.forEach((col) => {
      drawCellText(doc, col.label, colX, cursorY + 12, col.width, {
        align: col.align,
        color: COLORS.headerText,
      });
      colX += col.width;
    });
    cursorY += headerHeight;
  };

  drawRevHeader();
  if (!model.reversedInvoices.length) {
    ensureSpace(rowHeight);
    doc.setFont(undefined, "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.mutedText);
    doc.text("No reversed invoices.", marginX + 4, cursorY + 11);
    cursorY += rowHeight;
  }
  model.reversedInvoices.forEach((row, index) => {
    ensureSpace(rowHeight + 2);
    if (cursorY === 40) drawRevHeader();
    if (index % 2 === 1) {
      doc.setFillColor(...COLORS.zebraBg);
      doc.rect(marginX, cursorY, contentWidth, rowHeight, "F");
    }
    doc.setDrawColor(...COLORS.border);
    doc.rect(marginX, cursorY, contentWidth, rowHeight);
    doc.setFont(undefined, "normal");
    doc.setFontSize(8);
    const values = {
      invoice_date: formatDisplayDate(row.invoice_date),
      voucher_number: row.voucher_number,
      amount_incl_vat: formatLedgerMoney(row.amount_incl_vat),
      credit_note_date: formatDisplayDate(row.credit_note_date),
      credit_note_voucher: row.credit_note_voucher,
      credit_note_amount: formatLedgerMoney(row.credit_note_amount),
    };
    let colX = marginX;
    revCols.forEach((col) => {
      drawCellText(doc, values[col.key], colX, cursorY + 11, col.width, { align: col.align });
      colX += col.width;
    });
    cursorY += rowHeight;
  });

  addPdfBuildFooter(doc, getClientBuildId());
  return doc;
}

export async function downloadCustomerLedgerPdf(model) {
  const doc = await createCustomerLedgerPdfDoc(model);
  const filename = `${String(model.filename || "balance-confirmation").replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;
  doc.save(filename);
  return filename;
}
