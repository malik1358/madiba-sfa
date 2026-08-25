import test from "node:test";
import assert from "node:assert/strict";

import {
  needsEnglishTranslation,
  parseGoogleTranslatePayload,
  parseMyMemoryPayload,
} from "../app/lib/translateText.js";

test("needsEnglishTranslation detects missing or duplicate english remarks", () => {
  assert.equal(needsEnglishTranslation("", "Hello"), false);
  assert.equal(needsEnglishTranslation("مرحبا", ""), true);
  assert.equal(needsEnglishTranslation("مرحبا", "مرحبا"), true);
  assert.equal(needsEnglishTranslation("مرحبا", "Hello"), false);
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
