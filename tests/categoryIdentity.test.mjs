import test from "node:test";
import assert from "node:assert/strict";

import {
  UNCLASSIFIED_CATEGORY,
  canonicalizeCategoryLabel,
  categoryArabicLabel,
  formatCategoryBilingual,
  normalizeCategoryName,
  titleCaseCategoryLabel,
} from "../app/lib/categoryIdentity.js";

test("title-case collapses casing variants and keeps POS", () => {
  assert.equal(titleCaseCategoryLabel("baby Care"), "Baby Care");
  assert.equal(titleCaseCategoryLabel("office supplies"), "Office Supplies");
  assert.equal(titleCaseCategoryLabel("pos supplies"), "POS Supplies");
  assert.equal(titleCaseCategoryLabel("  sundry  "), "Sundry");
});

test("canonicalize merges casing and Body Care → Personal Care", () => {
  assert.equal(canonicalizeCategoryLabel("baby Care"), "Baby Care");
  assert.equal(canonicalizeCategoryLabel("Baby Care"), "Baby Care");
  assert.equal(canonicalizeCategoryLabel("body care"), "Personal Care");
  assert.equal(canonicalizeCategoryLabel("Body Care"), "Personal Care");
  assert.equal(canonicalizeCategoryLabel(""), UNCLASSIFIED_CATEGORY);
});

test("normalizeCategoryName keeps legacy casing when no alias", () => {
  assert.equal(normalizeCategoryName("baby Care"), "baby Care");
  assert.equal(normalizeCategoryName("Body Care"), "Personal Care");
});

test("bilingual category labels show English / Arabic", () => {
  assert.equal(categoryArabicLabel("Baby Care"), "العناية بالطفل");
  assert.equal(formatCategoryBilingual("baby Care"), "Baby Care / العناية بالطفل");
  assert.equal(formatCategoryBilingual("Body Care"), "Personal Care / العناية الشخصية");
  assert.equal(formatCategoryBilingual("Office supplies"), "Office Supplies / مستلزمات المكتب");
  assert.equal(formatCategoryBilingual("Unknown Niche"), "Unknown Niche");
});
