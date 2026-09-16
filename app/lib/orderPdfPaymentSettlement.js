const TITLE_HEIGHT = 18;
const SUBTITLE_HEIGHT = 14;
const ROW_HEIGHT = 16;
const HEADER_HEIGHT = 18;
const AFTER_TABLE_GAP = 14;
const FOOTER_HEIGHT = 18;

const COLORS = {
  headerBg: [15, 76, 92],
  headerText: [255, 255, 255],
  zebraBg: [242, 248, 249],
  bodyText: [20, 20, 20],
  mutedText: [74, 100, 107],
  totalBg: [232, 241, 243],
  border: [164, 183, 188],
  paid: [31, 122, 58],
  partial: [154, 103, 0],
  open: [180, 35, 24],
  reversed: [74, 85, 96],
};

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function statusColor(status) {
  if (status === "Paid") return COLORS.paid;
  if (status === "Partial") return COLORS.partial;
  if (status === "Reversed") return COLORS.reversed;
  return COLORS.open;
}

function paymentDaysLabel(invoice) {
  if (invoice?.payment_days != null) return String(invoice.payment_days);
  if (Number(invoice?.open_days || 0) > 0) return `Open ${invoice.open_days}d`;
  return "—";
}

/**
 * Build a compact settlement model for the sales-order PDF appendix.
 */
export function buildPaymentSettlementPdfModel(ledger) {
  if (!ledger || !Array.isArray(ledger.invoices)) return null;
  const invoices = ledger.invoices;
  const reversed = Array.isArray(ledger.reversedInvoices) ? ledger.reversedInvoices : [];
  const creditNotes = Array.isArray(ledger.creditNotes) ? ledger.creditNotes : [];
  if (!invoices.length && !reversed.length && !creditNotes.length) return null;

  const totals = ledger.totals || {};
  const summary = ledger.summary || {};
  const subtitleParts = [
    `${Number(totals.paid_invoice_count || 0)} paid`,
    `${Number(totals.partial_invoice_count || 0)} partial`,
    `${Number(totals.open_invoice_count || 0)} open`,
  ];
  if (summary.avgDaysToPay != null) {
    subtitleParts.push(`Avg ${summary.avgDaysToPay} days to pay`);
  }

  return {
    subtitle: subtitleParts.join(" · "),
    invoices: invoices.map((row) => ({
      invoice_date: row.invoice_date || "—",
      voucher_number: row.voucher_number || "—",
      amount_excl_vat: formatMoney(row.amount_excl_vat),
      amount_incl_vat: formatMoney(row.amount_incl_vat),
      paid_amount: formatMoney(row.paid_amount),
      remaining: formatMoney(row.remaining),
      status: row.status || "Open",
      payment_days: paymentDaysLabel(row),
    })),
    invoiceTotals: {
      amount_excl_vat: formatMoney(totals.invoice_sales_excl_vat ?? totals.sales_excl_vat),
      amount_incl_vat: formatMoney(totals.invoice_sales_incl_vat ?? totals.sales_incl_vat),
      paid_amount: formatMoney(
        Number(totals.paid_amount || 0) - Number(totals.reversed_sales_incl_vat || 0),
      ),
      remaining: formatMoney(totals.open_sales_amount),
    },
    reversed: reversed.map((row) => ({
      invoice_date: row.invoice_date || "—",
      voucher_number: row.voucher_number || "—",
      amount_incl_vat: formatMoney(row.amount_incl_vat),
      credit_note_date: row.credit_note_date || "—",
      credit_note_voucher: row.credit_note_voucher || "—",
      credit_note_amount: formatMoney(row.credit_note_amount),
      status: "Reversed",
    })),
    creditNotes: creditNotes.map((row) => ({
      credit_date: row.credit_date || "—",
      voucher_number: row.voucher_number || "—",
      kind: row.kind || "Credit Note",
      reference: row.reference || "—",
      amount_excl_vat: formatMoney(row.amount_excl_vat),
      amount_incl_vat: formatMoney(row.amount_incl_vat),
      status: row.kind || "Credit",
    })),
    creditNoteTotals: {
      amount_excl_vat: formatMoney(totals.credit_note_excl_vat || 0),
      amount_incl_vat: formatMoney(totals.credit_note_amount || 0),
    },
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
    doc.text(String(text), x + width - 3, y, { align: "right" });
  } else {
    doc.text(String(text), x + 3, y);
  }
}

/**
 * Append the Invoices & Settlement table near the end of the sales-order PDF.
 */
export function appendPaymentSettlementToPdf(doc, {
  ledger = null,
  analytics = null,
  x,
  y,
  maxWidth,
  ensureSpace,
}) {
  const model = buildPaymentSettlementPdfModel(ledger || analytics?.paymentSettlement || null);
  if (!model) return typeof y === "function" ? y() : y;

  let cursorY = typeof y === "function" ? y() : y;
  const tableWidth = maxWidth;
  const cols = [
    { key: "invoice_date", label: "Date", width: 58, align: "left" },
    { key: "voucher_number", label: "Voucher", width: 72, align: "left" },
    { key: "amount_excl_vat", label: "Excl VAT", width: 62, align: "right" },
    { key: "amount_incl_vat", label: "Incl VAT", width: 62, align: "right" },
    { key: "paid_amount", label: "Paid", width: 58, align: "right" },
    { key: "remaining", label: "Open", width: 58, align: "right" },
    { key: "status", label: "Status", width: 52, align: "left" },
    { key: "payment_days", label: "Days", width: Math.max(40, tableWidth - (58 + 72 + 62 + 62 + 58 + 58 + 52)), align: "right" },
  ];

  const drawTitle = (title, subtitle = "") => {
    ensureSpace(TITLE_HEIGHT + (subtitle ? SUBTITLE_HEIGHT : 0) + HEADER_HEIGHT + ROW_HEIGHT);
    doc.setFont(undefined, "bold");
    doc.setFontSize(11);
    doc.setTextColor(...COLORS.bodyText);
    doc.text(title, x, cursorY);
    cursorY += TITLE_HEIGHT;
    if (subtitle) {
      doc.setFont(undefined, "normal");
      doc.setFontSize(8);
      doc.setTextColor(...COLORS.mutedText);
      doc.text(subtitle, x, cursorY);
      cursorY += SUBTITLE_HEIGHT;
    }
    doc.setFontSize(8);
  };

  drawTitle("Invoices & Settlement", model.subtitle);

  const drawHeader = () => {
    fillHeader(doc, x, cursorY, tableWidth, HEADER_HEIGHT);
    doc.setFont(undefined, "bold");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.headerText);
    let colX = x;
    cols.forEach((col) => {
      drawCellText(doc, col.label, colX, cursorY + 12, col.width, {
        align: col.align,
        color: COLORS.headerText,
      });
      colX += col.width;
    });
    cursorY += HEADER_HEIGHT;
    doc.setFont(undefined, "normal");
  };

  drawHeader();

  model.invoices.forEach((row, index) => {
    if (cursorY + ROW_HEIGHT > doc.internal.pageSize.getHeight() - 52) {
      doc.addPage();
      cursorY = 48;
      drawHeader();
    }
    if (index % 2 === 1) {
      doc.setFillColor(...COLORS.zebraBg);
      doc.rect(x, cursorY, tableWidth, ROW_HEIGHT, "F");
    }
    doc.setDrawColor(...COLORS.border);
    let colX = x;
    cols.forEach((col) => {
      doc.rect(colX, cursorY, col.width, ROW_HEIGHT);
      const value = row[col.key];
      drawCellText(doc, value, colX, cursorY + 11, col.width, {
        align: col.align,
        color: col.key === "status" ? statusColor(row.status) : COLORS.bodyText,
      });
      colX += col.width;
    });
    cursorY += ROW_HEIGHT;
  });

  if (model.invoices.length) {
    ensureSpace(FOOTER_HEIGHT + 8);
    doc.setFillColor(...COLORS.totalBg);
    doc.rect(x, cursorY, tableWidth, FOOTER_HEIGHT, "F");
    doc.setFont(undefined, "bold");
    let colX = x;
    const footer = {
      invoice_date: "Total",
      voucher_number: "",
      amount_excl_vat: model.invoiceTotals.amount_excl_vat,
      amount_incl_vat: model.invoiceTotals.amount_incl_vat,
      paid_amount: model.invoiceTotals.paid_amount,
      remaining: model.invoiceTotals.remaining,
      status: "",
      payment_days: "",
    };
    cols.forEach((col) => {
      doc.rect(colX, cursorY, col.width, FOOTER_HEIGHT);
      drawCellText(doc, footer[col.key], colX, cursorY + 12, col.width, { align: col.align });
      colX += col.width;
    });
    cursorY += FOOTER_HEIGHT + AFTER_TABLE_GAP;
    doc.setFont(undefined, "normal");
  } else {
    cursorY += 8;
  }

  if (model.reversed.length) {
    drawTitle(
      "Reversed by Credit Note",
      `${model.reversed.length} excluded from avg days to pay`,
    );
    const revCols = [
      { key: "invoice_date", label: "Sales Date", width: 62 },
      { key: "voucher_number", label: "Invoice", width: 72 },
      { key: "amount_incl_vat", label: "Incl VAT", width: 62, align: "right" },
      { key: "credit_note_date", label: "CN Date", width: 62 },
      { key: "credit_note_voucher", label: "CN Voucher", width: 72 },
      { key: "credit_note_amount", label: "CN Amount", width: 62, align: "right" },
      { key: "status", label: "Status", width: tableWidth - (62 + 72 + 62 + 62 + 72 + 62) },
    ];

    const drawRevHeader = () => {
      fillHeader(doc, x, cursorY, tableWidth, HEADER_HEIGHT);
      doc.setFont(undefined, "bold");
      doc.setTextColor(...COLORS.headerText);
      let colX = x;
      revCols.forEach((col) => {
        drawCellText(doc, col.label, colX, cursorY + 12, col.width, {
          align: col.align || "left",
          color: COLORS.headerText,
        });
        colX += col.width;
      });
      cursorY += HEADER_HEIGHT;
      doc.setFont(undefined, "normal");
    };

    drawRevHeader();
    model.reversed.forEach((row, index) => {
      if (cursorY + ROW_HEIGHT > doc.internal.pageSize.getHeight() - 52) {
        doc.addPage();
        cursorY = 48;
        drawRevHeader();
      }
      if (index % 2 === 1) {
        doc.setFillColor(...COLORS.zebraBg);
        doc.rect(x, cursorY, tableWidth, ROW_HEIGHT, "F");
      }
      let colX = x;
      revCols.forEach((col) => {
        doc.rect(colX, cursorY, col.width, ROW_HEIGHT);
        drawCellText(doc, row[col.key], colX, cursorY + 11, col.width, {
          align: col.align || "left",
          color: col.key === "status" ? COLORS.reversed : COLORS.bodyText,
        });
        colX += col.width;
      });
      cursorY += ROW_HEIGHT;
    });
    cursorY += AFTER_TABLE_GAP;
  }

  if ((model.creditNotes || []).length) {
    drawTitle(
      "Credit Notes & Sales Returns",
      `${model.creditNotes.length} partial / later (not full immediate reverse)`,
    );
    const cnCols = [
      { key: "credit_date", label: "Date", width: 62 },
      { key: "voucher_number", label: "Voucher", width: 72 },
      { key: "kind", label: "Type", width: 90 },
      { key: "reference", label: "Reference", width: 72 },
      { key: "amount_excl_vat", label: "Excl VAT", width: 62, align: "right" },
      { key: "amount_incl_vat", label: "Incl VAT", width: 62, align: "right" },
      { key: "status", label: "Status", width: Math.max(40, tableWidth - (62 + 72 + 90 + 72 + 62 + 62)) },
    ];

    const drawCnHeader = () => {
      fillHeader(doc, x, cursorY, tableWidth, HEADER_HEIGHT);
      doc.setFont(undefined, "bold");
      doc.setTextColor(...COLORS.headerText);
      let colX = x;
      cnCols.forEach((col) => {
        drawCellText(doc, col.label, colX, cursorY + 12, col.width, {
          align: col.align || "left",
          color: COLORS.headerText,
        });
        colX += col.width;
      });
      cursorY += HEADER_HEIGHT;
      doc.setFont(undefined, "normal");
    };

    drawCnHeader();
    model.creditNotes.forEach((row, index) => {
      if (cursorY + ROW_HEIGHT > doc.internal.pageSize.getHeight() - 52) {
        doc.addPage();
        cursorY = 48;
        drawCnHeader();
      }
      if (index % 2 === 1) {
        doc.setFillColor(...COLORS.zebraBg);
        doc.rect(x, cursorY, tableWidth, ROW_HEIGHT, "F");
      }
      let colX = x;
      cnCols.forEach((col) => {
        doc.rect(colX, cursorY, col.width, ROW_HEIGHT);
        drawCellText(doc, row[col.key], colX, cursorY + 11, col.width, {
          align: col.align || "left",
          color: COLORS.bodyText,
        });
        colX += col.width;
      });
      cursorY += ROW_HEIGHT;
    });

    ensureSpace(FOOTER_HEIGHT + 8);
    doc.setFillColor(...COLORS.totalBg);
    doc.rect(x, cursorY, tableWidth, FOOTER_HEIGHT, "F");
    doc.setFont(undefined, "bold");
    let footerX = x;
    const cnFooter = {
      credit_date: "Total",
      voucher_number: "",
      kind: "",
      reference: "",
      amount_excl_vat: model.creditNoteTotals.amount_excl_vat,
      amount_incl_vat: model.creditNoteTotals.amount_incl_vat,
      status: "",
    };
    cnCols.forEach((col) => {
      doc.rect(footerX, cursorY, col.width, FOOTER_HEIGHT);
      drawCellText(doc, cnFooter[col.key], footerX, cursorY + 12, col.width, {
        align: col.align || "left",
      });
      footerX += col.width;
    });
    cursorY += FOOTER_HEIGHT + AFTER_TABLE_GAP;
    doc.setFont(undefined, "normal");
  }

  doc.setTextColor(...COLORS.bodyText);
  doc.setFontSize(10);
  return cursorY;
}
