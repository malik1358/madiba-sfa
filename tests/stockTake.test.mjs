import test from "node:test";
import assert from "node:assert/strict";

import {
  attachSystemQtyToLines,
  convertEnteredQtyToUnits,
  findItemByBarcode,
  findItemByItemCode,
  formatStockQty,
  hasStockTakeModuleAccess,
  resolveScannedUom,
  STOCK_TAKE_UOM,
  warehouseKey,
} from "../app/lib/stockTake.js";
import {
  parseStockTakeMasterRows,
  parseSystemInventoryRows,
  rowsFromSheetMatrix,
} from "../app/lib/stockTakeMasterImport.js";

const item = {
  item_code: "A004409",
  item_name: "Twin blade",
  base_uom: "PCS",
  mid_uom: "BAG",
  master_uom: "CTN",
  base_uom_pack_size: 336,
  mid_uom_pack_size: 14,
  barcode_base: "111",
  barcode_mid: "222",
  barcode_master: "333",
};

test("warehouse key ignores case and extra spaces", () => {
  assert.equal(warehouseKey("  Riyadh  DC "), "RIYADH DC");
});

test("item code lookup finds the item without locking unit", () => {
  assert.equal(findItemByItemCode([item], "a004409")?.item_code, "A004409");
  assert.equal(findItemByItemCode([item], "missing"), null);
});

test("scanned barcode selects the matching UOM", () => {
  assert.equal(resolveScannedUom(item, "111").kind, STOCK_TAKE_UOM.BASE);
  assert.equal(resolveScannedUom(item, "222").kind, STOCK_TAKE_UOM.MID);
  assert.equal(resolveScannedUom(item, "333").kind, STOCK_TAKE_UOM.MASTER);
  assert.equal(resolveScannedUom(item, "A004409").ambiguous, true);
});

test("qty converts to base first then back to master", () => {
  assert.deepEqual(
    convertEnteredQtyToUnits({
      qtyEntered: 2,
      scannedUom: STOCK_TAKE_UOM.MASTER,
      baseUomPackSize: 336,
      midUomPackSize: 14,
    }),
    { qtyEntered: 2, qtyBase: 672, qtyMid: 48, qtyMaster: 2, scannedUom: "MASTER" },
  );

  const mid = convertEnteredQtyToUnits({
    qtyEntered: 3,
    scannedUom: STOCK_TAKE_UOM.MID,
    baseUomPackSize: 336,
    midUomPackSize: 14,
  });
  assert.equal(mid.qtyBase, 42);
  assert.equal(mid.qtyMaster, 42 / 336);

  const base = convertEnteredQtyToUnits({
    qtyEntered: 10,
    scannedUom: STOCK_TAKE_UOM.BASE,
    baseUomPackSize: 336,
    midUomPackSize: 14,
  });
  assert.equal(base.qtyBase, 10);
  assert.equal(Number(base.qtyMaster.toFixed(8)), Number((10 / 336).toFixed(8)));
});

test("admins always have stock take access", () => {
  assert.equal(hasStockTakeModuleAccess({ role: "admin", stockTakeAccess: false }), true);
  assert.equal(hasStockTakeModuleAccess({ role: "salesman", stockTakeAccess: false }), false);
  assert.equal(hasStockTakeModuleAccess({ role: "salesman", stockTakeAccess: true }), true);
});

test("report keeps scanned lines and optionally shows system qty", () => {
  const rows = attachSystemQtyToLines(
    [{ item_code: "A1", qty_base: 20 }],
    [{ item_code: "A1", qty_base: 15 }, { item_code: "B2", qty_base: 99 }],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].system_qty_base, 15);
  assert.equal(rows[0].variance_qty_base, 5);
});

test("master excel columns map pack sizes and barcodes", () => {
  const parsed = parseStockTakeMasterRows([{
    "Product Code": "a004409",
    "Item Name": "Twin blade",
    "Base UOM": "PCS",
    "MID UOM": "BAG",
    "Master UOM": "CTN",
    "Base UOM Pack Size": 336,
    "MID UOM Pack Size": 14,
    "Base Barcode": "111",
    "MID Barcode": "222",
    "Master Barcode": "333",
  }]);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].item_code, "A004409");
  assert.equal(parsed.items[0].base_uom_pack_size, 336);
  assert.equal(parsed.items[0].mid_uom_pack_size, 14);
  assert.equal(parsed.items[0].barcode_master, "333");
});

test("inventory module excel keeps master barcode when the header is shifted one column", () => {
  const rows = rowsFromSheetMatrix([
    ["Product Code", "Item Name", "Base UOM Pack Size", "BASE UOM", "MID UOM Pack Size", "MID UOM", "Master UOM", "BARCODE Mid", "BARCODE Master ", ""],
    ["A004035", "Cotton swabs", "240", "PC", "12", "PACK", "CTN", "6287050670979", "", "6287050670740"],
  ]);
  const parsed = parseStockTakeMasterRows(rows);
  assert.equal(parsed.items[0].item_code, "A004035");
  assert.equal(parsed.items[0].base_uom, "PC");
  assert.equal(parsed.items[0].base_uom_pack_size, 240);
  assert.equal(parsed.items[0].mid_uom_pack_size, 12);
  assert.equal(parsed.items[0].barcode_mid, "6287050670979");
  assert.equal(parsed.items[0].barcode_master, "6287050670740");
});

test("header row can sit below a title row", () => {
  const rows = rowsFromSheetMatrix([
    ["KSA Price Tag Format", "", ""],
    ["Product Code", "Item Name", "Base UOM Pack Size"],
    ["A1", "Item", "24"],
  ]);
  assert.equal(rows[0]["Product Code"], "A1");
  assert.equal(rows[0]["Base UOM Pack Size"], "24");
});

test("system inventory upload is keyed by item in base qty", () => {
  const rows = parseSystemInventoryRows([
    { "Item Code": "a1", Qty: 12 },
    { "Item Code": "A1", "Qty Base": 18 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qty_base, 18);
});

test("barcode lookup finds the item", () => {
  assert.equal(findItemByBarcode([item], "222")?.item_code, "A004409");
  assert.equal(formatStockQty(10.5), "10.5");
});
