import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import fs from "node:fs";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import {
  cataloguePacking, cataloguePermissions, catalogueSheetPacking,
  hasCataloguePrice, validateCataloguePhoto, MAX_PRODUCT_PHOTO_BYTES,
} from "../app/lib/productCatalogue.js";
import {
  deleteCataloguePhoto, loadCatalogueDetails as loadDetails, loadCatalogueSheetPacking,
  prepareCataloguePhoto, requireCatalogueAccess, uploadCataloguePhoto,
} from "../app/lib/productCatalogueServer.js";
import { buildModuleAccess, listAccessibleNavGroups, localizedModuleLabel } from "../app/lib/moduleAccess.js";
import {
  buildAttachmentKey,
  buildImmutableProductCataloguePhotoKey,
  buildProductCataloguePhotoKey,
  ATTACHMENT_CATEGORIES,
  KEY_LAYOUTS,
} from "../app/lib/storage/attachmentKeys.js";

const loadCatalogueDetails = (admin) => loadDetails(admin, async () => ({}));
const id = "12345678-1234-1234-1234-123456789012";

function mockAdmin(tables = {}, options = {}) {
  if (!tables.attachments) tables.attachments = tables.attachments || [];
  const calls = [];
  const files = new Map();
  const admin = {
    calls, files,
    auth: { getUser: async () => ({ data: { user: options.user || { id: "user", user_metadata: {} } }, error: options.authError }) },
    from(table) {
      let action = "select";
      let body;
      let filters = [];
      let range = [0, Infinity];
      const query = {
        select() { return query; },
        order() { return query; },
        range(start, end) { range = [start, end]; return query; },
        limit(value) { range = [0, value - 1]; return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        insert(value) { action = "insert"; body = value; return query; },
        delete() { action = "delete"; return query; },
        single() { return query.then((result) => ({ ...result, data: result.data?.[0] || null })); },
        maybeSingle() { return query.single(); },
        then(resolve, reject) {
          calls.push({ table, action, body, range, filters: [...filters] });
          const error = options.errors?.[`${table}:${action}`] || options.errors?.[table];
          if (error) return Promise.resolve({ data: null, error }).then(resolve, reject);
          const all = tables[table] || [];
          const matched = all.filter((row) => filters.every(([key, value]) => row[key] === value));
          if (action === "insert") {
            const row = {
              id: body.id || randomUUID(),
              created_at: body.created_at || "2026-10-15T00:00:00Z",
              ...body,
            };
            tables[table] = [...all, row];
            return Promise.resolve({ data: [row], error: null }).then(resolve, reject);
          }
          if (action === "delete") tables[table] = all.filter((row) => !matched.includes(row));
          return Promise.resolve({ data: matched.slice(range[0], range[1] + 1), error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    storage: {
      getBucket: async (bucket) => {
        calls.push({ action: "getBucket", bucket });
        return { data: { id: bucket }, error: null };
      },
      from(bucket) {
        return {
          upload: async (path, buffer, metadata) => {
            calls.push({ action: "upload", bucket, path, metadata });
            if (options.uploadError) return { error: options.uploadError };
            files.set(`${bucket}/${path}`, buffer);
            return { data: { path }, error: null };
          },
          remove: async (paths) => {
            calls.push({ action: "remove", bucket, paths });
            if (options.removeError) return { error: options.removeError };
            paths.forEach((path) => files.delete(`${bucket}/${path}`));
            return { error: null };
          },
          createSignedUrl: async (path) => ({
            data: { signedUrl: `https://example.invalid/${bucket}/${path}?signed=test` }, error: null,
          }),
        };
      },
    },
  };
  return admin;
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
    console, URL, MAX_PRODUCT_PHOTO_BYTES,
    deleteCataloguePhoto, loadCatalogueDetails, requireCatalogueAccess, uploadCataloguePhoto,
  });
  vm.runInContext(source.replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/g, "").replace(/export /g, ""), context);
  return context;
}

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
  assert.deepEqual(result.details.A123, { sellingUnit: "CTN", packing: "CTN OF 20 PACK OF 12 PC", photos: [] });
  const unavailable = await loadDetails(mockAdmin({ items_master: [{ item_code: "A123" }] }), async () => {
    throw new Error("Sheet offline");
  });
  assert.match(unavailable.warnings[0], /Sheet offline/);
  await assert.rejects(loadCatalogueSheetPacking(async () => new Response("", { status: 403 })), /403/);
});

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

test("photo writes are restricted to active admin/manager, including metadata gates", () => {
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

test("catalogue photo attachment keys encode item codes for legacy and immutable layouts", () => {
  assert.equal(
    buildProductCataloguePhotoKey({ itemCode: " a/123 ", uuid: id }),
    `product-catalogue/415f313233/${id}.jpg`,
  );
  assert.match(
    buildImmutableProductCataloguePhotoKey({ itemCode: "A123", uuid: id, now: Date.parse("2026-10-15T12:00:00+03:00") }),
    new RegExp(`^product-catalogue/2026/10/A123/20261015-${id}\\.jpg$`),
  );
  assert.equal(
    buildAttachmentKey(ATTACHMENT_CATEGORIES.productCataloguePhoto, { itemCode: "A123", extension: "jpg", uuid: id }, KEY_LAYOUTS.legacy),
    buildProductCataloguePhotoKey({ itemCode: "A123", uuid: id }),
  );
  assert.throws(() => buildProductCataloguePhotoKey({ itemCode: "", uuid: id }));
});

test("API authentication rejects anonymous, invalid, inactive and unauthorized writers", async () => {
  const profile = { id: "user", role: "salesman", is_active: true };
  const admin = mockAdmin({ profiles: [profile] });
  await assert.rejects(requireCatalogueAccess(admin, authRequest("")), { status: 401 });
  await assert.rejects(requireCatalogueAccess(mockAdmin({}, { authError: {} }), authRequest()), { status: 401 });
  assert.equal((await requireCatalogueAccess(admin, authRequest())).canManagePhotos, false);
  await assert.rejects(requireCatalogueAccess(admin, authRequest(), true), { status: 403 });
  profile.role = "manager";
  assert.equal((await requireCatalogueAccess(admin, authRequest(), true)).canManagePhotos, true);
  profile.is_active = false;
  await assert.rejects(requireCatalogueAccess(admin, authRequest()), { status: 403 });
  profile.is_active = true;
  profile.role = "collector";
  await assert.rejects(requireCatalogueAccess(admin, authRequest()), { status: 403 });
});

test("initial catalogue works without photos when attachments schema is missing", async () => {
  const admin = mockAdmin({
    items_master: [{ item_code: "A123", tally_unit: "CTN" }],
    products: [], stock_take_items: [],
  }, { errors: { "attachments:select": { code: "42P01", message: "relation attachments does not exist" } } });
  const result = await loadCatalogueDetails(admin);
  assert.deepEqual(result.details.A123, { sellingUnit: "CTN", packing: "", photos: [] });
  assert.equal(result.photosReady, false);
  assert.match(result.warnings[0], /20261015084023/);
});

test("catalogue reads paginate past 1000 items and retain every carousel photo from attachments", async () => {
  const admin = mockAdmin({
    items_master: Array.from({ length: 1002 }, (_, index) => ({ item_code: `A${index}`, tally_unit: "CTN" })),
    products: [{ item_code: "B123", unit: "BOX" }],
    stock_take_items: [{ item_code: "A1001", master_uom: "CTN", base_uom: "PCS", base_uom_pack_size: 24 }],
    attachments: [
      {
        id: "second", category: "product_catalogue_photo", entity_id: "A1001",
        object_key: "product-catalogue/second.jpg", storage_provider: "supabase",
        created_at: "2026-10-09T02:00:00Z",
      },
      {
        id: "first", category: "product_catalogue_photo", entity_id: "a1001",
        object_key: "product-catalogue/first.jpg", storage_provider: "supabase",
        created_at: "2026-10-09T01:00:00Z",
      },
      {
        id: "other", category: "receipt_copy", entity_id: "visit",
        object_key: "payment-collections/x.jpg", storage_provider: "supabase",
        created_at: "2026-10-09T01:00:00Z",
      },
    ],
  });
  const result = await loadCatalogueDetails(admin);
  assert.equal(Object.keys(result.details).length, 1003);
  assert.deepEqual(result.details.A1001.packing, "24 PCS / CTN");
  assert.equal(result.details.A1001.photos.length, 2);
  assert.equal(result.details.A1001.photos[0].id, "first");
  assert.match(result.details.A1001.photos[0].url, /product-catalogue\/first\.jpg/);
  assert.deepEqual(result.details.B123, { sellingUnit: "BOX", packing: "", photos: [] });
  assert.equal(result.photosReady, true);
  assert.ok(admin.calls.some((call) => call.table === "items_master" && call.range[0] === 1000));
});

test("optional packing schema absence is explicit while other database errors are surfaced", async () => {
  const admin = mockAdmin({ items_master: [{ item_code: "A123" }] }, { errors: { stock_take_items: { code: "42P01" } } });
  const result = await loadCatalogueDetails(admin);
  assert.match(result.warnings[0], /stock_take_items/);
  assert.deepEqual(result.details.A123, { sellingUnit: "", packing: "", photos: [] });
  await assert.rejects(loadCatalogueDetails(mockAdmin({}, { errors: {
    items_master: new Error("Database unavailable"),
  } })), /Database unavailable/);
});

test("non-schema attachment failures are surfaced rather than disguised as no photos", async () => {
  await assert.rejects(loadCatalogueDetails(mockAdmin({}, { errors: {
    "attachments:select": new Error("Database unavailable"),
  } })), /Database unavailable/);
});

test("image processing validates actual bytes, rejects oversized/SVG files and strips metadata", async () => {
  const png = await sharp({ create: { width: 1800, height: 100, channels: 3, background: "red" } }).png().toBuffer();
  const jpeg = await prepareCataloguePhoto(new File([png], "photo.png", { type: "text/plain" }));
  const metadata = await sharp(jpeg).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 1600);
  assert.equal(metadata.exif, undefined);
  await assert.rejects(prepareCataloguePhoto({ size: MAX_PRODUCT_PHOTO_BYTES + 1, arrayBuffer() {} }), { status: 400 });
  await assert.rejects(prepareCataloguePhoto(new File(["bad"], "fake.jpg")), /cannot be read/);
  await assert.rejects(prepareCataloguePhoto(new File(['<svg width="10" height="10"></svg>'], "image.svg")), /Only JPEG/);
});

test("client photo validation rejects unsupported types, empty and oversized images", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.doesNotThrow(() => validateCataloguePhoto({ type, size: MAX_PRODUCT_PHOTO_BYTES }));
  }
  assert.throws(() => validateCataloguePhoto({ type: "image/svg+xml", size: 10 }), /JPEG/);
  assert.throws(() => validateCataloguePhoto({ type: "image/png", size: 0 }), /3 MB/);
  assert.throws(() => validateCataloguePhoto({ type: "image/png", size: MAX_PRODUCT_PHOTO_BYTES + 1 }), /3 MB/);
});

test("uploaded photos persist in attachments across reload and can be removed", async () => {
  const tables = { items_master: [{ item_code: "A123" }], attachments: [] };
  const admin = mockAdmin(tables);
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "blue" } }).png().toBuffer();
  const uploaded = await uploadCataloguePhoto(admin, { id: "user" }, " a123 ", new File([png], "photo.png"));
  assert.equal(admin.files.size, 1);
  assert.equal(tables.attachments.length, 1);
  assert.equal(tables.attachments[0].category, "product_catalogue_photo");
  assert.equal(tables.attachments[0].entity_id, "A123");
  const reloaded = await loadCatalogueDetails(admin);
  assert.equal(reloaded.details.A123.photos[0].id, uploaded.id);
  await deleteCataloguePhoto(admin, uploaded.id);
  assert.equal(admin.files.size, 0);
  assert.equal((await loadCatalogueDetails(admin)).details.A123.photos.length, 0);
});

test("failed metadata persistence rolls back the uploaded Storage object", async () => {
  const admin = mockAdmin({ items_master: [{ item_code: "A123" }], attachments: [] }, { errors: {
    "attachments:insert": new Error("Insert failed"),
  } });
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "blue" } }).png().toBuffer();
  await assert.rejects(uploadCataloguePhoto(admin, { id: "user" }, "A123", new File([png], "photo.png")), /Insert failed/);
  assert.equal(admin.files.size, 0);
  await assert.rejects(uploadCataloguePhoto(admin, { id: "user" }, "UNKNOWN", new File([png], "photo.png")), { status: 404 });
  await assert.rejects(deleteCataloguePhoto(admin, id), { status: 404 });
});

test("concurrent uploads each retain their own durable attachment row", async () => {
  const admin = mockAdmin({ items_master: [{ item_code: "A123" }], attachments: [] });
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "blue" } }).png().toBuffer();
  const results = await Promise.all([
    uploadCataloguePhoto(admin, { id: "user" }, "A123", new File([png], "one.png")),
    uploadCataloguePhoto(admin, { id: "user" }, "A123", new File([png], "two.png")),
  ]);
  assert.notEqual(results[0].id, results[1].id);
  assert.equal(admin.files.size, 2);
  assert.equal((await loadCatalogueDetails(admin)).details.A123.photos.length, 2);
});

test("failed Storage removal does not delete the photo metadata", async () => {
  const admin = mockAdmin({ attachments: [{
    id, category: "product_catalogue_photo", entity_id: "A123",
    object_key: "product-catalogue/photo.jpg", storage_provider: "supabase",
    created_at: "2026-10-09T00:00:00Z",
  }] }, { removeError: new Error("Storage unavailable") });
  await assert.rejects(deleteCataloguePhoto(admin, id), /Storage unavailable/);
  assert.equal(admin.calls.filter((call) => call.action === "delete").length, 0);
  assert.equal((await loadCatalogueDetails(admin)).details.A123.photos.length, 1);
});

test("HTTP endpoints enforce read/write access before parsing an upload and never cache private data", async () => {
  const profile = { id: "user", role: "salesman", is_active: true };
  const admin = mockAdmin({ profiles: [profile], items_master: [{ item_code: "A123" }], attachments: [] });
  const routes = routeHarness(admin);
  const read = await routes.GET(authRequest());
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("cache-control"), "private, no-store");
  assert.equal((await read.json()).canManagePhotos, false);
  const denied = await routes.POST(authRequest());
  assert.equal(denied.status, 403);
  const deniedDelete = await routes.DELETE(authRequest());
  assert.equal(deniedDelete.status, 403);
  assert.equal(admin.calls.filter((call) => call.action === "upload" || call.action === "remove").length, 0);
  assert.equal((await routes.GET(authRequest(""))).status, 401);
});

test("HTTP photo upload persists the gallery and DELETE removes the specified image only", async () => {
  const admin = mockAdmin({
    profiles: [{ id: "user", role: "manager", is_active: true }],
    items_master: [{ item_code: "A123" }],
    attachments: [],
  });
  const routes = routeHarness(admin);
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "blue" } }).png().toBuffer();
  const form = new FormData();
  form.set("itemCode", "A123");
  form.set("photo", new File([png], "photo.png"));
  const posted = await routes.POST(new Request("http://localhost/api/product-catalogue", {
    method: "POST", body: form, headers: { authorization: "Bearer test-token" },
  }));
  assert.equal(posted.status, 200);
  const payload = await posted.json();
  const read = await routes.GET(authRequest());
  assert.equal((await read.json()).details.A123.photos[0].id, payload.id);
  const deleted = await routes.DELETE(new Request(`http://localhost/api/product-catalogue?photoId=${payload.id}`, {
    method: "DELETE", headers: { authorization: "Bearer test-token" },
  }));
  assert.equal(deleted.status, 200);
  assert.equal(admin.files.size, 0);
  const oversized = await routes.POST(new Request("http://localhost/api/product-catalogue", {
    method: "POST", headers: { authorization: "Bearer test-token", "content-length": String(MAX_PRODUCT_PHOTO_BYTES + 100000) },
  }));
  assert.equal(oversized.status, 413);
});

test("catalogue UI uploads via FormData and refreshes signed URLs before expiry", () => {
  const source = fs.readFileSync(new URL("../app/components/ProductCatalogue.jsx", import.meta.url), "utf8");
  assert.match(source, /FormData/);
  assert.match(source, /method:\s*["']POST["']/);
  assert.match(source, /method:\s*["']DELETE["']/);
  assert.match(source, /photosReady/);
  assert.match(source, /Upload photo/);
  assert.match(source, /4 \* 60 \* 1000/);
  assert.doesNotMatch(source, /not uploaded, saved, or shared/);
  assert.doesNotMatch(source, /createObjectURL|revokeObjectURL|previewPhotos/);
});
