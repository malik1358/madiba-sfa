import test from "node:test";
import assert from "node:assert/strict";

import { needsEnglishTranslation } from "../app/lib/translateText.js";

test("needsEnglishTranslation detects missing or duplicate english remarks", () => {
  assert.equal(needsEnglishTranslation("", "Hello"), false);
  assert.equal(needsEnglishTranslation("مرحبا", ""), true);
  assert.equal(needsEnglishTranslation("مرحبا", "مرحبا"), true);
  assert.equal(needsEnglishTranslation("مرحبا", "Hello"), false);
});
