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
