import test from "node:test";
import assert from "node:assert/strict";

import {
  claimUnsavedEntry,
  fieldIsDirty,
  hasOpenUnsavedEntry,
  isEditableControl,
  resetUnsavedEntryClaimsForTests,
} from "../app/lib/unsavedEntryGuard.js";

test("editable controls include text fields and skip submit buttons", () => {
  assert.equal(isEditableControl({ tagName: "INPUT", type: "text" }), true);
  assert.equal(isEditableControl({ tagName: "INPUT", type: "number" }), true);
  assert.equal(isEditableControl({ tagName: "TEXTAREA" }), true);
  assert.equal(isEditableControl({ tagName: "SELECT" }), true);
  assert.equal(isEditableControl({ tagName: "INPUT", type: "submit" }), false);
  assert.equal(isEditableControl({ tagName: "BUTTON" }), false);
});

test("fieldIsDirty compares current values to the original defaults", () => {
  assert.equal(fieldIsDirty({ type: "text", value: "Ahmad", defaultValue: "" }), true);
  assert.equal(fieldIsDirty({ type: "text", value: "", defaultValue: "" }), false);
  assert.equal(fieldIsDirty({ type: "checkbox", checked: true, defaultChecked: false }), true);
  assert.equal(fieldIsDirty({ type: "file", files: { length: 1 } }), true);
  assert.equal(fieldIsDirty({ type: "hidden", value: "x", defaultValue: "" }), false);
});

test("claimed entry work blocks a build reload until it is released", () => {
  resetUnsavedEntryClaimsForTests();
  assert.equal(hasOpenUnsavedEntry(null), false);

  const release = claimUnsavedEntry();
  assert.equal(hasOpenUnsavedEntry(null), true);

  release();
  assert.equal(hasOpenUnsavedEntry(null), false);
});

test("an open entry marker defers reload even without typed values", () => {
  resetUnsavedEntryClaimsForTests();
  const root = {
    querySelector(selector) {
      return selector === '[data-entry-form="open"]' ? {} : null;
    },
    querySelectorAll() {
      return [];
    },
    activeElement: null,
  };
  assert.equal(hasOpenUnsavedEntry(root), true);
});

test("no open form allows an immediate reload", () => {
  resetUnsavedEntryClaimsForTests();
  const root = {
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    activeElement: { tagName: "BODY" },
  };
  assert.equal(hasOpenUnsavedEntry(root), false);
});
