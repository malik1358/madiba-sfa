import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { parsePricePayload, loadPricePayload } from "../app/lib/pricePayload.js";
import { normalizePaymentType, normalizePricingType, orderPriceMapFor } from "../app/lib/regionalPricing.js";
import { resolveCatalogForOrder, priceOrderLines } from "../app/lib/orderPricing.js";
import { catalogueCardPrice, catalogueItemGroups } from "../app/lib/productCatalogue.js";
import { loadRetailPriceMaps } from "../app/lib/retailPricingServer.js";
import { buildQuickOrderSuggestions } from "../app/management/customer-audit/lib/quickOrder.js";
import { buildOrderPdfSnapshotFromSavedOrder } from "../app/lib/orderPdfDocument.js";
import { buildOrderWhatsappSummary } from "../app/lib/orderWhatsapp.js";
import { DEFAULT_ORDER_SCHEMES, evaluateOrderSchemes } from "../app/lib/orderSchemes.js";

function sheetFixture() {
  const header = Array(100).fill("");
  const row = Array(100).fill("");
  header[1] = "Product Code";
  header[2] = "Item Name";
  header[79] = "Wholesale Price Riyadh";
  header[83] = "Wholesale Price Dammam";
  header[87] = "Wholesale Price Jeddah";
  header[93] = "Product Category";
  row[1] = "A1000";
  row[2] = "Office pen";
  row[79] = "100";
  row[81] = "120";
  row[83] = "110";
  row[85] = "135";
  row[87] = "140";
  row[89] = "3%";
  row[90] = "2%";
  row[93] = "Office";
  return [header, row];
}

test("provided Apps Script keeps wholesale behavior and exports ex-VAT retail CD/CH/CJ", () => {
  const values = sheetFixture();
  const context = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName: () => ({ getDataRange: () => ({ getDisplayValues: () => values }) }),
    }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (text) => ({ setMimeType: () => JSON.parse(text) }) },
  });
  vm.runInContext(fs.readFileSync(new URL("../scripts/google-apps-script/price-feed.gs", import.meta.url), "utf8"), context);
  const payload = context.doGet();
  assert.deepEqual(payload.regionPriceMaps, { riyadh: { A1000: 100 }, dammam: { A1000: 110 }, jeddah: { A1000: 140 } });
  assert.deepEqual(payload.retailRegionPriceMaps, { riyadh: { A1000: 120 }, dammam: { A1000: 135 }, jeddah: { A1000: 140 } });
  assert.equal(payload.cashDiscountMap.A1000, "2%");
  assert.equal(payload.valueDiscountMap.A1000, "3%");
  assert.deepEqual(parsePricePayload(payload).retailRegionPriceMaps, parsePricePayload(values).retailRegionPriceMaps);
});

test("retail city maps never fall back to wholesale or another city's price", () => {
  const catalog = parsePricePayload(sheetFixture());
  assert.equal(orderPriceMapFor(catalog, "riyadh", "retail").A1000, 120);
  assert.equal(orderPriceMapFor(catalog, "dammam", "retail").A1000, 135);
  assert.equal(orderPriceMapFor(catalog, "jeddah", "retail").A1000, 140);
  assert.equal(orderPriceMapFor(catalog, "riyadh", "wholesale").A1000, 100);
  assert.deepEqual(orderPriceMapFor({ priceMap: { A: 100 }, retailRegionPriceMaps: { riyadh: { A: 120 } } }, "dammam", "retail"), {});
  const retail = resolveCatalogForOrder(catalog, { selectedRegion: "jeddah", currentUserRegions: ["riyadh", "dammam"], pricingType: "retail" });
  assert.equal(retail.region, "riyadh", "unassigned city cannot be selected");
  const [line] = priceOrderLines([{ item_code: "A1000", quantity: 2, rate: 1 }], retail);
  assert.equal(line.rate, 120, "server ignores supplied price");
  assert.equal(line.lineTotalInclVat, 276);
  assert.throws(() => priceOrderLines([{ item_code: "MISSING", quantity: 1, rate: 100 }], retail), /Retail price unavailable/);
});

test("retail feed loader fails explicitly until Apps Script supplies valid retail maps", async () => {
  await assert.rejects(loadRetailPriceMaps(async () => new Response("{}", { status: 403 })), /403/);
  await assert.rejects(loadRetailPriceMaps(async () => Response.json({ priceMap: { A1000: 100 } })), /Redeploy/);
  const maps = await loadRetailPriceMaps(async () => Response.json({ retailRegionPriceMaps: { riyadh: { A1000: 120 } } }));
  assert.equal(maps.riyadh.A1000, 120);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ priceMap: { A1000: 100 }, retailRegionPriceMaps: maps });
    assert.equal((await loadPricePayload("http://localhost/prices")).retailRegionPriceMaps.riyadh.A1000, 120);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("card cash preview and quantity-based volume reductions use identical order discount math", () => {
  const item = { item_code: "A1000", item_name: "Office pen" };
  const options = { price: 100, cashDiscountMap: { A1000: 0.02 }, valueDiscountMap: { A1000: 0.03 } };
  assert.equal(catalogueCardPrice(item, { ...options, quantity: 0, paymentType: "credit" }).rate, 100);
  assert.equal(catalogueCardPrice(item, { ...options, quantity: 0, paymentType: "cash" }).rate, 98);
  assert.equal(catalogueCardPrice(item, { ...options, quantity: 49, paymentType: "cash" }).rate, 98);
  const priced = catalogueCardPrice(item, { ...options, quantity: 50, paymentType: "cash" });
  assert.equal(priced.rate, 95);
  assert.equal(priced.applied.value, true);
  const [saved] = priceOrderLines([{ ...item, quantity: 50 }], {
    regionPriceMap: { A1000: 100 }, paymentType: "cash", ...options,
  });
  assert.equal(saved.rate, priced.rate);
});

test("volume card discounts start at exactly 5,000; schemes exclude cash and gloves stay VAT-free", () => {
  const item = { item_code: "A005425", item_name: "Paper" };
  for (const quantity of [4999, 5000, 5001]) {
    const card = catalogueCardPrice(item, { price: 1, quantity, paymentType: "credit", valueDiscountMap: { A005425: 0.03 } });
    assert.equal(card.applied.value, quantity >= 5000);
    assert.equal(Number(card.rate.toFixed(2)), quantity >= 5000 ? 0.97 : 1);
  }
  const card = catalogueCardPrice(item, {
    price: 100, quantity: 40, paymentType: "cash", cashDiscountMap: { A005425: 0.02 },
    schemeApplications: evaluateOrderSchemes({ A005425: 40, A004224: 1 }, DEFAULT_ORDER_SCHEMES),
  });
  assert.equal(card.applied.cash, false);
  assert.equal(card.applied.scheme, true);
  assert.equal(Number(card.rate.toFixed(2)), 98.17);
  assert.equal(catalogueCardPrice({ ...item, item_name: "Vinyl gloves" }, { price: 100, quantity: 1, paymentType: "credit" }).vatRate, 0);
});

test("queued draft/submit payloads retain retail mode and reject missing retail rates before queueing", () => {
  const context = vm.createContext({
    normalizePaymentType, normalizePricingType, priceOrderLines,
    getPrice: (map, code) => map[String(code).trim().toUpperCase()] || 0,
  });
  const source = fs.readFileSync(new URL("../app/management/customer-audit/hooks/useOrder.js", import.meta.url), "utf8");
  vm.runInContext(source.replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/g, "").replace("export function useOrder", "function useOrder"), context);
  for (const action of ["save_draft", "submit"]) {
    const options = {
      action, selectedCustomer: { customer_code: "C1" }, orderMaker: { salesmanCode: "S1" },
      orderItems: [{ item_code: "A1000", order_quantity: 2 }],
      priceList: { A1000: 120 }, paymentType: "credit", pricingType: "retail", pricingRegion: "dammam",
    };
    const payload = context.buildOrderPayload(options);
    assert.equal(payload.pricingType, "retail");
    assert.equal(payload.pricingRegion, "dammam");
    assert.equal(payload.lines[0].rate, 120);
    assert.throws(() => context.buildOrderPayload({ ...options, priceList: {} }), /Retail price unavailable/);
  }
});

test("retail PDF and WhatsApp keep the order's selected retail basis", () => {
  const snapshot = buildOrderPdfSnapshotFromSavedOrder({
    order: { id: 1, customer_code: "C1" },
    lines: [{ item_code: "A1000", quantity: 2, rate: 120 }],
    history: [{ pricingType: "retail" }, { pricingRegion: "riyadh", paymentType: "credit" }],
    pricingCatalog: parsePricePayload(sheetFixture()),
  });
  assert.equal(snapshot.pricingType, "retail");
  assert.equal(snapshot.lines[0].rate, 120);
  assert.equal(snapshot.totals.amountInclVat, 276);
  assert.match(buildOrderWhatsappSummary(snapshot), /Pricing type: RETAIL/);
});

test("three never-bought items lead the catalogue, retain ranking and never duplicate the browse grid", () => {
  const items = ["A1000", "A1001", "A1002", "A1003", "A1004"].map((item_code) => ({ item_code, item_name: item_code, category: "Office" }));
  const suggestions = buildQuickOrderSuggestions({
    analytics: {}, itemMaster: items,
    transactions: [{ item_code: "A1000", sales_amount: 100, quantity: 1 }],
    peerTransactions: [],
  });
  assert.equal(suggestions.newItems.length, 3);
  assert.ok(suggestions.newItems.every((item) => item.item_code !== "A1000"));
  const groups = catalogueItemGroups(items, [...suggestions.newItems].reverse(), true);
  assert.deepEqual(groups.recommended.map((item) => item.item_code), [...suggestions.newItems].reverse().map((item) => item.item_code));
  assert.equal(groups.browse.length, 2);
  assert.deepEqual(catalogueItemGroups(items, suggestions.newItems, false).recommended, []);
  assert.equal(catalogueItemGroups([items[0]], suggestions.newItems, true).recommended.length, 0);
});
