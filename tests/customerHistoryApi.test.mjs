import test from "node:test";
import assert from "node:assert/strict";

import { buildSettlementCustomerHistoryUrl } from "../app/lib/customerHistoryApi.js";

test("buildSettlementCustomerHistoryUrl keeps New Order on full settlement history", () => {
  const url = buildSettlementCustomerHistoryUrl(
    "/api/customer-history",
    " C001 ",
    "Madiba Medical",
    { refresh: true },
  );

  assert.equal(
    url,
    "/api/customer-history?customerCode=C001&customerName=Madiba+Medical&fullHistory=1&scope=settlement&refresh=1",
  );
});
