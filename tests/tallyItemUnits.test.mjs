import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTallyOrderExportRows,
  resolveTallySalesRouting,
  resolveTallyVoucherSetup,
  TALLY_EXPORT_COLUMNS,
} from "../app/lib/tallyItemUnits.js";

test("Table 1 maps region, payment, and BM voucher type", () => {
  assert.deepEqual(
    resolveTallyVoucherSetup({ pricingRegion: "riyadh", paymentType: "credit" }),
    { voucherType: "RIYADH W/S CREDIT", priceList: "RIYADH W/S", salesLedger: "SALES WHOLESALE" },
  );
  assert.equal(
    resolveTallyVoucherSetup({ pricingRegion: "dammam", paymentType: "cash" }).voucherType,
    "DAMMAM CASH SALES",
  );
  assert.equal(
    resolveTallyVoucherSetup({ pricingRegion: "jeddah", paymentType: "credit" }).priceList,
    "JEDDAH W/S",
  );
  assert.equal(
    resolveTallyVoucherSetup({
      pricingRegion: "riyadh",
      paymentType: "credit",
      routing: resolveTallySalesRouting({ salesman_code: "ZIA" }, "riyadh"),
    }).voucherType,
    "SALES NON FOOD DIVISION",
  );
  assert.equal(
    resolveTallyVoucherSetup({ pricingRegion: "riyadh", channel: "retail" }).priceList,
    "RIYADH RETAIL",
  );
  assert.equal(
    resolveTallyVoucherSetup({ pricingRegion: "riyadh", channel: "ecomm" }).salesLedger,
    "SALES ONLINE",
  );
});

test("export rows use the Tally voucher columns", () => {
  const rows = buildTallyOrderExportRows({
    order: { customer_name: "TEST CUST", salesman_code: "ALI", created_at: "2026-10-01T08:00:00Z" },
    lines: [{
      item_code: "A000057",
      item_name: "PAPER",
      quantity: 2,
      rate: 90,
      wholesaleRate: 100,
      category: "PAPER",
      barcode: "628000000001",
    }],
    unitMap: { A000057: { tally_unit: "CTN", tally_item_name: "A000057_PAPERLINE" } },
    orderNumber: "SO-1",
    pricingRegion: "dammam",
    paymentType: "credit",
    exportDate: new Date("2026-10-16T08:00:00Z"),
    orderDate: "2026-10-01T08:00:00Z",
  });

  assert.deepEqual(Object.keys(rows[0]), TALLY_EXPORT_COLUMNS);
  assert.equal(rows[0]["Voucher Type Name"], "DAMMAM W/S CREDIT");
  assert.equal(rows[0].PriceListName, "DAMMAM W/S");
  assert.equal(rows[0]["Voucher.Class"], "e.Invoice.Integration Phase");
  assert.equal(rows[0]["Voucher Number"], "");
  assert.equal(rows[0]["Ref.No"], "SO-1");
  assert.equal(rows[0]["order no"], "SO-1");
  assert.equal(rows[0]["CUSTOMER NAME"], "TEST CUST");
  assert.equal(rows[0]["Charge.Ledgers VAT/Freight"], "Output VAT 15% - Non Food Division");
  assert.equal(rows[0].Barcode, "628000000001");
  assert.equal(rows[0]["Item Name"], "A000057_PAPERLINE");
  assert.equal(rows[0]["Barcode.Qty"], 2);
  assert.equal(rows[0]["Barcode.UOM"], "CTN");
  assert.equal(rows[0]["Billed Quantity"], 2);
  assert.equal(rows[0]["Item Rate"], 100);
  assert.equal(rows[0].Discount, 10);
  assert.equal(rows[0].godown, "DAMMAM W/H 1");
  assert.equal(rows[0]["SALES LEDGER"], "SALES WHOLESALE");
  assert.equal(rows[0]["SALES TEAM"], "OTHER THAN ZIA & ASRAR");
  assert.equal(rows[0]["COST CENTER"], "OTHER");
  assert.equal(rows[0]["Tracking No."], "");
});
