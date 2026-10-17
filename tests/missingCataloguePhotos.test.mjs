import assert from "node:assert/strict";
import test from "node:test";
import { missingCataloguePhotoReport } from "../app/lib/missingCataloguePhotos.js";

test("missing catalogue photo report drops building materials and items that already have a photo", () => {
  const report = missingCataloguePhotoReport({
    master: [
      { item_code: "A1", item_name: "Baby Oil", category: "Baby Care", is_active: true },
      { item_code: "A2", item_name: "MDF Board 18mm", category: "Sundry", is_active: true },
      { item_code: "A3", item_name: "Pen", category: "Stationery", is_active: true },
      { item_code: "A4", item_name: "Old Soap Do Not Use", category: "Body Care", is_active: true },
      { item_code: "B1", item_name: "Cement Board", category: "Building Material", is_active: true },
    ],
    sheet: [
      { item_code: "A5", item_name: "Shampoo", category: "body care" },
    ],
    priceMap: { A1: "12.5", A2: 4, A3: 0, A5: "8", B1: "20" },
    photoCodes: ["a3"],
  });

  assert.deepEqual(report.rows.map((row) => row.code), ["A1", "A5"]);
  assert.equal(report.rows[1].category, "Body Care");
  assert.equal(report.summary.pricedMissing, 2);
  assert.equal(report.summary.withPhotos, 1);
  assert.equal(report.summary.excludedBuilding, 2);
  assert.equal(report.summary.unpricedMissing, 0);
});
