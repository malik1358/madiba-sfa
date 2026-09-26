import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { resolveExistingCollectionCustomerCode } from "../app/api/payment-collections/route.js";

test("resolveExistingCollectionCustomerCode reuses suffix account variants like 1608C", () => {
  assert.equal(resolveExistingCollectionCustomerCode(["1608C"], "1608"), "1608C");
  assert.equal(resolveExistingCollectionCustomerCode(["1608", "1608C"], "1608"), "1608C");
});

test("resolveExistingCollectionCustomerCode avoids unrelated numeric prefixes", () => {
  assert.equal(resolveExistingCollectionCustomerCode(["16080", "16081"], "1608"), "");
});

test("collection save path reuses the matched customer code before insert", () => {
  const source = fs.readFileSync(new URL("../app/api/payment-collections/route.js", import.meta.url), "utf8");
  assert.match(source, /customerCode\s*=\s*await ensureCollectionCustomerRecord\(admin,\s*customerCode,\s*customerName\)/);
});
