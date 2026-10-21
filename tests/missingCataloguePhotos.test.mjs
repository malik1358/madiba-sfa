import assert from "node:assert/strict";
import test from "node:test";
import { missingCataloguePhotoReport } from "../app/lib/missingCataloguePhotos.js";

test("missing catalogue photo report keeps priced catalogue products and drops the rest", () => {
  const report = missingCataloguePhotoReport({
    master: [
      { item_code: "A000001", item_name: "Baby Oil", category: "Baby Care", is_active: true },
      { item_code: "A000002", item_name: "MDF Board 18mm", category: "Sundry", is_active: true },
      { item_code: "A000003", item_name: "Pen", category: "Stationery", is_active: true },
      { item_code: "A000004", item_name: "Old Soap Do Not Use", category: "Body Care", is_active: true },
      { item_code: "B000001", item_name: "Cement Board", category: "Building Material", is_active: true },
      { item_code: "A003944", item_name: "Madiba Refrigerator", category: "Electronics", is_active: true },
      { item_code: "ITEMCOUNT", item_name: "ITEMCOUNT", category: "Unclassified", is_active: true },
      { item_code: "NC00143", item_name: "NC00143_BUFFALO BOBBY VEAL, 18KG, ALLANA (023)", category: "Unclassified", is_active: true },
    ],
    sheet: [
      { item_code: "A000005", item_name: "Shampoo", category: "body care" },
    ],
    priceMap: {
      A000001: "12.5",
      A000002: 4,
      A000003: 0,
      A000005: "8",
      B000001: "20",
      ITEMCOUNT: "640",
      NC00143: "55",
    },
    photoCodes: ["A000006"],
  });

  assert.deepEqual(report.rows.map((row) => row.code), ["A000001", "A000005"]);
  assert.equal(report.rows[1].category, "Body Care");
  assert.equal(report.summary.missing, 2);
  assert.equal(report.summary.withPhotos, 0);
  assert.equal(report.summary.excludedBuilding, 2);
});

test("a priced catalogue item that already has a photo is counted and not listed", () => {
  const report = missingCataloguePhotoReport({
    master: [
      { item_code: "A000006", item_name: "Notebook", category: "Stationery", is_active: true },
    ],
    priceMap: { A000006: "3" },
    photoCodes: ["a000006"],
  });

  assert.deepEqual(report.rows, []);
  assert.equal(report.summary.withPhotos, 1);
  assert.equal(report.summary.missing, 0);
});
