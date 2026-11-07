import assert from "node:assert/strict";
import test from "node:test";
import {
  reverseArabicPreservingDigits,
  splitPdfTextRuns,
} from "../app/lib/pdfArabicText.js";

test("Arabic visual reverse keeps Eastern digit amounts in logical order", () => {
  // Naive reverse of ٥,٤٩١.٨٠ is ٠٨.١٩٤,٥ — the bug that made Arabic closing
  // balance disagree with English (5,491.80 vs 5,194.08) on customer 1592.
  assert.equal(reverseArabicPreservingDigits("٥,٤٩١.٨٠"), "٥,٤٩١.٨٠");
  assert.equal(reverseArabicPreservingDigits("٤٢١"), "٤٢١");
  assert.equal(reverseArabicPreservingDigits("١٥٩٢"), "١٥٩٢");
  assert.equal(reverseArabicPreservingDigits("٢٠٢٦"), "٢٠٢٦");
  assert.equal(reverseArabicPreservingDigits("١٣"), "١٣");
});

test("Arabic visual reverse still mirrors letters for LTR PDF drawing", () => {
  assert.equal(reverseArabicPreservingDigits("مدين"), "نيدم");
  assert.equal(reverseArabicPreservingDigits("٨٠ مدين"), "نيدم ٨٠");
  assert.equal(
    reverseArabicPreservingDigits("رصيد ٥,٤٩١.٨٠ مدين"),
    "نيدم ٥,٤٩١.٨٠ ديصر",
  );
});

test("Eastern digit runs are classified as Arabic (Unicode block) but stay readable after reverse", () => {
  const runs = splitPdfTextRuns("RNFD/٤٢١");
  assert.deepEqual(runs, [
    { text: "RNFD/", arabic: false },
    { text: "٤٢١", arabic: true },
  ]);
  assert.equal(reverseArabicPreservingDigits(runs[1].text), "٤٢١");
});
