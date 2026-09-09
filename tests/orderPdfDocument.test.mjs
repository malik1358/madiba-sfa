import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOrderPdfSnapshotFromSavedOrder,
  enrichOrderPdfLiveData,
  formatHistoryChange,
  inferPricingFromHistory,
  mapSavedOrderLinesToPdfLines,
  renderOrderPdfDocument,
  resolveLiveOrderPdfSnapshot,
} from "../app/lib/orderPdfDocument.js";

function createMockDoc() {
  const texts = [];
  let fontSize = 10;
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
    setFontSize(size) { fontSize = Number(size) || fontSize; },
    getFontSize() { return fontSize; },
    getTextWidth(text) { return String(text ?? "").length * fontSize * 0.5; },
    setTextColor() {},
    setPage() {},
    getNumberOfPages() { return 1; },
    addPage() {},
    rect() {},
    roundedRect() {},
    splitTextToSize(text, maxWidth) {
      const value = String(text ?? "");
      const charWidth = fontSize * 0.5;
      const perLine = Math.max(1, Math.floor(Number(maxWidth || 0) / charWidth) || value.length || 1);
      const lines = [];
      value.split(/\n/).forEach((part) => {
        if (!part) {
          lines.push("");
          return;
        }
        for (let index = 0; index < part.length; index += perLine) {
          lines.push(part.slice(index, index + perLine));
        }
      });
      return lines.length ? lines : [value];
    },
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

  assert.ok(doc.texts.includes("Order Number  296"));
  assert.equal(doc.texts.includes("Cash Disc"), false);
  assert.equal(doc.texts.includes("Value Disc"), false);
  assert.equal(doc.texts.includes("Scheme"), false);
  assert.ok(doc.texts.includes("Outstanding Details"));
  assert.ok(doc.texts.includes("Amount after VAT"));
  assert.equal(doc.texts.includes("Item Code"), false);
  assert.equal(doc.texts.includes("Line Total"), false);
  assert.equal(doc.texts.includes("Outstanding Buckets"), false);
});

test("renderOrderPdfDocument includes the historic Monthly Performance table", () => {
  const doc = createMockDoc();
  const snapshot = buildOrderPdfSnapshotFromSavedOrder({
    order: {
      id: 346,
      status: "SUBMITTED",
      customer_code: "1041",
      customer_name: "AL KHAMIS ARABIYA TRADING Co.",
      salesman_code: "ABADALLA ANTHANATH",
      updated_at: "2026-09-08T02:57:00.000Z",
    },
    lines: [{ item_code: "A004379", item_name: "SANDWICH ROLL PAPER", quantity: 20, rate: 49, line_value: 980 }],
    outstanding: {
      bucketLabels: ["0-30 days"],
      customer: { buckets: { "0-30 days": 17164 }, open_invoices: 9, total_outstanding: 30211 },
      customerInvoices: [],
    },
  });

  renderOrderPdfDocument(doc, snapshot, {
    analytics: {
      months: ["2026-01", "2026-03", "2026-08"],
      yearGroups: [{ year: "2026", months: ["2026-01", "2026-03", "2026-08"] }],
      monthlySummary: [
        { month: "2026-01", sales: 12000, skuCount: 4 },
        { month: "2026-03", sales: 8000, skuCount: 3 },
        { month: "2026-08", sales: 15000, skuCount: 7 },
      ],
      itemCount: 14,
    },
  });

  assert.ok(doc.texts.includes("Monthly Performance"));
  assert.ok(doc.texts.includes("Sales"));
  assert.ok(doc.texts.includes("SKUs Sold"));
  assert.ok(doc.texts.includes("JAN"));
  assert.ok(doc.texts.includes("AUG"));
});

test("renderOrderPdfDocument never prints a pending queue id as the order number", () => {
  const doc = createMockDoc();
  renderOrderPdfDocument(doc, {
    orderId: "pending:8981a846-ca3",
    orderNumber: "pending:8981a846-ca3",
    statusLabel: "Submitted",
    savedAtIso: "2026-09-07T08:30:44.000Z",
    customerCode: "1059",
    customerName: "Test",
    salesmanCode: "ADMIN",
    paymentType: "credit",
    pricingRegion: "riyadh",
    itemCount: 0,
    totalQuantity: 0,
    grandTotal: 0,
    totals: {},
    lines: [],
    history: [],
    outstanding: { bucketLabels: [], customer: null, customerInvoices: [] },
  });

  assert.ok(doc.texts.includes("Order Number  —"));
  assert.equal(doc.texts.some((text) => text.includes("pending:")), false);
});

test("renderOrderPdfDocument hides cash and value percents when they are not applied", () => {
  const doc = createMockDoc();
  renderOrderPdfDocument(doc, {
    orderId: 337,
    orderNumber: "337",
    statusLabel: "Submitted",
    savedAtIso: "2026-09-07T14:33:49.000Z",
    customerCode: "1367",
    customerName: "Wubl Al Khaleej Trading Company",
    salesmanCode: "AHMED NABIL",
    paymentType: "credit",
    pricingRegion: "riyadh",
    itemCount: 2,
    totalQuantity: 50,
    grandTotal: 2850,
    totals: {
      wholesaleTotal: 2850,
      cashDiscountTotal: 0,
      valueDiscountTotal: 0,
      schemeDiscountTotal: 0,
      amountExclVat: 2850,
      vatAmount: 427.5,
      amountInclVat: 3277.5,
    },
    lines: [
      {
        item_code: "A004075",
        item_name: "THERMAL POS ROLL",
        quantity: 20,
        wholesaleRate: 69,
        rate: 69,
        cashDiscount: 0.03,
        valueDiscount: 0.02,
        cashApplied: false,
        valueApplied: false,
        schemeDiscountAmount: 0,
        lineValue: 1380,
        vatAmount: 207,
        lineTotalInclVat: 1587,
      },
      {
        item_code: "A004379",
        item_name: "SANDWICH ROLL PAPER",
        quantity: 30,
        wholesaleRate: 49,
        rate: 49,
        cashDiscount: 0.02,
        valueDiscount: 0,
        cashApplied: false,
        valueApplied: false,
        schemeDiscountAmount: 0,
        lineValue: 1470,
        vatAmount: 220.5,
        lineTotalInclVat: 1690.5,
      },
    ],
    history: [],
    outstanding: { bucketLabels: [], customer: null, customerInvoices: [] },
  });

  assert.equal(doc.texts.includes("3%"), false);
  assert.equal(doc.texts.includes("2%"), false);
  assert.equal(doc.texts.includes("Cash Disc"), false);
  assert.equal(doc.texts.includes("Value Disc"), false);
  assert.equal(doc.texts.includes("Scheme"), false);
  assert.equal(doc.texts.includes("Cash discount"), false);
  assert.equal(doc.texts.includes("Value discount"), false);
  assert.equal(doc.texts.includes("Scheme discount"), false);
  assert.equal(doc.texts.some((text) => text.includes("3% applied")), false);
  assert.equal(doc.texts.some((text) => text.includes("2% applied")), false);
});

test("renderOrderPdfDocument hides catalog cash percent when the line was not reduced", () => {
  const doc = createMockDoc();
  renderOrderPdfDocument(doc, {
    orderId: "PROSPECT-OFF-2ab058da299843ac",
    orderNumber: "PROSPECT-OFF-2ab058da299843ac",
    statusLabel: "Submitted",
    savedAtIso: "2026-09-09T16:00:00.000Z",
    customerCode: "PROSPECT-OFF-2ab058da299843ac",
    customerName: "Fan Al Ihtiraf Perfume Wholsae",
    salesmanCode: "ADMIN",
    paymentType: "credit",
    pricingRegion: "riyadh",
    itemCount: 3,
    totalQuantity: 3,
    grandTotal: 240,
    totals: {
      wholesaleTotal: 240,
      cashDiscountTotal: 0,
      valueDiscountTotal: 0,
      schemeDiscountTotal: 0,
      amountExclVat: 240,
      vatAmount: 36,
      amountInclVat: 276,
    },
    lines: [
      {
        item_code: "A004210",
        item_name: "A004210_MADIBA FOR MEN NO GAS FRAGRANCE BODY SPRAY 120ML X 24 - DYNAMIC",
        quantity: 1,
        wholesaleRate: 80,
        rate: 80,
        cashDiscount: 0.08,
        valueDiscount: 0,
        cashApplied: true,
        valueApplied: false,
        cashDiscountAmount: 0,
        valueDiscountAmount: 0,
        schemeDiscountAmount: 0,
        lineValue: 80,
        vatAmount: 12,
        lineTotalInclVat: 92,
      },
      {
        item_code: "A004211",
        item_name: "A004211_MADIBA FOR MEN NO GAS FRAGRANCE BODY SPRAY 120ML X 24 - BRONZE",
        quantity: 1,
        wholesaleRate: 80,
        rate: 80,
        cashDiscount: 0.08,
        valueDiscount: 0,
        cashApplied: false,
        valueApplied: false,
        cashDiscountAmount: 0,
        schemeDiscountAmount: 0,
        lineValue: 80,
        vatAmount: 12,
        lineTotalInclVat: 92,
      },
    ],
    history: [],
    outstanding: { bucketLabels: [], customer: null, customerInvoices: [] },
  });

  assert.equal(doc.texts.includes("Cash Disc"), false);
  assert.equal(doc.texts.includes("Value Disc"), false);
  assert.equal(doc.texts.includes("Scheme"), false);
  assert.equal(doc.texts.includes("8%"), false);
  assert.equal(doc.texts.includes("Cash discount"), false);
});

test("renderOrderPdfDocument wraps applied cash and value discounts onto two lines", () => {
  const doc = createMockDoc();
  renderOrderPdfDocument(doc, {
    orderId: 349,
    orderNumber: "349",
    statusLabel: "Submitted",
    savedAtIso: "2026-09-08T07:23:15.000Z",
    customerCode: "PROSPECT-308",
    customerName: "AL NOOR STATIONERY",
    salesmanCode: "ADMIN",
    paymentType: "cash",
    pricingRegion: "riyadh",
    itemCount: 1,
    totalQuantity: 20,
    grandTotal: 1341.6,
    totals: {
      wholesaleTotal: 1380,
      cashDiscountTotal: 41.4,
      valueDiscountTotal: 0,
      schemeDiscountTotal: 0,
      amountExclVat: 1338.6,
      vatAmount: 200.79,
      amountInclVat: 1539.39,
    },
    lines: [{
      item_code: "A004075",
      item_name: "THERMAL POS ROLL 5 ROLLS X 10 Shrink",
      quantity: 20,
      wholesaleRate: 69,
      rate: 66.93,
      cashDiscount: 0.03,
      valueDiscount: 0.02,
      cashApplied: true,
      valueApplied: false,
      cashDiscountAmount: 41.4,
      valueDiscountAmount: 0,
      schemeDiscountAmount: 0,
      lineValue: 1338.6,
      vatAmount: 200.79,
      lineTotalInclVat: 1539.39,
    }],
    history: [],
    outstanding: { bucketLabels: [], customer: null, customerInvoices: [] },
  });

  assert.ok(doc.texts.includes("PROSPECT-308 - AL NOOR STATIONERY"));
  assert.ok(doc.texts.includes("Cash Disc"));
  assert.ok(doc.texts.includes("Cash discount"));
  assert.equal(doc.texts.includes("Value Disc"), false);
  assert.equal(doc.texts.includes("Scheme"), false);
  assert.ok(doc.texts.includes("3%"));
  assert.ok(doc.texts.includes("41.40"));
  assert.equal(doc.texts.some((text) => /\d+% applied/.test(text)), false);
});

test("renderOrderPdfDocument keeps cash discount and long item names inside their cells", () => {
  const doc = createMockDoc();
  renderOrderPdfDocument(doc, {
    orderId: 370,
    orderNumber: "370",
    statusLabel: "Submitted",
    savedAtIso: "2026-09-09T06:10:00.000Z",
    customerCode: "PROSPECT-OFF-928e50006f234652",
    customerName: "ARKAN AL AJHIZAH TRADING CO",
    salesmanCode: "SM002",
    paymentType: "cash",
    pricingRegion: "riyadh",
    itemCount: 1,
    totalQuantity: 200,
    grandTotal: 167972,
    totals: {
      wholesaleTotal: 171400,
      cashDiscountTotal: 3428,
      valueDiscountTotal: 0,
      schemeDiscountTotal: 0,
      amountExclVat: 167972,
      vatAmount: 25195.8,
      amountInclVat: 193167.8,
    },
    lines: [{
      item_code: "A005355",
      item_name: "A005355_Westpoint Window AC 18K COOL ONLY",
      quantity: 200,
      wholesaleRate: 857,
      rate: 839.86,
      cashDiscount: 0.02,
      valueDiscount: 0,
      cashApplied: true,
      valueApplied: false,
      cashDiscountAmount: 3428,
      valueDiscountAmount: 0,
      schemeDiscountAmount: 0,
      lineValue: 167972,
      vatAmount: 25195.8,
      lineTotalInclVat: 193167.8,
    }],
    history: [],
    outstanding: { bucketLabels: [], customer: null, customerInvoices: [] },
  });

  assert.ok(doc.texts.includes("2%"));
  assert.ok(doc.texts.includes("3,428.00"));
  assert.equal(doc.texts.some((text) => text.includes("2% applied")), false);
  assert.equal(doc.texts.some((text) => text.includes("Westp") && !text.includes("Westpoint")), false);
  assert.ok(doc.texts.some((text) => text.includes("Westpoint")));
  assert.ok(doc.texts.some((text) => text.includes("Window")));
  assert.ok(doc.texts.some((text) => text.includes("COOL")));
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
  assert.ok(doc.texts.includes("Scheme discount"));
  assert.equal(doc.texts.includes("Cash Disc"), false);
  assert.equal(doc.texts.includes("Value Disc"), false);
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

test("resolveLiveOrderPdfSnapshot retries until the live order number is available", async () => {
  const originalFetch = global.fetch;
  let salesOrderCalls = 0;
  let outstandingCalls = 0;
  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("/api/sales-orders")) {
      salesOrderCalls += 1;
      if (salesOrderCalls < 3) {
        return { ok: true, json: async () => ({ success: true, found: false }) };
      }
      return {
        ok: true,
        json: async () => ({ success: true, found: true, orderId: 325, orderNumber: "325" }),
      };
    }
    if (href.includes("/api/outstanding")) {
      outstandingCalls += 1;
      return { ok: false, json: async () => ({}) };
    }
    return { ok: false, json: async () => ({}) };
  };

  try {
    const { snapshot } = await resolveLiveOrderPdfSnapshot({
      orderId: "pending:ccc3f31333cd",
      customerCode: "PROSPECT-OFF-ccc3f31333cd4cfe",
      lines: [],
      outstanding: { bucketLabels: [], customer: null, customerInvoices: [] },
    }, { accessToken: "token" }, { delayMs: 0 });

    assert.equal(snapshot.orderNumber, "325");
    assert.equal(salesOrderCalls, 3);
    assert.equal(outstandingCalls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("enrichOrderPdfLiveData replaces offline prospect codes with the live PROSPECT id", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("/api/sales-orders")) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          found: true,
          orderId: 325,
          orderNumber: "325",
          customerCode: "PROSPECT-OFF-ccc3f31333cd4cfe",
        }),
      };
    }
    if (href.includes("/api/prospects")) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          found: true,
          customerCode: "PROSPECT-412",
          customerName: "test",
        }),
      };
    }
    return { ok: false, json: async () => ({}) };
  };

  try {
    const { snapshot } = await enrichOrderPdfLiveData({
      orderId: 325,
      customerCode: "PROSPECT-OFF-ccc3f31333cd4cfe",
      customerName: "test",
      lines: [],
      outstanding: { bucketLabels: [], customer: null, customerInvoices: [] },
    }, { accessToken: "token" });

    assert.equal(snapshot.orderNumber, "325");
    assert.equal(snapshot.customerCode, "PROSPECT-412");
    assert.equal(snapshot.customerName, "test");
  } finally {
    global.fetch = originalFetch;
  }
});

test("enrichOrderPdfLiveData fills the shop name for a live PROSPECT id", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const href = String(url);
    if (href.includes("/api/sales-orders")) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          found: true,
          orderId: 349,
          orderNumber: "349",
          customerCode: "PROSPECT-308",
          customerName: "",
        }),
      };
    }
    if (href.includes("/api/prospects?id=308")) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          found: true,
          customerCode: "PROSPECT-308",
          customerName: "AL NOOR STATIONERY",
        }),
      };
    }
    return { ok: false, json: async () => ({}) };
  };

  try {
    const { snapshot } = await enrichOrderPdfLiveData({
      orderId: 349,
      customerCode: "PROSPECT-308",
      customerName: "",
      lines: [],
      outstanding: { bucketLabels: [], customer: null, customerInvoices: [] },
    }, { accessToken: "token" });

    assert.equal(snapshot.customerCode, "PROSPECT-308");
    assert.equal(snapshot.customerName, "AL NOOR STATIONERY");
  } finally {
    global.fetch = originalFetch;
  }
});
