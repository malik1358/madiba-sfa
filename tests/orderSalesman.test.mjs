import test from "node:test";
import assert from "node:assert/strict";

import {
  formatOrderSalesmanLabel,
  resolveOrderMakerFromProfile,
  resolveOrderMakerFromScope,
} from "../app/lib/orderSalesman.js";

test("resolveOrderMakerFromProfile uses the logged-in profile, not customer master", () => {
  const maker = resolveOrderMakerFromProfile({
    salesman_code: "JUNAID",
    salesman_name: "Junaid",
  });
  assert.deepEqual(maker, { salesmanCode: "JUNAID", salesmanName: "Junaid" });
});

test("resolveOrderMakerFromProfile falls back to code when name is blank", () => {
  const maker = resolveOrderMakerFromProfile({ salesman_code: "PARVEZ", salesman_name: "" });
  assert.equal(maker.salesmanCode, "PARVEZ");
  assert.equal(maker.salesmanName, "PARVEZ");
});

test("resolveOrderMakerFromScope prefers current user member name", () => {
  const maker = resolveOrderMakerFromScope({
    currentUserId: "u-junaid",
    currentSalesmanCode: "JUNAID",
    visibleMembers: [
      { id: "u-parvez", salesman_code: "PARVEZ", salesman_name: "Parvez" },
      { id: "u-junaid", salesman_code: "JUNAID", salesman_name: "Junaid" },
    ],
  });
  assert.deepEqual(maker, { salesmanCode: "JUNAID", salesmanName: "Junaid" });
});

test("formatOrderSalesmanLabel prefers stored name over code", () => {
  assert.equal(formatOrderSalesmanLabel({ salesman_name: "Junaid", salesman_code: "JUNAID" }), "Junaid");
  assert.equal(formatOrderSalesmanLabel({ salesmanName: "Junaid", salesmanCode: "JUNAID" }), "Junaid");
  assert.equal(formatOrderSalesmanLabel({ salesmanCode: "PARVEZ" }), "PARVEZ");
  assert.equal(formatOrderSalesmanLabel({}), "-");
});
