import test from "node:test";
import assert from "node:assert/strict";
import {
  canRefreshOrderPricing,
  resolveRefreshPricingContext,
  summarizePricingRefreshChanges,
} from "../app/lib/orderPricingRefresh.js";
import { ORDER_STATUS_PENDING_INVOICE_CREATION } from "../app/lib/orderApproval.js";

test("can refresh pricing only when the order is not a draft and has no uploaded invoice", () => {
  const submitted = { id: 12, status: "SUBMITTED" };
  assert.equal(canRefreshOrderPricing(submitted, null), true);
  assert.equal(
    canRefreshOrderPricing(submitted, { status: ORDER_STATUS_PENDING_INVOICE_CREATION }),
    true,
  );
  assert.equal(
    canRefreshOrderPricing(submitted, { invoiceFilePath: "C1/12/invoice.pdf" }),
    false,
  );
  assert.equal(
    canRefreshOrderPricing(submitted, { invoiceUploadedAt: "2026-10-01T10:00:00.000Z" }),
    false,
  );
  assert.equal(canRefreshOrderPricing({ id: 1, status: "DRAFT" }, null), false);
  assert.equal(canRefreshOrderPricing({ id: 2, status: "CANCELLED" }, null), false);
  assert.equal(canRefreshOrderPricing(null, null), false);
});

test("refresh pricing still allowed for settled invoice-status rows without a PDF", () => {
  assert.equal(
    canRefreshOrderPricing(
      { id: 9, status: "SUBMITTED" },
      { status: "Pending with salesman" },
    ),
    true,
  );
});

test("resolveRefreshPricingContext prefers stored pricing meta over history", () => {
  const resolved = resolveRefreshPricingContext({
    pricingMeta: {
      paymentType: "cash",
      pricingRegion: "jeddah",
      pricingType: "retail",
    },
    history: [
      { paymentType: "credit", pricingRegion: "riyadh", pricingType: "wholesale" },
    ],
  });
  assert.deepEqual(resolved, {
    paymentType: "cash",
    pricingRegion: "jeddah",
    pricingType: "retail",
  });
});

test("resolveRefreshPricingContext falls back to the latest history pricing", () => {
  const resolved = resolveRefreshPricingContext({
    pricingMeta: null,
    history: [
      { paymentType: "credit", pricingRegion: "riyadh", pricingType: "wholesale" },
      { paymentType: "cash", pricingRegion: "dammam", pricingType: "wholesale" },
    ],
  });
  assert.equal(resolved.paymentType, "cash");
  assert.equal(resolved.pricingRegion, "dammam");
  assert.equal(resolved.pricingType, "wholesale");
});

test("summarizePricingRefreshChanges counts rate updates only", () => {
  const summary = summarizePricingRefreshChanges([
    {
      type: "UPDATED",
      item_code: "A1",
      before_quantity: 2,
      after_quantity: 2,
      before_rate: 10,
      after_rate: 12,
    },
    {
      type: "UPDATED",
      item_code: "A2",
      before_quantity: 1,
      after_quantity: 3,
      before_rate: 5,
      after_rate: 5,
    },
  ]);
  assert.equal(summary.changedLineCount, 1);
  assert.equal(summary.unchanged, false);
  assert.deepEqual(summarizePricingRefreshChanges([]), {
    changedLineCount: 0,
    unchanged: true,
  });
});
