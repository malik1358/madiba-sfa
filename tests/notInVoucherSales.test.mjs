import test from "node:test";
import assert from "node:assert/strict";
import {
  groupNotInVoucherVouchers,
  isNotInVoucherSalesRow,
  summarizeNotInVoucherVouchers,
} from "../app/lib/notInVoucherSales.js";
import {
  buildNotInVoucherEmail,
  notInVoucherEmailCc,
  notInVoucherEmailRecipients,
} from "../app/lib/notInVoucherEmail.js";

test("isNotInVoucherSalesRow matches salesman code or name", () => {
  assert.equal(isNotInVoucherSalesRow({ salesman_code: "NOT IN VOUCHER" }), true);
  assert.equal(isNotInVoucherSalesRow({ salesman_name: "not in voucher" }), true);
  assert.equal(isNotInVoucherSalesRow({ salesman_code: "ZIA" }), false);
});

test("groupNotInVoucherVouchers collapses lines and ignores other salesmen", () => {
  const vouchers = groupNotInVoucherVouchers([
    {
      transaction_date: "2026-10-15",
      voucher_number: "DN/001",
      voucher_type: "Debit Note",
      customer_code: "1171",
      customer_name: "Riyadh Store",
      category: "Sundry",
      salesman_code: "NOT IN VOUCHER",
      sales_amount: 1000,
      profit_amount: -50,
      quantity: 2,
    },
    {
      transaction_date: "2026-10-15",
      voucher_number: "DN/001",
      voucher_type: "Debit Note",
      customer_code: "1171",
      customer_name: "Riyadh Store",
      category: "Personal Care",
      salesman_name: "NOT IN VOUCHER",
      sales_amount: 500,
      profit_amount: 20,
      quantity: 1,
    },
    {
      transaction_date: "2026-10-15",
      voucher_number: "SI/9",
      voucher_type: "Sales",
      customer_code: "1",
      salesman_code: "ZIA",
      sales_amount: 999,
      profit_amount: 1,
      quantity: 1,
    },
  ]);
  assert.equal(vouchers.length, 1);
  assert.equal(vouchers[0].lineCount, 2);
  assert.equal(vouchers[0].salesAmount, 1500);
  assert.deepEqual(vouchers[0].categories, ["Personal Care", "Sundry"]);
  assert.equal(summarizeNotInVoucherVouchers(vouchers).voucherCount, 1);
});

test("buildNotInVoucherEmail and recipients default to Malik", () => {
  const mail = buildNotInVoucherEmail({
    date: "2026-10-15",
    vouchers: [{
      transactionDate: "2026-10-15",
      voucherNumber: "DN/001",
      voucherType: "Debit Note",
      customerCode: "1171",
      customerName: "Riyadh Store",
      categories: ["Sundry"],
      lineCount: 2,
      salesAmount: 1500,
    }],
    env: { APP_ORIGIN: "https://madiba-sfa.vercel.app" },
  });
  assert.match(mail.subject, /NOT IN VOUCHER/);
  assert.match(mail.html, /DN\/001/);
  assert.deepEqual(notInVoucherEmailRecipients({}), ["malik@pinasz.com"]);
  assert.deepEqual(notInVoucherEmailCc({}, ["malik@pinasz.com"]), [
    "vinit.kulkarni@noorshukran.com",
    "badrish.thapliyal@noorshukran.com",
  ]);
  assert.deepEqual(
    notInVoucherEmailCc({ NOT_IN_VOUCHER_EMAIL_TEST_TO: "only@pinasz.com" }, ["only@pinasz.com"]),
    [],
  );
});
