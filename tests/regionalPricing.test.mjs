import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEffectivePriceList,
  getPricedOrderLine,
  parseDiscountRate,
  resolveOrderPricingRegion,
} from "../app/lib/regionalPricing.js";

test("parseDiscountRate reads percent and decimal scheme values", () => {
  assert.equal(parseDiscountRate("2.00%"), 0.02);
  assert.equal(parseDiscountRate("3"), 0.03);
  assert.equal(parseDiscountRate("0.05"), 0.05);
  assert.equal(parseDiscountRate("#VALUE!"), 0);
  assert.equal(parseDiscountRate(""), 0);
});

test("cash discount applies only to cash orders", () => {
  const credit = getPricedOrderLine({
    wholesaleRate: 100,
    quantity: 10,
    paymentType: "credit",
    cashDiscountRate: 0.02,
  });
  const cash = getPricedOrderLine({
    wholesaleRate: 100,
    quantity: 10,
    paymentType: "cash",
    cashDiscountRate: 0.02,
  });

  assert.equal(credit.rate, 100);
  assert.equal(cash.rate, 98);
  assert.equal(cash.applied.cash, true);
});

test("value discount applies when SKU value exceeds 5000 SAR", () => {
  const below = getPricedOrderLine({
    wholesaleRate: 100,
    quantity: 50,
    valueDiscountRate: 0.03,
  });
  const above = getPricedOrderLine({
    wholesaleRate: 100,
    quantity: 51,
    valueDiscountRate: 0.03,
  });

  assert.equal(below.applied.value, false);
  assert.equal(below.rate, 100);
  assert.equal(above.applied.value, true);
  assert.equal(Number(above.rate.toFixed(2)), 97);
});

test("cash and value discounts can stack", () => {
  const priced = getPricedOrderLine({
    wholesaleRate: 114.33,
    quantity: 50,
    paymentType: "cash",
    cashDiscountRate: 0.02,
    valueDiscountRate: 0.03,
  });

  assert.equal(priced.applied.cash, true);
  assert.equal(priced.applied.value, true);
  assert.equal(Number(priced.rate.toFixed(4)), Number((114.33 * 0.97 * 0.98).toFixed(4)));
});

test("buildEffectivePriceList uses current quantity for value discount", () => {
  const prices = buildEffectivePriceList({
    wholesaleMap: { A006061: 114.33 },
    cashDiscountMap: { A006061: 0.02 },
    valueDiscountMap: { A006061: 0.03 },
    paymentType: "cash",
    quantities: { A006061: 50 },
  });

  assert.equal(Number(prices.A006061.toFixed(4)), Number((114.33 * 0.97 * 0.98).toFixed(4)));
});

test("resolveOrderPricingRegion prefers the customer salesman region", () => {
  assert.equal(
    resolveOrderPricingRegion({
      currentUserRegion: "riyadh",
      customerSalesmanCode: "SM002",
      pricingRegionBySalesmanCode: { SM002: "dammam" },
    }),
    "dammam"
  );
  assert.equal(
    resolveOrderPricingRegion({
      currentUserRegion: "jeddah",
      customerSalesmanCode: "",
      pricingRegionBySalesmanCode: {},
    }),
    "jeddah"
  );
});
