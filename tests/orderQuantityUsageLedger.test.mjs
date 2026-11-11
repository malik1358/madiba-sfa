import test from "node:test";
import assert from "node:assert/strict";

import {
  ORDER_QUANTITY_USAGE_LEGACY_LOCAL_KEY,
  ORDER_QUANTITY_USAGE_LOCAL_KEY,
  readConfirmedOrderQuantityUsage,
  recordConfirmedOrderQuantityUsage,
  releaseConfirmedOrderQuantityUsage,
} from "../app/lib/orderQuantityControlsClient.js";

const WEEK = "2026-11-09T21:00:00.000Z";

function installMemoryStorage() {
  const storage = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => { storage.set(key, String(value)); },
      removeItem: (key) => { storage.delete(key); },
    },
  };
  return storage;
}

function uninstallMemoryStorage() {
  delete globalThis.window;
}

test("v2 ledger upserts by order id instead of accumulating re-saves", () => {
  installMemoryStorage();
  try {
    recordConfirmedOrderQuantityUsage({
      customerCode: "1534",
      orderId: 1158,
      weekStartIso: WEEK,
      lines: [
        { item_code: "A006298", quantity: 40 },
        { item_code: "A006299", quantity: 40 },
        { item_code: "A006300", quantity: 20 },
      ],
    });
    recordConfirmedOrderQuantityUsage({
      customerCode: "1534",
      orderId: 1158,
      weekStartIso: WEEK,
      lines: [
        { item_code: "A006298", quantity: 40 },
        { item_code: "A006299", quantity: 40 },
        { item_code: "A006300", quantity: 20 },
      ],
    });

    assert.deepEqual(
      readConfirmedOrderQuantityUsage({ customerCode: "1534", weekStartIso: WEEK }),
      { A006298: 40, A006299: 40, A006300: 20 },
    );
  } finally {
    uninstallMemoryStorage();
  }
});

test("releasing a cancelled draft frees the weekly glove remaining qty", () => {
  installMemoryStorage();
  try {
    recordConfirmedOrderQuantityUsage({
      customerCode: "1534",
      orderId: "1158",
      weekStartIso: WEEK,
      lines: [
        { item_code: "A006298", quantity: 40 },
        { item_code: "A006299", quantity: 40 },
        { item_code: "A006300", quantity: 20 },
      ],
    });

    assert.equal(
      releaseConfirmedOrderQuantityUsage({
        customerCode: "1534",
        orderId: 1158,
        weekStartIso: WEEK,
      }),
      true,
    );

    assert.deepEqual(
      readConfirmedOrderQuantityUsage({ customerCode: "1534", weekStartIso: WEEK }),
      {},
    );
  } finally {
    uninstallMemoryStorage();
  }
});

test("excludeOrderId ignores the draft being edited so 100 CTN can be re-saved", () => {
  installMemoryStorage();
  try {
    recordConfirmedOrderQuantityUsage({
      customerCode: "1534",
      orderId: "1158",
      weekStartIso: WEEK,
      lines: [
        { item_code: "A006298", quantity: 40 },
        { item_code: "A006299", quantity: 40 },
        { item_code: "A006300", quantity: 20 },
      ],
    });

    assert.deepEqual(
      readConfirmedOrderQuantityUsage({
        customerCode: "1534",
        weekStartIso: WEEK,
        excludeOrderId: "1158",
      }),
      {},
    );
  } finally {
    uninstallMemoryStorage();
  }
});

test("reading the v2 ledger clears the stale v1 flat totals", () => {
  const storage = installMemoryStorage();
  try {
    storage.set(ORDER_QUANTITY_USAGE_LEGACY_LOCAL_KEY, JSON.stringify({
      weekStartIso: WEEK,
      byCustomer: {
        1534: { A006298: 40, A006299: 40, A006300: 20 },
      },
    }));

    assert.deepEqual(
      readConfirmedOrderQuantityUsage({ customerCode: "1534", weekStartIso: WEEK }),
      {},
    );
    assert.equal(storage.has(ORDER_QUANTITY_USAGE_LEGACY_LOCAL_KEY), false);
    assert.equal(storage.has(ORDER_QUANTITY_USAGE_LOCAL_KEY), false);
  } finally {
    uninstallMemoryStorage();
  }
});

test("recording bare id drops the matching pending: alias so qty is not doubled", () => {
  installMemoryStorage();
  try {
    recordConfirmedOrderQuantityUsage({
      customerCode: "1534",
      orderId: "pending:1158",
      weekStartIso: WEEK,
      lines: [{ item_code: "A006299", quantity: 100 }],
    });
    recordConfirmedOrderQuantityUsage({
      customerCode: "1534",
      orderId: "1158",
      weekStartIso: WEEK,
      lines: [{ item_code: "A006299", quantity: 100 }],
    });

    assert.deepEqual(
      readConfirmedOrderQuantityUsage({ customerCode: "1534", weekStartIso: WEEK }),
      { A006299: 100 },
    );
  } finally {
    uninstallMemoryStorage();
  }
});
