import test from "node:test";
import assert from "node:assert/strict";

import {
  clearTranslationCache,
  needsEnglishTranslation,
  parseGoogleTranslatePayload,
  parseMyMemoryPayload,
} from "../app/lib/translateText.js";

test("needsEnglishTranslation always refreshes when Arabic remark is present", () => {
  assert.equal(needsEnglishTranslation("", "Hello"), false);
  assert.equal(needsEnglishTranslation("مرحبا", ""), true);
  assert.equal(needsEnglishTranslation("مرحبا", "مرحبا"), true);
  // Stale English from a previous Arabic remark must still be refreshed.
  assert.equal(needsEnglishTranslation("مرحبا", "Will transfer today."), true);
  assert.equal(needsEnglishTranslation("حالة وفاة", "Hello"), true);
});

test("parseGoogleTranslatePayload joins translated segments", () => {
  const payload = [[["Hello", "مرحبا", null, 0]], null, "ar"];
  assert.equal(parseGoogleTranslatePayload(payload), "Hello");
});

test("parseMyMemoryPayload ignores quota warning responses", () => {
  assert.equal(
    parseMyMemoryPayload({
      responseData: {
        translatedText: "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY.",
      },
    }),
    "",
  );
  assert.equal(
    parseMyMemoryPayload({
      responseData: {
        translatedText: "He was contacted via mobile.",
      },
    }),
    "He was contacted via mobile.",
  );
});

test("clearTranslationCache is available for tests", () => {
  clearTranslationCache();
  assert.equal(typeof clearTranslationCache, "function");
});
