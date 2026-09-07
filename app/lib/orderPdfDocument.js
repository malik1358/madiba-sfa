import { lookupPositiveRate } from "./itemCodeAliases.js";
import { addPdfBuildFooter } from "./buildInfo.js";
import { appendCreditControlRemarkToPdf } from "./creditApproval.js";
import { appendMonthlyPerformanceToPdf } from "./orderPdfMonthlyPerformance.js";
import {
  buildOutstandingPdfBucketRows,
  sortBucketLabels,
  syncOutstandingCustomerFromInvoices,
  toNumber as parseOutstandingNumber,
} from "./outstanding.js";
import {
  DEFAULT_PAYMENT_TYPE,
  DEFAULT_PRICING_REGION,
  VAT_RATE,
  formatDiscountDetail,
  formatMoneyAmount,
  getPricedOrderLine,
  lookupDiscountRate,
  normalizePaymentType,
  normalizePricingRegion,
  pricingRegionLabel,
  regionPriceMapFor,
  summarizePricedLines,
} from "./regionalPricing.js";
import { evaluateOrderSchemes, lookupSchemeApplication } from "./orderSchemes.js";
import { loadPricePayload } from "./pricePayload.js";
import { PRICE_CACHE_KEY } from "./priceApiConfig.js";
import { formatSalesOrderNumber, salesOrderNumberNeedsLiveLookup } from "./salesOrderNumber.js";
import { isQueuedPendingOrderId } from "./queuedSalesOrders.js";
import { parseOfflineProspectIdFromCustomerCode } from "./prospects.js";

export const ORDER_PDF_OUTSTANDING_API = "/api/outstanding";
export const ORDER_PDF_CUSTOMER_HISTORY_API = "/api/customer-history";
export const ORDER_PDF_SALES_ORDER_API = "/api/sales-orders";
export const ORDER_PDF_PROSPECTS_API = "/api/prospects";

function formatHistoryMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatQty(value) {
  return Number(value || 0).toLocaleString("en-SA", { maximumFractionDigits: 0 });
}

function formatReceivableMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function toAmount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatHistoryChange(change) {
  if (!change) return "";

  const baseLabel = `${change.item_code || "-"} ${change.item_name || ""}`.trim();
  if (change.type === "ADDED") {
    return `${baseLabel}: added ${change.after_quantity || 0} qty at ${formatHistoryMoney(change.after_rate || 0)}`;
  }
  if (change.type === "REMOVED") {
    return `${baseLabel}: removed ${change.before_quantity || 0} qty`;
  }

  const parts = [];
  if (Number(change.before_quantity || 0) !== Number(change.after_quantity || 0)) {
    parts.push(`qty ${change.before_quantity || 0} -> ${change.after_quantity || 0}`);
  }
  if (Number(change.before_rate || 0) !== Number(change.after_rate || 0)) {
    parts.push(`rate ${formatHistoryMoney(change.before_rate || 0)} -> ${formatHistoryMoney(change.after_rate || 0)}`);
  }
  return `${baseLabel}: ${parts.join(", ")}`;
}

export function inferPricingFromHistory(history = []) {
  const entries = Array.isArray(history) ? history : [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.paymentType || entry?.pricingRegion) {
      return {
        paymentType: normalizePaymentType(entry.paymentType),
        pricingRegion: normalizePricingRegion(entry.pricingRegion),
      };
    }
  }

  return {
    paymentType: DEFAULT_PAYMENT_TYPE,
    pricingRegion: DEFAULT_PRICING_REGION,
  };
}

function fallbackPdfLine(line) {
  const quantity = toAmount(line?.quantity ?? line?.order_quantity);
  const storedRate = toAmount(line?.rate);
  const wholesaleRate = toAmount(line?.wholesaleRate || storedRate);
  const lineValue = toAmount(line?.lineValue ?? line?.line_value ?? line?.lineTotal ?? quantity * storedRate);
  const vatAmount = toAmount(line?.vatAmount ?? lineValue * VAT_RATE);

  return {
    item_code: line?.item_code || "-",
    item_name: line?.item_name || "-",
    quantity,
    wholesaleRate,
    rate: storedRate || wholesaleRate,
    cashDiscount: toAmount(line?.cashDiscount),
    valueDiscount: toAmount(line?.valueDiscount),
    cashApplied: Boolean(line?.cashApplied),
    valueApplied: Boolean(line?.valueApplied),
    cashDiscountAmount: toAmount(line?.cashDiscountAmount),
    valueDiscountAmount: toAmount(line?.valueDiscountAmount),
    schemeDiscountAmount: toAmount(line?.schemeDiscountAmount),
    wholesaleLineValue: toAmount(line?.wholesaleLineValue ?? quantity * wholesaleRate),
    lineValue,
    lineTotal: lineValue,
    vatAmount,
    lineTotalInclVat: toAmount(line?.lineTotalInclVat ?? lineValue + vatAmount),
  };
}

export function mapSavedOrderLinesToPdfLines(lines = [], {
  paymentType = DEFAULT_PAYMENT_TYPE,
  pricingCatalog = null,
  pricingRegion = DEFAULT_PRICING_REGION,
} = {}) {
  const region = normalizePricingRegion(pricingRegion);
  const regionPriceMap = pricingCatalog
    ? regionPriceMapFor(pricingCatalog.regionPriceMaps, region, pricingCatalog.priceMap)
    : {};
  const cashDiscountMap = pricingCatalog?.cashDiscountMap || {};
  const valueDiscountMap = pricingCatalog?.valueDiscountMap || {};
  const resolvedPayment = normalizePaymentType(paymentType);
  const schemeApplications = evaluateOrderSchemes(lines, pricingCatalog?.schemes || []);

  return (Array.isArray(lines) ? lines : []).map((line) => {
    const existing = fallbackPdfLine(line);
    const code = String(line?.item_code || "").trim().toUpperCase();
    const catalogWholesale = lookupPositiveRate(regionPriceMap, code, 0);
    if (!(catalogWholesale > 0)) return existing;

    const cashDiscount = lookupDiscountRate(cashDiscountMap, code);
    const valueDiscount = lookupDiscountRate(valueDiscountMap, code);
    const scheme = lookupSchemeApplication(schemeApplications, code);
    const priced = getPricedOrderLine({
      wholesaleRate: catalogWholesale,
      quantity: existing.quantity,
      paymentType: resolvedPayment,
      cashDiscountRate: cashDiscount,
      valueDiscountRate: valueDiscount,
      schemeUnitDiscount: scheme.unitDiscount,
      schemeDiscountedQty: scheme.discountedQty,
    });

    return {
      ...existing,
      ...priced,
      item_code: line?.item_code || existing.item_code,
      item_name: line?.item_name || existing.item_name,
      cashDiscount,
      valueDiscount,
      cashApplied: priced.applied.cash,
      valueApplied: priced.applied.value,
      lineTotal: priced.lineValue,
    };
  });
}

export function buildOrderPdfSnapshotFromSavedOrder({
  order,
  lines = [],
  history = [],
  outstanding = null,
  creditApprovalRemark = "",
  paymentType,
  pricingRegion,
  pricingCatalog = null,
} = {}) {
  const inferred = inferPricingFromHistory(history);
  const resolvedPayment = normalizePaymentType(paymentType || inferred.paymentType);
  const resolvedRegion = normalizePricingRegion(pricingRegion || inferred.pricingRegion);
  const pdfLines = mapSavedOrderLinesToPdfLines(lines, {
    paymentType: resolvedPayment,
    pricingCatalog,
    pricingRegion: resolvedRegion,
  });
  const totals = summarizePricedLines(pdfLines);
  const orderNumber = formatSalesOrderNumber(order);

  return {
    orderId: order?.id,
    orderNumber,
    statusLabel: order?.status || "-",
    savedAtIso: order?.updated_at || order?.created_at || new Date().toISOString(),
    customerCode: order?.customer_code || "",
    customerName: order?.customer_name || "",
    salesmanCode: order?.salesman_code || "",
    paymentType: resolvedPayment,
    pricingRegion: resolvedRegion,
    itemCount: pdfLines.length,
    totalQuantity: pdfLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0),
    grandTotal: totals.amountExclVat,
    totals,
    lines: pdfLines,
    history: Array.isArray(history) ? history : [],
    creditApprovalRemark,
    outstanding: {
      bucketLabels: Array.isArray(outstanding?.bucketLabels) ? outstanding.bucketLabels : [],
      customer: outstanding?.customer || null,
      customerInvoices: Array.isArray(outstanding?.customerInvoices) ? outstanding.customerInvoices : [],
    },
  };
}

export async function enrichOrderPdfLiveData(snapshot, {
  accessToken = "",
  outstandingApi = ORDER_PDF_OUTSTANDING_API,
  customerHistoryApi = ORDER_PDF_CUSTOMER_HISTORY_API,
  salesOrderApi = ORDER_PDF_SALES_ORDER_API,
  prospectsApi = ORDER_PDF_PROSPECTS_API,
  analyticsFallback = null,
  skipOutstanding = false,
  skipHistory = false,
  skipPricing = false,
} = {}) {
  const next = {
    ...snapshot,
    orderNumber: formatSalesOrderNumber(snapshot),
    outstanding: {
      bucketLabels: Array.isArray(snapshot?.outstanding?.bucketLabels) ? snapshot.outstanding.bucketLabels : [],
      customer: snapshot?.outstanding?.customer || null,
      customerInvoices: Array.isArray(snapshot?.outstanding?.customerInvoices) ? snapshot.outstanding.customerInvoices : [],
    },
  };

  let analytics = analyticsFallback;
  const authHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : null;

  if (authHeaders) {
    try {
      const params = new URLSearchParams();
      if (snapshot?.orderId && !isQueuedPendingOrderId(snapshot.orderId) && !Number.isNaN(Number(snapshot.orderId))) {
        params.set("orderId", String(snapshot.orderId));
      } else if (salesOrderNumberNeedsLiveLookup(snapshot) && snapshot?.customerCode) {
        params.set("customerCode", snapshot.customerCode);
        params.set("latest", "1");
      }

      if ([...params.keys()].length > 0) {
        const orderResponse = await fetch(`${salesOrderApi}?${params.toString()}`, {
          headers: authHeaders,
          cache: "no-store",
        });
        const orderPayload = await orderResponse.json().catch(() => ({}));
        if (orderResponse.ok && orderPayload.success && orderPayload.found !== false && orderPayload.orderId) {
          next.orderId = orderPayload.orderId;
          next.orderNumber = formatSalesOrderNumber({
            id: orderPayload.orderId,
            order_number: orderPayload.orderNumber,
          });
          if (orderPayload.customerCode) next.customerCode = orderPayload.customerCode;
          if (orderPayload.customerName) next.customerName = orderPayload.customerName;
        }
      }
    } catch {
      // Keep the local snapshot if the live order number cannot be fetched.
    }

    try {
      const offlineId = parseOfflineProspectIdFromCustomerCode(next.customerCode || snapshot?.customerCode);
      if (offlineId) {
        const prospectResponse = await fetch(`${prospectsApi}?offlineId=${encodeURIComponent(offlineId)}`, {
          headers: authHeaders,
          cache: "no-store",
        });
        const prospectPayload = await prospectResponse.json().catch(() => ({}));
        if (prospectResponse.ok && prospectPayload.success && prospectPayload.found !== false && prospectPayload.customerCode) {
          next.customerCode = prospectPayload.customerCode;
          if (prospectPayload.customerName) next.customerName = prospectPayload.customerName;
        }
      }
    } catch {
      // Keep the saved customer code if the live prospect cannot be fetched.
    }
  }

  const liveCustomerCode = next.customerCode || snapshot?.customerCode;
  const liveCustomerName = next.customerName || snapshot?.customerName;
  const dataLookups = [];

  if (authHeaders && liveCustomerCode && !skipOutstanding) {
    dataLookups.push((async () => {
      try {
        const outstandingResponse = await fetch(
          `${outstandingApi}?customerCode=${encodeURIComponent(liveCustomerCode || "")}&customerName=${encodeURIComponent(liveCustomerName || "")}`,
          { headers: authHeaders, cache: "no-store" }
        );
        const outstandingPayload = await outstandingResponse.json().catch(() => ({}));
        if (outstandingResponse.ok && outstandingPayload.success) {
          next.outstanding.customer = outstandingPayload.customer || next.outstanding.customer;
          next.outstanding.bucketLabels = sortBucketLabels(outstandingPayload.bucketLabels || next.outstanding.bucketLabels);
          next.outstanding.customerInvoices = Array.isArray(outstandingPayload.customerInvoices)
            ? outstandingPayload.customerInvoices
            : next.outstanding.customerInvoices;
        }
      } catch {
        // Keep generating the order PDF even if outstanding cannot be refreshed.
      }
    })());
  }

  if (authHeaders && liveCustomerCode && !skipHistory && !analytics?.monthlySummary?.length) {
    dataLookups.push((async () => {
      try {
        const historyResponse = await fetch(
          `${customerHistoryApi}?customerCode=${encodeURIComponent(liveCustomerCode)}`,
          { headers: authHeaders }
        );
        const historyPayload = await historyResponse.json().catch(() => ({}));
        if (historyResponse.ok && historyPayload.success) {
          const { buildAnalytics } = await import("../management/customer-audit/lib/analytics.js");
          analytics = buildAnalytics(Array.isArray(historyPayload.transactions) ? historyPayload.transactions : []);
        }
      } catch {
        analytics = analyticsFallback;
      }
    })());
  }

  if (!skipPricing) {
    dataLookups.push((async () => {
      try {
        const pricingCatalog = await loadPricePayload("/api/pricing/cache", PRICE_CACHE_KEY);
        const repriced = mapSavedOrderLinesToPdfLines(next.lines || snapshot.lines || [], {
          paymentType: next.paymentType || snapshot.paymentType,
          pricingCatalog,
          pricingRegion: next.pricingRegion || snapshot.pricingRegion,
        });
        const totals = summarizePricedLines(repriced);
        next.lines = repriced;
        next.totals = totals;
        next.grandTotal = totals.amountExclVat;
      } catch {
        // Keep the saved snapshot if the live price catalog cannot be loaded.
      }
    })());
  }

  await Promise.all(dataLookups);

  next.outstanding.customer = syncOutstandingCustomerFromInvoices(
    next.outstanding.customer,
    next.outstanding.customerInvoices,
  );

  return { snapshot: next, analytics };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolveLiveOrderPdfSnapshot(snapshot, options = {}, {
  processQueue,
  attempts = 8,
  delayMs = 400,
} = {}) {
  let current = snapshot;
  let analytics = options.analyticsFallback || null;
  const canLookup = Boolean(options.accessToken);

  for (let attempt = 0; attempt < (canLookup ? attempts : 1); attempt += 1) {
    if (typeof processQueue === "function" && salesOrderNumberNeedsLiveLookup(current)) {
      await processQueue().catch(() => undefined);
    }

    const identityOnly = attempt > 0;
    const enriched = await enrichOrderPdfLiveData(current, {
      ...options,
      analyticsFallback: analytics,
      skipOutstanding: identityOnly || options.skipOutstanding,
      skipHistory: identityOnly || options.skipHistory,
      skipPricing: identityOnly || options.skipPricing,
    });
    current = enriched.snapshot;
    analytics = enriched.analytics;
    if (!salesOrderNumberNeedsLiveLookup(current)) {
      return { snapshot: current, analytics };
    }
    if (attempt < attempts - 1) await wait(delayMs);
  }

  return { snapshot: current, analytics };
}

export function renderOrderPdfDocument(doc, snapshot, { analytics = null } = {}) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 40;
  const marginTop = 38;
  const contentWidth = pageWidth - marginX * 2;
  const tableStartX = marginX;
  const pdfTotals = snapshot.totals || summarizePricedLines(snapshot.lines || []);
  const subtotal = Number(pdfTotals.amountExclVat || snapshot.grandTotal || 0);
  const vatAmount = Number(pdfTotals.vatAmount || subtotal * VAT_RATE);
  const totalWithVat = Number(pdfTotals.amountInclVat || subtotal + vatAmount);

  const columns = [
    { key: "item_code", label: "Code", width: 46, align: "left" },
    { key: "item_name", label: "Item", width: 78, align: "left" },
    { key: "quantity", label: "Qty", width: 26, align: "right" },
    { key: "rate", label: "Rate", width: 40, align: "right" },
    { key: "cashDiscount", label: "Cash Disc", width: 50, align: "right" },
    { key: "valueDiscount", label: "Value Disc", width: 50, align: "right" },
    { key: "schemeDiscount", label: "Scheme", width: 48, align: "right" },
    { key: "exclVat", label: "Excl. VAT", width: 52, align: "right" },
    { key: "vat", label: "VAT 15%", width: 46, align: "right" },
    { key: "inclVat", label: "Incl. VAT", width: 79, align: "right" },
  ];

  const orderSummaryColumns = [
    { label: "Items", value: String(snapshot.itemCount ?? (snapshot.lines || []).length), align: "left" },
    { label: "Total Qty", value: formatQty(snapshot.totalQuantity), align: "left" },
    { label: "Without VAT", value: formatMoneyAmount(subtotal), align: "left" },
    { label: "VAT 15%", value: formatMoneyAmount(vatAmount), align: "left" },
    { label: "After VAT", value: formatMoneyAmount(totalWithVat), align: "left" },
  ];

  function drawCellText(text, x, y, width, align = "left") {
    if (align === "right") {
      doc.text(text, x + width - 6, y, { align: "right" });
      return;
    }
    doc.text(text, x + 6, y);
  }

  function drawTableHeader(startY) {
    let colX = tableStartX;
    doc.setFillColor(239, 244, 245);
    doc.rect(tableStartX, startY, contentWidth, 24, "F");
    doc.setFont(undefined, "bold");
    doc.setFontSize(8);

    columns.forEach((column) => {
      doc.rect(colX, startY, column.width, 24);
      drawCellText(column.label, colX, startY + 15, column.width, column.align);
      colX += column.width;
    });

    doc.setFont(undefined, "normal");
    return startY + 24;
  }

  const orderNumberLabel = formatSalesOrderNumber(snapshot) || "—";

  doc.setDrawColor(72, 110, 120);
  doc.setLineWidth(1);
  doc.roundedRect(marginX, marginTop, contentWidth, 108, 6, 6);

  doc.setFontSize(18);
  doc.setFont(undefined, "bold");
  doc.text("MADIBA SFA", marginX + 12, marginTop + 24);
  doc.setFontSize(12);
  doc.text("SALES ORDER", marginX + 12, marginTop + 44);

  doc.setFontSize(16);
  doc.text(`Order Number  ${orderNumberLabel}`, marginX + 12, marginTop + 70);

  doc.setFont(undefined, "normal");
  doc.setFontSize(10);
  doc.text(
    `Status: ${snapshot.statusLabel} | ${String(snapshot.paymentType || "credit").toUpperCase()} | ${pricingRegionLabel(snapshot.pricingRegion)}`,
    marginX + 12,
    marginTop + 90
  );

  const rightColX = marginX + contentWidth - 210;
  doc.text(`Date: ${new Date(snapshot.savedAtIso).toLocaleString("en-GB")}`, rightColX, marginTop + 24);
  doc.text(`Salesman: ${snapshot.salesmanCode || "-"}`, rightColX, marginTop + 40);

  doc.setLineWidth(0.8);
  doc.roundedRect(marginX, marginTop + 120, contentWidth, 56, 5, 5);
  doc.setFont(undefined, "bold");
  doc.text("Customer", marginX + 12, marginTop + 140);
  doc.setFont(undefined, "normal");
  const customerText = `${snapshot.customerCode} - ${snapshot.customerName}`;
  const customerLines = doc.splitTextToSize(customerText, contentWidth - 24);
  const customerLine1 = Array.isArray(customerLines) ? customerLines[0] : customerText;
  const customerLine2 = Array.isArray(customerLines) && customerLines.length > 1 ? customerLines[1] : "";
  doc.text(customerLine1, marginX + 12, marginTop + 156);
  if (customerLine2) {
    doc.text(customerLine2, marginX + 12, marginTop + 168);
  }

  const orderSummaryY = marginTop + 188;
  const orderSummaryHeight = 40;
  const orderSummaryColWidth = contentWidth / orderSummaryColumns.length;
  doc.roundedRect(marginX, orderSummaryY, contentWidth, orderSummaryHeight, 5, 5);
  doc.setFont(undefined, "bold");
  orderSummaryColumns.forEach((col, index) => {
    const colX = marginX + index * orderSummaryColWidth;
    doc.text(col.label, colX + 8, orderSummaryY + 16);
  });
  doc.setFont(undefined, "normal");
  orderSummaryColumns.forEach((col, index) => {
    const colX = marginX + index * orderSummaryColWidth;
    doc.text(col.value, colX + 8, orderSummaryY + 32);
  });

  let y = drawTableHeader(marginTop + 242);
  doc.setFontSize(9);

  (snapshot.lines || []).forEach((line) => {
    const rowValues = {
      item_code: String(line.item_code || "-"),
      item_name: String(line.item_name || "-"),
      quantity: String(line.quantity),
      rate: formatMoneyAmount(line.wholesaleRate || line.rate),
      cashDiscount: formatDiscountDetail(line.cashDiscount, line.cashApplied, line.cashDiscountAmount),
      valueDiscount: formatDiscountDetail(line.valueDiscount, line.valueApplied, line.valueDiscountAmount),
      schemeDiscount: Number(line.schemeDiscountAmount || 0) > 0
        ? formatMoneyAmount(line.schemeDiscountAmount)
        : "—",
      exclVat: formatMoneyAmount(line.lineValue || line.lineTotal),
      vat: formatMoneyAmount(line.vatAmount),
      inclVat: formatMoneyAmount(line.lineTotalInclVat),
    };

    const itemNameCol = columns.find((column) => column.key === "item_name");
    const wrappedName = doc.splitTextToSize(rowValues.item_name, (itemNameCol?.width || 200) - 12);
    const wrappedLines = Array.isArray(wrappedName) ? wrappedName : [rowValues.item_name];
    const rowHeight = Math.max(24, wrappedLines.length * 12 + 8);

    if (y + rowHeight > pageHeight - 110) {
      doc.addPage();
      y = drawTableHeader(marginTop);
    }

    let colX = tableStartX;
    columns.forEach((column) => {
      doc.rect(colX, y, column.width, rowHeight);

      if (column.key === "item_name") {
        wrappedLines.forEach((nameLine, index) => {
          drawCellText(nameLine, colX, y + 14 + index * 12, column.width, column.align);
        });
      } else {
        drawCellText(rowValues[column.key], colX, y + 15, column.width, column.align);
      }

      colX += column.width;
    });

    y += rowHeight;
  });

  const summaryBoxWidth = 260;
  const summaryBoxHeight = 144;
  const summaryX = pageWidth - marginX - summaryBoxWidth;
  const bottomMargin = 52;
  let cursorY = y + 16;

  function ensureSpace(requiredHeight) {
    if (cursorY + requiredHeight > pageHeight - bottomMargin) {
      doc.addPage();
      cursorY = marginTop;
    }
  }

  const outstandingCustomer = snapshot.outstanding?.customer || null;
  const outstandingBuckets = Array.isArray(snapshot.outstanding?.bucketLabels) ? snapshot.outstanding.bucketLabels : [];
  const outstandingInvoices = Array.isArray(snapshot.outstanding?.customerInvoices) ? snapshot.outstanding.customerInvoices : [];

  function formatOutstandingValue(value, digits = 0, withCurrency = true) {
    const number = parseOutstandingNumber(value);
    if (withCurrency) return formatReceivableMoney(number);
    return number.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  const bucketRows = buildOutstandingPdfBucketRows(outstandingCustomer, outstandingBuckets).map((row) => ({
    label: row.label,
    value: formatOutstandingValue(row.amount, 0, row.kind !== "count"),
  }));
  const outstandingBlockHeight = bucketRows.length > 0
    ? 14 + 10 + bucketRows.length * 18
    : 0;
  const hasOutstandingBuckets = bucketRows.length > 0;
  const combinedSectionHeight = hasOutstandingBuckets
    ? outstandingBlockHeight + 12 + summaryBoxHeight
    : summaryBoxHeight;

  ensureSpace(combinedSectionHeight + 16);
  const sectionY = cursorY;
  let summaryY = sectionY;

  if (hasOutstandingBuckets) {
    doc.setFont(undefined, "bold");
    doc.text("Outstanding Details", marginX, sectionY);
    doc.setFont(undefined, "normal");

    let bucketY = sectionY + 14;
    const labelW = 220;
    const valueW = 120;

    bucketRows.forEach((row, index) => {
      const rowH = 18;
      doc.rect(marginX, bucketY, labelW, rowH);
      doc.rect(marginX + labelW, bucketY, valueW, rowH);
      doc.text(row.label, marginX + 6, bucketY + 12);
      if (index === bucketRows.length - 1) {
        doc.setFont(undefined, "bold");
      }
      doc.text(row.value, marginX + labelW + valueW - 6, bucketY + 12, { align: "right" });
      if (index === bucketRows.length - 1) {
        doc.setFont(undefined, "normal");
      }
      bucketY += rowH;
    });

    cursorY = bucketY;
    summaryY = bucketY + 12;
  }

  doc.roundedRect(summaryX, summaryY, summaryBoxWidth, summaryBoxHeight, 4, 4);
  doc.setFont(undefined, "normal");
  doc.setFontSize(9);
  const summaryRows = [
    ["Before discount", formatMoneyAmount(pdfTotals.wholesaleTotal)],
    ["Cash discount", pdfTotals.cashDiscountTotal > 0 ? formatMoneyAmount(pdfTotals.cashDiscountTotal) : "None"],
    ["Value discount", pdfTotals.valueDiscountTotal > 0 ? formatMoneyAmount(pdfTotals.valueDiscountTotal) : "None"],
    ["Scheme discount", pdfTotals.schemeDiscountTotal > 0 ? formatMoneyAmount(pdfTotals.schemeDiscountTotal) : "None"],
    ["Amount without VAT", formatMoneyAmount(subtotal)],
    ["VAT 15%", formatMoneyAmount(vatAmount)],
  ];
  summaryRows.forEach((row, index) => {
    doc.text(row[0], summaryX + 10, summaryY + 16 + index * 16);
    doc.text(row[1], summaryX + summaryBoxWidth - 10, summaryY + 16 + index * 16, { align: "right" });
  });
  doc.setFont(undefined, "bold");
  doc.setFontSize(11);
  const totalY = summaryY + 16 + summaryRows.length * 16 + 6;
  doc.text("Amount after VAT", summaryX + 10, totalY);
  doc.text(formatMoneyAmount(totalWithVat), summaryX + summaryBoxWidth - 10, totalY, { align: "right" });
  doc.setFont(undefined, "normal");
  doc.setFontSize(10);

  cursorY = Math.max(cursorY, summaryY + summaryBoxHeight) + 24;

  if (outstandingCustomer && outstandingInvoices.length > 0) {
    ensureSpace(30);
    doc.setFont(undefined, "bold");
    doc.text("Outstanding Invoice Rows", marginX, cursorY);
    doc.setFont(undefined, "normal");

    const invoiceCols = [
      { label: "Date", width: 72 },
      { label: "Ref. No.", width: 90 },
      { label: "Pending Amount", width: 92 },
      { label: "Due Date", width: 72 },
      { label: "Overdue Days", width: 62 },
      { label: "Invoice Day", width: 62 },
      { label: "Salesman", width: 65 },
    ];
    const rowH = 18;
    let rowY = cursorY + 8;

    function drawInvoiceHeader(atY) {
      let colX = marginX;
      doc.setFont(undefined, "bold");
      doc.setFontSize(9);
      invoiceCols.forEach((col) => {
        doc.rect(colX, atY, col.width, rowH);
        doc.text(col.label, colX + 4, atY + 12);
        colX += col.width;
      });
      doc.setFont(undefined, "normal");
      return atY + rowH;
    }

    rowY = drawInvoiceHeader(rowY);

    outstandingInvoices.slice(0, 12).forEach((invoice) => {
      if (rowY > pageHeight - bottomMargin) {
        doc.addPage();
        rowY = drawInvoiceHeader(marginTop);
      }

      const values = [
        String(invoice?.invoice_date || "-"),
        String(invoice?.ref_no || "-"),
        formatOutstandingValue(invoice?.pending_amount ?? invoice?.amount, 0, false),
        String(invoice?.due_date || "-"),
        formatOutstandingValue(invoice?.overdue_days, 0, false),
        formatOutstandingValue(invoice?.invoice_day, 0, false),
        String(invoice?.salesman || "-"),
      ];

      let valueX = marginX;
      values.forEach((value, idx) => {
        const width = invoiceCols[idx].width;
        doc.rect(valueX, rowY, width, rowH);
        const rightAligned = idx === 2 || idx === 4 || idx === 5;
        if (rightAligned) doc.text(String(value), valueX + width - 4, rowY + 12, { align: "right" });
        else doc.text(String(value), valueX + 4, rowY + 12);
        valueX += width;
      });

      rowY += rowH;
    });

    doc.setFontSize(10);
    cursorY = rowY + 16;
  }

  if (Array.isArray(snapshot.history) && snapshot.history.length > 0) {
    ensureSpace(24);
    doc.setFont(undefined, "bold");
    doc.text("Change History", marginX, cursorY);
    cursorY += 18;
    doc.setFont(undefined, "normal");

    snapshot.history.slice(-6).forEach((entry) => {
      const when = entry.changedAt || entry.savedAt || entry.saved_at || entry.timestamp || "";
      const label = `${when ? new Date(when).toLocaleString("en-GB") : "-"} • ${entry.action || "UPDATED"}`;
      const lines = [label, ...(Array.isArray(entry.changes) ? entry.changes.map(formatHistoryChange) : [])].filter(Boolean);
      const entryHeight = lines.reduce((sum, line) => {
        const wrapped = doc.splitTextToSize(line, pageWidth - marginX * 2 - 16);
        return sum + Math.max(12, wrapped.length * 10);
      }, 4);

      ensureSpace(entryHeight);
      lines.forEach((line) => {
        const wrapped = doc.splitTextToSize(line, pageWidth - marginX * 2 - 16);
        wrapped.forEach((part, index) => {
          doc.text(part, marginX + 8, cursorY + index * 10);
        });
        cursorY += Math.max(12, wrapped.length * 10);
      });
      cursorY += 4;
    });
  }

  cursorY = appendCreditControlRemarkToPdf(doc, {
    remark: snapshot.creditApprovalRemark,
    x: marginX,
    y: () => cursorY,
    maxWidth: contentWidth,
    ensureSpace,
  });

  cursorY = appendMonthlyPerformanceToPdf(doc, {
    analytics,
    x: marginX,
    y: () => cursorY,
    maxWidth: contentWidth,
    ensureSpace,
  });

  doc.setFontSize(9);
  ensureSpace(20);
  doc.text("Note: Item rates are exclusive of VAT. VAT is applied at 15% on subtotal.", marginX, pageHeight - 36);
  doc.text("Cash Disc is the sheet cash scheme. Value Disc applies when the SKU value exceeds 5,000 SAR. Scheme is the mix carton offer on that line.", marginX, pageHeight - 24);
  addPdfBuildFooter(doc);
  return doc;
}

export async function createOrderPdfDocument(snapshot, options = {}) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  renderOrderPdfDocument(doc, snapshot, options);
  return doc;
}
