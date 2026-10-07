import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { randomUUID } from "node:crypto";

const source = fs.readFileSync(new URL("../app/management/customer-audit/hooks/useOrder.js", import.meta.url), "utf8");

function createHarness(result, { draftId = 586 } = {}) {
  const states = [draftId, "O586", "customer:1462", { SKU: 10 }, false, false, true, [{ action: "draft" }], "DRAFT"];
  const refs = [];
  const requests = [];
  const errors = [];
  let stateIndex = 0;
  let refIndex = 0;
  const context = vm.createContext({
    crypto: { randomUUID },
    useState: (initial) => {
      const index = stateIndex++;
      if (index >= states.length) states[index] = initial;
      return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useRef: (initial) => {
      const index = refIndex++;
      refs[index] ||= { current: initial };
      return refs[index];
    },
    useCallback: (callback) => callback,
    useMemo: (callback) => callback(),
    useEffect: () => {},
    getSupabaseClient: () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: "test-user" }, access_token: "test-token" } } }) } }),
    buildOrderItems: (quantities) => Object.entries(quantities).filter(([, quantity]) => quantity > 0).map(([item_code, order_quantity]) => ({ item_code, order_quantity })),
    buildOrderSummary: (items) => ({ itemCount: items.length }),
    promptCustomerMobileUpdateIfMissing: async () => {},
    captureGpsLocationWithFallbackConfirm: async () => ({ latitude: 24, longitude: 46 }),
    resolveGpsCapturePlatform: async () => "web",
    loadVisitDistanceMetrics: async () => ({ distance: 0 }),
    resolveOrderMakerFromScope: () => ({ salesmanCode: "OSAMA", salesmanName: "Osama" }),
    allocateLocalSalesOrderNumber: async () => "O586",
    rememberSalesmanOrderSequence: async () => {},
    getPrice: () => 100,
    normalizePaymentType: (value) => value,
    priceOrderLines: (lines) => lines,
    postJsonResilient: async (request) => {
      requests.push(request);
      if (result instanceof Error) throw result;
      return typeof result === "function" ? result() : result;
    },
    buildQueuedPendingOrderId: (id) => `pending:${id}`,
    upsertLocalPendingOrder: async () => {},
    requestLoginFirstCustomerHintCheck: () => {},
    friendlyErrorMessage: (error) => error.message,
    blockedByAvgDaysMessage: () => "Blocked",
  });
  vm.runInContext(source.replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/g, "").replace("export function useOrder", "function useOrder"), context);
  function render(customerCode = "1462") {
    stateIndex = 0;
    refIndex = 0;
    const hook = context.useOrder({
      selectedCustomer: { customer_code: customerCode, customer_name: "Alnazafuh Almukhtasuh" },
      priceList: {},
      accessScope: {},
      setError: (message) => errors.push(message),
      setMessage: () => {},
    });
    refs[0].current = `customer:${customerCode}`;
    return hook;
  }
  return { render, states, refs, requests, errors };
}

function assertCleared(harness) {
  const hook = harness.render();
  assert.equal(hook.orderItems.length, 0);
  assert.equal(hook.draftOrderId, null);
  assert.equal(hook.showOrderReview, false);
  assert.equal(hook.loadedOrderStatus, "DRAFT");
  assert.equal(hook.orderHistory.length, 0);
  assert.equal(harness.states[1], "");
  assert.equal(harness.refs[2].current, null);
}

test("online submission clears customer 1462's entry but retains submitted snapshot data", async () => {
  const harness = createHarness({ payload: { orderId: 586, orderNumber: "O586", status: "SUBMITTED" } });
  const hook = harness.render();
  const saved = await hook.submitOrder({ silent: true });
  assert.equal(saved.orderId, 586);
  assert.equal(saved.orderNumber, "O586");
  assert.equal(hook.orderItems[0].order_quantity, 10);
  assertCleared(harness);
  assert.equal(harness.refs[3].current.has("586"), true);
});

for (const draftId of [586, null]) {
  test(`queued submission clears the cart for ${draftId ? "a saved draft" : "a new order"}`, async () => {
    const harness = createHarness({ queued: true, queueId: "queue-1" }, { draftId });
    const saved = await harness.render().submitOrder();
    assert.equal(saved.orderId, draftId || "pending:queue-1");
    assertCleared(harness);
    assert.equal(harness.refs[3].current.has(String(saved.orderId)), true);
  });
}

test("failed submission preserves cart, draft and retry identity", async () => {
  const harness = createHarness(new Error("Unable to persist order"));
  assert.equal(await harness.render().submitOrder(), null);
  const firstRequestId = harness.requests[0].jsonBody.requestId;
  const hook = harness.render();
  assert.equal(hook.draftOrderId, 586);
  assert.equal(hook.orderItems[0].order_quantity, 10);
  assert.equal(harness.refs[2].current, firstRequestId);
  await hook.submitOrder();
  assert.equal(harness.requests[1].jsonBody.requestId, firstRequestId);
  assert.equal(harness.refs[3].current.size, 0);
});

test("next order for the same customer gets a new request id and no previous draft id", async () => {
  const harness = createHarness({ payload: { orderId: 586, orderNumber: "O586" } });
  await harness.render().submitOrder();
  harness.render().setOrderQuantities({ SKU: 2 });
  await harness.render().submitOrder();
  assert.notEqual(harness.requests[0].jsonBody.requestId, harness.requests[1].jsonBody.requestId);
  assert.equal(harness.requests[1].jsonBody.orderId, null);
});

test("late submission completion cannot clear another customer's cart", async () => {
  let finish;
  const harness = createHarness(() => new Promise((resolve) => { finish = resolve; }));
  const submitting = harness.render().submitOrder();
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  harness.states[0] = 900;
  harness.states[2] = "customer:OTHER";
  harness.states[3] = { OTHER_SKU: 3 };
  harness.render("OTHER");
  finish({ payload: { orderId: 586, orderNumber: "O586" } });
  await submitting;
  const hook = harness.render("OTHER");
  assert.equal(hook.draftOrderId, 900);
  assert.equal(hook.orderItems[0].item_code, "OTHER_SKU");
  assert.equal(hook.orderItems[0].order_quantity, 3);
});

test("draft restoration skips already submitted rows, including late lines and history", () => {
  assert.equal((source.match(/completedOrderIds\.current\.has\(String\(order\.id\)\)/g) || []).length, 3);
  const page = fs.readFileSync(new URL("../app/management/new-order/page.js", import.meta.url), "utf8");
  assert.match(page, /const snapshot = buildOrderSnapshot\(saved\.orderId, "Submitted", saved\.orderNumber, saved\.visitDistance\)/);
});