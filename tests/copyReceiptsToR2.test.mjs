import test from "node:test";
import assert from "node:assert/strict";
import {
  copyReceiptBatch,
  receiptDestinationKey,
  shouldStopCopy,
} from "../app/lib/storage/copyReceiptsToR2.js";

test("existing receipt filenames keep the approved R2 key", () => {
  assert.equal(
    receiptDestinationKey("receipt-copies/1114C-1720000000000-receipt.jpg"),
    "payment-collections/receipt-copies/1114C-1720000000000-receipt.jpg",
  );
  assert.throws(() => receiptDestinationKey("receipt-copies/2026/10/file.jpg"), /original filename/);
  assert.throws(() => receiptDestinationKey("payment-copies/file.jpg"), /original filename/);
});

test("a matching R2 object is reused and a different object is not overwritten", async () => {
  const store = new Map();
  const marked = [];
  const first = await copyReceiptBatch({
    names: ["receipt-copies/a.jpg"],
    download: async () => Buffer.from("receipt-a"),
    put: async (key, body) => {
      if (store.has(key)) throw Object.assign(new Error("exists"), { statusCode: 412 });
      store.set(key, Buffer.from(body));
    },
    get: async (key) => store.get(key),
    markVerified: async (key) => {
      marked.push(key);
      return 1;
    },
    timeBudgetMs: 5000,
  });
  assert.equal(first.copied, 1);
  assert.equal(first.verifiedRows, 1);
  assert.equal(marked[0], "payment-collections/receipt-copies/a.jpg");

  const second = await copyReceiptBatch({
    names: ["receipt-copies/a.jpg"],
    download: async () => Buffer.from("receipt-a"),
    put: async (key) => {
      if (store.has(key)) throw Object.assign(new Error("exists"), { statusCode: 412 });
    },
    get: async (key) => store.get(key),
    markVerified: async () => 1,
    timeBudgetMs: 5000,
  });
  assert.equal(second.already, 1);
  assert.equal(second.copied, 0);
  assert.equal(store.get("payment-collections/receipt-copies/a.jpg").toString(), "receipt-a");

  const conflict = await copyReceiptBatch({
    names: ["receipt-copies/a.jpg"],
    download: async () => Buffer.from("other"),
    put: async (key) => {
      if (store.has(key)) throw Object.assign(new Error("exists"), { statusCode: 412 });
    },
    get: async (key) => store.get(key),
    markVerified: async () => 1,
    timeBudgetMs: 5000,
  });
  assert.equal(conflict.stop, true);
  assert.equal(conflict.stopReason, "integrity");
  assert.equal(store.get("payment-collections/receipt-copies/a.jpg").toString(), "receipt-a");
});

test("widespread file failures stop the batch", () => {
  assert.equal(shouldStopCopy({ attempted: 20, fileFailures: 6 }), true);
  assert.equal(shouldStopCopy({ attempted: 10, fileFailures: 2 }), false);
  assert.equal(shouldStopCopy({ auth: 1 }), true);
});
