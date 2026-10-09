import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  cataloguePacking, cataloguePermissions, catalogueSheetPacking, hasCataloguePrice, validateCataloguePreview, MAX_PRODUCT_PHOTO_BYTES,
} from "../app/lib/productCatalogue.js";
import { loadCatalogueDetails as loadDetails, loadCatalogueSheetPacking, requireCatalogueAccess } from "../app/lib/productCatalogueServer.js";
import { buildModuleAccess, listAccessibleNavGroups, localizedModuleLabel } from "../app/lib/moduleAccess.js";

const loadCatalogueDetails = (admin) => loadDetails(admin, async () => ({}));

test("packing label shows the description directly and selling unit is separately optional", () => {
  const source = fs.readFileSync(new URL("../app/components/ProductCatalogue.jsx", import.meta.url), "utf8");
  const packingBlock = source.match(/<p className=\{styles\.packing\}>([\s\S]*?)<\/p>/)[1];
  assert.match(packingBlock, /"Packing"\}:\s*<\/strong> \{detail\.packing \|\|/);
  assert.match(packingBlock, /\{detail\.sellingUnit && <span><strong>.*"Selling unit"/);
  assert.doesNotMatch(packingBlock, /Unit not specified/);
});

test("catalogue flags selected cart items missing prices after a pricing change", () => {
  const source = fs.readFileSync(new URL("../app/components/ProductCatalogue.jsx", import.meta.url), "utf8");
  const selector = source.match(/const unpricedCartCodes = [^\r\n]+/)[0];
  const context = vm.createContext({
    quantities: { A1000: 1, A1001: 2, A1002: 0, A1003: 3 },
    priceList: { A1000: 120, A1003: 0 },
    hasCataloguePrice,
  });
  vm.runInContext(`${selector}\nglobalThis.result = unpricedCartCodes;`, context);
  assert.deepEqual(Array.from(context.result), ["A1001", "A1003"]);
  context.priceList = { A1000: 120, A1001: 100, A1003: 140 };
  assert.deepEqual(Array.from(vm.runInContext("Object.keys(quantities).filter((code) => Number(quantities[code]) > 0 && !hasCataloguePrice(priceList[code]))", context)), []);
});

test("catalogue packing uses sheet AM description matched by normalized product code", async () => {
  const header = Array(42).fill("");
  header[1] = "Product Code";
  header[2] = "Item Name";
  header[38] = "Unit description";
  const row = Array(42).fill("");
  row[1] = " a123 ";
  row[38] = " CTN OF 20 PACK OF 12 PC ";
  const matrix = [["Title"], header, row];
  assert.deepEqual(catalogueSheetPacking(matrix), { A123: "CTN OF 20 PACK OF 12 PC" });
  assert.throws(() => catalogueSheetPacking([["Other header"]]), /AM/);
  const packing = await loadCatalogueSheetPacking(async (url, options) => {
    assert.match(url, /gid=612911319/);
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal);
    return new Response(matrix.map((entry) => entry.join(",")).join("\n"));
  });
  const result = await loadDetails(mockAdmin({ items_master: [{ item_code: "A123", tally_unit: "CTN" }] }), async () => packing);
  assert.deepEqual(result.details.A123, { sellingUnit: "CTN", packing: "CTN OF 20 PACK OF 12 PC" });
  const unavailable = await loadDetails(mockAdmin({ items_master: [{ item_code: "A123" }] }), async () => {
    throw new Error("Sheet offline");
  });
  assert.match(unavailable.warnings[0], /Sheet offline/);
  await assert.rejects(loadCatalogueSheetPacking(async () => new Response("", { status: 403 })), /403/);
});

function mockAdmin(tables = {}, options = {}) {
  const calls = [];
  return {
    calls,
    auth: { getUser: async () => ({ data: { user: options.user || { id: "user", user_metadata: {} } }, error: options.authError }) },
    from(table) {
      let filters = [];
      let range = [0, Infinity];
      const query = {
        select() { return query; },
        order() { return query; },
        range(start, end) { range = [start, end]; return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        single() { return query.then((result) => ({ ...result, data: result.data?.[0] || null })); },
        then(resolve, reject) {
          calls.push({ table, range });
          const error = options.errors?.[table];
          if (error) return Promise.resolve({ data: null, error }).then(resolve, reject);
          const matched = (tables[table] || []).filter((row) => filters.every(([key, value]) => row[key] === value));
          return Promise.resolve({ data: matched.slice(range[0], range[1] + 1), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    storage: new Proxy({}, { get() { throw new Error("Catalogue must not access image storage."); } }),
  };
}

function authRequest(header = "Bearer test-token") {
  return new Request("http://localhost/api/product-catalogue", { headers: header ? { authorization: header } : {} });
}

function routeHarness(admin) {
  const source = fs.readFileSync(new URL("../app/api/product-catalogue/route.js", import.meta.url), "utf8");
  const context = vm.createContext({
    NextResponse: { json: (body, options) => new Response(JSON.stringify(body), {
      ...options, headers: { ...options.headers, "Content-Type": "application/json" },
    }) },
    createClient: () => admin,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321", SUPABASE_SERVICE_ROLE_KEY: "synthetic-test-key" } },
    console, loadCatalogueDetails, requireCatalogueAccess,
  });
  vm.runInContext(source.replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/g, "").replace(/export /g, ""), context);
  return context;
}

test("catalogue only displays finite positive regional prices while New Order keeps its item list", () => {
  for (const value of [undefined, null, "", " ", "invalid", 0, -1, Infinity, NaN]) {
    assert.equal(hasCataloguePrice(value), false, String(value));
  }
  for (const value of [0.01, 12, "25.50"]) assert.equal(hasCataloguePrice(value), true);
  const source = fs.readFileSync(new URL("../app/management/new-order/page.js", import.meta.url), "utf8");
  const selector = source.slice(source.indexOf("  const filteredItems = useMemo("), source.indexOf("  const groupedItems = useMemo("))
    .replace("const filteredItems =", "result =");
  const items = ["A", "B", "C", "D", "E"].map((item_code) => ({ item_code, item_name: item_code, category: "Office" }));
  function select(catalogueMode, regionPriceList, itemSearch = "", categoryFilter = "ALL") {
    const context = {
      catalogueMode, regionPriceList, itemSearch, categoryFilter, mergedItemsMaster: items,
      hasCataloguePrice, normalizeText: String, normalizeCategoryLabel: (value) => value,
      useMemo: (fn) => fn(),
    };
    vm.runInNewContext(selector, context);
    return Array.from(context.result, (item) => item.item_code);
  }
  assert.deepEqual(select(true, { A: 10, B: 0, C: -1, D: "bad" }), ["A"]);
  assert.deepEqual(select(true, { B: "12" }), ["B"], "switching regions changes visibility");
  assert.deepEqual(select(true, {}), []);
  assert.deepEqual(select(true, { A: 10 }, "B"), []);
  assert.deepEqual(select(true, { A: 10 }, "", "Other"), []);
  assert.deepEqual(select(false, {}), ["A", "B", "C", "D", "E"]);
  assert.match(source, /items=\{filteredItems\}/);
  assert.match(source, /filteredItems\.forEach/);
});

test("catalogue customer search reuses scoped code/name suggestions and explicit selection", () => {
  const page = fs.readFileSync(new URL("../app/management/new-order/page.js", import.meta.url), "utf8");
  const component = fs.readFileSync(new URL("../app/components/ProductCatalogue.jsx", import.meta.url), "utf8");
  const selector = (
    page.match(/const filteredCustomers = useMemo\([\s\S]*?\}, \[customers, customerSearch\]\);/)[0] +
    page.match(/const customerNameSuggestions = useMemo\([\s\S]*?\);/)[0]
  )
    .replace("const filteredCustomers =", "filteredCustomers =")
    .replace("const customerNameSuggestions =", "result =");
  const customers = [
    { customer_code: "C01", customer_name: "Alpha Trading" },
    { customer_code: "C02", customer_name: "Alpha Excluded", excluded: true },
    ...Array.from({ length: 12 }, (_, i) => ({ customer_code: `P${i}`, customer_name: `Prospect ${i}`, is_prospect: true })),
  ];
  function search(customerSearch) {
    const context = { customerSearch, customers, isExcludedNewOrderCustomer: (customer) => customer.excluded, useMemo: (fn) => fn() };
    vm.runInNewContext(selector, context);
    return Array.from(context.result, (customer) => customer.customer_code);
  }
  assert.deepEqual(search("  c01 "), ["C01"]);
  assert.deepEqual(search("ALPHA"), ["C01"], "excluded customers never become suggestions");
  assert.deepEqual(search("unknown"), []);
  assert.deepEqual(search(""), []);
  assert.equal(search("prospect").length, 10);
  assert.match(page, /customerSuggestions=\{customerNameSuggestions\}/);
  assert.match(page, /onCustomerSearch=\{setCustomerSearch\}/);
  assert.match(component, /onCustomer\(customer\.customer_code, customer\.customer_name\)/);
  assert.match(component, /onCustomerSearch\(event\.target\.value\)/);
  assert.match(component, /Selected customer:/);
  assert.match(component, /Clear customer/);
  assert.match(component, /No matching customers/);
  assert.match(component, /\[search, category, pricingRegion, pricingType, selectedCustomer\?\.customer_code\]/);
  assert.doesNotMatch(component, /customers\.map/);
});

test("catalogue navigation follows field order access and keeps collector exclusions", () => {
  for (const role of ["admin", "manager", "salesman", "invoice_maker", "product-promoter"]) {
    const access = buildModuleAccess({ role });
    assert.equal(access.canAccess("productCatalogue"), true, role);
    assert.equal(access.canAccessPath("/management/product-catalogue"), true);
    assert.ok(listAccessibleNavGroups(access).some((group) => group.items.some((item) => item.moduleKey === "productCatalogue")));
  }
  for (const context of [{ role: "collector" }, { role: "salesman", salesmanCode: "CL01" }, { role: "admin", collectionOnlyMetadata: true }, {}]) {
    assert.equal(buildModuleAccess(context).canAccess("productCatalogue"), false);
  }
  assert.equal(localizedModuleLabel("productCatalogue", "ar"), "كتالوج المنتجات");
});

test("photo preview controls remain restricted to active admin/manager", () => {
  for (const role of ["admin", "manager"]) {
    assert.deepEqual(cataloguePermissions({ role, is_active: true }), { canView: true, canManagePhotos: true });
  }
  for (const role of ["salesman", "invoice-maker", "product_promoter"]) {
    assert.deepEqual(cataloguePermissions({ role, is_active: true }), { canView: true, canManagePhotos: false });
  }
  assert.equal(cataloguePermissions({ role: "admin", is_active: false }).canView, false);
  assert.equal(cataloguePermissions({ role: "manager", is_active: true }, { app_metadata: { collection_only: true } }).canManagePhotos, false);
});

test("packing uses existing Tally selling unit and stock take conversion without guessing", () => {
  assert.deepEqual(cataloguePacking({ tally_unit: "BOX" }, { unit: "CTN" }, {
    master_uom: "CTN", base_uom: "PCS", mid_uom: "BOX", base_uom_pack_size: 120, mid_uom_pack_size: 10,
  }), { sellingUnit: "BOX", packing: "120 PCS / CTN · 10 PCS / BOX" });
  assert.deepEqual(cataloguePacking(), { sellingUnit: "", packing: "" });
  assert.deepEqual(cataloguePacking({}, { unit: "CTN" }, { base_uom_pack_size: -1 }), { sellingUnit: "CTN", packing: "" });
});

test("API rejects anonymous, invalid, inactive and collection-only users", async () => {
  const profile = { id: "user", role: "salesman", is_active: true };
  const admin = mockAdmin({ profiles: [profile] });
  await assert.rejects(requireCatalogueAccess(admin, authRequest("")), { status: 401 });
  await assert.rejects(requireCatalogueAccess(mockAdmin({}, { authError: {} }), authRequest()), { status: 401 });
  assert.equal((await requireCatalogueAccess(admin, authRequest())).canManagePhotos, false);
  profile.is_active = false;
  await assert.rejects(requireCatalogueAccess(admin, authRequest()), { status: 403 });
  profile.is_active = true;
  profile.role = "collector";
  await assert.rejects(requireCatalogueAccess(admin, authRequest()), { status: 403 });
});

test("packing loads without any photo schema or Storage and paginates beyond 1000 rows", async () => {
  const admin = mockAdmin({
    items_master: Array.from({ length: 1002 }, (_, index) => ({ item_code: `A${index}`, tally_unit: "CTN" })),
    products: [{ item_code: "B123", unit: "BOX" }],
    stock_take_items: [{ item_code: "A1001", master_uom: "CTN", base_uom: "PCS", base_uom_pack_size: 24 }],
  });
  const result = await loadCatalogueDetails(admin);
  assert.equal(Object.keys(result.details).length, 1003);
  assert.deepEqual(result.details.A1001, { sellingUnit: "CTN", packing: "24 PCS / CTN" });
  assert.deepEqual(result.details.B123, { sellingUnit: "BOX", packing: "" });
  assert.deepEqual(result.warnings, []);
  assert.ok(admin.calls.some((call) => call.table === "items_master" && call.range[0] === 1000));
  assert.ok(admin.calls.every((call) => ["items_master", "products", "stock_take_items"].includes(call.table)));
  assert.equal("photosReady" in result, false);
});

test("optional packing schema absence is explicit while other database errors are surfaced", async () => {
  const admin = mockAdmin({ items_master: [{ item_code: "A123" }] }, { errors: { stock_take_items: { code: "42P01" } } });
  const result = await loadCatalogueDetails(admin);
  assert.match(result.warnings[0], /stock_take_items/);
  assert.deepEqual(result.details.A123, { sellingUnit: "", packing: "" });
  await assert.rejects(loadCatalogueDetails(mockAdmin({}, { errors: {
    items_master: new Error("Database unavailable"),
  } })), /Database unavailable/);
});

test("packing HTTP endpoint authenticates and never caches private data; no photo write handlers exist", async () => {
  const routes = routeHarness(mockAdmin({
    profiles: [{ id: "user", role: "manager", is_active: true }],
    items_master: [{ item_code: "A123" }],
  }));
  const read = await routes.GET(authRequest());
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("cache-control"), "private, no-store");
  assert.equal((await read.json()).canManagePhotos, true);
  assert.equal((await routes.GET(authRequest(""))).status, 401);
  assert.equal(routes.POST, undefined);
  assert.equal(routes.DELETE, undefined);
});

test("local preview validation rejects unsupported types, empty and oversized images", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.doesNotThrow(() => validateCataloguePreview({ type, size: MAX_PRODUCT_PHOTO_BYTES }));
  }
  assert.throws(() => validateCataloguePreview({ type: "image/svg+xml", size: 10 }), /JPEG/);
  assert.throws(() => validateCataloguePreview({ type: "image/png", size: 0 }), /3 MB/);
  assert.throws(() => validateCataloguePreview({ type: "image/png", size: MAX_PRODUCT_PHOTO_BYTES + 1 }), /3 MB/);
});

test("photo selection and removal only use in-memory blob URLs, with no upload or persistent writes", () => {
  const source = fs.readFileSync(new URL("../app/components/ProductCatalogue.jsx", import.meta.url), "utf8");
  let photos = {};
  let error = "";
  const revoked = [];
  let sequence = 0;
  const context = vm.createContext({
    canManagePhotos: true,
    previewUrls: { current: new Set() },
    validateCataloguePreview,
    URL: { createObjectURL: () => `blob:test-${++sequence}`, revokeObjectURL: (url) => revoked.push(url) },
    setError: (value) => { error = value; },
    setPreviewPhotos: (update) => { photos = update(photos); },
  });
  const handlers = source.slice(source.indexOf("  function preview("), source.indexOf("  const { recommended:"));
  vm.runInContext(handlers, context);
  context.preview("A123", { type: "image/png", size: 10 });
  context.preview("A123", { type: "image/jpeg", size: 10 });
  assert.equal(photos.A123.length, 2);
  context.remove("A123", "blob:test-1");
  assert.equal(photos.A123.length, 1);
  assert.deepEqual(revoked, ["blob:test-1"]);
  context.preview("A123", { type: "image/svg+xml", size: 10 });
  assert.match(error, /JPEG/);
  assert.equal(photos.A123.length, 1);
  context.canManagePhotos = false;
  context.preview("A123", { type: "image/png", size: 10 });
  assert.equal(photos.A123.length, 1);
  assert.doesNotMatch(source, /FormData|method:\s*["'](?:POST|DELETE)|localStorage|indexedDB/);
  assert.match(source, /previewUrls\.current\.forEach\(\(url\) => URL\.revokeObjectURL\(url\)\)/);
  assert.match(source, /not uploaded, saved, or shared/);
});
