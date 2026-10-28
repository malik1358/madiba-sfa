import { addPdfBuildFooter, getClientBuildId } from "./buildInfo.js";
import {
  flattenLedgerLinesExcludingReversed,
  openSettlementInvoices,
} from "./datewiseLines.js";
import { buildOutstandingPdfBucketRows } from "./outstanding.js";
import { getKsaDateString } from "./workdayActivity.js";

export const LEDGER_COMPANY_NAME = "Noor Shukran Trading Company";

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

export function yearKeyFromDate(isoDate) {
  const raw = String(isoDate || "").trim();
  return /^\d{4}/.test(raw) ? raw.slice(0, 4) : "";
}

export function monthKeyFromDate(isoDate) {
  const raw = String(isoDate || "").trim();
  return /^\d{4}-\d{2}/.test(raw) ? raw.slice(0, 7) : "";
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

/**
 * Balance-confirmation particulars stay short.
 * Receipt / Payment do not repeat applied invoice numbers or amounts.
 */
export function ledgerLineParticulars(row) {
  const kind = String(row?.kind || "Entry").trim() || "Entry";
  if (kind === "Receipt" || kind === "Payment") return kind;
  if (kind === "Purchase") return "Purchase";
  const detail = String(row?.detail || "").trim();
  if (!detail || detail === "—") return kind;
  if (kind === "Invoice") return `Sales — ${detail}`;
  return `${kind} — ${detail}`;
}

/**
 * Running-balance rows plus year sections (month gaps, year close, opening BF).
 * Balance is positive when the customer owes (Dr).
 */
export function buildBalanceConfirmationLedgerRows(lines = []) {
  let balance = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  const entries = [];

  (Array.isArray(lines) ? lines : []).forEach((line) => {
    const { debit, credit } = ledgerLineDebitCredit(line);
    if (debit <= 0.009 && credit <= 0.009) return;
    balance = roundMoney(balance + debit - credit);
    totalDebit = roundMoney(totalDebit + debit);
    totalCredit = roundMoney(totalCredit + credit);
    entries.push({
      type: "entry",
      date: line.date || "",
      year: yearKeyFromDate(line.date),
      month: monthKeyFromDate(line.date),
      particulars: ledgerLineParticulars(line),
      voucher: line.voucher || "—",
      debit,
      credit,
      balance,
    });
  });

  const yearKeys = [...new Set(entries.map((row) => row.year).filter(Boolean))].sort();
  const years = [];
  let carry = 0;

  yearKeys.forEach((year) => {
    const yearEntries = entries.filter((row) => row.year === year);
    let yearDebit = 0;
    let yearCredit = 0;
    let previousMonth = "";
    const rows = [];

    yearEntries.forEach((row) => {
      yearDebit = roundMoney(yearDebit + row.debit);
      yearCredit = roundMoney(yearCredit + row.credit);
      const monthBreakBefore = Boolean(previousMonth && row.month && row.month !== previousMonth);
      rows.push({ ...row, monthBreakBefore });
      previousMonth = row.month || previousMonth;
    });

    const closingBalance = yearEntries.length
      ? yearEntries[yearEntries.length - 1].balance
      : carry;

    years.push({
      year,
      openingBalance: carry,
      rows,
      totalDebit: yearDebit,
      totalCredit: yearCredit,
      closingBalance,
    });
    carry = closingBalance;
  });

  return {
    rows: entries,
    years,
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
  outstandingCustomer = null,
  outstandingBucketLabels = [],
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
  const bucketRows = buildOutstandingPdfBucketRows(
    outstandingCustomer,
    outstandingBucketLabels,
  ).filter((row) => row.kind === "bucket" || row.kind === "total");

  return {
    companyName: LEDGER_COMPANY_NAME,
    title: "Customer Account Statement",
    subtitle: "Balance Confirmation",
    customerCode: code,
    customerName: name,
    customerLabel: name ? `${code} — ${name}` : code,
    statementDate,
    periodFrom: dates[0] || "",
    periodTo: dates[dates.length - 1] || statementDate,
    ledger: statement,
    outstandingBuckets: bucketRows,
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

function drawLedgerTableHeader(doc, marginX, contentWidth, ledgerCols, headerHeight, ensureSpace, cursorRef) {
  ensureSpace(headerHeight + 16);
  fillHeader(doc, marginX, cursorRef.y, contentWidth, headerHeight);
  doc.setFont(undefined, "bold");
  doc.setFontSize(8);
  let colX = marginX;
  ledgerCols.forEach((col) => {
    drawCellText(doc, col.label, colX, cursorRef.y + 12, col.width, {
      align: col.align,
      color: COLORS.headerText,
    });
    colX += col.width;
  });
  cursorRef.y += headerHeight;
}

function drawLedgerDataRow(doc, {
  marginX,
  contentWidth,
  ledgerCols,
  rowHeight,
  row,
  zebra,
  ensureSpace,
  cursorRef,
}) {
  ensureSpace(rowHeight + 2);
  if (cursorRef.y <= 42) {
    // Page just started — caller redraws header when needed.
  }
  if (zebra) {
    doc.setFillColor(...COLORS.zebraBg);
    doc.rect(marginX, cursorRef.y, contentWidth, rowHeight, "F");
  }
  doc.setDrawColor(...COLORS.border);
  doc.rect(marginX, cursorRef.y, contentWidth, rowHeight);
  doc.setFont(undefined, row.bold ? "bold" : "normal");
  doc.setFontSize(8);
  let colX = marginX;
  ledgerCols.forEach((col) => {
    let text = row.values[col.key];
    if (col.key === "particulars") {
      const clipped = doc.splitTextToSize(String(text || ""), col.width - 6);
      text = Array.isArray(clipped) ? clipped[0] : text;
    }
    drawCellText(doc, text, colX, cursorRef.y + 11, col.width, { align: col.align });
    colX += col.width;
  });
  cursorRef.y += rowHeight;
}

function drawYearTotalRow(doc, {
  marginX,
  contentWidth,
  ledgerCols,
  rowHeight,
  label,
  totalDebit,
  totalCredit,
  closingBalance,
  ensureSpace,
  cursorRef,
}) {
  ensureSpace(rowHeight + 8);
  doc.setFillColor(...COLORS.totalBg);
  doc.rect(marginX, cursorRef.y, contentWidth, rowHeight, "F");
  doc.rect(marginX, cursorRef.y, contentWidth, rowHeight);
  doc.setFont(undefined, "bold");
  doc.setFontSize(8);
  let totalX = marginX;
  [
    { text: label, width: 62 + 190 + 70, align: "left" },
    { text: formatLedgerMoney(totalDebit), width: 68, align: "right" },
    { text: formatLedgerMoney(totalCredit), width: 68, align: "right" },
    { text: formatBalanceSide(closingBalance), width: ledgerCols[5].width, align: "right" },
  ].forEach((cell) => {
    drawCellText(doc, cell.text, totalX, cursorRef.y + 11, cell.width, { align: cell.align });
    totalX += cell.width;
  });
  cursorRef.y += rowHeight;
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
  const cursorRef = { y: 40 };

  const ensureSpace = (needed) => {
    if (cursorRef.y + needed <= pageHeight - 42) return;
    doc.addPage();
    cursorRef.y = 40;
  };

  // Title block — company may wrap to two lines.
  const companyLines = doc.splitTextToSize(model.companyName || LEDGER_COMPANY_NAME, contentWidth - 200);
  const titleBlockHeight = 70 + Math.max(0, (companyLines.length - 1) * 14);
  doc.setDrawColor(...COLORS.accent);
  doc.setLineWidth(1.2);
  doc.roundedRect(marginX, cursorRef.y, contentWidth, titleBlockHeight, 4, 4);
  doc.setFont(undefined, "bold");
  doc.setFontSize(14);
  doc.setTextColor(...COLORS.accent);
  doc.text(companyLines, marginX + 14, cursorRef.y + 22);
  const afterCompanyY = cursorRef.y + 22 + companyLines.length * 14;
  doc.setFontSize(12);
  doc.setTextColor(...COLORS.bodyText);
  doc.text(model.title, marginX + 14, afterCompanyY + 4);
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.mutedText);
  doc.text(model.subtitle, marginX + 14, afterCompanyY + 20);

  doc.setFont(undefined, "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.bodyText);
  const rightX = marginX + contentWidth - 14;
  doc.text(`Statement date: ${formatDisplayDate(model.statementDate)}`, rightX, cursorRef.y + 22, { align: "right" });
  doc.text(
    `Period: ${formatDisplayDate(model.periodFrom)} to ${formatDisplayDate(model.periodTo)}`,
    rightX,
    cursorRef.y + 38,
    { align: "right" },
  );
  cursorRef.y += titleBlockHeight + 16;

  doc.setFont(undefined, "bold");
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.bodyText);
  doc.text("Party", marginX, cursorRef.y);
  doc.setFont(undefined, "normal");
  const partyLines = doc.splitTextToSize(model.customerLabel || "—", contentWidth - 50);
  doc.text(partyLines, marginX + 42, cursorRef.y);
  cursorRef.y += Math.max(18, partyLines.length * 12 + 8);

  const ledgerCols = [
    { key: "date", label: "Date", width: 62, align: "left" },
    { key: "particulars", label: "Particulars", width: 190, align: "left" },
    { key: "voucher", label: "Voucher", width: 70, align: "left" },
    { key: "debit", label: "Debit", width: 68, align: "right" },
    { key: "credit", label: "Credit", width: 68, align: "right" },
    { key: "balance", label: "Balance", width: contentWidth - (62 + 190 + 70 + 68 + 68), align: "right" },
  ];

  doc.setFont(undefined, "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.bodyText);
  ensureSpace(24);
  doc.text("Account Ledger", marginX, cursorRef.y);
  cursorRef.y += 16;

  const yearSections = Array.isArray(model.ledger?.years) && model.ledger.years.length
    ? model.ledger.years
    : [{
      year: "",
      openingBalance: 0,
      rows: model.ledger?.rows || [],
      totalDebit: model.ledger?.totalDebit || 0,
      totalCredit: model.ledger?.totalCredit || 0,
      closingBalance: model.ledger?.closingBalance || 0,
    }];

  if (!yearSections.some((section) => (section.rows || []).length)) {
    ensureSpace(rowHeight);
    doc.setFont(undefined, "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.mutedText);
    doc.text("No ledger movements for this customer.", marginX + 4, cursorRef.y + 11);
    cursorRef.y += rowHeight + 10;
  }

  yearSections.forEach((section, sectionIndex) => {
    ensureSpace(36 + headerHeight + rowHeight * 3);
    if (section.year) {
      doc.setFont(undefined, "bold");
      doc.setFontSize(10);
      doc.setTextColor(...COLORS.accent);
      doc.text(`Year ${section.year}`, marginX, cursorRef.y);
      cursorRef.y += 14;
    }

    drawLedgerTableHeader(doc, marginX, contentWidth, ledgerCols, headerHeight, ensureSpace, cursorRef);

    const showOpening = sectionIndex > 0 || Math.abs(Number(section.openingBalance || 0)) > 0.009;
    if (showOpening) {
      drawLedgerDataRow(doc, {
        marginX,
        contentWidth,
        ledgerCols,
        rowHeight,
        zebra: false,
        ensureSpace,
        cursorRef,
        row: {
          bold: true,
          values: {
            date: section.year ? `01-Jan-${section.year}` : "",
            particulars: "Opening Balance",
            voucher: "",
            debit: "",
            credit: "",
            balance: formatBalanceSide(section.openingBalance),
          },
        },
      });
    }

    let zebraIndex = showOpening ? 1 : 0;
    (section.rows || []).forEach((row) => {
      if (row.monthBreakBefore) {
        ensureSpace(rowHeight);
        cursorRef.y += rowHeight;
      }
      if (cursorRef.y <= 42) {
        drawLedgerTableHeader(doc, marginX, contentWidth, ledgerCols, headerHeight, ensureSpace, cursorRef);
      }
      drawLedgerDataRow(doc, {
        marginX,
        contentWidth,
        ledgerCols,
        rowHeight,
        zebra: zebraIndex % 2 === 1,
        ensureSpace,
        cursorRef,
        row: {
          values: {
            date: formatDisplayDate(row.date),
            particulars: row.particulars,
            voucher: row.voucher,
            debit: moneyOrBlank(row.debit),
            credit: moneyOrBlank(row.credit),
            balance: formatBalanceSide(row.balance),
          },
        },
      });
      zebraIndex += 1;
    });

    drawYearTotalRow(doc, {
      marginX,
      contentWidth,
      ledgerCols,
      rowHeight,
      label: section.year ? `Total ${section.year}` : "Total",
      totalDebit: section.totalDebit,
      totalCredit: section.totalCredit,
      closingBalance: section.closingBalance,
      ensureSpace,
      cursorRef,
    });

    ensureSpace(20);
    doc.setFont(undefined, "bold");
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.bodyText);
    doc.text(
      section.year
        ? `Closing balance ${section.year}: SAR ${formatBalanceSide(section.closingBalance)}`
        : `Closing balance: SAR ${formatBalanceSide(section.closingBalance)}`,
      marginX,
      cursorRef.y + 12,
    );
    cursorRef.y += 22;
  });

  ensureSpace(28);
  doc.setFont(undefined, "bold");
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.bodyText);
  doc.text(
    `Closing balance as on ${formatDisplayDate(model.statementDate)}: SAR ${formatBalanceSide(model.ledger.closingBalance)}`,
    marginX,
    cursorRef.y,
  );
  cursorRef.y += 18;

  // Bucket-wise outstanding under closing balance
  ensureSpace(40);
  doc.setFont(undefined, "bold");
  doc.setFontSize(10);
  doc.text("Outstanding by aging bucket", marginX, cursorRef.y);
  cursorRef.y += 12;

  const bucketCols = [
    { key: "label", label: "Bucket", width: contentWidth - 120, align: "left" },
    { key: "amount", label: "Amount", width: 120, align: "right" },
  ];
  ensureSpace(headerHeight + rowHeight);
  fillHeader(doc, marginX, cursorRef.y, contentWidth, headerHeight);
  doc.setFont(undefined, "bold");
  doc.setFontSize(8);
  let bucketHeaderX = marginX;
  bucketCols.forEach((col) => {
    drawCellText(doc, col.label, bucketHeaderX, cursorRef.y + 12, col.width, {
      align: col.align,
      color: COLORS.headerText,
    });
    bucketHeaderX += col.width;
  });
  cursorRef.y += headerHeight;

  const buckets = Array.isArray(model.outstandingBuckets) ? model.outstandingBuckets : [];
  if (!buckets.length) {
    ensureSpace(rowHeight);
    doc.setFont(undefined, "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.mutedText);
    doc.text("No outstanding bucket row for this customer.", marginX + 4, cursorRef.y + 11);
    cursorRef.y += rowHeight;
  }
  buckets.forEach((bucket, index) => {
    ensureSpace(rowHeight + 2);
    if (index % 2 === 1) {
      doc.setFillColor(...COLORS.zebraBg);
      doc.rect(marginX, cursorRef.y, contentWidth, rowHeight, "F");
    }
    doc.setDrawColor(...COLORS.border);
    doc.rect(marginX, cursorRef.y, contentWidth, rowHeight);
    doc.setFont(undefined, bucket.kind === "total" ? "bold" : "normal");
    doc.setFontSize(8);
    drawCellText(doc, bucket.label, marginX, cursorRef.y + 11, bucketCols[0].width, { align: "left" });
    drawCellText(
      doc,
      formatLedgerMoney(bucket.amount),
      marginX + bucketCols[0].width,
      cursorRef.y + 11,
      bucketCols[1].width,
      { align: "right", color: bucket.kind === "total" ? COLORS.open : COLORS.bodyText },
    );
    cursorRef.y += rowHeight;
  });
  cursorRef.y += 16;

  // Confirmation
  ensureSpace(90);
  doc.setDrawColor(...COLORS.accent);
  doc.setLineWidth(0.8);
  doc.roundedRect(marginX, cursorRef.y, contentWidth, 78, 3, 3);
  doc.setFont(undefined, "bold");
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.bodyText);
  doc.text("Balance Confirmation", marginX + 10, cursorRef.y + 16);
  doc.setFont(undefined, "normal");
  doc.setFontSize(8);
  const confirmLines = doc.splitTextToSize(model.confirmationText, contentWidth - 20);
  doc.text(confirmLines, marginX + 10, cursorRef.y + 32);
  cursorRef.y += 94;

  // Signatures
  ensureSpace(70);
  const sigWidth = (contentWidth - 24) / 3;
  ["Prepared by", "Authorised signatory", "Customer confirmation"].forEach((label, index) => {
    const x = marginX + index * (sigWidth + 12);
    doc.setDrawColor(...COLORS.border);
    doc.line(x, cursorRef.y + 36, x + sigWidth, cursorRef.y + 36);
    doc.setFont(undefined, "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.mutedText);
    doc.text(label, x, cursorRef.y + 50);
  });
  cursorRef.y += 70;

  // Open invoices schedule
  ensureSpace(40);
  doc.setFont(undefined, "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.bodyText);
  doc.text("Schedule A — Open Invoices", marginX, cursorRef.y);
  cursorRef.y += 14;
  doc.setFont(undefined, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.mutedText);
  doc.text("Bills still open as per FIFO settlement (excluded reversals not listed here).", marginX, cursorRef.y);
  cursorRef.y += 12;

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
    fillHeader(doc, marginX, cursorRef.y, contentWidth, headerHeight);
    doc.setFont(undefined, "bold");
    doc.setFontSize(8);
    let colX = marginX;
    openCols.forEach((col) => {
      drawCellText(doc, col.label, colX, cursorRef.y + 12, col.width, {
        align: col.align,
        color: COLORS.headerText,
      });
      colX += col.width;
    });
    cursorRef.y += headerHeight;
  };

  drawOpenHeader();
  if (!model.openInvoices.length) {
    ensureSpace(rowHeight);
    doc.setFont(undefined, "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.mutedText);
    doc.text("No open invoices.", marginX + 4, cursorRef.y + 11);
    cursorRef.y += rowHeight;
  }
  model.openInvoices.forEach((row, index) => {
    ensureSpace(rowHeight + 2);
    if (cursorRef.y === 40) drawOpenHeader();
    if (index % 2 === 1) {
      doc.setFillColor(...COLORS.zebraBg);
      doc.rect(marginX, cursorRef.y, contentWidth, rowHeight, "F");
    }
    doc.setDrawColor(...COLORS.border);
    doc.rect(marginX, cursorRef.y, contentWidth, rowHeight);
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
      drawCellText(doc, values[col.key], colX, cursorRef.y + 11, col.width, {
        align: col.align,
        color: col.key === "remaining" ? COLORS.open : COLORS.bodyText,
      });
      colX += col.width;
    });
    cursorRef.y += rowHeight;
  });

  ensureSpace(rowHeight + 10);
  doc.setFillColor(...COLORS.totalBg);
  doc.rect(marginX, cursorRef.y, contentWidth, rowHeight, "F");
  doc.rect(marginX, cursorRef.y, contentWidth, rowHeight);
  doc.setFont(undefined, "bold");
  doc.setFontSize(8);
  drawCellText(doc, "Total open", marginX, cursorRef.y + 11, 140, { align: "left" });
  drawCellText(doc, formatLedgerMoney(model.openTotal), marginX + 286, cursorRef.y + 11, 68, {
    align: "right",
    color: COLORS.open,
  });
  cursorRef.y += rowHeight + 18;

  // Reversed schedule
  ensureSpace(40);
  doc.setFont(undefined, "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.bodyText);
  doc.text("Schedule B — Reversed Invoices (excluded from ledger)", marginX, cursorRef.y);
  cursorRef.y += 14;
  doc.setFont(undefined, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.mutedText);
  doc.text("Same-day / next-day full credit-note reversals. Not included in the account ledger above.", marginX, cursorRef.y);
  cursorRef.y += 12;

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
    fillHeader(doc, marginX, cursorRef.y, contentWidth, headerHeight);
    doc.setFont(undefined, "bold");
    doc.setFontSize(8);
    let colX = marginX;
    revCols.forEach((col) => {
      drawCellText(doc, col.label, colX, cursorRef.y + 12, col.width, {
        align: col.align,
        color: COLORS.headerText,
      });
      colX += col.width;
    });
    cursorRef.y += headerHeight;
  };

  drawRevHeader();
  if (!model.reversedInvoices.length) {
    ensureSpace(rowHeight);
    doc.setFont(undefined, "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.mutedText);
    doc.text("No reversed invoices.", marginX + 4, cursorRef.y + 11);
    cursorRef.y += rowHeight;
  }
  model.reversedInvoices.forEach((row, index) => {
    ensureSpace(rowHeight + 2);
    if (cursorRef.y === 40) drawRevHeader();
    if (index % 2 === 1) {
      doc.setFillColor(...COLORS.zebraBg);
      doc.rect(marginX, cursorRef.y, contentWidth, rowHeight, "F");
    }
    doc.setDrawColor(...COLORS.border);
    doc.rect(marginX, cursorRef.y, contentWidth, rowHeight);
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
      drawCellText(doc, values[col.key], colX, cursorRef.y + 11, col.width, { align: col.align });
      colX += col.width;
    });
    cursorRef.y += rowHeight;
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
