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
    seedLast: 67,
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
});

test("next voucher numbers after the seed are four digits", () => {
  assert.equal(nextTallyVoucherNumber("dammam_cash", 67), "DC/0068");
  assert.equal(nextTallyVoucherNumber("dammam_credit", 133), "DNFD/0134");
  assert.equal(nextTallyVoucherNumber("jeddah_cash", 1), "JC/0002");
  assert.equal(nextTallyVoucherNumber("jeddah_credit", 10), "JNFD/0011");
  assert.equal(nextTallyVoucherNumber("riyadh_cash", 142), "RC/0143");
  assert.equal(nextTallyVoucherNumber("riyadh_credit", 637), "RNFD/0638");
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
