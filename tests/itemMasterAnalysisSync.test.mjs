import assert from "node:assert/strict";
import test from "node:test";
import {
  buildItemMasterRowKey,
  mapRawItemMasterRow,
  mapRawRowsToMirrorRows,
  parseAltUomConv,
} from "../app/lib/itemMasterAnalysisSync.js";
import {
  flattenExecuteQueriesRows,
  getPowerBiConfig,
} from "../app/lib/powerBiClient.js";

test("mapRawItemMasterRow reads Power BI executeQueries style keys", () => {
  const mapped = mapRawItemMasterRow({
    "Item Master (Google Sheet)[Import or Local]": "Import",
    "Item Master (Google Sheet)[Main Group]": "Electronics",
    "Item Master (Google Sheet)[Sub Group]": "Electronics",
    "Item Master (Google Sheet)[Category]": "Split AC",
    "mst_stock_item[Item Code]": "a000057",
    "mst_stock_item[item_name]": "A000057_PAPERLINE",
    "Item Master (Google Sheet)[Article No]": "A000057",
    "Item Master (Google Sheet)[Article Common Name]": "A000057_PAPERLINE",
    "Item Master (Google Sheet)[Brand Name]": "PAPERLINE",
    "mst_stock_item[uom]": "Pcs",
    "mst_stock_item[alternate_uom]": "Ctn",
    "[ALT_UOM_CONV]": "12",
  });

  assert.equal(mapped.import_or_local, "Import");
  assert.equal(mapped.main_group, "Electronics");
  assert.equal(mapped.category, "Split AC");
  assert.equal(mapped.tally_item_code, "A000057");
  assert.equal(mapped.tally_item_name, "A000057_PAPERLINE");
  assert.equal(mapped.google_article_no, "A000057");
  assert.equal(mapped.brand_name, "PAPERLINE");
  assert.equal(mapped.tally_base_uom, "Pcs");
  assert.equal(mapped.tally_alt_uom, "Ctn");
  assert.equal(mapped.tally_alt_uom_conv, 12);
});

test("mapRawRowsToMirrorRows dedupes by stable row_key", () => {
  const rows = mapRawRowsToMirrorRows([
    {
      "mst_stock_item[Item Code]": "A000057",
      "Item Master (Google Sheet)[Article No]": "A000057",
      "mst_stock_item[item_name]": "A000057_PAPERLINE",
      "[ALT_UOM_CONV]": 1,
    },
    {
      "mst_stock_item[Item Code]": "A000057",
      "Item Master (Google Sheet)[Article No]": "A000057",
      "mst_stock_item[item_name]": "A000057_PAPERLINE",
      "[ALT_UOM_CONV]": 1,
    },
  ], "2026-11-13T10:00:00.000Z");

  assert.equal(rows.length, 1);
  assert.equal(rows[0].tally_item_code, "A000057");
  assert.equal(rows[0].synced_at, "2026-11-13T10:00:00.000Z");
  assert.equal(rows[0].row_key, buildItemMasterRowKey(rows[0]));
});

test("parseAltUomConv handles blanks and commas", () => {
  assert.equal(parseAltUomConv(""), null);
  assert.equal(parseAltUomConv("1,234.5"), 1234.5);
  assert.equal(parseAltUomConv(2), 2);
});

test("flattenExecuteQueriesRows extracts table rows", () => {
  const rows = flattenExecuteQueriesRows({
    results: [
      {
        tables: [
          {
            rows: [
              { "mst_stock_item[Item Code]": "A1" },
              { "mst_stock_item[Item Code]": "A2" },
            ],
          },
        ],
      },
    ],
  });
  assert.deepEqual(rows.map((row) => row["mst_stock_item[Item Code]"]), ["A1", "A2"]);
});

test("getPowerBiConfig trims env and defaults report id", () => {
  const config = getPowerBiConfig({
    POWERBI_TENANT_ID: " tenant ",
    POWERBI_CLIENT_ID: " client ",
    POWERBI_CLIENT_SECRET: " secret ",
    POWERBI_WORKSPACE_ID: " workspace ",
    POWERBI_DATASET_ID: " dataset ",
  });
  assert.equal(config.tenantId, "tenant");
  assert.equal(config.clientId, "client");
  assert.equal(config.reportId, "c7c58c6d-d5db-495c-8698-4b08eae90c51");
});
