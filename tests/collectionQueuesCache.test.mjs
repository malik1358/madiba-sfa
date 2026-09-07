import test from "node:test";
import assert from "node:assert/strict";

import { collectionQueuesHaveRows } from "../app/lib/mobileDataCache.js";

test("collectionQueuesHaveRows is false for empty or missing queues", () => {
  assert.equal(collectionQueuesHaveRows(null), false);
  assert.equal(collectionQueuesHaveRows({}), false);
  assert.equal(collectionQueuesHaveRows({
    dueCustomers: [],
    notDueCustomers: [],
    legalCustomers: [],
  }), false);
});

test("collectionQueuesHaveRows is true when any queue bucket has customers", () => {
  assert.equal(collectionQueuesHaveRows({
    dueCustomers: [{ customer_code: "1001" }],
    notDueCustomers: [],
    legalCustomers: [],
  }), true);
  assert.equal(collectionQueuesHaveRows({
    dueCustomers: [],
    notDueCustomers: [{ customer_code: "1002" }],
    legalCustomers: [],
  }), true);
  assert.equal(collectionQueuesHaveRows({
    dueCustomers: [],
    notDueCustomers: [],
    legalCustomers: [{ customer_code: "1003" }],
  }), true);
});
