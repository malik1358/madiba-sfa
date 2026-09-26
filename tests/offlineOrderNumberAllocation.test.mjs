import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { allocateLocalSalesOrderNumber } from "../app/lib/offlineOrderNumber.js";

test("useOrder allots permanent salesman order numbers offline", () => {
  const source = fs.readFileSync(
    new URL("../app/management/customer-audit/hooks/useOrder.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /allocateLocalSalesOrderNumber/);
  assert.match(source, /orderNumber: allottedOrderNumber/);
  assert.match(source, /draftOrderNumber/);
  assert.match(source, /rememberSalesmanOrderSequence/);
  assert.match(source, /existingServerOrderId/);
  assert.match(source, /Only invent a local pending row for brand-new/);
});

test("sales-orders API persists client order numbers without rewrite", () => {
  const source = fs.readFileSync(new URL("../app/api/sales-orders/route.js", import.meta.url), "utf8");
  assert.match(source, /clientOrderNumber/);
  assert.match(source, /Never replace an order number that already exists/);
  assert.match(source, /allocateServerSalesmanOrderNumber/);
  assert.match(source, /preferredOrderNumber/);
});

test("allocateLocalSalesOrderNumber preserves legacy numeric ids on resubmit", async () => {
  // Order #503 style: already on the server, not a short salesman series. Re-save
  // must keep 503 so the PDF does not invent ABA02 while the server keeps 503.
  assert.equal(
    await allocateLocalSalesOrderNumber("ABADALLA ANTHANATH", {
      existingOrderNumber: "503",
      peerCodes: ["ABADALLA ANTHANATH", "AHMED NABIL"],
    }),
    "503",
  );
});

test("offlineOrderNumber preserves any non-placeholder existing number", () => {
  const source = fs.readFileSync(new URL("../app/lib/offlineOrderNumber.js", import.meta.url), "utf8");
  assert.match(source, /isPlaceholderSalesOrderNumber/);
  assert.match(source, /legacy numeric ids/);
});
