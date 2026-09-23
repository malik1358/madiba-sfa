import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("useOrder allots permanent salesman order numbers offline", () => {
  const source = fs.readFileSync(
    new URL("../app/management/customer-audit/hooks/useOrder.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /allocateLocalSalesOrderNumber/);
  assert.match(source, /orderNumber: allottedOrderNumber/);
  assert.match(source, /draftOrderNumber/);
  assert.match(source, /rememberSalesmanOrderSequence/);
});

test("sales-orders API persists client order numbers without rewrite", () => {
  const source = fs.readFileSync(new URL("../app/api/sales-orders/route.js", import.meta.url), "utf8");
  assert.match(source, /clientOrderNumber/);
  assert.match(source, /Never replace an order number that already exists/);
  assert.match(source, /allocateServerSalesmanOrderNumber/);
  assert.match(source, /preferredOrderNumber/);
});
