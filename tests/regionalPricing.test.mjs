import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEffectivePriceList,
  formatAppliedDiscount,
  formatDiscountDetail,
  formatPdfDiscountDetail,
  formatDiscountPercent,
  formatOrderVatLabel,
  getPricedOrderLine,
  isVatExemptProduct,
  lookupDiscountRate,
  parseDiscountRate,
  pricingRegionsFromMetadata,
  resolveOrderPricingRegion,
  vatRateForProduct,
  summarizePricedLines,
} from "../app/lib/regionalPricing.js";

test("formatDiscountPercent and lookupDiscountRate show item scheme rates", () => {
  assert.equal(formatDiscountPercent(0.02), "2%");
  assert.equal(formatDiscountPercent(0), "—");
  assert.equal(lookupDiscountRate({ A003927: 0.02 }, "a003927"), 0.02);
  assert.equal(lookupDiscountRate({ A003606: "8.00%" }, "A003606"), 0.08);
});

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
  const cashFromPercentString = getPricedOrderLine({
    wholesaleRate: 102,
    quantity: 5,
    paymentType: "cash",
    cashDiscountRate: "8.00%",
  });

  assert.equal(credit.rate, 100);
  assert.equal(credit.applied.cash, false);
  assert.equal(cash.rate, 98);
  assert.equal(cash.applied.cash, true);
  assert.equal(cashFromPercentString.rate, 93.84);
  assert.equal(cashFromPercentString.applied.cash, true);
  assert.equal(Number(cashFromPercentString.cashDiscountAmount.toFixed(2)), 40.8);
});

test("formatAppliedDiscount marks the scheme only when it reduced the line", () => {
  assert.equal(formatAppliedDiscount(0.04, true), "4% applied");
  assert.equal(formatAppliedDiscount(0.04, false), "4%");
  assert.equal(formatAppliedDiscount(0, false), "—");
});

test("value discount applies when SKU value exceeds 5000 SAR", () => {
  const below = getPricedOrderLine({
    wholesaleRate: 100,
    quantity: 49,
    valueDiscountRate: 0.03,
  });
  const atThreshold = getPricedOrderLine({
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
  assert.equal(atThreshold.applied.value, true);
  assert.equal(above.applied.value, true);
  assert.equal(Number(above.rate.toFixed(2)), 97);
});

test("value discount ignores negative or invalid quantities", () => {
  const negative = getPricedOrderLine({
    wholesaleRate: 100,
    quantity: -60,
    valueDiscountRate: 0.03,
  });
  const invalid = getPricedOrderLine({
    wholesaleRate: 100,
    quantity: Number.NaN,
    valueDiscountRate: 0.03,
  });

  assert.equal(negative.applied.value, false);
  assert.equal(negative.lineValue, 0);
  assert.equal(invalid.applied.value, false);
  assert.equal(invalid.lineValue, 0);
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
  assert.equal(Number(priced.rate.toFixed(4)), Number((114.33 * (1 - 0.03 - 0.02)).toFixed(4)));
});

test("A004190 credit line over 5000 applies value only; cash stacks both", () => {
  const credit = getPricedOrderLine({
    wholesaleRate: 58,
    quantity: 113,
    paymentType: "credit",
    cashDiscountRate: 0.04,
    valueDiscountRate: 0.04,
  });
  const cash = getPricedOrderLine({
    wholesaleRate: 58,
    quantity: 113,
    paymentType: "cash",
    cashDiscountRate: 0.04,
    valueDiscountRate: 0.04,
  });

  assert.equal(credit.applied.value, true);
  assert.equal(credit.applied.cash, false);
  assert.equal(Number(credit.rate.toFixed(2)), 55.68);
  assert.equal(Number(credit.valueDiscountAmount.toFixed(2)), Number((58 * 113 * 0.04).toFixed(2)));
  assert.equal(credit.cashDiscountAmount, 0);
  const totals = summarizePricedLines([credit]);
  assert.equal(Number(totals.amountExclVat.toFixed(2)), Number(credit.lineValue.toFixed(2)));
  assert.equal(Number(totals.vatAmount.toFixed(2)), Number((credit.lineValue * 0.15).toFixed(2)));
  assert.equal(formatDiscountDetail(0.04, true, 262.16), "4% applied · 262.16");
  assert.equal(formatPdfDiscountDetail(0.03, true, 41.4), "3%\n41.40");
  assert.equal(formatDiscountDetail(0.03, false, 0), "—");
  assert.equal(formatDiscountDetail(0.02, false, 0), "—");
  assert.equal(cash.applied.value, true);
  assert.equal(cash.applied.cash, true);
  assert.equal(Number(cash.rate.toFixed(4)), Number((58 * (1 - 0.04 - 0.04)).toFixed(4)));
});

test("buildEffectivePriceList uses current quantity for value discount", () => {
  const prices = buildEffectivePriceList({
    wholesaleMap: { A006061: 114.33 },
    cashDiscountMap: { A006061: 0.02 },
    valueDiscountMap: { A006061: 0.03 },
    paymentType: "cash",
    quantities: { A006061: 50 },
  });

  assert.equal(Number(prices.A006061.toFixed(4)), Number((114.33 * (1 - 0.03 - 0.02)).toFixed(4)));
});

test("resolveOrderPricingRegion prefers the logged-in user region", () => {
  assert.equal(
    resolveOrderPricingRegion({
      currentUserRegion: "dammam",
      customerSalesmanCode: "SM002",
      pricingRegionBySalesmanCode: { SM002: "riyadh" },
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

test("multi-region salesmen can pick an assigned order region", () => {
  assert.deepEqual(
    pricingRegionsFromMetadata({ pricing_region: "riyadh", pricing_regions: ["riyadh", "dammam"] }),
    ["riyadh", "dammam"]
  );
  assert.equal(
    resolveOrderPricingRegion({
      selectedRegion: "dammam",
      currentUserRegion: "riyadh",
      currentUserRegions: ["riyadh", "dammam"],
    }),
    "dammam"
  );
  assert.equal(
    resolveOrderPricingRegion({
      selectedRegion: "jeddah",
      currentUserRegion: "riyadh",
      currentUserRegions: ["riyadh", "dammam"],
    }),
    "riyadh"
  );
});

test("vinyl glove SKUs are VAT-exempt even when sales name omits Gloves", () => {
  assert.equal(isVatExemptProduct({ item_name: "Gloves, clear vinyl, XL - A003949" }), true);
  assert.equal(isVatExemptProduct({ item_name: "A003949_MADIBA VINYL Do Not Use", item_code: "A003949" }), true);
  assert.equal(isVatExemptProduct({ item_name: "A003948_MADIBA VINYL GLOVES SIZE Do Not Use" }), true);
  assert.equal(vatRateForProduct({ item_name: "A003949_MADIBA VINYL Do Not Use" }), 0);
  assert.equal(vatRateForProduct({ item_name: "Paper A4", category: "Stationery" }), 0.15);
});

test("glove order lines are priced with zero VAT on New Order and PDF totals", () => {
  const gloves = getPricedOrderLine({
    wholesaleRate: 48,
    quantity: 100,
    item_code: "A006298",
    item_name: "MADIBA VINYL GLOVES SIZE MEDIUM TRANSPARENT CLEAR",
  });
  assert.equal(gloves.vatRate, 0);
  assert.equal(gloves.vatAmount, 0);
  assert.equal(gloves.lineTotalInclVat, 4800);

  const xl = getPricedOrderLine({
    wholesaleRate: 54,
    quantity: 50,
    item_code: "A006300",
    item_name: "MADIBA VINYL GLOVES SIZE XL TRANSPARENT CLEAR",
  });
  const gloveTotals = summarizePricedLines([gloves, xl]);
  assert.equal(gloveTotals.amountExclVat, 7500);
  assert.equal(gloveTotals.vatAmount, 0);
  assert.equal(gloveTotals.amountInclVat, 7500);
  assert.equal(formatOrderVatLabel(gloveTotals), "VAT 0%");
  assert.equal(formatOrderVatLabel(gloveTotals, { language: "ar" }), "ضريبة 0%");

  const paper = getPricedOrderLine({
    wholesaleRate: 100,
    quantity: 10,
    item_name: "Paper A4",
  });
  const mixed = summarizePricedLines([gloves, paper]);
  assert.equal(mixed.amountExclVat, 5800);
  assert.equal(Number(mixed.vatAmount.toFixed(2)), 150);
  assert.equal(formatOrderVatLabel(mixed), "VAT");
  assert.equal(formatOrderVatLabel({ amountExclVat: 1000, vatAmount: 150 }), "VAT 15%");
});
