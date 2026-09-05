import test from "node:test";
import assert from "node:assert/strict";
import {
  NEXT_VISIT_PAST_ERROR,
  NEXT_VISIT_REQUIRED_ERROR,
  normalizeDateOnly,
  nextVisitDateInputValue,
  validateNextVisitDate,
} from "../app/lib/nextVisitDate.js";

test("normalizeDateOnly keeps YYYY-MM-DD and strips time", () => {
  assert.equal(normalizeDateOnly("2026-08-25"), "2026-08-25");
  assert.equal(normalizeDateOnly("2026-08-25T10:00:00Z"), "2026-08-25");
  assert.equal(normalizeDateOnly(""), "");
  assert.equal(normalizeDateOnly("not-a-date"), "");
});

test("nextVisitDateInputValue clears overdue dates for new scheduling", () => {
  assert.equal(nextVisitDateInputValue("2026-08-25", "2026-09-05"), "");
  assert.equal(nextVisitDateInputValue("2026-09-05", "2026-09-05"), "2026-09-05");
  assert.equal(nextVisitDateInputValue("2026-09-10", "2026-09-05"), "2026-09-10");
});

test("validateNextVisitDate rejects past dates and empty when required", () => {
  assert.equal(validateNextVisitDate("2026-09-05", { todayKey: "2026-09-05" }), "2026-09-05");
  assert.equal(validateNextVisitDate("2026-09-06", { todayKey: "2026-09-05" }), "2026-09-06");
  assert.equal(validateNextVisitDate("", { todayKey: "2026-09-05" }), null);

  assert.throws(
    () => validateNextVisitDate("2026-08-25", { todayKey: "2026-09-05" }),
    (error) => error.message === NEXT_VISIT_PAST_ERROR,
  );
  assert.throws(
    () => validateNextVisitDate("", { required: true, todayKey: "2026-09-05" }),
    (error) => error.message === NEXT_VISIT_REQUIRED_ERROR,
  );
});
