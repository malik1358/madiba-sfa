import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMasterUnitConvMap,
  formatMasterStockQty,
  toMasterStockQty,
  unitsMatch,
} from "../app/lib/masterUnitQty.js";
import {
  buildEodStockAvailability,
  countryEodStockDisplayQty,
  formatEodStockAvailableLabel,
} from "../app/lib/eodStock.js";

test("unitsMatch treats carton aliases as equal", () => {
  assert.equal(unitsMatch("Ctn", "CTN"), true);
  assert.equal(unitsMatch("Ctn", "carton"), true);
  assert.equal(unitsMatch("RM", "Ctn"), false);
});

test("toMasterStockQty converts base stock to master with 0 decimals", () => {
  const result = toMasterStockQty(1000, {
    stockUnit: "RM",
    baseUom: "RM",
    masterUom: "Ctn",
    conv: 5,
  });
  assert.equal(result.qty, 200);
  assert.equal(result.unit, "Ctn");
  assert.equal(result.converted, true);
  assert.equal(formatMasterStockQty(result.qty, result.unit), "200 Ctn");
});

test("toMasterStockQty does not divide when stock unit is already master", () => {
  const result = toMasterStockQty(40, {
    stockUnit: "CTN",
    baseUom: "RM",
    masterUom: "Ctn",
    conv: 5,
  });
  assert.equal(result.qty, 40);
  assert.equal(result.converted, false);
});

test("buildMasterUnitConvMap prefers multi-unit conversion rows", () => {
  const map = buildMasterUnitConvMap([
    {
      tally_item_code: "A000057",
      tally_base_uom: "Ctn",
      tally_alt_uom: null,
      tally_master_unit_conv: 1,
    },
    {
      tally_item_code: "A000057",
      google_article_no: "A000057",
      tally_base_uom: "RM",
      tally_alt_uom: "Ctn",
      tally_master_unit_conv: 5,
    },
  ]);
  assert.equal(map.A000057.conv, 5);
  assert.equal(map.A000057.masterUom, "Ctn");
});

test("Available label shows master unit when conversion map is present", () => {
  const availability = buildEodStockAvailability({
    stockDate: "2026-11-13",
    uploadedAt: "2026-11-13T10:00:00.000Z",
    rows: [{
      itemCode: "A000057",
      itemName: "PAPERLINE",
      unit: "RM",
      cities: {
        riyadh: { qty: 800, value: 0 },
        dammam: { qty: 200, value: 0 },
        jeddah: { qty: 0, value: 0 },
      },
    }],
  }, {
    masterUnits: {
      A000057: { masterUom: "Ctn", baseUom: "RM", conv: 5 },
    },
  });

  assert.equal(countryEodStockDisplayQty(availability, "A000057"), 200);
  assert.equal(
    formatEodStockAvailableLabel(1000, "en", null, availability, "A000057", Date.parse("2026-11-13T12:00:00.000Z")),
    "Available: 200 Ctn · R:160 D:40 J:0",
  );
});
