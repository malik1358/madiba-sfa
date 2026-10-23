import test from "node:test";
import assert from "node:assert/strict";
import {
  excelDateToIso,
  findReceiptHeaderRow,
  isPaymentVoucherType,
  mergeReceiptDatasets,
  parseParticularsParty,
  parseReceiptRegisterRows,
  paymentRegisterTemplateMatrix,
  prioritizeReceiptSheets,
  receiptRegisterTemplateMatrix,
  receiptRowIdentity,
  stripPaymentVoucherRows,
  removeUnanchoredDuplicateReceipts,
} from "../app/lib/receiptRegister.js";

const NEW_FORMAT_HEADER = [
  "TRANSACTIONDATE",
  "VOUCHERTYPENAME",
  "VOUCHERNUMBER",
  "LEDGERNAME",
  "Cr",
];

const PAYMENT_FORMAT_HEADER = [
  "TRANSACTIONDATE",
  "VOUCHERTYPENAME",
  "VOUCHERNUMBER",
  "LEDGERNAME",
  "Dr",
];

test("findReceiptHeaderRow accepts the TRANSACTIONDATE / LEDGERNAME / Cr export", () => {
  const header = findReceiptHeaderRow([
    ["ignored"],
    NEW_FORMAT_HEADER,
  ]);

  assert.ok(header);
  assert.equal(header.headerRowIndex, 1);
  assert.equal(header.columns.date, 0);
  assert.equal(header.columns.vchType, 1);
  assert.equal(header.columns.vchNo, 2);
  assert.equal(header.columns.particulars, 3);
  assert.equal(header.columns.credit, 4);
});

test("findReceiptHeaderRow accepts Payment Register Dr-only exports", () => {
  const header = findReceiptHeaderRow([
    PAYMENT_FORMAT_HEADER,
  ]);

  assert.ok(header);
  assert.equal(header.columns.debit, 4);
  assert.equal(header.columns.credit, -1);
});

test("isPaymentVoucherType detects Payment voucher labels", () => {
  assert.equal(isPaymentVoucherType("Payment"), true);
  assert.equal(isPaymentVoucherType("Payment Voucher"), true);
  assert.equal(isPaymentVoucherType("Bank Payment"), true);
  assert.equal(isPaymentVoucherType("Receipt"), false);
  assert.equal(isPaymentVoucherType("JV-Collection"), false);
  assert.equal(isPaymentVoucherType("NSTC JV"), false);
});

test("parseReceiptRegisterRows keeps collection voucher types and skips Payment by default", () => {
  const lookup = {
    byCode: new Map([
      ["1006", { customer_code: "1006", customer_name: "ABDULLAH HAMAD AL DAKHEEL TRADING EST." }],
      ["1144", { customer_code: "1144", customer_name: "HELAL ALSAIF TRADING Est" }],
    ]),
    byName: new Map(),
  };

  const parsed = parseReceiptRegisterRows([
    NEW_FORMAT_HEADER,
    [new Date("2026-01-01T00:00:00.000Z"), "Receipt", "1", "1006  ABDULLAH HAMAD AL DAKHEEL TRADING EST.", 500],
    [new Date("2026-01-01T00:00:00.000Z"), "Receipt", "2", "Uncleared Payments of Clients", 1038.5],
    [new Date("2026-01-08T00:00:00.000Z"), "JV-Collection", "45", "1144  HELAL ALSAIF TRADING Est", 837.2],
    [new Date("2026-01-09T00:00:00.000Z"), "NSTC JV", "JV/AUG/00034", "1006  ABDULLAH HAMAD AL DAKHEEL TRADING EST.", 11782.25],
    [new Date("2026-01-10T00:00:00.000Z"), "Payment", "99", "1006  ABDULLAH HAMAD AL DAKHEEL TRADING EST.", 10],
  ], null, lookup);

  assert.equal(parsed.rows.length, 4);
  assert.equal(parsed.skippedPaymentCount, 1);
  assert.deepEqual(parsed.dates, ["2026-01-01", "2026-01-08", "2026-01-09"]);
  assert.equal(parsed.rows[0].receipt_date, "2026-01-01");
  assert.equal(parsed.rows[0].customer_code, "1006");
  assert.equal(parsed.rows[0].vch_no, "1");
  assert.equal(parsed.rows[0].amount, 500);
  assert.equal(parsed.rows[0].matched, true);
  assert.equal(parsed.rows[1].customer_code, "");
  assert.equal(parsed.rows[1].matched, false);
  assert.equal(parsed.rows[2].vch_type, "JV-Collection");
  assert.equal(parsed.rows[2].customer_code, "1144");
  assert.equal(parsed.rows[2].amount, 837.2);
  assert.equal(parsed.rows[3].vch_type, "NSTC JV");
  assert.equal(parsed.rows[3].customer_code, "1006");
  assert.equal(parsed.rows[3].amount, 11782.25);
  assert.equal(parsed.matchedCount, 3);
  assert.equal(parsed.unmatchedCount, 1);
});

test("parseReceiptRegisterRows imports Payment vouchers when opted in", () => {
  const lookup = {
    byCode: new Map([
      ["1006", { customer_code: "1006", customer_name: "ABDULLAH HAMAD AL DAKHEEL TRADING EST." }],
    ]),
    byName: new Map(),
  };

  const parsed = parseReceiptRegisterRows([
    NEW_FORMAT_HEADER,
    [new Date("2026-01-01T00:00:00.000Z"), "Receipt", "1", "1006  ABDULLAH HAMAD AL DAKHEEL TRADING EST.", 500],
    [new Date("2026-01-10T00:00:00.000Z"), "Payment", "99", "1006  ABDULLAH HAMAD AL DAKHEEL TRADING EST.", 10],
  ], null, lookup, { includePaymentVouchers: true });

  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.skippedPaymentCount, 0);
  assert.equal(parsed.rows[1].vch_type, "Payment");
  assert.equal(parsed.rows[1].customer_code, "1006");
  assert.equal(parsed.rows[1].amount, -10);
});

test("parseReceiptRegisterRows imports Payment Register Dr amounts as negative when opted in", () => {
  const lookup = {
    byCode: new Map([
      ["1415", { customer_code: "1415", customer_name: "DUAL PARTY TRADING" }],
    ]),
    byName: new Map(),
  };

  const parsed = parseReceiptRegisterRows([
    PAYMENT_FORMAT_HEADER,
    [new Date("2026-02-05T00:00:00.000Z"), "Payment", "PV/102", "1415  DUAL PARTY TRADING", 2500],
  ], null, lookup, { includePaymentVouchers: true });

  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].vch_type, "Payment");
  assert.equal(parsed.rows[0].customer_code, "1415");
  assert.equal(parsed.rows[0].vch_no, "PV/102");
  assert.equal(parsed.rows[0].amount, -2500);
  assert.equal(parsed.rows[0].matched, true);
});

test("parseReceiptRegisterRows skips Payment Register rows when option is off", () => {
  const parsed = parseReceiptRegisterRows([
    PAYMENT_FORMAT_HEADER,
    [new Date("2026-02-05T00:00:00.000Z"), "Payment", "PV/102", "1415  DUAL PARTY TRADING", 2500],
  ], null, null, { includePaymentVouchers: false });

  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.skippedPaymentCount, 1);
});

test("parseReceiptRegisterRows stores a debit as a negative receipt and a credit as a receipt", () => {
  const lookup = {
    byCode: new Map([
      ["1075C", { customer_code: "1075C", customer_name: "Asl Al Maarifa company Limited" }],
    ]),
    byName: new Map(),
  };
  const parsed = parseReceiptRegisterRows([
    ["TRANSACTIONDATE", "VOUCHERTYPENAME", "VOUCHERNUMBER", "LEDGERNAME", "Dr", "Cr"],
    [new Date("2025-10-20T00:00:00.000Z"), "Round Off", "RO-1457", "1075C Asl Al Maarifa company Limited", 0.45, ""],
    [new Date("2025-12-18T00:00:00.000Z"), "Round Off", "RO-2219", "1075C Asl Al Maarifa company Limited", "", 0.25],
    [new Date("2025-11-13T00:00:00.000Z"), "Receipt", "286", "1075C Asl Al Maarifa company Limited", "", 10000],
  ], null, lookup);

  const byVoucher = new Map(parsed.rows.map((row) => [row.vch_no, row.amount]));
  assert.equal(parsed.rows.length, 3);
  assert.equal(byVoucher.get("RO-1457"), -0.45);
  assert.equal(byVoucher.get("RO-2219"), 0.25);
  assert.equal(byVoucher.get("286"), 10000);
});

test("parseParticularsParty keeps letter suffixes on customer codes", () => {
  const party = parseParticularsParty("1194C  Muhammed Awad Awn  Al-Rahmani Est.");
  assert.equal(party.customer_code, "1194C");
  assert.match(party.customer_name, /Muhammed Awad Awn/i);
});

test("excelDateToIso reads US-style dates when the day is > 12", () => {
  assert.equal(excelDateToIso("9/20/2026"), "2026-09-20");
  assert.equal(excelDateToIso("20/9/2026"), "2026-09-20");
  assert.equal(excelDateToIso("09-18-2026"), "2026-09-18");
});

test("prioritizeReceiptSheets prefers Export when no receipt sheet name exists", () => {
  assert.deepEqual(
    prioritizeReceiptSheets(["Summary", "Export", "Other"]),
    ["Export", "Summary", "Other"],
  );
});

test("prioritizeReceiptSheets prefers Payment sheets when payment vouchers are opted in", () => {
  assert.deepEqual(
    prioritizeReceiptSheets(["Summary", "Receipt", "Payment Register"], { includePaymentVouchers: true }),
    ["Payment Register", "Receipt", "Summary"],
  );
});

test("upload templates parse cleanly as receipt and payment registers", () => {
  const receiptTemplate = receiptRegisterTemplateMatrix();
  const paymentTemplate = paymentRegisterTemplateMatrix();
  assert.deepEqual(receiptTemplate[0], [
    "TRANSACTIONDATE", "VOUCHERTYPENAME", "VOUCHERNUMBER", "LEDGERNAME", "Cr",
  ]);
  assert.deepEqual(paymentTemplate[0], [
    "TRANSACTIONDATE", "VOUCHERTYPENAME", "VOUCHERNUMBER", "LEDGERNAME", "Dr",
  ]);

  const receipts = parseReceiptRegisterRows(receiptTemplate);
  assert.equal(receipts.rows.length, 2);
  assert.equal(receipts.rows[0].vch_type, "Receipt");
  assert.equal(receipts.rows[1].vch_type, "JV-Collection");

  const payments = parseReceiptRegisterRows(paymentTemplate, null, null, {
    includePaymentVouchers: true,
  });
  assert.equal(payments.rows.length, 1);
  assert.equal(payments.rows[0].vch_type, "Payment");
  assert.equal(payments.rows[0].amount, -2500);
});

test("stripPaymentVoucherRows removes Payment types and keeps collections", () => {
  const { rows, removed } = stripPaymentVoucherRows([
    { vch_type: "Receipt", amount: 100, receipt_date: "2026-01-01", vch_no: "1" },
    { vch_type: "Payment", amount: 0.02, receipt_date: "2026-09-30", vch_no: "VP-1" },
    { vch_type: "Payment", amount: -50, receipt_date: "2026-09-30", vch_no: "VP-2" },
    { vch_type: "JV-Collection", amount: 200, receipt_date: "2026-01-02", vch_no: "45" },
  ]);
  assert.equal(removed, 2);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.vch_type), ["Receipt", "JV-Collection"]);
});

test("mergeReceiptDatasets keeps negative Payment voucher amounts", () => {
  const merged = mergeReceiptDatasets([], [{
    receipt_date: "2026-09-30",
    customer_code: "1301",
    customer_name: "Zero One Trading Establishment",
    particulars: "1301 Zero One Trading Establishment",
    vch_type: "Payment",
    vch_no: "VP-1",
    amount: -1250,
    matched: true,
  }]);
  assert.equal(merged.rows.length, 1);
  assert.equal(merged.added, 1);
  assert.equal(merged.rows[0].amount, -1250);
});

test("mergeReceiptDatasets upserts by voucher and does not wipe other same-day receipts", () => {
  const existing = [
    {
      receipt_date: "2026-10-03",
      customer_code: "1001",
      customer_name: "Keep Me",
      particulars: "1001 Keep Me",
      vch_type: "JV-Collection",
      vch_no: "JV/Coll/2026/0900",
      amount: 1000,
      matched: true,
    },
    {
      receipt_date: "2026-10-02",
      customer_code: "1002",
      customer_name: "Other Day",
      particulars: "1002 Other Day",
      vch_type: "Receipt",
      vch_no: "10",
      amount: 250,
      matched: true,
    },
  ];
  const incoming = [
    {
      receipt_date: "2026-10-03",
      customer_code: "1041",
      customer_name: "AL KHAMIS ARABIYA TRADING Co.",
      particulars: "1041  AL KHAMIS ARABIYA TRADING Co.",
      vch_type: "JV-Collection",
      vch_no: "JV/Coll/2026/0928",
      amount: 5000,
      matched: true,
    },
    {
      receipt_date: "2026-10-03",
      customer_code: "1001",
      customer_name: "Keep Me Updated",
      particulars: "1001 Keep Me Updated",
      vch_type: "JV-Collection",
      vch_no: "JV/Coll/2026/0900",
      amount: 1100,
      matched: true,
    },
  ];

  const merged = mergeReceiptDatasets(existing, incoming, ["2026-10-03"]);
  assert.equal(merged.rows.length, 3);
  assert.equal(merged.added, 1);
  assert.equal(merged.updated, 1);
  assert.equal(
    merged.rows.find((row) => row.vch_no === "JV/Coll/2026/0900")?.amount,
    1100,
  );
  assert.equal(
    merged.rows.find((row) => row.vch_no === "JV/Coll/2026/0928")?.amount,
    5000,
  );
  assert.equal(
    merged.rows.find((row) => row.vch_no === "10")?.customer_code,
    "1002",
  );
  assert.equal(
    receiptRowIdentity(incoming[0]),
    "2026-10-03|JV-COLLECTION|JV/COLL/2026/0928|1041",
  );
});

test("removeUnanchoredDuplicateReceipts drops a customer receipt copied onto a neighbouring voucher", () => {
  const cleaned = removeUnanchoredDuplicateReceipts([
    {
      receipt_date: "2026-10-13",
      customer_code: "1224",
      customer_name: "RAWAAT MAZAYA",
      particulars: "1224  RAWAAT MAZAYA",
      vch_type: "Receipt",
      vch_no: "1958",
      amount: 76000,
      matched: true,
    },
    {
      receipt_date: "2026-10-13",
      customer_code: "1224",
      customer_name: "RAWAAT MAZAYA",
      particulars: "1224  RAWAAT MAZAYA",
      vch_type: "Receipt",
      vch_no: "1959",
      amount: 76000,
      matched: true,
    },
    {
      receipt_date: "2026-10-13",
      customer_code: "",
      customer_name: "Alrajhi Bank",
      particulars: "Alrajhi Bank",
      vch_type: "Receipt",
      vch_no: "1959",
      amount: 76000,
      matched: false,
    },
    {
      receipt_date: "2026-10-13",
      customer_code: "1224",
      customer_name: "RAWAAT MAZAYA",
      particulars: "1224  RAWAAT MAZAYA",
      vch_type: "Receipt",
      vch_no: "1960",
      amount: 76000,
      matched: true,
    },
    {
      receipt_date: "2026-10-13",
      customer_code: "1536",
      customer_name: "Al-Bader",
      particulars: "1536 Al-Bader",
      vch_type: "Receipt",
      vch_no: "1960",
      amount: 6418.66,
      matched: true,
    },
    {
      receipt_date: "2026-10-13",
      customer_code: "",
      customer_name: "Alrajhi Bank",
      particulars: "Alrajhi Bank",
      vch_type: "Receipt",
      vch_no: "1960",
      amount: 6418.66,
      matched: false,
    },
  ]);

  assert.equal(cleaned.removed, 2);
  const kept = cleaned.rows.filter((row) => row.customer_code === "1224").map((row) => row.vch_no);
  assert.deepEqual(kept, ["1959"]);
  assert.equal(cleaned.rows.some((row) => row.customer_code === "1536" && row.vch_no === "1960"), true);
});

test("removeUnanchoredDuplicateReceipts keeps two real receipts of the same amount", () => {
  const cleaned = removeUnanchoredDuplicateReceipts([
    {
      receipt_date: "2026-10-13",
      customer_code: "1008",
      particulars: "1008 Store",
      vch_type: "Receipt",
      vch_no: "10",
      amount: 500,
      matched: true,
    },
    {
      receipt_date: "2026-10-13",
      customer_code: "",
      particulars: "Alrajhi Bank",
      vch_type: "Receipt",
      vch_no: "10",
      amount: 500,
      matched: false,
    },
    {
      receipt_date: "2026-10-13",
      customer_code: "1008",
      particulars: "1008 Store",
      vch_type: "Receipt",
      vch_no: "11",
      amount: 500,
      matched: true,
    },
    {
      receipt_date: "2026-10-13",
      customer_code: "",
      particulars: "Cash",
      vch_type: "Receipt",
      vch_no: "11",
      amount: 500,
      matched: false,
    },
  ]);

  assert.equal(cleaned.removed, 0);
  assert.equal(cleaned.rows.filter((row) => row.customer_code === "1008").length, 2);
});

test("removeUnanchoredDuplicateReceipts drops an early-October copy when the next voucher has the bank", () => {
  const cleaned = removeUnanchoredDuplicateReceipts([
    {
      receipt_date: "2026-10-01",
      customer_code: "1035C",
      particulars: "1035C",
      vch_type: "Receipt",
      vch_no: "1865",
      amount: 69000,
      matched: true,
    },
    {
      receipt_date: "2026-10-01",
      customer_code: "1035C",
      particulars: "1035C",
      vch_type: "Receipt",
      vch_no: "1866",
      amount: 69000,
      matched: true,
    },
    {
      receipt_date: "2026-10-01",
      customer_code: "",
      particulars: "Alrajhi Bank",
      vch_type: "Receipt",
      vch_no: "1866",
      amount: 69000,
      matched: false,
    },
    {
      receipt_date: "2026-10-03",
      customer_code: "1109C",
      particulars: "1109C Dhajja Al Tawfeer Trading Company",
      vch_type: "Receipt",
      vch_no: "1872",
      amount: 7000,
      matched: true,
    },
    {
      receipt_date: "2026-10-03",
      customer_code: "1142",
      particulars: "1142 Hawaseeb information technology",
      vch_type: "Receipt",
      vch_no: "1872",
      amount: 1000,
      matched: true,
    },
    {
      receipt_date: "2026-10-03",
      customer_code: "",
      particulars: "Alrajhi Bank",
      vch_type: "Receipt",
      vch_no: "1872",
      amount: 1000,
      matched: false,
    },
    {
      receipt_date: "2026-10-03",
      customer_code: "1109C",
      particulars: "1109C Dhajja Al Tawfeer Trading Company",
      vch_type: "Receipt",
      vch_no: "1873",
      amount: 7000,
      matched: true,
    },
    {
      receipt_date: "2026-10-03",
      customer_code: "",
      particulars: "Alrajhi Bank",
      vch_type: "Receipt",
      vch_no: "1873",
      amount: 7000,
      matched: false,
    },
    {
      receipt_date: "2026-10-04",
      customer_code: "1110C",
      particulars: "1110C Dhawi Salem Walid Al-Mahri Trading Est.",
      vch_type: "Receipt",
      vch_no: "1879",
      amount: 40000,
      matched: true,
    },
    {
      receipt_date: "2026-10-04",
      customer_code: "",
      particulars: "Alrajhi Bank",
      vch_type: "Receipt",
      vch_no: "1879",
      amount: 40000,
      matched: false,
    },
    {
      receipt_date: "2026-10-04",
      customer_code: "1110C",
      particulars: "1110C Dhawi Salem Walid Al-Mahri Trading Est.",
      vch_type: "Receipt",
      vch_no: "1880",
      amount: 40000,
      matched: true,
    },
    {
      receipt_date: "2026-10-04",
      customer_code: "",
      particulars: "Alrajhi Bank",
      vch_type: "Receipt",
      vch_no: "1880",
      amount: 40000,
      matched: false,
    },
    {
      receipt_date: "2026-10-05",
      customer_code: "1110C",
      particulars: "1110C Dhawi Salem Walid Al-Mahri Trading Est.",
      vch_type: "Receipt",
      vch_no: "1895",
      amount: 2500,
      matched: true,
    },
    {
      receipt_date: "2026-10-05",
      customer_code: "",
      particulars: "Alrajhi Bank",
      vch_type: "Receipt",
      vch_no: "1895",
      amount: 7550,
      matched: false,
    },
    {
      receipt_date: "2026-10-05",
      customer_code: "1110C",
      particulars: "1110C Dhawi Salem Walid Al-Mahri Trading Est.",
      vch_type: "Receipt",
      vch_no: "1896",
      amount: 2500,
      matched: true,
    },
    {
      receipt_date: "2026-10-05",
      customer_code: "",
      particulars: "Alrajhi Bank",
      vch_type: "Receipt",
      vch_no: "1896",
      amount: 2500,
      matched: false,
    },
  ]);

  assert.deepEqual(
    cleaned.rows.filter((row) => row.customer_code === "1035C").map((row) => row.vch_no),
    ["1866"],
  );
  assert.deepEqual(
    cleaned.rows.filter((row) => row.customer_code === "1109C").map((row) => row.vch_no),
    ["1873"],
  );
  assert.deepEqual(
    cleaned.rows.filter((row) => row.customer_code === "1142").map((row) => row.vch_no),
    ["1872"],
  );
  assert.deepEqual(
    cleaned.rows.filter((row) => row.customer_code === "1110C").map((row) => row.vch_no),
    ["1879", "1880", "1896"],
  );
});

test("removeUnanchoredDuplicateReceipts keeps the later voucher when the same receipt was mapped twice", () => {
  const cleaned = removeUnanchoredDuplicateReceipts([
    {
      receipt_date: "2026-10-10",
      customer_code: "1573",
      particulars: "1573 Lamsat",
      vch_type: "Receipt",
      vch_no: "1936",
      amount: 20,
      matched: true,
    },
    {
      receipt_date: "2026-10-10",
      customer_code: "1139C",
      particulars: "1139C HAMSAT AL TAWFEER",
      vch_type: "Receipt",
      vch_no: "1937",
      amount: 10000,
      matched: true,
    },
    {
      receipt_date: "2026-10-10",
      customer_code: "1573",
      particulars: "1573 Lamsat",
      vch_type: "Receipt",
      vch_no: "1937",
      amount: 20,
      matched: true,
    },
    {
      receipt_date: "2026-10-10",
      customer_code: "",
      particulars: "Alrajhi Bank",
      vch_type: "Receipt",
      vch_no: "1937",
      amount: 10000,
      matched: false,
    },
    {
      receipt_date: "2026-10-10",
      customer_code: "1139C",
      particulars: "1139C HAMSAT AL TAWFEER",
      vch_type: "Receipt",
      vch_no: "1938",
      amount: 10000,
      matched: true,
    },
    {
      receipt_date: "2026-10-10",
      customer_code: "",
      particulars: "Alrajhi Bank",
      vch_type: "Receipt",
      vch_no: "1938",
      amount: 10000,
      matched: false,
    },
  ]);

  assert.deepEqual(
    cleaned.rows.filter((row) => row.customer_code === "1139C").map((row) => row.vch_no),
    ["1938"],
  );
});
