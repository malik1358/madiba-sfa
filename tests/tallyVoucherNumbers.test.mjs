import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTallyVoucherNumber,
  nextTallyVoucherNumber,
  resolveTallyVoucherSeries,
} from "../app/lib/tallyVoucherNumbers.js";
import { buildTallyOrderExportRows } from "../app/lib/tallyItemUnits.js";

test("voucher series maps city and payment to the seeded prefixes", () => {
  assert.deepEqual(resolveTallyVoucherSeries({ pricingRegion: "dammam", paymentType: "cash" }), {
    seriesKey: "dammam_cash",
    prefix: "DC",
    seedLast: 72,
  });
  assert.equal(
    resolveTallyVoucherSeries({ pricingRegion: "dammam", paymentType: "credit" }).prefix,
    "DNFD",
  );
  assert.equal(
    resolveTallyVoucherSeries({ pricingRegion: "jeddah", paymentType: "cash" }).prefix,
    "JC",
  );
  assert.equal(
    resolveTallyVoucherSeries({ pricingRegion: "jeddah", paymentType: "credit" }).prefix,
    "JNFD",
  );
  assert.equal(
    resolveTallyVoucherSeries({ pricingRegion: "riyadh", paymentType: "cash" }).prefix,
    "RC",
  );
  assert.equal(
    resolveTallyVoucherSeries({ pricingRegion: "riyadh", paymentType: "credit" }).prefix,
    "RNFD",
  );
  assert.equal(
    resolveTallyVoucherSeries({ pricingRegion: "riyadh", channel: "retail" }).prefix,
    "RNFR",
  );
  assert.equal(
    resolveTallyVoucherSeries({ pricingRegion: "riyadh", channel: "store" }).prefix,
    "RS",
  );
  assert.equal(
    resolveTallyVoucherSeries({
      pricingRegion: "riyadh",
      routing: { costCenter: "BM" },
    }).prefix,
    "NFD",
  );
});

test("next voucher numbers after the seed are four digits", () => {
  assert.equal(nextTallyVoucherNumber("dammam_cash"), "DC/0073");
  assert.equal(nextTallyVoucherNumber("dammam_credit"), "DNFD/0138");
  assert.equal(nextTallyVoucherNumber("jeddah_cash"), "JC/0008");
  assert.equal(nextTallyVoucherNumber("jeddah_credit"), "JNFD/0014");
  assert.equal(nextTallyVoucherNumber("riyadh_cash"), "RC/0148");
  assert.equal(nextTallyVoucherNumber("riyadh_retail"), "RNFR/0002");
  assert.equal(nextTallyVoucherNumber("riyadh_store"), "RS/0290");
  assert.equal(nextTallyVoucherNumber("riyadh_credit"), "RNFD/0681");
  assert.equal(nextTallyVoucherNumber("non_food"), "NFD/2175");
  assert.equal(formatTallyVoucherNumber("RC", 9), "RC/0009");
});

test("export rows put the sticky voucher number on item and VAT lines", () => {
  const rows = buildTallyOrderExportRows({
    order: {
      customer_name: "TEST CUST",
      salesman_name: "Thamer",
      tally_voucher_number: "RC/0143",
    },
    lines: [{
      item_code: "A000057",
      item_name: "PAPER",
      quantity: 2,
      rate: 90,
      wholesaleRate: 100,
      category: "PAPER",
    }],
    orderNumber: "SO-1",
    pricingRegion: "riyadh",
    paymentType: "cash",
    voucherNumber: "RC/0143",
  });

  assert.equal(rows[0]["Voucher Number"], "RC/0143");
  assert.equal(rows.at(-1)["Voucher Number"], "RC/0143");
});
