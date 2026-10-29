import { addPdfBuildFooter, getClientBuildId } from "./buildInfo.js";
import {
  flattenLedgerLinesExcludingReversed,
  openSettlementInvoices,
} from "./datewiseLines.js";
import {
  buildMachineOpenOutstandingCustomer,
  buildOutstandingPdfBucketRows,
  DEFAULT_OUTSTANDING_BUCKET_LABELS,
} from "./outstanding.js";
import { installArabicPdfText, registerArabicPdfFont } from "./pdfArabicText.js";
import { getKsaDateString } from "./workdayActivity.js";

export const LEDGER_COMPANY_NAME = "Noor Shukran Trading Company";
export const LEDGER_COMPANY_NAME_AR = "شركة نور شكران للتجارة";
export const LEDGER_PDF_LANGUAGES = ["ar", "en"];

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

const COPY = {
  en: {
    companyName: LEDGER_COMPANY_NAME,
    title: "Customer Account Statement",
    subtitle: "Balance Confirmation",
    statementDate: "Statement date",
    period: "Period",
    periodTo: "to",
    party: "Party",
    accountLedger: "Account Ledger",
    noMovements: "No ledger movements for this customer.",
    year: "Year",
    openingBalance: "Opening Balance",
    total: "Total",
    closingBalanceYear: (year, amount) => `Closing balance ${year}: SAR ${amount}`,
    closingBalance: (amount) => `Closing balance: SAR ${amount}`,
    closingAsOn: (date, amount) => `Closing balance as on ${date}: SAR ${amount}`,
    outstandingBuckets: "Outstanding by aging bucket",
    bucket: "Bucket",
    amount: "Amount",
    noBuckets: "No outstanding bucket row for this customer.",
    balanceConfirmation: "Balance Confirmation",
    preparedBy: "Prepared by",
    authorisedSignatory: "Authorised signatory",
    customerConfirmation: "Customer confirmation",
    scheduleA: "Schedule A — Open Invoices",
    scheduleAHint: "Bills still open as per FIFO settlement (excluded reversals not listed here).",
    noOpen: "No open invoices.",
    totalOpen: "Total open",
    scheduleB: "Schedule B — Reversed Invoices (excluded from ledger)",
    scheduleBHint: "Same-day / next-day full credit-note reversals. Not included in the account ledger above.",
    noReversed: "No reversed invoices.",
    date: "Date",
    particulars: "Particulars",
    voucher: "Voucher",
    debit: "Debit",
    credit: "Credit",
    balance: "Balance",
    salesInclVat: "Sales incl VAT",
    paid: "Paid",
    open: "Open",
    status: "Status",
    days: "Days",
    salesDate: "Sales Date",
    invoice: "Invoice",
    cnDate: "CN Date",
    cnVoucher: "CN Voucher",
    cnAmount: "CN Amount",
    languageBanner: "Arabic section follows first; English section starts on a new page.",
    sectionBanner: "English",
    receipt: "Receipt",
    payment: "Payment",
    purchase: "Purchase",
    salesPrefix: "Sales",
    creditNote: "Credit Note",
    salesReturn: "Sales Return",
    entry: "Entry",
    openStatus: "Open",
    openDays: (n) => `Open ${n}d`,
    dr: "Dr",
    cr: "Cr",
    months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    bucketDays: (label) => `${label} days`,
    openInvoicesCount: "Open invoices",
    totalOutstanding: "Total outstanding",
    confirmation: ({ name, code, balance, date }) => [
      `As per our books, the account of ${name || code || "the customer"}`,
      `(Code ${code || "—"}) shows a closing balance of SAR ${balance}`,
      `as on ${date}.`,
      "Immediate credit-note reversals are excluded from this ledger and listed separately.",
      "Kindly confirm that this balance agrees with your records and return a signed copy.",
    ].join(" "),
  },
  ar: {
    companyName: LEDGER_COMPANY_NAME_AR,
    title: "كشف حساب العميل",
    subtitle: "تأكيد الرصيد",
    statementDate: "تاريخ الكشف",
    period: "الفترة",
    periodTo: "إلى",
    party: "الحساب",
    accountLedger: "دفتر حساب العميل",
    noMovements: "لا توجد حركات في دفتر هذا العميل.",
    year: "سنة",
    openingBalance: "رصيد افتتاحي",
    total: "الإجمالي",
    closingBalanceYear: (year, amount) => `رصيد إغلاق ${year}: ${amount} ر.س`,
    closingBalance: (amount) => `رصيد الإغلاق: ${amount} ر.س`,
    closingAsOn: (date, amount) => `رصيد الإغلاق كما في ${date}: ${amount} ر.س`,
    outstandingBuckets: "المستحق حسب فترات التقادم",
    bucket: "الفترة",
    amount: "المبلغ",
    noBuckets: "لا توجد بيانات تقادم مستحق لهذا العميل.",
    balanceConfirmation: "تأكيد الرصيد",
    preparedBy: "أعده",
    authorisedSignatory: "التوقيع المعتمد",
    customerConfirmation: "تأكيد العميل",
    scheduleA: "الملحق أ — الفواتير المفتوحة",
    scheduleAHint: "الفواتير المفتوحة حسب تسوية الوارد أولاً صادر أولاً (المعكوسات مستبعدة من هذا الجدول).",
    noOpen: "لا توجد فواتير مفتوحة.",
    totalOpen: "إجمالي المفتوح",
    scheduleB: "الملحق ب — الفواتير المعكوسة (مستبعدة من الدفتر)",
    scheduleBHint: "عكس كامل بإشعار دائن في نفس اليوم أو اليوم التالي. غير مدرجة في دفتر الحساب أعلاه.",
    noReversed: "لا توجد فواتير معكوسة.",
    date: "التاريخ",
    particulars: "البيان",
    voucher: "السند",
    debit: "مدين",
    credit: "دائن",
    balance: "الرصيد",
    salesInclVat: "المبيعات شامل الضريبة",
    paid: "المدفوع",
    open: "المفتوح",
    status: "الحالة",
    days: "الأيام",
    salesDate: "تاريخ البيع",
    invoice: "الفاتورة",
    cnDate: "تاريخ الإشعار",
    cnVoucher: "سند الإشعار",
    cnAmount: "مبلغ الإشعار",
    languageBanner: "القسم العربي أولاً؛ القسم الإنجليزي يبدأ في صفحة جديدة.",
    sectionBanner: "عربي",
    receipt: "قبض",
    payment: "دفع",
    purchase: "مشتريات",
    salesPrefix: "مبيعات",
    creditNote: "إشعار دائن",
    salesReturn: "مردود مبيعات",
    entry: "قيد",
    openStatus: "مفتوح",
    openDays: (n) => `مفتوح ${n} يوم`,
    dr: "مدين",
    cr: "دائن",
    months: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
    bucketDays: (label) => `${label} يوم`,
    openInvoicesCount: "عدد الفواتير المفتوحة",
    totalOutstanding: "إجمالي المستحق",
    confirmation: ({ name, code, balance, date }) => [
      `حسب دفاترنا، يظهر حساب ${name || code || "العميل"}`,
      `(الرمز ${code || "—"}) رصيد إغلاق بمبلغ ${balance} ر.س`,
      `كما في ${date}.`,
      "تم استبعاد العكوسات الفورية بإشعار دائن من هذا الدفتر وإدراجها بشكل منفصل.",
      "يرجى التأكيد بأن هذا الرصيد يطابق سجلاتكم وإعادة نسخة موقعة.",
    ].join(" "),
  },
};

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

/** Western 0-9 → Eastern Arabic-Indic ٠-٩ for Arabic PDF sections. */
export function toEasternDigits(value) {
  return String(value ?? "").replace(/[0-9]/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]);
}

export function localizeLedgerDigits(value, lang = "en") {
  const text = String(value ?? "");
  return lang === "ar" ? toEasternDigits(text) : text;
}

export function formatLedgerMoney(value, lang = "en") {
  const formatted = Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return localizeLedgerDigits(formatted, lang);
}

export function formatBalanceSide(value, lang = "en") {
  const copy = COPY[lang] || COPY.en;
  const amount = roundMoney(value);
  if (Math.abs(amount) <= 0.009) return localizeLedgerDigits("0.00", lang);
  const abs = formatLedgerMoney(Math.abs(amount), lang);
  return amount > 0 ? `${abs} ${copy.dr}` : `${abs} ${copy.cr}`;
}

export function formatDisplayDate(isoDate, lang = "en") {
  const copy = COPY[lang] || COPY.en;
  const raw = String(isoDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return localizeLedgerDigits(raw || "—", lang);
  const [year, month, day] = raw.split("-");
  return localizeLedgerDigits(`${day}-${copy.months[Number(month) - 1]}-${year}`, lang);
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
export function ledgerLineParticulars(row, lang = "en") {
  const copy = COPY[lang] || COPY.en;
  const kind = String(row?.kind || "Entry").trim() || "Entry";
  if (kind === "Receipt") return copy.receipt;
  if (kind === "Payment") return copy.payment;
  if (kind === "Purchase") return copy.purchase;
  const detail = String(row?.detail || "").trim();
  if (kind === "Invoice") {
    if (!detail || detail === "—") return copy.salesPrefix;
    const localizedDetail = /^open$/i.test(detail) ? copy.openStatus : detail;
    return `${copy.salesPrefix} — ${localizedDetail}`;
  }
  if (/credit note/i.test(kind)) {
    if (!detail || detail === "—") return copy.creditNote;
    return `${copy.creditNote} — ${detail}`;
  }
  if (/sales return|return/i.test(kind)) {
    if (!detail || detail === "—") return copy.salesReturn;
    return `${copy.salesReturn} — ${detail}`;
  }
  if (!detail || detail === "—") return kind === "Entry" ? copy.entry : kind;
  return `${kind} — ${detail}`;
}

function localizeOpenDays(row, lang = "en") {
  const copy = COPY[lang] || COPY.en;
  if (row?.payment_days != null) return localizeLedgerDigits(row.payment_days, lang);
  if (row?.open_days > 0) return localizeLedgerDigits(copy.openDays(row.open_days), lang);
  return "—";
}

function localizeStatus(status, lang = "en") {
  const copy = COPY[lang] || COPY.en;
  const raw = String(status || "Open").trim();
  if (/^open$/i.test(raw)) return copy.openStatus;
  return raw;
}

function localizeBucketLabel(bucket, lang = "en") {
  const copy = COPY[lang] || COPY.en;
  if (!bucket) return "";
  if (bucket.kind === "total") return copy.totalOutstanding;
  if (bucket.kind === "count") return copy.openInvoicesCount;
  const raw = String(bucket.label || "").trim();
  const match = raw.match(/^(.+?)\s+days$/i);
  if (match) return localizeLedgerDigits(copy.bucketDays(match[1]), lang);
  return localizeLedgerDigits(raw, lang);
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
      kind: String(line?.kind || "").trim(),
      detail: String(line?.detail || "").trim(),
      particulars: ledgerLineParticulars(line, "en"),
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
  // Closing balance and Total outstanding are the same figure: Machine Open
  // (Schedule A). The running ledger should already equal that after leftover
  // non-voiding CNs stay on the statement; if it still drifts, prefer open AR.
  const ledgerClosing = statement.closingBalance;
  const closing = Math.abs(ledgerClosing - openTotal) <= 0.02 ? ledgerClosing : openTotal;
  const agingLabels = (Array.isArray(outstandingBucketLabels) && outstandingBucketLabels.length)
    ? outstandingBucketLabels
    : DEFAULT_OUTSTANDING_BUCKET_LABELS;
  const machineOpenOutstanding = buildMachineOpenOutstandingCustomer(openInvoices, agingLabels);
  const tallyTotal = roundMoney(Number(outstandingCustomer?.total_outstanding || 0));
  const agingCustomer = openTotal > 0.009 || tallyTotal <= 0.009
    ? { ...machineOpenOutstanding, total_outstanding: closing }
    : {
      ...(outstandingCustomer || machineOpenOutstanding),
      total_outstanding: closing,
    };
  const bucketRows = buildOutstandingPdfBucketRows(
    agingCustomer,
    agingLabels,
  ).filter((row) => row.kind === "bucket" || row.kind === "total")
    .map((row) => (row.kind === "total" ? { ...row, amount: closing } : row));
  const years = (statement.years || []).map((section, index, list) => {
    if (index !== list.length - 1) return section;
    if (Math.abs(Number(section.closingBalance || 0) - closing) <= 0.02) return section;
    return { ...section, closingBalance: closing };
  });

  return {
    companyName: LEDGER_COMPANY_NAME,
    companyNameAr: LEDGER_COMPANY_NAME_AR,
    title: COPY.en.title,
    subtitle: COPY.en.subtitle,
    customerCode: code,
    customerName: name,
    customerLabel: name ? `${code} — ${name}` : code,
    statementDate,
    periodFrom: dates[0] || "",
    periodTo: dates[dates.length - 1] || statementDate,
    ledger: {
      ...statement,
      years,
      closingBalance: closing,
    },
    outstandingBuckets: bucketRows,
    openInvoices: openInvoices.map((row) => ({
      invoice_date: row.invoice_date || "",
      voucher_number: row.voucher_number || "—",
      amount_incl_vat: roundMoney(row.amount_incl_vat),
      paid_amount: roundMoney(row.paid_amount),
      remaining: roundMoney(row.remaining),
      status: row.status || "Open",
      open_days: row.open_days,
      payment_days: row.payment_days,
      days: localizeOpenDays(row, "en"),
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
    confirmationText: COPY.en.confirmation({
      name,
      code,
      balance: formatBalanceSide(closing, "en"),
      date: formatDisplayDate(statementDate, "en"),
    }),
    confirmationTextAr: COPY.ar.confirmation({
      name,
      code: localizeLedgerDigits(code, "ar"),
      balance: formatBalanceSide(closing, "ar"),
      date: formatDisplayDate(statementDate, "ar"),
    }),
    languages: [...LEDGER_PDF_LANGUAGES],
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

function moneyOrBlank(value, lang = "en") {
  return Number(value || 0) > 0.009 ? formatLedgerMoney(value, lang) : "";
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
  lang,
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
    { text: formatLedgerMoney(totalDebit, lang), width: 68, align: "right" },
    { text: formatLedgerMoney(totalCredit, lang), width: 68, align: "right" },
    { text: formatBalanceSide(closingBalance, lang), width: ledgerCols[5].width, align: "right" },
  ].forEach((cell) => {
    drawCellText(doc, cell.text, totalX, cursorRef.y + 11, cell.width, { align: cell.align });
    totalX += cell.width;
  });
  cursorRef.y += rowHeight;
}

/**
 * Draw text line-by-line. Passing a string[] to jsPDF.text bypasses the Arabic
 * font shim and produces mojibake — always feed one string per call.
 */
function drawWrappedText(doc, text, x, y, {
  align = "left",
  maxWidth = 0,
  lineHeight = 11,
} = {}) {
  const source = String(text ?? "");
  const lines = maxWidth > 0
    ? doc.splitTextToSize(source, maxWidth)
    : source.split(/\r?\n/);
  const list = (Array.isArray(lines) ? lines : [String(lines || "")]).map((line) => String(line ?? ""));
  const opts = align === "right" ? { align: "right" } : undefined;
  list.forEach((line, index) => {
    doc.text(line, x, y + index * lineHeight, opts);
  });
  return list.length || 1;
}

function drawBlockText(doc, text, x, y, { align = "left", maxWidth = 0 } = {}) {
  return drawWrappedText(doc, text, x, y, { align, maxWidth, lineHeight: 12 });
}

/**
 * Render one complete language section (Arabic or English). Do not mix languages.
 */
export function renderCustomerLedgerLanguageSection(doc, model, lang, {
  marginX,
  contentWidth,
  pageHeight,
  rowHeight,
  headerHeight,
  cursorRef,
  startFreshPage = false,
} = {}) {
  const copy = COPY[lang] || COPY.en;
  const rtl = lang === "ar";
  const textStart = rtl ? marginX + contentWidth : marginX;
  const textAlign = rtl ? "right" : "left";

  const ensureSpace = (needed) => {
    if (cursorRef.y + needed <= pageHeight - 42) return;
    doc.addPage();
    cursorRef.y = 40;
  };

  if (startFreshPage) {
    doc.addPage();
    cursorRef.y = 40;
  }

  const companyName = lang === "ar"
    ? (model.companyNameAr || LEDGER_COMPANY_NAME_AR)
    : (model.companyName || LEDGER_COMPANY_NAME);
  const companyLines = doc.splitTextToSize(companyName, contentWidth - 200);
  const titleBlockHeight = 70 + Math.max(0, (companyLines.length - 1) * 14);
  doc.setDrawColor(...COLORS.accent);
  doc.setLineWidth(1.2);
  doc.roundedRect(marginX, cursorRef.y, contentWidth, titleBlockHeight, 4, 4);
  doc.setFont(undefined, "bold");
  doc.setFontSize(14);
  doc.setTextColor(...COLORS.accent);
  drawBlockText(doc, companyLines.join("\n"), rtl ? marginX + contentWidth - 14 : marginX + 14, cursorRef.y + 22, {
    align: textAlign,
  });
  const afterCompanyY = cursorRef.y + 22 + companyLines.length * 14;
  doc.setFontSize(12);
  doc.setTextColor(...COLORS.bodyText);
  drawBlockText(doc, copy.title, rtl ? marginX + contentWidth - 14 : marginX + 14, afterCompanyY + 4, {
    align: textAlign,
  });
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.mutedText);
  drawBlockText(doc, copy.subtitle, rtl ? marginX + contentWidth - 14 : marginX + 14, afterCompanyY + 20, {
    align: textAlign,
  });

  doc.setFont(undefined, "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.bodyText);
  const metaX = rtl ? marginX + 14 : marginX + contentWidth - 14;
  const metaAlign = rtl ? "left" : "right";
  doc.text(
    `${copy.statementDate}: ${formatDisplayDate(model.statementDate, lang)}`,
    metaX,
    cursorRef.y + 22,
    { align: metaAlign },
  );
  doc.text(
    `${copy.period}: ${formatDisplayDate(model.periodFrom, lang)} ${copy.periodTo} ${formatDisplayDate(model.periodTo, lang)}`,
    metaX,
    cursorRef.y + 38,
    { align: metaAlign },
  );
  cursorRef.y += titleBlockHeight + 16;

  doc.setFont(undefined, "bold");
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.bodyText);
  drawBlockText(doc, copy.party, textStart, cursorRef.y, { align: textAlign });
  doc.setFont(undefined, "normal");
  const partyMax = contentWidth - 50;
  const partyX = rtl ? marginX + contentWidth - 42 : marginX + 42;
  const partyLineCount = drawWrappedText(doc, model.customerLabel || "—", partyX, cursorRef.y, {
    align: textAlign,
    maxWidth: partyMax,
    lineHeight: 12,
  });
  cursorRef.y += Math.max(18, partyLineCount * 12 + 8);

  const ledgerCols = [
    { key: "date", label: copy.date, width: 62, align: "left" },
    { key: "particulars", label: copy.particulars, width: 190, align: "left" },
    { key: "voucher", label: copy.voucher, width: 70, align: "left" },
    { key: "debit", label: copy.debit, width: 68, align: "right" },
    { key: "credit", label: copy.credit, width: 68, align: "right" },
    { key: "balance", label: copy.balance, width: contentWidth - (62 + 190 + 70 + 68 + 68), align: "right" },
  ];

  doc.setFont(undefined, "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.bodyText);
  ensureSpace(24);
  drawBlockText(doc, copy.accountLedger, textStart, cursorRef.y, { align: textAlign });
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
    drawBlockText(doc, copy.noMovements, textStart, cursorRef.y + 11, { align: textAlign });
    cursorRef.y += rowHeight + 10;
  }

  yearSections.forEach((section, sectionIndex) => {
    ensureSpace(36 + headerHeight + rowHeight * 3);
    if (section.year) {
      doc.setFont(undefined, "bold");
      doc.setFontSize(10);
      doc.setTextColor(...COLORS.accent);
      drawBlockText(
        doc,
        `${copy.year} ${localizeLedgerDigits(section.year, lang)}`,
        textStart,
        cursorRef.y,
        { align: textAlign },
      );
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
            date: section.year
              ? localizeLedgerDigits(`01-${copy.months[0]}-${section.year}`, lang)
              : "",
            particulars: copy.openingBalance,
            voucher: "",
            debit: "",
            credit: "",
            balance: formatBalanceSide(section.openingBalance, lang),
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
            date: formatDisplayDate(row.date, lang),
            particulars: ledgerLineParticulars(row, lang),
            voucher: localizeLedgerDigits(row.voucher, lang),
            debit: moneyOrBlank(row.debit, lang),
            credit: moneyOrBlank(row.credit, lang),
            balance: formatBalanceSide(row.balance, lang),
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
      label: section.year
        ? `${copy.total} ${localizeLedgerDigits(section.year, lang)}`
        : copy.total,
      totalDebit: section.totalDebit,
      totalCredit: section.totalCredit,
      closingBalance: section.closingBalance,
      lang,
      ensureSpace,
      cursorRef,
    });

    ensureSpace(20);
    doc.setFont(undefined, "bold");
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.bodyText);
    const yearClosing = section.year
      ? copy.closingBalanceYear(section.year, formatBalanceSide(section.closingBalance, lang))
      : copy.closingBalance(formatBalanceSide(section.closingBalance, lang));
    drawBlockText(doc, yearClosing, textStart, cursorRef.y + 12, { align: textAlign });
    cursorRef.y += 22;
  });

  ensureSpace(28);
  doc.setFont(undefined, "bold");
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.bodyText);
  drawBlockText(
    doc,
    copy.closingAsOn(
      formatDisplayDate(model.statementDate, lang),
      formatBalanceSide(model.ledger.closingBalance, lang),
    ),
    textStart,
    cursorRef.y,
    { align: textAlign },
  );
  cursorRef.y += 18;

  ensureSpace(40);
  doc.setFont(undefined, "bold");
  doc.setFontSize(10);
  drawBlockText(doc, copy.outstandingBuckets, textStart, cursorRef.y, { align: textAlign });
  cursorRef.y += 12;

  const bucketCols = [
    { key: "label", label: copy.bucket, width: contentWidth - 120, align: "left" },
    { key: "amount", label: copy.amount, width: 120, align: "right" },
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
    drawBlockText(doc, copy.noBuckets, textStart, cursorRef.y + 11, { align: textAlign });
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
    drawCellText(doc, localizeBucketLabel(bucket, lang), marginX, cursorRef.y + 11, bucketCols[0].width, { align: "left" });
    drawCellText(
      doc,
      formatLedgerMoney(bucket.amount, lang),
      marginX + bucketCols[0].width,
      cursorRef.y + 11,
      bucketCols[1].width,
      { align: "right", color: bucket.kind === "total" ? COLORS.open : COLORS.bodyText },
    );
    cursorRef.y += rowHeight;
  });
  cursorRef.y += 16;

  doc.setFont(undefined, "normal");
  doc.setFontSize(8);
  const confirmation = lang === "ar"
    ? (model.confirmationTextAr || copy.confirmation({
      name: model.customerName,
      code: localizeLedgerDigits(model.customerCode, "ar"),
      balance: formatBalanceSide(model.ledger.closingBalance, "ar"),
      date: formatDisplayDate(model.statementDate, "ar"),
    }))
    : (model.confirmationText || copy.confirmation({
      name: model.customerName,
      code: model.customerCode,
      balance: formatBalanceSide(model.ledger.closingBalance, "en"),
      date: formatDisplayDate(model.statementDate, "en"),
    }));
  const confirmLines = doc.splitTextToSize(String(confirmation || ""), contentWidth - 20);
  const confirmLineCount = Array.isArray(confirmLines) ? confirmLines.length : 1;
  const confirmHeight = Math.max(78, 28 + confirmLineCount * 11 + 14);
  ensureSpace(confirmHeight + 16);
  doc.setDrawColor(...COLORS.accent);
  doc.setLineWidth(0.8);
  doc.roundedRect(marginX, cursorRef.y, contentWidth, confirmHeight, 3, 3);
  doc.setFont(undefined, "bold");
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.bodyText);
  drawBlockText(doc, copy.balanceConfirmation, rtl ? marginX + contentWidth - 10 : marginX + 10, cursorRef.y + 16, {
    align: textAlign,
  });
  doc.setFont(undefined, "normal");
  doc.setFontSize(8);
  drawWrappedText(
    doc,
    confirmation,
    rtl ? marginX + contentWidth - 10 : marginX + 10,
    cursorRef.y + 32,
    {
      align: textAlign,
      maxWidth: contentWidth - 20,
      lineHeight: 11,
    },
  );
  cursorRef.y += confirmHeight + 16;

  ensureSpace(70);
  const sigWidth = (contentWidth - 24) / 3;
  const sigLabels = [copy.preparedBy, copy.authorisedSignatory, copy.customerConfirmation];
  sigLabels.forEach((label, index) => {
    const x = marginX + index * (sigWidth + 12);
    doc.setDrawColor(...COLORS.border);
    doc.line(x, cursorRef.y + 36, x + sigWidth, cursorRef.y + 36);
    doc.setFont(undefined, "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.mutedText);
    drawBlockText(doc, label, rtl ? x + sigWidth : x, cursorRef.y + 50, { align: textAlign });
  });
  cursorRef.y += 70;

  ensureSpace(40);
  doc.setFont(undefined, "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.bodyText);
  drawBlockText(doc, copy.scheduleA, textStart, cursorRef.y, { align: textAlign });
  cursorRef.y += 14;
  doc.setFont(undefined, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.mutedText);
  drawBlockText(doc, copy.scheduleAHint, textStart, cursorRef.y, { align: textAlign });
  cursorRef.y += 12;

  const openCols = [
    { key: "invoice_date", label: copy.date, width: 62, align: "left" },
    { key: "voucher_number", label: copy.voucher, width: 78, align: "left" },
    { key: "amount_incl_vat", label: copy.salesInclVat, width: 78, align: "right" },
    { key: "paid_amount", label: copy.paid, width: 68, align: "right" },
    { key: "remaining", label: copy.open, width: 68, align: "right" },
    { key: "status", label: copy.status, width: 56, align: "left" },
    { key: "days", label: copy.days, width: contentWidth - (62 + 78 + 78 + 68 + 68 + 56), align: "right" },
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
    drawBlockText(doc, copy.noOpen, textStart, cursorRef.y + 11, { align: textAlign });
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
      invoice_date: formatDisplayDate(row.invoice_date, lang),
      voucher_number: localizeLedgerDigits(row.voucher_number, lang),
      amount_incl_vat: formatLedgerMoney(row.amount_incl_vat, lang),
      paid_amount: formatLedgerMoney(row.paid_amount, lang),
      remaining: formatLedgerMoney(row.remaining, lang),
      status: localizeStatus(row.status, lang),
      days: localizeOpenDays(row, lang),
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
  drawCellText(doc, copy.totalOpen, marginX, cursorRef.y + 11, 140, { align: "left" });
  drawCellText(doc, formatLedgerMoney(model.openTotal, lang), marginX + 286, cursorRef.y + 11, 68, {
    align: "right",
    color: COLORS.open,
  });
  cursorRef.y += rowHeight + 18;

  ensureSpace(40);
  doc.setFont(undefined, "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.bodyText);
  drawBlockText(doc, copy.scheduleB, textStart, cursorRef.y, { align: textAlign });
  cursorRef.y += 14;
  doc.setFont(undefined, "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.mutedText);
  drawBlockText(doc, copy.scheduleBHint, textStart, cursorRef.y, { align: textAlign });
  cursorRef.y += 12;

  const revCols = [
    { key: "invoice_date", label: copy.salesDate, width: 62, align: "left" },
    { key: "voucher_number", label: copy.invoice, width: 72, align: "left" },
    { key: "amount_incl_vat", label: copy.salesInclVat, width: 78, align: "right" },
    { key: "credit_note_date", label: copy.cnDate, width: 62, align: "left" },
    { key: "credit_note_voucher", label: copy.cnVoucher, width: 72, align: "left" },
    { key: "credit_note_amount", label: copy.cnAmount, width: contentWidth - (62 + 72 + 78 + 62 + 72), align: "right" },
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
    drawBlockText(doc, copy.noReversed, textStart, cursorRef.y + 11, { align: textAlign });
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
      invoice_date: formatDisplayDate(row.invoice_date, lang),
      voucher_number: localizeLedgerDigits(row.voucher_number, lang),
      amount_incl_vat: formatLedgerMoney(row.amount_incl_vat, lang),
      credit_note_date: formatDisplayDate(row.credit_note_date, lang),
      credit_note_voucher: localizeLedgerDigits(row.credit_note_voucher, lang),
      credit_note_amount: formatLedgerMoney(row.credit_note_amount, lang),
    };
    let colX = marginX;
    revCols.forEach((col) => {
      drawCellText(doc, values[col.key], colX, cursorRef.y + 11, col.width, { align: col.align });
      colX += col.width;
    });
    cursorRef.y += rowHeight;
  });
}

/**
 * Render a professional balance-confirmation PDF (A4): full Arabic section, then full English.
 */
export async function createCustomerLedgerPdfDoc(model) {
  if (!model) throw new Error("Customer ledger PDF model is required.");
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const { ARABIC_FONT_BASE64 } = await import("./pdfArabicFontData.js");
  registerArabicPdfFont(doc, ARABIC_FONT_BASE64);
  installArabicPdfText(doc);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 36;
  const contentWidth = pageWidth - marginX * 2;
  const rowHeight = 15;
  const headerHeight = 17;
  const cursorRef = { y: 40 };
  const languages = Array.isArray(model.languages) && model.languages.length
    ? model.languages
    : LEDGER_PDF_LANGUAGES;

  languages.forEach((lang, index) => {
    renderCustomerLedgerLanguageSection(doc, model, lang, {
      marginX,
      contentWidth,
      pageHeight,
      rowHeight,
      headerHeight,
      cursorRef,
      startFreshPage: index > 0,
    });
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
