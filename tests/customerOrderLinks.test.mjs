import assert from "node:assert/strict";
import test from "node:test";
import {
  CUSTOMER_ORDER_LINK_TTL_HOURS,
  buildCustomerFacingCatalogItems,
  buildCustomerOrderLinkPath,
  buildCustomerOrderLinkUrl,
  customerOrderLinkExpiresAt,
  isCustomerOrderLinkExpired,
  isCustomerOrderLinkItemInKsaStock,
  isPublicCustomerOrderPath,
  isValidOrderLinkTokenShape,
  requireCustomerOrderLinkPricing,
  sanitizeCustomerOrderLinkCatalogPayload,
} from "../app/lib/customerOrderLinks.js";
import { canAccessWithoutMorningAttendance } from "../app/lib/morningAttendance.js";

test("customer order link token shape and URL helpers", () => {
  assert.equal(isValidOrderLinkTokenShape("short"), false);
  assert.equal(isValidOrderLinkTokenShape("abcdefghijklmnopqrstuvwx"), true);
  assert.equal(buildCustomerOrderLinkPath("abc_DEF-12345678901234567890"), "/order/abc_DEF-12345678901234567890");
  assert.equal(
    buildCustomerOrderLinkUrl("https://madiba-sfa.vercel.app", "abcdefghijklmnopqrstuvwx"),
    "https://madiba-sfa.vercel.app/order/abcdefghijklmnopqrstuvwx",
  );
});

test("customer order links expire after 36 hours", () => {
  assert.equal(CUSTOMER_ORDER_LINK_TTL_HOURS, 36);
  const created = new Date("2026-11-18T12:00:00.000Z");
  const expires = customerOrderLinkExpiresAt(created);
  assert.equal(expires.toISOString(), "2026-11-20T00:00:00.000Z");
  assert.equal(isCustomerOrderLinkExpired({ expires_at: expires.toISOString() }, created), false);
  assert.equal(
    isCustomerOrderLinkExpired({ expires_at: expires.toISOString() }, new Date("2026-11-20T00:00:00.000Z")),
    true,
  );
});

test("public order paths skip staff morning-attendance gate", () => {
  assert.equal(isPublicCustomerOrderPath("/order/abc"), true);
  assert.equal(isPublicCustomerOrderPath("/management/customer-audit"), false);
  assert.equal(canAccessWithoutMorningAttendance("/order/tokentokentokentoken12"), true);
  assert.equal(canAccessWithoutMorningAttendance("/privacy"), true);
});

test("customer-facing catalog keeps only priced in-stock catalogue codes", () => {
  const sheetItems = [
    { item_code: "A001111", item_name: "In stock pen", category: "Stationery" },
    { item_code: "A002222", item_name: "Out of stock pen", category: "Stationery" },
    { item_code: "A003333", item_name: "Unpriced pen", category: "Stationery" },
    { item_code: "BM001", item_name: "Not a catalogue code", category: "Other" },
  ];
  const regionPriceMap = {
    A001111: 10,
    A002222: 12,
    BM001: 5,
  };
  const eodStock = {
    active: true,
    stockDate: "2026-11-17",
    uploadedAt: "2026-11-17T18:00:00.000Z",
    byCity: {
      riyadh: { A001111: 8, A002222: 0, A003333: 4 },
      dammam: {},
      jeddah: {},
    },
    units: {},
    masterUnits: {
      A001111: { masterUom: "CTN", baseUom: "Pcs", conv: 12 },
    },
  };

  const items = buildCustomerFacingCatalogItems({ sheetItems, regionPriceMap, eodStock });
  assert.deepEqual(items.map((item) => item.item_code), ["A001111"]);
  assert.equal(items[0].master_unit, "CTN");
  assert.equal(items[0].base_unit, "Pcs");
  assert.equal(items[0].unit_conv, 12);
  assert.equal(items[0].price, 10);
  assert.equal("available" in items[0], false);
  assert.equal("stock" in items[0], false);

  assert.deepEqual(
    buildCustomerFacingCatalogItems({ sheetItems, regionPriceMap, eodStock: { active: false } }),
    [],
  );

  assert.equal(isCustomerOrderLinkItemInKsaStock(eodStock, "A001111"), true);
  assert.equal(isCustomerOrderLinkItemInKsaStock(eodStock, "A002222"), false);
  assert.equal(isCustomerOrderLinkItemInKsaStock({ active: false }, "A001111"), false);
});

test("order link creation requires explicit city and wholesale/retail", () => {
  assert.equal(requireCustomerOrderLinkPricing({}).ok, false);
  assert.equal(requireCustomerOrderLinkPricing({ pricingRegion: "riyadh" }).ok, false);
  assert.equal(requireCustomerOrderLinkPricing({ pricingType: "wholesale" }).ok, false);
  assert.deepEqual(
    requireCustomerOrderLinkPricing({ pricingRegion: "Dammam", pricingType: "Retail" }),
    { ok: true, pricingRegion: "dammam", pricingType: "retail" },
  );
});

test("sanitize catalog payload strips stock qty and keeps customer-safe fields", () => {
  const sanitized = sanitizeCustomerOrderLinkCatalogPayload({
    customerCode: "1224",
    customerName: "Demo Customer",
    paymentType: "credit",
    pricingRegion: "dammam",
    pricingType: "retail",
    schemes: [{
      id: "scheme-1",
      name: "Mix deal",
      active: true,
      rewardItemCode: "A001111",
      rewardEveryQty: 40,
      unitDiscountSar: 1.5,
      qualifierItemCodes: ["A004224"],
      excludeCashDiscount: true,
    }],
    items: [{
      item_code: "A001111",
      item_name: "Pen",
      category: "Stationery",
      price: 10,
      master_unit: "CTN",
      base_unit: "Pcs",
      unit_conv: 12,
      packing: "12 Pcs / CTN",
      photos: [{ id: "photo-1" }],
      available: 99,
      stockQty: 99,
    }],
  });

  assert.equal(sanitized.items.length, 1);
  assert.equal(sanitized.items[0].available, undefined);
  assert.equal(sanitized.items[0].stockQty, undefined);
  assert.equal(sanitized.items[0].master_unit, "CTN");
  assert.equal(sanitized.items[0].base_unit, "Pcs");
  assert.equal(sanitized.items[0].unit_conv, 12);
  assert.equal(sanitized.schemes[0].name, "Mix deal");
  assert.equal(sanitized.customerCode, "1224");
  assert.equal(sanitized.pricingRegion, "dammam");
  assert.equal(sanitized.pricingType, "retail");
});
