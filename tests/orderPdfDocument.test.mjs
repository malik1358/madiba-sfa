import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOrderPdfSnapshotFromSavedOrder,
  enrichOrderPdfLiveData,
  formatHistoryChange,
  inferPricingFromHistory,
  mapSavedOrderLinesToPdfLines,
  renderOrderPdfDocument,
} from "../app/lib/orderPdfDocument.js";

function createMockDoc() {
  const texts = [];
  return {
    texts,
    internal: {
      pageSize: {
        getWidth: () => 595.28,
        getHeight: () => 841.89,
      },
    },
    setFillColor() {},
    setDrawColor() {},
    setLineWidth() {},
    setFont() {},
    setFontSize() {},
    setTextColor() {},
    setPage() {},
    getNumberOfPages() { return 1; },
    addPage() {},
    rect() {},
    roundedRect() {},
    splitTextToSize(text) { return [String(text)]; },
    text(value) { texts.push(String(value)); },
  };
}

test("inferPricingFromHistory uses the latest payment and region", () => {
  const inferred = inferPricingFromHistory([
    { paymentType: "credit", pricingRegion: "riyadh" },
    { paymentType: "cash", pricingRegion: "jeddah" },
  ]);
  assert.equal(inferred.paymentType, "cash");
  assert.equal(inferred.pricingRegion, "jeddah");
});

test("mapSavedOrderLinesToPdfLines keeps stored totals when catalog does not match", () => {
  const [line] = mapSavedOrderLinesToPdfLines([
    { item_code: "A004075", item_name: "THERMAL ROLL", quantity: 20, rate: 72, line_value: 1440 },
  ]);
  assert.equal(line.lineValue, 1440);
  assert.equal(line.vatAmount, 216);
  assert.equal(line.lineTotalInclVat, 1656);
});

test("mapSavedOrderLinesToPdfLines applies the A005425 mix scheme to alias paper codes", () => {
  const [line] = mapSavedOrderLinesToPdfLines(
    [
      { item_code: "A003234", item_name: "GOLDEN STAR PAPER", quantity: 40, rate: 53.83, line_value: 2153.2 },
      { item_code: "A004226", item_name: "TRI STAR PEN", quantity: 1, rate: 243, line_value: 243 },
    ],
    {
      paymentType: "credit",
      pricingRegion: "dammam",
      pricingCatalog: {
        priceMap: { A005425: 53.83, A004226: 243 },
        regionPriceMaps: { dammam: { A005425: 53.83, A004226: 243 } },
        cashDiscountMap: { A003234: 0.02 },
        valueDiscountMap: {},
        schemes: [{
          id: "default-a005425-mix-40",
          name: "A005425 + mix 40 CTN",
          active: true,
          rewardItemCode: "A005425",
          rewardEveryQty: 40,
          applyTo: "complete_lots",
          unitDiscountSar: 1.83,
          qualifierItemCodes: ["A004224", "A004225", "A004226", "A004227"],
          qualifierMinQty: 1,
          qualifierMode: "any",
        }],
      },
    }
  );

  assert.equal(Number(line.schemeDiscountAmount.toFixed(2)), 73.2);
  assert.equal(Boolean(line.applied?.scheme), true);
  assert.equal(Number(line.lineValue.toFixed(2)), Number(((53.83 * 40) - 73.2).toFixed(2)));
});

test("mapSavedOrderLinesToPdfLines fills discount columns when catalog reprices to the saved total", () => {
  const [line] = mapSavedOrderLinesToPdfLines(
    [{ item_code: "A1", item_name: "Item", quantity: 10, rate: 90, line_value: 900 }],
    {
      paymentType: "cash",
      pricingRegion: "riyadh",
      pricingCatalog: {
        priceMap: { A1: 100 },
        regionPriceMaps: { riyadh: { A1: 100 } },
        cashDiscountMap: { A1: 0.1 },
        valueDiscountMap: {},
      },
    }
  );
  assert.equal(line.wholesaleRate, 100);
  assert.equal(line.cashApplied, true);
  assert.equal(line.lineValue, 900);
});

test("buildOrderPdfSnapshotFromSavedOrder matches the new-order snapshot shape", () => {
  const snapshot = buildOrderPdfSnapshotFromSavedOrder({
    order: {
      id: 296,
      status: "SUBMITTED",
      customer_code: "PROSPECT-261",
      customer_name: "INFOGATE TRADING EST",
      salesman_code: "MOINUDIN KHAJA",
      updated_at: "2026-09-06T16:02:56.000Z",
    },
    lines: [{ item_code: "A004075", item_name: "THERMAL ROLL", quantity: 20, rate: 72, line_value: 1440 }],
    history: [{ action: "SUBMITTED_ORDER", paymentType: "credit", pricingRegion: "riyadh", changedAt: "2026-09-06T16:02:56.000Z" }],
    creditApprovalRemark: "Credit control: Approval not required.",
  });

  assert.equal(snapshot.orderId, 296);
  assert.equal(snapshot.orderNumber, "296");
  assert.equal(snapshot.statusLabel, "SUBMITTED");
  assert.equal(snapshot.paymentType, "credit");
  assert.equal(snapshot.itemCount, 1);
  assert.equal(snapshot.totalQuantity, 20);
  assert.equal(snapshot.totals.amountExclVat, 1440);
  assert.equal(snapshot.lines[0].item_code, "A004075");
});

test("formatHistoryChange describes added items", () => {
  assert.equal(
    formatHistoryChange({ type: "ADDED", item_code: "A1", item_name: "Roll", after_quantity: 2, after_rate: 10 }),
    "A1 Roll: added 2 qty at 10"
  );
});

test("renderOrderPdfDocument draws the new order layout", () => {
  const doc = createMockDoc();
  const snapshot = buildOrderPdfSnapshotFromSavedOrder({
    order: {
      id: 296,
      status: "SUBMITTED",
      customer_code: "PROSPECT-261",
      customer_name: "INFOGATE",
      salesman_code: "MOIN",
      updated_at: "2026-09-06T16:02:56.000Z",
    },
    lines: [{ item_code: "A004075", item_name: "THERMAL ROLL", quantity: 20, rate: 72, line_value: 1440 }],
    outstanding: {
      bucketLabels: ["0-30 days"],
      customer: { buckets: { "0-30 days": 0 }, open_invoices: 0, total_outstanding: 0 },
      customerInvoices: [],
    },
  });

  renderOrderPdfDocument(doc, snapshot);

  assert.ok(doc.texts.includes("Order Number: 296"));
  assert.ok(doc.texts.includes("Cash Disc"));
  assert.ok(doc.texts.includes("Scheme"));
  assert.ok(doc.texts.includes("Outstanding Details"));
  assert.ok(doc.texts.includes("Amount after VAT"));
  assert.equal(doc.texts.includes("Item Code"), false);
  assert.equal(doc.texts.includes("Line Total"), false);
  assert.equal(doc.texts.includes("Outstanding Buckets"), false);
});

test("renderOrderPdfDocument shows scheme discount on the item row", () => {
  const doc = createMockDoc();
  renderOrderPdfDocument(doc, {
    orderId: 325,
    orderNumber: "325",
    statusLabel: "Submitted",
    savedAtIso: "2026-09-07T08:30:44.000Z",
    customerCode: "PROSPECT-OFF",
    customerName: "test",
    salesmanCode: "ADMIN",
    paymentType: "credit",
    pricingRegion: "dammam",
    itemCount: 1,
    totalQuantity: 40,
    grandTotal: 2080,
    totals: {
      wholesaleTotal: 2153.2,
      cashDiscountTotal: 0,
      valueDiscountTotal: 0,
      schemeDiscountTotal: 73.2,
      amountExclVat: 2080,
      vatAmount: 312,
      amountInclVat: 2392,
    },
    lines: [{
      item_code: "A005425",
      item_name: "GOLDEN STAR PAPER",
      quantity: 40,
      wholesaleRate: 53.83,
      rate: 52,
      cashDiscount: 0.02,
      valueDiscount: 0,
      cashApplied: false,
      valueApplied: false,
      schemeDiscountAmount: 73.2,
      lineValue: 2080,
      vatAmount: 312,
      lineTotalInclVat: 2392,
    }],
    history: [],
    outstanding: { bucketLabels: [], customer: null, customerInvoices: [] },
  });

  assert.ok(doc.texts.includes("Scheme"));
  assert.ok(doc.texts.filter((text) => text === "73.20").length >= 2);
});

test("enrichOrderPdfLiveData replaces a pending queue id with the live order number", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("/api/sales-orders")) {
      return {
        ok: true,
        json: async () => ({ success: true, found: true, orderId: 4451, orderNumber: "4451" }),
      };
    }
    return { ok: false, json: async () => ({}) };
  };

  try {
    const { snapshot } = await enrichOrderPdfLiveData({
      orderId: "pending:8981a846-ca3",
      customerCode: "1059",
      customerName: "Test Customer",
      lines: [],
      outstanding: { bucketLabels: [], customer: null, customerInvoices: [] },
    }, { accessToken: "token" });

    assert.equal(snapshot.orderNumber, "4451");
    assert.equal(snapshot.orderId, 4451);
  } finally {
    global.fetch = originalFetch;
  }
});
