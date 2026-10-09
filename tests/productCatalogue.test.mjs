import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  cataloguePacking, cataloguePermissions, validateCataloguePreview, MAX_PRODUCT_PHOTO_BYTES,
} from "../app/lib/productCatalogue.js";
import { loadCatalogueDetails, requireCatalogueAccess } from "../app/lib/productCatalogueServer.js";
import { buildModuleAccess, listAccessibleNavGroups, localizedModuleLabel } from "../app/lib/moduleAccess.js";

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
  const handlers = source.slice(source.indexOf("  function preview("), source.indexOf("  const lastPage"));
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
