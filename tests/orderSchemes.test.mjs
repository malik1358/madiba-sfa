import test from "node:test";
import assert from "node:assert/strict";

import { getPricedOrderLine } from "../app/lib/regionalPricing.js";
import { priceOrderLines } from "../app/lib/orderPricing.js";
import {
  DEFAULT_ORDER_SCHEMES,
  describeOrderScheme,
  evaluateOrderSchemes,
  lookupSchemeApplication,
  normalizeOrderSchemes,
  parseItemCodeList,
  resolveStoredOrderSchemes,
} from "../app/lib/orderSchemes.js";

const firstScheme = DEFAULT_ORDER_SCHEMES[0];

test("parseItemCodeList splits mixed separators", () => {
  assert.deepEqual(parseItemCodeList("A004224, A004225;A004226 A004227"), [
    "A004224",
    "A004225",
    "A004226",
    "A004227",
  ]);
});

test("missing scheme storage falls back to the A005425 mix default", () => {
  const schemes = resolveStoredOrderSchemes(null);
  assert.equal(schemes[0].rewardItemCode, "A005425");
  assert.deepEqual(schemes[0].qualifierItemCodes, ["A004224", "A004225", "A004226", "A004227"]);
  assert.equal(schemes[0].unitDiscountSar, 1.83);
});

test("saved empty scheme list is respected", () => {
  assert.deepEqual(resolveStoredOrderSchemes({ schemes: [] }), []);
});

test("A005425 scheme applies to Golden Star alias paper codes", () => {
  const applied = evaluateOrderSchemes({ A003234: 40, A004226: 1 }, DEFAULT_ORDER_SCHEMES);
  assert.equal(lookupSchemeApplication(applied, "A003234").schemeAmount, 73.2);
  assert.equal(lookupSchemeApplication(applied, "A005425").schemeAmount, 0);
});

test("A005425 scheme needs 40 cartons plus one mix item", () => {
  const noMix = evaluateOrderSchemes({ A005425: 40 }, DEFAULT_ORDER_SCHEMES);
  const shortQty = evaluateOrderSchemes({ A005425: 39, A004224: 1 }, DEFAULT_ORDER_SCHEMES);
  const applied = evaluateOrderSchemes({ A005425: 40, A004226: 1 }, DEFAULT_ORDER_SCHEMES);

  assert.equal(lookupSchemeApplication(noMix, "A005425").schemeAmount, 0);
  assert.equal(lookupSchemeApplication(shortQty, "A005425").schemeAmount, 0);
  assert.equal(lookupSchemeApplication(applied, "A005425").schemeAmount, 73.2);
  assert.equal(lookupSchemeApplication(applied, "A005425").discountedQty, 40);
});

test("A005425 scheme discounts only complete 40-carton lots", () => {
  const applied = evaluateOrderSchemes({ A005425: 85, A004227: 2 }, DEFAULT_ORDER_SCHEMES);
  assert.equal(lookupSchemeApplication(applied, "A005425").schemeAmount, 146.4);
});

test("all_units apply mode discounts every carton once the minimum is met", () => {
  const schemes = normalizeOrderSchemes([{
    ...firstScheme,
    applyTo: "all_units",
  }]);
  const applied = evaluateOrderSchemes({ A005425: 45, A004224: 1 }, schemes);
  assert.equal(Number(lookupSchemeApplication(applied, "A005425").schemeAmount.toFixed(2)), 82.35);
});

test("priced order line subtracts the scheme SAR from the net rate", () => {
  const applications = evaluateOrderSchemes({ A005425: 40, A004224: 1 }, DEFAULT_ORDER_SCHEMES);
  const scheme = lookupSchemeApplication(applications, "A005425");
  const priced = getPricedOrderLine({
    wholesaleRate: 100,
    quantity: 40,
    schemeUnitDiscount: scheme.unitDiscount,
    schemeDiscountedQty: scheme.discountedQty,
  });

  assert.equal(priced.applied.scheme, true);
  assert.equal(Number(priced.schemeDiscountAmount.toFixed(2)), 73.2);
  assert.equal(Number(priced.rate.toFixed(2)), 98.17);
  assert.equal(Number(priced.lineValue.toFixed(2)), 3926.8);
});

test("A005425 mix scheme does not stack with cash discount", () => {
  const applications = evaluateOrderSchemes({ A005425: 40, A004224: 1 }, DEFAULT_ORDER_SCHEMES);
  const scheme = lookupSchemeApplication(applications, "A005425");
  assert.equal(scheme.excludeCashDiscount, true);

  const priced = getPricedOrderLine({
    wholesaleRate: 100,
    quantity: 40,
    paymentType: "cash",
    cashDiscountRate: 0.02,
    schemeUnitDiscount: scheme.unitDiscount,
    schemeDiscountedQty: scheme.discountedQty,
    excludeCashDiscount: scheme.excludeCashDiscount,
  });

  assert.equal(priced.applied.scheme, true);
  assert.equal(priced.applied.cash, false);
  assert.equal(priced.cashDiscountAmount, 0);
  assert.equal(Number(priced.schemeDiscountAmount.toFixed(2)), 73.2);
  assert.equal(Number(priced.rate.toFixed(2)), 98.17);
});

test("priceOrderLines skips cash when the mix scheme excludes it", () => {
  const lines = priceOrderLines(
    [
      { item_code: "A005425", quantity: 40, rate: 50 },
      { item_code: "A004224", quantity: 1, rate: 10 },
    ],
    {
      regionPriceMap: { A005425: 50, A004224: 10 },
      cashDiscountMap: { A005425: 0.02, A004224: 0.02 },
      paymentType: "cash",
      schemes: DEFAULT_ORDER_SCHEMES,
    },
  );

  assert.equal(Number(lines[0].rate.toFixed(2)), 48.17);
  assert.equal(Number(lines[0].line_value.toFixed(2)), 1926.8);
  assert.equal(Number(lines[1].rate.toFixed(2)), 9.8);
});

test("legacy A005425 rows without excludeCashDiscount still block cash stacking", () => {
  const schemes = normalizeOrderSchemes([{
    id: "saved-mix",
    name: "A005425 + mix 40 CTN",
    rewardItemCode: "A005425",
    rewardEveryQty: 40,
    unitDiscountSar: 1.83,
    qualifierItemCodes: ["A004224", "A004225", "A004226", "A004227"],
  }]);
  assert.equal(schemes[0].excludeCashDiscount, true);
});

test("priceOrderLines applies the configured scheme on save", () => {
  const lines = priceOrderLines(
    [
      { item_code: "A005425", quantity: 40, rate: 50 },
      { item_code: "A004224", quantity: 1, rate: 10 },
    ],
    {
      regionPriceMap: { A005425: 50, A004224: 10 },
      schemes: DEFAULT_ORDER_SCHEMES,
    },
  );

  assert.equal(Number(lines[0].rate.toFixed(2)), 48.17);
  assert.equal(Number(lines[0].line_value.toFixed(2)), 1926.8);
  assert.equal(lines[1].rate, 10);
});

test("priceOrderLines fills a missing A003234 rate from the A005425 family", () => {
  const lines = priceOrderLines(
    [
      { item_code: "A003234", quantity: 40, rate: 0 },
      { item_code: "A004225", quantity: 1, rate: 243 },
    ],
    {
      regionPriceMap: { A005425: 52.83, A004225: 243 },
      schemes: DEFAULT_ORDER_SCHEMES,
    },
  );

  assert.equal(Number(lines[0].rate.toFixed(2)), 51);
  assert.equal(Number(lines[0].line_value.toFixed(2)), Number(((52.83 * 40) - 73.2).toFixed(2)));
});

test("describeOrderScheme explains the first configured deal", () => {
  assert.match(describeOrderScheme(firstScheme), /A005425/);
  assert.match(describeOrderScheme(firstScheme), /1\.83/);
  assert.match(describeOrderScheme(firstScheme), /Does not combine with cash discount/);
});
