import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_ORDER_QUANTITY_CONTROLS,
  activeOrderQuantityControls,
  evaluateOrderQuantityControls,
  formatQuantityControlViolation,
  getRiyadhWeekBounds,
  normalizeOrderQuantityControls,
  resolveStoredOrderQuantityControls,
} from "../app/lib/orderQuantityControls.js";

test("missing storage falls back to A004075 weekly 20 default", () => {
  const controls = resolveStoredOrderQuantityControls(null);
  assert.equal(controls.length, 1);
  assert.equal(controls[0].itemCode, "A004075");
  assert.deepEqual(controls[0].itemCodes, ["A004075"]);
  assert.equal(controls[0].maxQty, 20);
  assert.equal(controls[0].active, true);
  assert.equal(controls[0].period, "week");
});

test("saved empty control list is respected", () => {
  assert.deepEqual(resolveStoredOrderQuantityControls({ controls: [] }), []);
});

test("disabled controls are ignored during evaluation", () => {
  const controls = normalizeOrderQuantityControls([{
    ...DEFAULT_ORDER_QUANTITY_CONTROLS[0],
    active: false,
  }]);
  assert.equal(activeOrderQuantityControls(controls).length, 0);
  const violations = evaluateOrderQuantityControls({
    lines: [{ item_code: "A004075", quantity: 50 }],
    controls,
    priorQtyByItem: {},
  });
  assert.equal(violations.length, 0);
});

test("A004075 blocks when prior plus current exceed 20", () => {
  const violations = evaluateOrderQuantityControls({
    lines: [{ item_code: "A004075", quantity: 6 }],
    controls: DEFAULT_ORDER_QUANTITY_CONTROLS,
    priorQtyByItem: { A004075: 15 },
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].remainingQty, 5);
  assert.equal(violations[0].totalQty, 21);
  assert.match(formatQuantityControlViolation(violations[0]), /Remaining allowed: 5/);
});

test("A004075 allows exactly 20 for the week", () => {
  const violations = evaluateOrderQuantityControls({
    lines: [{ item_code: "A004075", quantity: 5 }],
    controls: DEFAULT_ORDER_QUANTITY_CONTROLS,
    priorQtyByItem: { A004075: 15 },
  });
  assert.equal(violations.length, 0);
});

test("unrelated items are not limited by the A004075 rule", () => {
  const violations = evaluateOrderQuantityControls({
    lines: [{ item_code: "A005425", quantity: 100 }],
    controls: DEFAULT_ORDER_QUANTITY_CONTROLS,
    priorQtyByItem: { A004075: 20 },
  });
  assert.equal(violations.length, 0);
});

test("Riyadh week bounds span seven days from Monday", () => {
  // Wednesday 2026-09-16 09:00 Riyadh = 06:00 UTC
  const bounds = getRiyadhWeekBounds(new Date("2026-09-16T06:00:00.000Z"));
  assert.equal(bounds.weekStartIso, "2026-09-13T21:00:00.000Z");
  assert.equal(bounds.weekEndIso, "2026-09-20T21:00:00.000Z");
});

test("legacy single itemCode normalizes to itemCodes array", () => {
  const [control] = normalizeOrderQuantityControls([{
    id: "legacy",
    itemCode: "A001",
    maxQty: 50,
  }]);
  assert.equal(control.itemCode, "A001");
  assert.deepEqual(control.itemCodes, ["A001"]);
});

test("group rule sums qty across all SKUs against one shared cap", () => {
  const controls = normalizeOrderQuantityControls([{
    id: "group-100",
    name: "Four SKUs max 100",
    active: true,
    itemCodes: ["SKU1", "SKU2", "SKU3", "SKU4"],
    maxQty: 100,
  }]);
  assert.deepEqual(controls[0].itemCodes, ["SKU1", "SKU2", "SKU3", "SKU4"]);
  assert.equal(controls[0].itemCode, "SKU1");

  const allowed = evaluateOrderQuantityControls({
    lines: [
      { item_code: "SKU1", quantity: 40 },
      { item_code: "SKU2", quantity: 30 },
      { item_code: "SKU3", quantity: 20 },
      { item_code: "SKU4", quantity: 10 },
    ],
    controls,
    priorQtyByItem: {},
  });
  assert.equal(allowed.length, 0);

  const blocked = evaluateOrderQuantityControls({
    lines: [
      { item_code: "SKU1", quantity: 40 },
      { item_code: "SKU2", quantity: 30 },
    ],
    controls,
    priorQtyByItem: { SKU3: 20, SKU4: 11 },
  });
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].alreadyQty, 31);
  assert.equal(blocked[0].orderedQty, 70);
  assert.equal(blocked[0].totalQty, 101);
  assert.equal(blocked[0].remainingQty, 69);
  assert.match(formatQuantityControlViolation(blocked[0]), /combined/);
});

test("group rule ignores orders that do not include any group SKU", () => {
  const controls = normalizeOrderQuantityControls([{
    itemCodes: ["SKU1", "SKU2", "SKU3", "SKU4"],
    maxQty: 100,
  }]);
  const violations = evaluateOrderQuantityControls({
    lines: [{ item_code: "OTHER", quantity: 500 }],
    controls,
    priorQtyByItem: { SKU1: 100 },
  });
  assert.equal(violations.length, 0);
});
