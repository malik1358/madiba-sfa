import test from "node:test";
import assert from "node:assert/strict";
import {
  attachRecentSalesValues,
  summarizeCustomersFromSalesRows,
} from "../app/lib/recentSalesAggregate.js";

const customers = [{ customer_code: "1511", latest_transaction_date: "2026-01-01" }];
const salesRows = [
  {
    id: 1,
    import_batch_id: 1,
    transaction_date: "2026-09-01",
    voucher_number: "A",
    reference: "R",
    customer_code: "1511",
    item_code: "I",
    quantity: "1.0000",
    sales_amount: "10.0000",
  },
  {
    id: 2,
    import_batch_id: 2,
    transaction_date: "2026-09-01",
    voucher_number: "A",
    reference: "R",
    customer_code: "1511",
    item_code: "I",
    quantity: "1.0000",
    sales_amount: "10.0000",
  },
  {
    id: 3,
    import_batch_id: 2,
    transaction_date: "2026-10-01",
    voucher_number: "B",
    reference: "R2",
    customer_code: "1511",
    item_code: "I2",
    quantity: "2.0000",
    sales_amount: "5.5000",
  },
  {
    id: 4,
    import_batch_id: 1,
    transaction_date: "2026-08-01",
    voucher_number: "C",
    reference: "R3",
    customer_code: "1511",
    item_code: "I3",
    quantity: "1.0000",
    sales_amount: "-3.0000",
  },
];

test("six-month totals keep the winning snapshot and ignore negative amounts", () => {
  const [row] = summarizeCustomersFromSalesRows(customers, salesRows, {
    fromDate: "2026-04-23",
    from30Iso: "2026-09-23",
  });

  assert.equal(row.recent_sales_value, 15.5);
  assert.equal(row.recent_30d_sales_value, 5.5);
  assert.equal(row.highest_monthly_sales, 10);
  assert.equal(row.operational_months, 2);
  assert.equal(row.average_monthly_purchase, 7.75);
  assert.equal(row.latest_transaction_date, "2026-10-01");
});

test("grouped totals produce the same customer figures as the line merge", async () => {
  const [expected] = summarizeCustomersFromSalesRows(customers, salesRows, {
    fromDate: "2026-04-23",
    from30Iso: "2026-09-23",
  });
  const admin = {
    async rpc(name, args) {
      assert.equal(name, "recent_sales_customer_totals");
      assert.deepEqual(args.customer_codes, ["1511"]);
      return {
        error: null,
        data: [{
          customer_code: "1511",
          recent_sales_value: "15.5000",
          recent_30d_sales_value: "5.5000",
          latest_transaction_date: "2026-10-01",
          positive_sales_by_month: { "2026-09": "10.0000", "2026-10": "5.5000" },
        }],
      };
    },
    from() {
      throw new Error("line pagination should not run when the totals function exists");
    },
  };

  const [row] = await attachRecentSalesValues(admin, customers);
  assert.equal(row.recent_sales_value, expected.recent_sales_value);
  assert.equal(row.recent_30d_sales_value, expected.recent_30d_sales_value);
  assert.equal(row.average_monthly_purchase, expected.average_monthly_purchase);
  assert.equal(row.highest_monthly_sales, expected.highest_monthly_sales);
  assert.equal(row.operational_months, expected.operational_months);
  assert.equal(row.latest_transaction_date, expected.latest_transaction_date);
});

test("missing totals function falls back to merged sales lines", async () => {
  const admin = {
    async rpc() {
      return {
        data: null,
        error: { code: "PGRST202", message: "Could not find the function public.recent_sales_customer_totals" },
      };
    },
    from(table) {
      assert.equal(table, "sales_raw");
      return {
        select() { return this; },
        gte() { return this; },
        in() { return this; },
        order() { return this; },
        range: async () => ({ data: salesRows, error: null }),
      };
    },
  };

  const [row] = await attachRecentSalesValues(admin, customers);
  assert.equal(row.recent_sales_value, 15.5);
  assert.equal(row.recent_30d_sales_value, 5.5);
  assert.equal(row.latest_transaction_date, "2026-10-01");
});
