import test from "node:test";
import assert from "node:assert/strict";

import {
  detectProfitColumn,
  findImportValue,
  findProfitAmount,
  parseImportNumber,
  summarizeProfitImport,
} from "../app/lib/salesImportHeaders.js";

test("findImportValue ignores extra spaces and punctuation", () => {
  const row = { " Party  Name ": "1224 SHOP" };
  assert.equal(findImportValue(row, ["Party Name"]), "1224 SHOP");
});

test("findProfitAmount reads common GP headers that are not an exact GP label", () => {
  assert.equal(findProfitAmount({ "GP Amt": 25 }), 25);
  assert.equal(findProfitAmount({ "G.P. Amount": 40 }), 40);
  assert.equal(findProfitAmount({ "Gross  Profit": 12 }), 12);
  assert.equal(findProfitAmount({ GrossProfit: 9 }), 9);
  assert.equal(findProfitAmount({ "Profit/Loss": 7 }), 7);
});

test("findProfitAmount skips percent columns and can use Margin amount", () => {
  assert.equal(findProfitAmount({ "GP %": 35, "Sales Amount": 100 }), null);
  assert.equal(detectProfitColumn({ "Margin %": 20 }), null);
  assert.equal(findProfitAmount({ Margin: 18 }), 18);
});

test("parseImportNumber reads accounting and currency cells", () => {
  assert.equal(parseImportNumber("(1,250.50)"), -1250.5);
  assert.equal(parseImportNumber("SAR 2,000"), 2000);
  assert.equal(parseImportNumber(15.25), 15.25);
});

test("summarizeProfitImport reports the matched column", () => {
  const source = [{ "Sales Amount": 100, "GP Amt": 30 }];
  const mapped = [{ profit_amount: 30 }];
  const summary = summarizeProfitImport(source, mapped);
  assert.equal(summary.profitColumn, "GP Amt");
  assert.equal(summary.profitRows, 1);
  assert.equal(summary.profitSum, 30);
});
