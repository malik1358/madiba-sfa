import assert from "node:assert/strict";
import test from "node:test";
import { parseTallyBarcodeCsv, TALLY_BARCODE_COLUMN_INDEX } from "../app/lib/tallyBarcodeSync.js";

test("parseTallyBarcodeCsv reads product code and column AP", () => {
  const cells = Array.from({ length: TALLY_BARCODE_COLUMN_INDEX + 1 }, () => "");
  cells[1] = "Product Code";
  cells[TALLY_BARCODE_COLUMN_INDEX] = "BARCODE Master";
  const data = Array.from({ length: TALLY_BARCODE_COLUMN_INDEX + 1 }, () => "");
  data[1] = "A004035";
  data[TALLY_BARCODE_COLUMN_INDEX] = "6287050670740";
  const blank = Array.from({ length: TALLY_BARCODE_COLUMN_INDEX + 1 }, () => "");
  blank[1] = "A009999";
  blank[TALLY_BARCODE_COLUMN_INDEX] = "NA";

  const csv = [cells, data, blank].map((row) => row.join(",")).join("\n");
  const rows = parseTallyBarcodeCsv(csv);
  assert.deepEqual(rows, [{ item_code: "A004035", tally_barcode: "6287050670740" }]);
});
