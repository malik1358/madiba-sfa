import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTallyOrderExportRows,
  chooseTallyLedgerName,
  ledgerNamesFromSalesRows,
  withTallyCatalogRates,
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
    order: {
      customer_name: "TEST CUST",
      salesman_code: "ALI",
      salesman_name: "Thamer",
      created_at: "2026-10-01T08:00:00Z",
    },
    lines: [{
      item_code: "A000057",
      item_name: "PAPER",
      quantity: 2,
      rate: 90,
      wholesaleRate: 100,
      discountPercent: 5,
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
  assert.equal(rows[0]["Charge.Ledgers VAT/Freight"], "");
  assert.equal(rows.length, 2);
  assert.equal(rows[1]["Charge.Ledgers VAT/Freight"], "Output VAT 15% - Non Food Division");
  assert.equal(rows[1].Amount, 27);
  assert.equal(rows[1]["Voucher Type Name"], "DAMMAM W/S CREDIT");
  assert.equal(rows[1]["CUSTOMER NAME"], "");
  assert.equal(rows[1]["Item Name"], "");
  assert.equal(rows[0].Barcode, "628000000001");
  assert.equal(rows[0]["Item Name"], "A000057_PAPERLINE");
  assert.equal(rows[0]["Barcode.Qty"], 2);
  assert.equal(rows[0]["Barcode.UOM"], "CTN");
  assert.equal(rows[0]["Billed Quantity"], 2);
  assert.equal(rows[0]["Item Rate"], 100);
  assert.equal(rows[0].Discount, 10);
  assert.equal(rows[0].godown, "DAMMAM W/H 1");
  assert.equal(rows[0]["SALES LEDGER"], "SALES WHOLESALE");
  assert.equal(rows[0]["SALES TEAM"], "Thamer");
  assert.equal(rows[0]["COST CENTER"], "OTHER");
  assert.equal(rows[0]["Tracking No."], "");
  assert.equal(rows[0].Amount, 180);
  assert.equal(rows[0]["VAT PERC"], 15);
  assert.equal(rows[1]["VAT PERC"], 15);
});

test("VAT PERC stays blank when the line has no VAT", () => {
  const rows = buildTallyOrderExportRows({
    order: { customer_name: "GLOVE CUST", salesman_name: "ALI" },
    lines: [{
      item_code: "G1",
      item_name: "MADIBA GLOVES",
      quantity: 2,
      rate: 10,
      category: "GLOVES",
    }],
    orderNumber: "SO-G",
    pricingRegion: "riyadh",
    paymentType: "cash",
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]["VAT PERC"], "");
});

test("catalog list rate is the item rate and discount is the per-unit gap", () => {
  const lines = withTallyCatalogRates(
    [{ item_code: "A005425", quantity: 100, rate: 55.81, line_value: 5581 }],
    {
      pricingRegion: "riyadh",
      pricingCatalog: { priceMap: { A005425: 64.48 }, regionPriceMaps: { riyadh: { A005425: 64.48 } } },
    },
  );
  const rows = buildTallyOrderExportRows({
    order: { customer_name: "LIB", salesman_name: "SM13", created_at: "2026-10-19T08:00:00Z" },
    lines,
    orderNumber: "PA95",
    pricingRegion: "riyadh",
    paymentType: "cash",
  });

  assert.equal(lines[0].wholesaleRate, 64.48);
  assert.equal(rows[0]["Item Rate"], 64.48);
  assert.equal(rows[0].Discount, 8.67);
  assert.equal(rows[0].Amount, 5581);
  assert.equal(rows[0]["SALES TEAM"], "SM13");
  assert.equal(rows.at(-1).Amount, 837.15);
  assert.equal(rows.at(-1)["Charge.Ledgers VAT/Freight"], "Output VAT 15% - Non Food Division");
});

test("customer name uses the imported Tally ledger, including its spacing", () => {
  const imported = [
    { customer_name: "AL-IBTIKAR LIBRARY FOR TRADING EST." },
    { customer_name: "1037  AL-IBTIKAR LIBRARY FOR TRADING EST." },
    { customer_name: "1037  AL-IBTIKAR LIBRARY FOR TRADING EST." },
    { source_data: { "Party Name": "1037 AL-IBTIKAR LIBRARY FOR TRADING EST." } },
  ];
  const ledgerName = chooseTallyLedgerName("1037", ledgerNamesFromSalesRows(imported));
  const rows = buildTallyOrderExportRows({
    order: {
      customer_code: "1037",
      customer_name: "AL-IBTIKAR LIBRARY FOR TRADING EST.",
      tally_ledger_name: ledgerName,
      salesman_name: "PARVEZ",
    },
    lines: [{ item_code: "A005425", item_name: "PAPER", quantity: 1, rate: 10, category: "PAPER" }],
    orderNumber: "PA95",
    pricingRegion: "riyadh",
    paymentType: "cash",
  });

  assert.equal(ledgerName, "1037  AL-IBTIKAR LIBRARY FOR TRADING EST.");
  assert.equal(rows[0]["CUSTOMER NAME"], "1037  AL-IBTIKAR LIBRARY FOR TRADING EST.");
  assert.equal(rows.at(-1)["CUSTOMER NAME"], "");
});
