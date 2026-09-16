import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCustomerSalesmanOwnership,
  applyCustomerSalesmanOwnershipToRows,
  buildCustomerSalesmanOwnershipMap,
  normalizeCustomerCode,
  normalizeSalesmanCode,
} from "../app/lib/customerSalesmanOwnership.js";

test("normalize helpers trim and uppercase codes", () => {
  assert.equal(normalizeCustomerCode(" 1427 "), "1427");
  assert.equal(normalizeSalesmanCode(" abadalla "), "ABADALLA");
});

test("master assignment overrides sales-line salesman", () => {
  const ownership = buildCustomerSalesmanOwnershipMap(
    [
      { customer_code: "1427", current_salesman_code: "ABADALLA" },
      { customer_code: "1480", current_salesman_code: "ABADALLA" },
    ],
    [
      { salesman_code: "ABADALLA", salesman_name: "ABADALLA ANTHANATH" },
    ],
  );

  const row = applyCustomerSalesmanOwnership({
    customer_code: "1427",
    salesman_code: "OTHER",
    salesman_name: "Someone Else",
    sales_amount: 100,
  }, ownership);

  assert.equal(row.salesman_code, "ABADALLA");
  assert.equal(row.salesman_name, "ABADALLA ANTHANATH");
  assert.equal(row.sales_amount, 100);
});

test("missing master keeps sales-line salesman", () => {
  const ownership = buildCustomerSalesmanOwnershipMap(
    [{ customer_code: "9999", current_salesman_code: "S1" }],
    [{ salesman_code: "S1", salesman_name: "Sales One" }],
  );

  const row = applyCustomerSalesmanOwnership({
    customer_code: "1427",
    salesman_code: "LINE",
    salesman_name: "From Sales Line",
  }, ownership);

  assert.equal(row.salesman_code, "LINE");
  assert.equal(row.salesman_name, "From Sales Line");
});

test("profile name used when code matches", () => {
  const ownership = buildCustomerSalesmanOwnershipMap(
    [{ customer_code: "1367", current_salesman_code: "ABADALLA" }],
    [{ salesman_code: "ABADALLA", salesman_name: "ABADALLA ANTHANATH" }],
  );

  assert.deepEqual(ownership.get("1367"), {
    salesman_code: "ABADALLA",
    salesman_name: "ABADALLA ANTHANATH",
  });

  const rows = applyCustomerSalesmanOwnershipToRows([
    { customer_code: "1367", salesman_code: "X", salesman_name: "Y" },
    { customer_code: "0001", salesman_code: "KEEP", salesman_name: "Keep Me" },
  ], ownership);

  assert.equal(rows[0].salesman_name, "ABADALLA ANTHANATH");
  assert.equal(rows[1].salesman_code, "KEEP");
  assert.equal(rows[1].salesman_name, "Keep Me");
});
