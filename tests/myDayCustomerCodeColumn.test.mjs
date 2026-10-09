import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../app/management/my-day/page.js", import.meta.url),
  "utf8",
);

test("My Day Visit Status displays each customer's code in a separate column", () => {
  assert.match(pageSource, /customerCode:\s*\{\s*en:\s*"Customer Code"/);
  assert.match(pageSource, /<th>\{t\("customerCode"\)\}<\/th>/);
  assert.match(pageSource, /<td>\{row\.customer_code \|\| "-"\}<\/td>/);
});
