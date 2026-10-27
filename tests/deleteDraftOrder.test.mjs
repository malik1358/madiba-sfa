import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import { cancelQueuedSalesOrderDraft, isQueuedPendingOrderId } from "../app/lib/queuedSalesOrders.js";

const useOrderSource = fs.readFileSync(
  new URL("../app/management/customer-audit/hooks/useOrder.js", import.meta.url),
  "utf8",
);
const salesOrdersSource = fs.readFileSync(
  new URL("../app/api/sales-orders/route.js", import.meta.url),
  "utf8",
);
const newOrderSource = fs.readFileSync(
  new URL("../app/management/new-order/page.js", import.meta.url),
  "utf8",
);

test("sales-orders exposes delete_draft that cancels DRAFT only", () => {
  assert.match(salesOrdersSource, /action === "delete_draft"/);
  assert.match(salesOrdersSource, /Only draft orders can be deleted/);
  assert.match(salesOrdersSource, /action: "DELETED_DRAFT"/);
  assert.match(salesOrdersSource, /status: "CANCELLED"/);
  assert.match(salesOrdersSource, /\.eq\("status", "DRAFT"\)/);
});

test("New Order and Customer Audit expose Delete Draft for saved drafts", () => {
  assert.match(newOrderSource, /canDeleteDraft/);
  assert.match(newOrderSource, /handleDeleteDraft/);
  assert.match(newOrderSource, /Delete Draft/);
  assert.match(useOrderSource, /const deleteDraft = useCallback/);
  assert.match(useOrderSource, /cancelQueuedSalesOrderDraft/);
  assert.match(useOrderSource, /removeLocalPendingOrder/);
});

test("queued pending draft ids are recognized for local cancel", () => {
  assert.equal(isQueuedPendingOrderId("pending:abc123"), true);
  assert.equal(isQueuedPendingOrderId(586), false);
});

function createDeleteHarness({
  draftId = 586,
  status = "DRAFT",
  result = { payload: { orderId: 586, orderNumber: "O586", status: "CANCELLED" } },
  confirm = true,
} = {}) {
  const states = [draftId, "O586", "customer:1462", { SKU: 10 }, false, false, false, true, [{ action: "draft" }], status];
  const refs = [];
  const requests = [];
  const errors = [];
  const messages = [];
  const cancelledPending = [];
  const removedLocal = [];
  const removedQueue = [];
  let stateIndex = 0;
  let refIndex = 0;
  const context = vm.createContext({
    crypto: { randomUUID },
    navigator: { onLine: true },
    window: {
      confirm: () => confirm,
      dispatchEvent: () => {},
    },
    CustomEvent: class CustomEvent {
      constructor(type) {
        this.type = type;
      }
    },
    useState: (initial) => {
      const index = stateIndex++;
      if (index >= states.length) states[index] = initial;
      return [states[index], (value) => {
        states[index] = typeof value === "function" ? value(states[index]) : value;
      }];
    },
    useRef: (initial) => {
      const index = refIndex++;
      refs[index] ||= { current: initial };
      return refs[index];
    },
    useCallback: (callback) => callback,
    useMemo: (callback) => callback(),
    useEffect: () => {},
    getSupabaseClient: () => ({
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: "test-user" }, access_token: "test-token" } },
        }),
      },
    }),
    buildOrderItems: (quantities) => Object.entries(quantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([item_code, order_quantity]) => ({ item_code, order_quantity })),
    buildOrderSummary: (items) => ({ itemCount: items.length }),
    promptCustomerMobileUpdateIfMissing: async () => {},
    captureGpsLocationWithFallbackConfirm: async () => ({ latitude: 24, longitude: 46 }),
    resolveGpsCapturePlatform: async () => "web",
    loadVisitDistanceMetrics: async () => ({ distance: 0 }),
    loadWorkingHoursTillMessage: async () => ({}),
    buildCurrentWorkingHoursEntry: () => ({}),
    resolveOrderMakerFromScope: () => ({ salesmanCode: "OSAMA", salesmanName: "Osama" }),
    allocateLocalSalesOrderNumber: async () => "O586",
    rememberSalesmanOrderSequence: async () => {},
    getPrice: () => 100,
    normalizePaymentType: (value) => value,
    normalizePricingType: (value) => (value === "retail" ? "retail" : "wholesale"),
    priceOrderLines: (lines) => lines,
    postJsonResilient: async (request) => {
      requests.push(request);
      if (result instanceof Error) throw result;
      return typeof result === "function" ? result() : result;
    },
    buildQueuedPendingOrderId: (id) => `pending:${id}`,
    cancelQueuedSalesOrderDraft: async (id) => {
      cancelledPending.push(id);
      return true;
    },
    removeLocalPendingOrder: async (_userId, _scope, id) => {
      removedLocal.push(id);
      return true;
    },
    removeOfflineQueueItemById: async (id) => {
      removedQueue.push(id);
      return true;
    },
    upsertLocalPendingOrder: async () => {},
    requestLoginFirstCustomerHintCheck: () => {},
    friendlyErrorMessage: (error, fallback) => error?.message || fallback,
    blockedByAvgDaysMessage: () => "Blocked",
    isSalesOrderSubmissionBlocked: () => false,
    assertLocalOrderQuantityControls: async () => ({ ok: true }),
    recordConfirmedOrderQuantityUsage: () => {},
    claimUnsavedEntry: () => () => {},
    WORKING_HOURS_WHATSAPP_TIMEOUT_MS: 8000,
  });
  vm.runInContext(
    useOrderSource
      .replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/g, "")
      .replace("export function useOrder", "function useOrder"),
    context,
  );

  function render(customerCode = "1462") {
    stateIndex = 0;
    refIndex = 0;
    const hook = context.useOrder({
      selectedCustomer: { customer_code: customerCode, customer_name: "Alnazafuh Almukhtasuh" },
      priceList: {},
      accessScope: {},
      language: "en",
      setError: (message) => errors.push(message),
      setMessage: (message) => messages.push(message),
    });
    refs[0].current = `customer:${customerCode}`;
    return hook;
  }

  return {
    render,
    states,
    refs,
    requests,
    errors,
    messages,
    cancelledPending,
    removedLocal,
    removedQueue,
  };
}

test("deleteDraft cancels a server draft, clears the cart, and does not queue offline", async () => {
  const harness = createDeleteHarness();
  const hook = harness.render();
  const deleted = await hook.deleteDraft({ confirm: false, silent: true });
  assert.equal(deleted.orderId, 586);
  assert.equal(deleted.status, "CANCELLED");
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.requests[0].jsonBody.action, "delete_draft");
  assert.equal(harness.requests[0].queueFirst, false);
  assert.equal(harness.states[0], null);
  assert.equal(harness.states[3] && Object.keys(harness.states[3]).length, 0);
  assert.equal(harness.states[7], false);
  assert.deepEqual(harness.removedLocal, [586]);
});

test("deleteDraft refuses non-draft loaded orders", async () => {
  const harness = createDeleteHarness({ status: "SUBMITTED" });
  assert.equal(await harness.render().deleteDraft({ confirm: false }), null);
  assert.equal(harness.requests.length, 0);
  assert.match(harness.errors[0] || "", /Only draft orders can be deleted/);
});

test("deleteDraft cancels a local queued pending draft without calling the API", async () => {
  const harness = createDeleteHarness({ draftId: "pending:queue-1" });
  const deleted = await harness.render().deleteDraft({ confirm: false, silent: true });
  assert.equal(deleted.localOnly, true);
  assert.equal(harness.requests.length, 0);
  assert.deepEqual(harness.cancelledPending, ["pending:queue-1"]);
  assert.deepEqual(harness.removedLocal, ["pending:queue-1"]);
  assert.equal(harness.states[0], null);
});

test("deleteDraft aborts when the user cancels confirmation", async () => {
  const harness = createDeleteHarness({ confirm: false });
  assert.equal(await harness.render().deleteDraft(), null);
  assert.equal(harness.requests.length, 0);
});

test("cancelQueuedSalesOrderDraft is exported for offline draft cleanup", () => {
  assert.equal(typeof cancelQueuedSalesOrderDraft, "function");
});
