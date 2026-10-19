import test from "node:test";
import assert from "node:assert/strict";

import {
  laterTransactionDate,
  resolveImportedBookOwner,
} from "../app/lib/customerBookOwner.js";

test("a new customer takes the invoice salesman", () => {
  assert.equal(resolveImportedBookOwner({
    invoiceSalesman: "junaid",
  }), "JUNAID");
});

test("an existing book owner is not replaced by a later invoice salesman", () => {
  assert.equal(resolveImportedBookOwner({
    existingSalesman: "PARVEZ",
    invoiceSalesman: "OSAMA",
  }), "PARVEZ");
});

test("an explicit transfer lock wins over both the stored owner and the invoice", () => {
  assert.equal(resolveImportedBookOwner({
    existingSalesman: "OSAMA",
    invoiceSalesman: "JUNAID",
    lockedSalesman: "PARVEZ",
  }), "PARVEZ");
});

test("a blank existing owner still accepts the invoice salesman", () => {
  assert.equal(resolveImportedBookOwner({
    existingSalesman: "  ",
    invoiceSalesman: "parvez",
  }), "PARVEZ");
});

test("latest transaction date never moves backward", () => {
  assert.equal(laterTransactionDate("2026-03-10", "2025-12-02"), "2026-03-10");
  assert.equal(laterTransactionDate("2025-12-02", "2026-03-10"), "2026-03-10");
  assert.equal(laterTransactionDate("", "2026-03-10"), "2026-03-10");
  assert.equal(laterTransactionDate("2026-03-10", ""), "2026-03-10");
});
