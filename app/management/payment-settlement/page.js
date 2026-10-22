"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import AppLanguageSwitch from "../../components/AppLanguageSwitch";
import MorningAttendanceGate from "../../components/MorningAttendanceGate";
import ExportableTable from "../../components/ExportableTable";
import SupabaseUnavailable from "../../components/SupabaseUnavailable";
import BiExcelHead, { useBiExcelFilters } from "../business-dashboard/BiExcelHead";
import { translate, useAppLanguage } from "../../lib/appLanguage";
import { resolveAuthSession } from "../../lib/authSession";
import {
  buildPaymentSettlementLedger,
  HISTORIC_PERFORMANCE_PERIOD_LABEL,
  HISTORIC_PERFORMANCE_SHORT_LABEL,
} from "../../lib/paymentBehavior.js";
import { formatSettlementOpenDelta } from "../../lib/settlementOpenDelta.js";
import {
  buildSfaStatementEntries,
  compareTallyStatement,
  parseTallyStatementWorkbook,
} from "../../lib/tallyStatementCompare.js";
import { getSupabaseClient } from "../../lib/supabase";
import { usePopupMessages } from "../../hooks/usePopupMessages";
import { useModuleAccess } from "../../hooks/useModuleAccess";

const TEXT = {
  title: { en: "Payment Settlement", ar: "تسوية المدفوعات" },
  subtitle: {
    en: "Customer-wise sales vs collections, FIFO settlement, and payment days per invoice.",
    ar: "مبيعات مقابل التحصيل لكل عميل، التسوية حسب الأقدم أولاً، وأيام الدفع لكل فاتورة.",
  },
  back: { en: "← Management", ar: "← الإدارة" },
  audit: { en: "Customers Audit", ar: "عملائي" },
  search: { en: "Search customer code or name", ar: "بحث بكود أو اسم العميل" },
  load: { en: "Load", ar: "تحميل" },
  searching: { en: "Searching...", ar: "جاري البحث..." },
  searchHint: { en: "Search, then choose one customer", ar: "ابحث ثم اختر عميلاً واحداً" },
  loading: { en: "Loading settlement...", ar: "جاري تحميل التسوية..." },
  selectCustomer: {
    en: "Select a customer to see sales, collections, and settlement.",
    ar: "اختر عميلاً لعرض المبيعات والتحصيل والتسوية.",
  },
  pickOne: {
    en: "Choose one customer from the list.",
    ar: "اختر عميلاً واحداً من القائمة.",
  },
  noMatch: { en: "No customer found.", ar: "لم يتم العثور على العميل." },
  statementTitle: { en: "Tally statement check", ar: "مطابقة كشف تالي" },
  statementHint: {
    en: "Upload this customer's Tally ledger (PDF, Excel, or CSV) with Date, Particulars, Vch Type, Vch No., Debit, and Credit. The first line where the running totals split is the entry behind the mismatch.",
    ar: "ارفع دفتر هذا العميل من تالي (PDF أو إكسل أو CSV) بأعمدة التاريخ والبيان ونوع القسيمة ورقمها والمدين والدائن. أول سطر يفترق فيه الإجمالي الجاري هو القيد المسبب للفرق.",
  },
  statementUpload: { en: "Upload Tally statement", ar: "رفع كشف تالي" },
  statementClear: { en: "Clear", ar: "مسح" },
  statementShowMatched: { en: "Show matched lines", ar: "عرض السطور المطابقة" },
  statementWindow: { en: "Statement dates", ar: "تواريخ الكشف" },
  statementTallyNet: { en: "Tally movement", ar: "حركة تالي" },
  statementSfaNet: { en: "SFA movement", ar: "حركة SFA" },
  statementDiff: { en: "Difference", ar: "الفرق" },
  statementIssues: { en: "Entries that differ", ar: "قيود مختلفة" },
  statementAgree: {
    en: "Every voucher in this statement matches SFA. No single entry is opening a gap.",
    ar: "كل قسيمة في هذا الكشف تطابق SFA. لا يوجد قيد واحد يفتح فرقاً.",
  },
  statementLeadTally: {
    en: "This Tally entry is not in SFA. It is the first line that opens the gap.",
    ar: "هذا القيد موجود في تالي وغير موجود في SFA. وهو أول سطر يفتح الفرق.",
  },
  statementLeadSfa: {
    en: "This SFA entry is not on the Tally statement. It is the first line that opens the gap.",
    ar: "هذا القيد موجود في SFA وغير موجود في كشف تالي. وهو أول سطر يفتح الفرق.",
  },
  statementLeadAmount: {
    en: "This voucher is in both, but the amounts differ. It is the first line that opens the gap.",
    ar: "هذه القسيمة موجودة في الطرفين لكن المبلغ مختلف. وهو أول سطر يفتح الفرق.",
  },
  statementLeadVat: {
    en: "These vouchers differ by about 15% VAT. Tally and SFA are not on the same VAT basis. The gap starts at this voucher.",
    ar: "هذه القسائم تختلف بحوالي 15% ضريبة. تالي وSFA ليسا على نفس أساس الضريبة. الفرق يبدأ من هذه القسيمة.",
  },
  statementDate: { en: "Date", ar: "التاريخ" },
  statementVoucher: { en: "Voucher", ar: "القسيمة" },
  statementType: { en: "Type", ar: "النوع" },
  statementParticulars: { en: "Particulars", ar: "البيان" },
  statementTallyDr: { en: "Tally debit", ar: "مدين تالي" },
  statementTallyCr: { en: "Tally credit", ar: "دائن تالي" },
  statementSfaDr: { en: "SFA debit", ar: "مدين SFA" },
  statementSfaCr: { en: "SFA credit", ar: "دائن SFA" },
  statementCause: { en: "Cause", ar: "السبب" },
  statementTotal: { en: "Total", ar: "الإجمالي" },
  causeMatched: { en: "Matched", ar: "مطابق" },
  causeAmount: { en: "Amount differs", ar: "المبلغ مختلف" },
  causeTally: { en: "In Tally only", ar: "في تالي فقط" },
  causeSfa: { en: "In SFA only", ar: "في SFA فقط" },
  causeVat: { en: "VAT basis", ar: "أساس الضريبة" },
  causeLeads: { en: "Opens the gap", ar: "يفتح الفرق" },
  statementPdf: {
    en: "Could not read that Tally PDF. Export the customer ledger with Date, Debit, and Credit columns.",
    ar: "تعذر قراءة ملف PDF من تالي. صدّر دفتر العميل بأعمدة التاريخ والمدين والدائن.",
  },
  statementNone: {
    en: "No ledger lines found. Use a Tally ledger export with Date, Debit, and Credit columns.",
    ar: "لم يتم العثور على سطور دفتر. استخدم تصدير دفتر تالي بأعمدة التاريخ والمدين والدائن.",
  },
  note: {
    en: "Referenced credit notes settle the named Ref. No. first (VAT-incl) and count in Paid. They do not cut that bill's sales figure. Only what the named bill cannot take follows oldest-open FIFO. Unreferenced CNs follow oldest-open FIFO. Dual-party Payments settle Purchases first, then leftover settles earlier sales. A Purchase no Payment covers settles sales invoices already dated on or before that purchase, and does not prepay a later invoice. Open is not forced to the outstanding upload. Avg days uses paid receipts only, then open invoices older than that paid avg. Immediate full reversals stay in Sales but are excluded from avg days.",
    ar: "إشعار دائن بمرجع يسوي الفاتورة المذكورة في رقم المرجع أولاً (مع الضريبة) ويُحسب في المدفوع، دون تخفيض رقم مبيعات تلك الفاتورة. ما لا تسعه الفاتورة يتبع الأقدم أولاً. الإشعارات بلا مرجع تتبع الأقدم أولاً. مدفوعات الطرف المزدوج تسوي المشتريات أولاً ثم المتبقي يسوي فواتير المبيعات الأقدم. المشتريات التي لا يغطيها سند دفع تسوي فواتير المبيعات بتاريخ الشراء أو قبله، ولا تسدد فاتورة لاحقة. المفتوح لا يُجبر على ملف المستحقات. متوسط الأيام من الإيصالات ثم الفواتير المفتوحة الأقدم من ذلك المتوسط. العكس الكامل الفوري يبقى في المبيعات ويُستبعد من المتوسط.",
  },
};

const STATEMENT_FILTER_KEYS = [
  "date",
  "voucher",
  "type",
  "particulars",
  "tallyDebit",
  "tallyCredit",
  "sfaDebit",
  "sfaCredit",
  "difference",
  "cause",
];

function statementCauseKey(row) {
  if (row?.status === "tally_only") return "causeTally";
  if (row?.status === "sfa_only") return "causeSfa";
  if (row?.status === "vat") return "causeVat";
  if (row?.status === "amount") return "causeAmount";
  return "causeMatched";
}

function statementFilterValue(row, key) {
  if (key === "date") return row.date || "—";
  if (key === "voucher") return row.voucher || "—";
  if (key === "type") return row.vchType || "—";
  if (key === "particulars") return row.particulars || "—";
  if (key === "cause") return row.status || "";
  if (key === "tallyDebit") return formatMoney(row.tallyDebit);
  if (key === "tallyCredit") return formatMoney(row.tallyCredit);
  if (key === "sfaDebit") return formatMoney(row.sfaDebit);
  if (key === "sfaCredit") return formatMoney(row.sfaCredit);
  if (key === "difference") return formatMoney(row.difference);
  return "";
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatCount(value) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatDelta(value) {
  return formatSettlementOpenDelta(value);
}

function deltaClass(value) {
  const number = Number(value || 0);
  if (number > 0.02) return "moduleBiMonthCell--up";
  if (number < -0.02) return "moduleBiMonthCell--down";
  return "";
}

function statusClass(status) {
  if (status === "Paid") return "paymentSettleStatus paymentSettleStatus--paid";
  if (status === "Partial") return "paymentSettleStatus paymentSettleStatus--partial";
  if (status === "Reversed" || status === "Tally") return "paymentSettleStatus paymentSettleStatus--reversed";
  if (status === "Matched" || status === "Applied") {
    return "paymentSettleStatus paymentSettleStatus--paid";
  }
  if (status === "Credit" || status === "Sales Return" || status === "Credit Note") {
    return "paymentSettleStatus paymentSettleStatus--credit";
  }
  return "paymentSettleStatus paymentSettleStatus--open";
}

function InvoiceSettlementRow({ invoice, open, onToggle }) {
  const receiptCount = Array.isArray(invoice.settlements) ? invoice.settlements.length : 0;
  const creditCount = Array.isArray(invoice.credit_notes) ? invoice.credit_notes.length : 0;
  const purchaseCount = Array.isArray(invoice.purchase_settlements) ? invoice.purchase_settlements.length : 0;
  const detailCount = receiptCount + creditCount + purchaseCount;
  const tallyOnly = Boolean(invoice.tally_only);
  const machineOpen = Number(invoice.remaining || 0);
  const tallyOpen = invoice.outstanding_pending == null ? null : Number(invoice.outstanding_pending || 0);
  const openDelta = tallyOpen == null ? null : machineOpen - tallyOpen;

  return (
    <>
      <tr>
        <td>{invoice.invoice_date || "—"}</td>
        <td>{invoice.voucher_number || "—"}</td>
        <td>{tallyOnly ? "—" : formatMoney(invoice.amount_excl_vat)}</td>
        <td>{tallyOnly ? "—" : formatMoney(invoice.amount_incl_vat)}</td>
        <td>{tallyOnly ? "—" : formatMoney(invoice.paid_amount)}</td>
        <td>{formatMoney(machineOpen)}</td>
        <td>{tallyOpen == null ? "—" : formatMoney(tallyOpen)}</td>
        <td className={openDelta == null ? "" : deltaClass(openDelta)}>
          {openDelta == null ? "—" : formatDelta(openDelta)}
        </td>
        <td><span className={statusClass(invoice.status)}>{invoice.status}</span></td>
        <td>
          {invoice.payment_days != null
            ? invoice.payment_days
            : (invoice.open_days > 0 ? `Open ${invoice.open_days}d` : "—")}
        </td>
        <td>
          {detailCount ? (
            <button type="button" className="moduleInlineButton" onClick={onToggle}>
              {open ? "Hide" : `Show ${detailCount}`}
            </button>
          ) : "—"}
        </td>
      </tr>
      {open && (invoice.settlements || []).map((settlement, index) => (
        <tr key={`${invoice.invoice_date}-rcpt-${settlement.receipt_date}-${index}`} className="paymentSettleChildRow">
          <td colSpan={2} style={{ paddingLeft: 18 }}>
            {Number(settlement.amount) < 0 ? "Payment" : "Paid"} on {settlement.receipt_date}
            {settlement.vch_no
              ? ` · ${Number(settlement.amount) < 0 ? "" : "Rcpt "}${settlement.vch_no}`
              : ""}
          </td>
          <td colSpan={2} />
          <td>{formatMoney(settlement.amount)}</td>
          <td colSpan={3} />
          <td />
          <td>{settlement.days != null ? `${settlement.days} days` : "—"}</td>
          <td />
        </tr>
      ))}
      {open && (invoice.purchase_settlements || []).map((purchase, index) => (
        <tr key={`${invoice.invoice_date}-pur-${purchase.voucher_number}-${index}`} className="paymentSettleChildRow">
          <td colSpan={2} style={{ paddingLeft: 18 }}>
            Purchase
            {purchase.voucher_number ? ` · ${purchase.voucher_number}` : ""}
            {purchase.purchase_date ? ` · ${purchase.purchase_date}` : ""}
            {" · settles this invoice"}
          </td>
          <td colSpan={2} />
          <td>{formatMoney(purchase.amount)}</td>
          <td colSpan={3} />
          <td><span className={statusClass("Applied")}>Purchase</span></td>
          <td>Not in avg days</td>
          <td />
        </tr>
      ))}
      {open && (invoice.credit_notes || []).map((note, index) => (
        <tr key={`${invoice.invoice_date}-cn-${note.voucher_number}-${index}`} className="paymentSettleChildRow paymentSettleChildRow--credit">
          <td colSpan={2} style={{ paddingLeft: 18 }}>
            {note.kind || "Credit note"}
            {" · "}
            {note.voucher_number || "—"}
            {note.credit_date ? ` · ${note.credit_date}` : ""}
            {" · settles like receipt"}
          </td>
          <td colSpan={2} />
          <td>{formatMoney(note.amount)}</td>
          <td colSpan={3} />
          <td><span className={statusClass("Credit")}>{note.kind || "Credit"}</span></td>
          <td>Not in avg days</td>
          <td />
        </tr>
      ))}
    </>
  );
}

function DatewiseDayRow({ row, open, onToggle }) {
  const invoices = Array.isArray(row.invoices) ? row.invoices : [];
  const receipts = Array.isArray(row.receipts) ? row.receipts : [];
  const purchases = Array.isArray(row.purchases) ? row.purchases : [];
  const detailCount = invoices.length + receipts.length + purchases.length;

  return (
    <>
      <tr>
        <td>
          <div className="paymentSettleDateCell">
            {detailCount ? (
              <button
                type="button"
                className="moduleInlineButton"
                aria-expanded={open}
                onClick={onToggle}
              >
                {open ? "−" : "+"}
              </button>
            ) : null}
            <span>{row.date}</span>
          </div>
        </td>
        <td>{formatCount(row.invoice_count)}</td>
        <td>{formatMoney(row.sales_excl_vat)}</td>
        <td>{formatMoney(row.sales_incl_vat)}</td>
        <td>{formatCount(row.receipt_count)}</td>
        <td>{formatMoney(row.collected_amount)}</td>
        <td>{formatMoney(row.open_sales_amount)}</td>
      </tr>
      {open && invoices.map((invoice, index) => (
        <tr
          key={`${row.date}-inv-${invoice.voucher_number || index}`}
          className="paymentSettleChildRow"
        >
          <td style={{ paddingLeft: 28 }}>
            Invoice · {invoice.voucher_number || "—"}
            {invoice.status ? (
              <>
                {" · "}
                <span className={statusClass(invoice.status)}>{invoice.status}</span>
              </>
            ) : null}
          </td>
          <td>1</td>
          <td>{formatMoney(invoice.amount_excl_vat)}</td>
          <td>{formatMoney(invoice.amount_incl_vat)}</td>
          <td />
          <td />
          <td>{formatMoney(invoice.remaining)}</td>
        </tr>
      ))}
      {open && purchases.map((purchase, index) => {
        const applications = Array.isArray(purchase.applications) ? purchase.applications : [];
        const applied = applications.reduce((total, application) => total + Number(application.amount || 0), 0);
        const unapplied = Math.max(0, Number(purchase.amount || 0) - applied);
        if (!applications.length) {
          return (
            <tr
              key={`${row.date}-pur-${purchase.vch_no || index}`}
              className="paymentSettleChildRow"
            >
              <td style={{ paddingLeft: 28 }}>
                Purchase{purchase.vch_no ? ` · ${purchase.vch_no}` : ""}
              </td>
              <td />
              <td />
              <td>{formatMoney(purchase.amount)}</td>
              <td />
              <td />
              <td />
            </tr>
          );
        }
        return [
          ...applications.map((application, applicationIndex) => (
            <tr
              key={`${row.date}-pur-${purchase.vch_no || index}-app-${applicationIndex}`}
              className="paymentSettleChildRow"
            >
              <td style={{ paddingLeft: 28 }}>
                Purchase
                {purchase.vch_no ? ` · ${purchase.vch_no}` : ""}
                {" → Invoice"}
                {application.voucher_number ? ` ${application.voucher_number}` : ""}
              </td>
              <td />
              <td />
              <td>{formatMoney(application.amount)}</td>
              <td />
              <td />
              <td />
            </tr>
          )),
          unapplied > 0.009 ? (
            <tr
              key={`${row.date}-pur-${purchase.vch_no || index}-open`}
              className="paymentSettleChildRow"
            >
              <td style={{ paddingLeft: 28 }}>
                Purchase
                {purchase.vch_no ? ` · ${purchase.vch_no}` : ""}
                {" · not adjusted against an invoice"}
              </td>
              <td />
              <td />
              <td>{formatMoney(unapplied)}</td>
              <td />
              <td />
              <td />
            </tr>
          ) : null,
        ];
      })}
      {open && receipts.map((receipt, index) => {
        const applications = Array.isArray(receipt.applications) ? receipt.applications : [];
        const isPayment = receipt.kind === "payment" || Number(receipt.amount) < 0;
        if (isPayment && applications.length) {
          return applications.map((application, applicationIndex) => (
            <tr
              key={`${row.date}-rcpt-${receipt.vch_no || index}-app-${applicationIndex}`}
              className="paymentSettleChildRow"
            >
              <td style={{ paddingLeft: 28 }}>
                Payment
                {receipt.vch_no ? ` · ${receipt.vch_no}` : ""}
                {" → "}
                {application.target_kind === "purchase" ? "Purchase" : "Invoice"}
                {application.voucher_number ? ` ${application.voucher_number}` : ""}
              </td>
              <td />
              <td />
              <td />
              <td>{applicationIndex === 0 ? 1 : ""}</td>
              <td>{formatMoney(application.amount)}</td>
              <td />
            </tr>
          ));
        }
        return (
          <tr
            key={`${row.date}-rcpt-${receipt.vch_no || index}`}
            className="paymentSettleChildRow"
          >
            <td style={{ paddingLeft: 28 }}>
              {isPayment ? "Payment" : "Receipt"}
              {receipt.vch_no ? ` · ${receipt.vch_no}` : ""}
              {isPayment ? " · not adjusted against an invoice" : ""}
            </td>
            <td />
            <td />
            <td />
            <td>1</td>
            <td>{formatMoney(receipt.amount)}</td>
            <td />
          </tr>
        );
      })}
      {open && !detailCount && (
        <tr className="paymentSettleChildRow">
          <td colSpan={7} style={{ paddingLeft: 28 }}>No transactions on this date.</td>
        </tr>
      )}
    </>
  );
}

export default function PaymentSettlementPage() {
  const { language, setLanguage, dir } = useAppLanguage();
  const t = translate(language, TEXT);
  const { access } = useModuleAccess();

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  usePopupMessages({ error, message });

  const [matches, setMatches] = useState([]);
  const [matchQuery, setMatchQuery] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [searchingCustomers, setSearchingCustomers] = useState(false);
  const [loadingSettlement, setLoadingSettlement] = useState(false);
  const [ledger, setLedger] = useState(null);
  const [statementReceipts, setStatementReceipts] = useState([]);
  const [statementFileName, setStatementFileName] = useState("");
  const [statementResult, setStatementResult] = useState(null);
  const [showMatchedStatement, setShowMatchedStatement] = useState(false);
  const statementInputRef = useRef(null);
  const [historyMeta, setHistoryMeta] = useState(null);
  const [expandedInvoice, setExpandedInvoice] = useState("");
  const [expandedDate, setExpandedDate] = useState("");
  const [autoCode, setAutoCode] = useState("");
  const autoLoadedRef = useRef("");
  const searchRequestRef = useRef(0);

  const canAccess = access.canAccess("paymentSettlement") || access.canAccess("customerAudit");

  const unpaidSummary = useMemo(() => {
    if (!ledger?.totals) return null;
    const openAmount = Number(ledger.totals.open_sales_amount || 0);
    const outstandingUnpaid = Number(
      ledger.totals.outstanding_unpaid || ledger.summary?.outstandingTotal || 0,
    );
    const salesInclVat = Number(
      ledger.totals.net_sales_incl_vat != null
        ? ledger.totals.net_sales_incl_vat
        : ledger.totals.sales_incl_vat || 0,
    );
    const collected = Number(ledger.totals.collected_amount || 0);
    const salesMinusCollected = Number(
      ledger.totals.sales_minus_collected != null
        ? ledger.totals.sales_minus_collected
        : salesInclVat - collected,
    );
    return {
      openAmount,
      outstandingUnpaid,
      matches: ledger.totals.open_matches_outstanding !== false,
      salesInclVat,
      collected,
      salesMinusCollected,
      creditNoteAmount: Number(ledger.totals.credit_note_amount || 0),
      balanceMatches: ledger.totals.sales_collected_matches_open !== false,
      balanceDelta: Number(ledger.totals.balance_delta || 0),
      tallyOpenTotal: (Array.isArray(ledger.invoices) ? ledger.invoices : []).reduce(
        (total, row) => total + (row.outstanding_pending == null ? 0 : Number(row.outstanding_pending || 0)),
        0,
      ),
      machineOpenTotal: openAmount,
    };
  }, [ledger]);

  const authHeaders = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    const session = await resolveAuthSession(supabase);
    return { Authorization: `Bearer ${session.access_token}` };
  }, []);

  const loadSettlement = useCallback(async (customer) => {
    if (!customer?.customer_code) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setLoadingSettlement(true);
    setError("");
    setMessage("");
    setLedger(null);
    setStatementReceipts([]);
    setStatementFileName("");
    setStatementResult(null);
    setShowMatchedStatement(false);
    setHistoryMeta(null);
    setExpandedInvoice("");
    setExpandedDate("");

    try {
      const headers = await authHeaders();
      if (!headers) return;
      const code = encodeURIComponent(customer.customer_code || "");
      const name = encodeURIComponent(customer.customer_name || "");

      const [historyResponse, outstandingResponse] = await Promise.all([
        fetch(`/api/customer-history?customerCode=${code}&customerName=${name}&fullHistory=1&scope=settlement`, { headers }),
        fetch(`/api/outstanding?customerCode=${code}&customerName=${name}`, { headers }),
      ]);

      const historyPayload = await historyResponse.json().catch(() => ({}));
      const outstandingPayload = await outstandingResponse.json().catch(() => ({}));

      if (!historyResponse.ok || !historyPayload.success) {
        throw new Error(historyPayload.error || "Unable to load sales/receipt history.");
      }

      const historyTransactions = Array.isArray(historyPayload.transactions) ? historyPayload.transactions : [];
      const nextLedger = buildPaymentSettlementLedger({
        transactions: historyTransactions,
        receipts: Array.isArray(historyPayload.receipts) ? historyPayload.receipts : [],
        outstandingCustomer: outstandingPayload?.customer || null,
        outstandingInvoices: Array.isArray(outstandingPayload?.customerInvoices)
          ? outstandingPayload.customerInvoices
          : [],
      });

      setSelectedCustomer(customer);
      setLedger(nextLedger);
      setStatementReceipts(Array.isArray(historyPayload.receipts) ? historyPayload.receipts : []);
      setStatementFileName("");
      setStatementResult(null);
      setShowMatchedStatement(false);
      setHistoryMeta({
        fromDate: historyPayload.fromDate || "",
        fullHistory: Boolean(historyPayload.fullHistory),
        transactionCount: historyTransactions.length,
      });
      setMessage(
        nextLedger.summary?.summaryLabel
        || `Loaded ${nextLedger.totals.invoice_count} invoices for ${customer.customer_code}.`,
      );
    } catch (err) {
      setError(err.message || "Unable to load settlement.");
      setLedger(null);
      setHistoryMeta(null);
    } finally {
      setLoadingSettlement(false);
    }
  }, [authHeaders]);

  const searchCustomers = useCallback(async (query) => {
    const needle = String(query || "").trim();
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    if (needle.length < 2) {
      setMatches([]);
      setMatchQuery("");
      setSearchingCustomers(false);
      return;
    }
    setSearchingCustomers(true);
    try {
      const headers = await authHeaders();
      if (!headers || searchRequestRef.current !== requestId) return;
      const response = await fetch(`/api/customers/lookup?q=${encodeURIComponent(needle)}`, { headers });
      const payload = await response.json().catch(() => ({}));
      if (searchRequestRef.current !== requestId) return;
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to search customers.");
      }
      setMatches(Array.isArray(payload.customers) ? payload.customers : []);
      setMatchQuery(needle);
    } catch (err) {
      if (searchRequestRef.current !== requestId) return;
      setMatches([]);
      setMatchQuery("");
      setError(err.message || "Unable to search customers.");
    } finally {
      if (searchRequestRef.current === requestId) setSearchingCustomers(false);
    }
  }, [authHeaders]);

  const chooseCustomer = useCallback((customer) => {
    if (!customer?.customer_code) return;
    searchRequestRef.current += 1;
    setSearchingCustomers(false);
    setMatches([]);
    setMatchQuery("");
    setCustomerSearch(`${customer.customer_code} ${customer.customer_name || ""}`.trim());
    void loadSettlement(customer);
  }, [loadSettlement]);

  const submitCustomerSearch = useCallback(async (event) => {
    event?.preventDefault?.();
    const needle = customerSearch.trim();
    if (!needle || loadingSettlement) return;

    const lowered = needle.toLowerCase();
    const readyMatches = matchQuery.toLowerCase() === lowered ? matches : [];
    const exact = readyMatches.find((row) => {
      const code = String(row.customer_code || "").trim().toLowerCase();
      const label = `${row.customer_code || ""} ${row.customer_name || ""}`.trim().toLowerCase();
      return code === lowered || label === lowered;
    });
    if (exact) {
      chooseCustomer(exact);
      return;
    }
    if (readyMatches.length === 1) {
      chooseCustomer(readyMatches[0]);
      return;
    }

    setSearchingCustomers(true);
    setError("");
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const code = needle.split(/\s+/)[0];
      const response = await fetch(`/api/customers/lookup?code=${encodeURIComponent(code)}`, { headers });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.success && payload.customer?.customer_code) {
        chooseCustomer(payload.customer);
        return;
      }
      if (readyMatches.length > 1) {
        setError(t("pickOne"));
        return;
      }
      setError(payload.error || t("noMatch"));
      setMatches([]);
      setMatchQuery("");
    } catch (err) {
      setError(err.message || t("noMatch"));
    } finally {
      setSearchingCustomers(false);
    }
  }, [authHeaders, chooseCustomer, customerSearch, loadingSettlement, matchQuery, matches, t]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setAutoCode(String(params.get("customer_code") || params.get("customerCode") || "").trim());
  }, []);

  useEffect(() => {
    const needle = customerSearch.trim();
    const selectedLabel = selectedCustomer
      ? `${selectedCustomer.customer_code || ""} ${selectedCustomer.customer_name || ""}`.trim()
      : "";
    if (
      needle.length < 2
      || (selectedLabel && needle.toLowerCase() === selectedLabel.toLowerCase())
      || (autoCode && needle.toUpperCase() === autoCode.toUpperCase())
    ) {
      setMatches([]);
      setMatchQuery("");
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void searchCustomers(needle);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [autoCode, customerSearch, searchCustomers, selectedCustomer]);

  useEffect(() => {
    if (!autoCode || autoLoadedRef.current === autoCode) return undefined;
    autoLoadedRef.current = autoCode;
    let cancelled = false;

    async function openLinkedCustomer() {
      setCustomerSearch(autoCode);
      setSearchingCustomers(true);
      setError("");
      try {
        const headers = await authHeaders();
        if (!headers || cancelled) return;
        const response = await fetch(`/api/customers/lookup?code=${encodeURIComponent(autoCode)}`, { headers });
        const payload = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok || !payload.success || !payload.customer?.customer_code) {
          throw new Error(payload.error || TEXT.noMatch.en);
        }
        setMatches([]);
        void loadSettlement(payload.customer);
      } catch (err) {
        if (!cancelled) setError(err.message || TEXT.noMatch.en);
      } finally {
        if (!cancelled) setSearchingCustomers(false);
      }
    }

    void openLinkedCustomer();
    return () => {
      cancelled = true;
    };
  }, [authHeaders, autoCode, loadSettlement]);

  useEffect(() => {
    if (!ledger || typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;
    document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [ledger]);

  const statementRows = useMemo(() => {
    const rows = Array.isArray(statementResult?.rows) ? statementResult.rows : [];
    if (showMatchedStatement) return rows;
    return rows.filter((row) => row.status !== "matched");
  }, [showMatchedStatement, statementResult]);

  const statementValueOf = useCallback((row, key) => {
    if (key === "cause") {
      const lead = row.leadsGap ? `${t("causeLeads")} · ` : "";
      return `${lead}${t(statementCauseKey(row))}`;
    }
    return statementFilterValue(row, key);
  }, [t]);

  const {
    filters: statementFilters,
    options: statementOptions,
    visibleRows: visibleStatementRows,
    setFilter: setStatementFilter,
  } = useBiExcelFilters(statementRows, STATEMENT_FILTER_KEYS, statementValueOf);

  const onStatementFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !ledger) return;
    setError("");
    try {
      let parsed;
      const isPdf = /\.pdf$/i.test(file.name || "") || String(file.type || "").includes("pdf");
      if (isPdf) {
        const headers = await authHeaders();
        if (!headers) return;
        const body = new FormData();
        body.append("file", file);
        const response = await fetch("/api/tally-statement", {
          method: "POST",
          headers,
          body,
        });
        parsed = await response.json().catch(() => ({}));
        if (!response.ok || !parsed?.entries?.length) {
          throw new Error(parsed?.error || t("statementPdf"));
        }
      } else {
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
        parsed = parseTallyStatementWorkbook(workbook);
      }
      if (!parsed.entries.length) {
        setStatementResult(null);
        setStatementFileName("");
        setError(parsed.error || t("statementNone"));
        return;
      }
      const purchases = (ledger.datewise || []).flatMap((day) => (
        (day.purchases || []).map((row) => ({
          ...row,
          purchase_date: row.purchase_date || day.date,
        }))
      ));
      const compared = compareTallyStatement(parsed, buildSfaStatementEntries({
        invoices: ledger.invoices,
        reversedInvoices: ledger.reversedInvoices,
        creditNotes: ledger.creditNotes,
        receipts: statementReceipts,
        purchases,
      }));
      setStatementFileName(file.name || "");
      setStatementResult(compared);
    } catch (err) {
      setStatementResult(null);
      setStatementFileName("");
      setError(err?.message || t("statementNone"));
    }
  }, [authHeaders, ledger, statementReceipts, t]);

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return (
      <SupabaseUnavailable
        title="Payment Settlement unavailable"
        message="Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to use this screen."
      />
    );
  }

  if (!canAccess) {
    return (
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleHint">You do not have access to Payment Settlement.</div>
        </div>
      </main>
    );
  }

  return (
    <MorningAttendanceGate>
      <main className="modulePage" dir={dir}>
        <div className="moduleShell">
          <div className="moduleHeader">
            <div>
              <p className="moduleEyebrow">MADIBA SFA</p>
              <h1>{t("title")}</h1>
              <p className="moduleSubtitle">{t("subtitle")}</p>
            </div>
            <div className="moduleHeaderMeta">
              <AppLanguageSwitch language={language} setLanguage={setLanguage} />
              <Link href="/management/outstanding-compare" className="moduleBackLink">Outstanding Compare</Link>
              <Link href="/management/customer-audit" className="moduleBackLink">{t("audit")}</Link>
              <Link href="/management" className="moduleBackLink">{t("back")}</Link>
            </div>
          </div>

          <section className="moduleSection">
            <div className="moduleSectionHeader">
              <h2>Customer</h2>
              <span>
                {searchingCustomers
                  ? t("searching")
                  : matches.length
                    ? `${matches.length.toLocaleString()} ${language === "ar" ? "نتائج" : "matches"}`
                    : t("searchHint")}
              </span>
            </div>
            <p className="moduleHint">{t("note")}</p>
            <form className="moduleFilterRow" onSubmit={submitCustomerSearch}>
              <input
                className="moduleInput"
                type="text"
                placeholder={t("search")}
                value={customerSearch}
                onChange={(event) => setCustomerSearch(event.target.value)}
                autoComplete="off"
              />
              <button type="submit" className="moduleInlineButton" disabled={loadingSettlement}>
                {t("load")}
              </button>
            </form>
            <div className="paymentSettleCustomerList">
              {matches.map((customer) => (
                <button
                  type="button"
                  key={customer.customer_code}
                  className="paymentSettleCustomerButton"
                  onClick={() => chooseCustomer(customer)}
                >
                  <strong>{customer.customer_code}</strong>
                  {" — "}
                  {customer.customer_name || "Unnamed"}
                </button>
              ))}
            </div>
          </section>

          {loadingSettlement && <div className="moduleLoading">{t("loading")}</div>}

          {!loadingSettlement && !ledger && (
            <div className="moduleHint">{t("selectCustomer")}</div>
          )}

          {!loadingSettlement && ledger && selectedCustomer && (
            <>
              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>
                    {selectedCustomer.customer_code}
                    {" "}
                    {selectedCustomer.customer_name}
                  </h2>
                  <button type="button" className="moduleInlineButton" onClick={() => loadSettlement(selectedCustomer)}>
                    Refresh
                  </button>
                </div>

                <div className="auditSummaryGrid">
                  <div className="auditSummaryCard">
                    <span>Avg Days to Pay</span>
                    <strong>
                      {ledger.summary.avgDaysToPay != null
                        ? (
                          ledger.summary.avgDaysToPay6m != null
                            ? `${ledger.summary.avgDaysToPay} days · 6m ${ledger.summary.avgDaysToPay6m}`
                            : `${ledger.summary.avgDaysToPay} days`
                        )
                        : (ledger.summary.avgDaysToPay6m != null
                          ? `6m ${ledger.summary.avgDaysToPay6m} days`
                          : "—")}
                    </strong>
                    <em className="auditSummaryCardMeta">
                      {ledger.summary.avgDaysToPay != null
                        ? (Number(ledger.summary.openAmountInAvg || 0) > 0.009
                          ? "Lifetime · paid avg + open invoices older than that avg only"
                          : "Lifetime · from collected receipts")
                        : "Needs sales, receipts, or open invoices"}
                    </em>
                    {ledger.summary.avgDaysToPay6m != null ? (
                      <em className="auditSummaryCardMeta">
                        {HISTORIC_PERFORMANCE_PERIOD_LABEL}: {formatCount(ledger.summary.avgDaysToPay6m)} days
                        {Number(ledger.summary.openAmountInAvg6m || 0) > 0.009
                          ? ` · includes open older than ${HISTORIC_PERFORMANCE_SHORT_LABEL} paid avg`
                          : ""}
                      </em>
                    ) : null}
                    {ledger.summary.avgDaysPaidOnly != null
                      && Number(ledger.summary.openAmountInAvg || 0) > 0.009
                      && ledger.summary.avgDaysPaidOnly !== ledger.summary.avgDaysToPay ? (
                      <em className="auditSummaryCardMeta">
                        Paid-only avg: {formatCount(ledger.summary.avgDaysPaidOnly)}d
                      </em>
                    ) : null}
                    {Number(ledger.summary.outstandingOldestDays || 0) > 0 ? (
                      <em className="auditSummaryCardMeta">
                        Oldest unpaid invoice: {formatCount(ledger.summary.outstandingOldestDays)}d
                        {Number(ledger.summary.outstandingOverdueCount || 0) > 0
                          ? ` · ${formatCount(ledger.summary.outstandingOverdueCount)} overdue`
                          : ""}
                      </em>
                    ) : null}
                  </div>
                  <div className="auditSummaryCard">
                    <span>Sales incl. VAT</span>
                    <strong>{formatMoney(unpaidSummary?.salesInclVat || ledger.totals.sales_incl_vat)}</strong>
                    {unpaidSummary?.creditNoteAmount > 0.009 ? (
                      <em className="auditSummaryCardMeta">
                        After sales returns {formatMoney(unpaidSummary.creditNoteAmount)}
                      </em>
                    ) : (
                      <em className="auditSummaryCardMeta">Gloves stay excl. VAT · other lines +15%</em>
                    )}
                  </div>
                  <div className="auditSummaryCard">
                    <span>Sales Returns</span>
                    <strong>{formatMoney(ledger.totals.credit_note_amount || 0)}</strong>
                    <em className="auditSummaryCardMeta">
                      {(ledger.totals.credit_note_count || 0) > 0
                        ? `${formatCount(ledger.totals.credit_note_count)} partial / later CN · not cash`
                        : "No partial or later credit notes"}
                    </em>
                  </div>
                  <div className="auditSummaryCard">
                    <span>Collected</span>
                    <strong>{formatMoney(ledger.totals.collected_amount)}</strong>
                  </div>
                  <div className="auditSummaryCard">
                    <span>Open (FIFO)</span>
                    <strong>{formatMoney(unpaidSummary?.openAmount || 0)}</strong>
                    {unpaidSummary?.matches === false ? (
                      <em className="auditSummaryCardMeta">
                        Tally outstanding {formatMoney(unpaidSummary.outstandingUnpaid)} — see Outstanding Compare
                      </em>
                    ) : unpaidSummary?.balanceMatches === false ? (
                      <em className="auditSummaryCardMeta">
                        Sales − Collected {formatMoney(unpaidSummary.salesMinusCollected)} (gap {formatMoney(unpaidSummary.balanceDelta)})
                      </em>
                    ) : (
                      <em className="auditSummaryCardMeta">Matches Tally outstanding upload</em>
                    )}
                  </div>
                </div>
              </section>

              <section className="moduleSection" id="tally-statement">
                <div className="moduleSectionHeader">
                  <h2>{t("statementTitle")}</h2>
                  <span>{statementFileName}</span>
                </div>
                <p className="moduleHint">{t("statementHint")}</p>
                <div className="moduleFilterRow">
                  <button
                    type="button"
                    className="moduleInlineButton"
                    onClick={() => statementInputRef.current?.click()}
                  >
                    {t("statementUpload")}
                  </button>
                  <input
                    ref={statementInputRef}
                    type="file"
                    accept=".pdf,.xlsx,.xls,.csv,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    hidden
                    onChange={onStatementFile}
                  />
                  {statementResult ? (
                    <button
                      type="button"
                      className="moduleInlineButton"
                      onClick={() => {
                        setStatementResult(null);
                        setStatementFileName("");
                      }}
                    >
                      {t("statementClear")}
                    </button>
                  ) : null}
                  <label className="moduleHint">
                    <input
                      type="checkbox"
                      checked={showMatchedStatement}
                      onChange={(event) => setShowMatchedStatement(event.target.checked)}
                    />
                    {" "}
                    {t("statementShowMatched")}
                  </label>
                </div>
                {statementResult ? (
                  <>
                    <div className="auditSummaryGrid">
                      <div className="auditSummaryCard">
                        <span>{t("statementWindow")}</span>
                        <strong>
                          {statementResult.from || "—"}
                          {" → "}
                          {statementResult.to || "—"}
                        </strong>
                        {statementResult.opening?.amount ? (
                          <em className="auditSummaryCardMeta">
                            Opening {formatMoney(statementResult.opening.amount)}
                            {" "}
                            {statementResult.opening.side === "credit" ? "Cr" : "Dr"}
                          </em>
                        ) : null}
                      </div>
                      <div className="auditSummaryCard">
                        <span>{t("statementTallyNet")}</span>
                        <strong>{formatMoney(statementResult.totals.tallyNet)}</strong>
                      </div>
                      <div className="auditSummaryCard">
                        <span>{t("statementSfaNet")}</span>
                        <strong>{formatMoney(statementResult.totals.sfaNet)}</strong>
                      </div>
                      <div className="auditSummaryCard">
                        <span>{t("statementDiff")}</span>
                        <strong className={Math.abs(statementResult.totals.difference) > 0.05 ? "moduleBiMonthCell--down" : "moduleBiMonthCell--up"}>
                          {formatMoney(statementResult.totals.difference)}
                        </strong>
                        <em className="auditSummaryCardMeta">
                          {statementResult.totals.issueCount}
                          {" "}
                          {t("statementIssues")}
                        </em>
                      </div>
                    </div>
                    <p className={statementResult.lead ? "paymentSettleStatementLead" : "moduleHint"}>
                      {statementResult.lead ? (
                        <>
                          <strong>
                            {statementResult.lead.date || "—"}
                            {" · "}
                            {statementResult.lead.voucher || "—"}
                            {" · "}
                            {formatMoney(statementResult.lead.difference)}
                          </strong>
                          {" "}
                          {statementResult.lead.status === "sfa_only" ? t("statementLeadSfa")
                            : statementResult.lead.status === "amount" ? t("statementLeadAmount")
                              : statementResult.lead.status === "vat" ? t("statementLeadVat")
                                : t("statementLeadTally")}
                        </>
                      ) : t("statementAgree")}
                    </p>
                    <ExportableTable filename="tally-statement-mismatch" sheetName="Statement" className="moduleTableWrap">
                      <table className="moduleTable moduleBiTable paymentSettleTable">
                        <thead>
                          <tr>
                            <BiExcelHead label={t("statementDate")} filterKey="date" options={statementOptions} filters={statementFilters} onChange={setStatementFilter} />
                            <BiExcelHead label={t("statementVoucher")} filterKey="voucher" options={statementOptions} filters={statementFilters} onChange={setStatementFilter} />
                            <BiExcelHead label={t("statementType")} filterKey="type" options={statementOptions} filters={statementFilters} onChange={setStatementFilter} />
                            <BiExcelHead label={t("statementParticulars")} filterKey="particulars" options={statementOptions} filters={statementFilters} onChange={setStatementFilter} />
                            <BiExcelHead label={t("statementTallyDr")} filterKey="tallyDebit" options={statementOptions} filters={statementFilters} onChange={setStatementFilter} />
                            <BiExcelHead label={t("statementTallyCr")} filterKey="tallyCredit" options={statementOptions} filters={statementFilters} onChange={setStatementFilter} />
                            <BiExcelHead label={t("statementSfaDr")} filterKey="sfaDebit" options={statementOptions} filters={statementFilters} onChange={setStatementFilter} />
                            <BiExcelHead label={t("statementSfaCr")} filterKey="sfaCredit" options={statementOptions} filters={statementFilters} onChange={setStatementFilter} />
                            <BiExcelHead label={t("statementDiff")} filterKey="difference" options={statementOptions} filters={statementFilters} onChange={setStatementFilter} className="moduleBiTotalCol" />
                            <BiExcelHead label={t("statementCause")} filterKey="cause" options={statementOptions} filters={statementFilters} onChange={setStatementFilter} />
                          </tr>
                        </thead>
                        <tbody>
                          {visibleStatementRows.map((row) => (
                            <tr key={row.id} className={row.leadsGap ? "paymentSettleStatementLead" : undefined}>
                              <td>{row.date || "—"}</td>
                              <td>{row.voucher || "—"}</td>
                              <td>{row.vchType || "—"}</td>
                              <td>{row.particulars || "—"}</td>
                              <td>{formatMoney(row.tallyDebit)}</td>
                              <td>{formatMoney(row.tallyCredit)}</td>
                              <td>{formatMoney(row.sfaDebit)}</td>
                              <td>{formatMoney(row.sfaCredit)}</td>
                              <td className={row.leadsGap ? "moduleBiMonthCell--current" : (Math.abs(row.difference) > 0.05 ? "moduleBiMonthCell--down" : "moduleBiMonthCell--up")}>
                                {formatMoney(row.difference)}
                              </td>
                              <td>
                                {row.leadsGap ? `${t("causeLeads")} · ` : ""}
                                {t(statementCauseKey(row))}
                              </td>
                            </tr>
                          ))}
                          {!visibleStatementRows.length && (
                            <tr>
                              <td colSpan={10}>{t("statementAgree")}</td>
                            </tr>
                          )}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={4}><strong>{t("statementTotal")}</strong></td>
                            <td><strong>{formatMoney(visibleStatementRows.reduce((total, row) => total + row.tallyDebit, 0))}</strong></td>
                            <td><strong>{formatMoney(visibleStatementRows.reduce((total, row) => total + row.tallyCredit, 0))}</strong></td>
                            <td><strong>{formatMoney(visibleStatementRows.reduce((total, row) => total + row.sfaDebit, 0))}</strong></td>
                            <td><strong>{formatMoney(visibleStatementRows.reduce((total, row) => total + row.sfaCredit, 0))}</strong></td>
                            <td className="moduleBiTotalCol"><strong>{formatMoney(visibleStatementRows.reduce((total, row) => total + row.difference, 0))}</strong></td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </ExportableTable>
                  </>
                ) : null}
              </section>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>Sales Returns & Credit Notes</h2>
                  <span>
                    {formatCount(ledger.totals.credit_note_count || 0)} not full immediate reversals
                  </span>
                </div>
                <p className="moduleHint">
                  Partial credit notes, later credit notes, and sales returns (not same-day / next-day
                  full invoice reversals). Settlement nests them under the voucher FIFO applied them to.
                  They reduce Open and count in Paid when settled; never in avg days to pay.
                </p>
                <ExportableTable filename="payment-settlement-credit-notes" sheetName="CreditNotes" className="moduleTableWrap">
                  <table className="moduleTable moduleBiTable paymentSettleTable">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Voucher</th>
                        <th>Type</th>
                        <th>Reference</th>
                        <th>Applied To</th>
                        <th>Excl VAT</th>
                        <th>Incl VAT</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(ledger.creditNotes || []).map((row) => (
                        <tr key={`${row.credit_date}::${row.voucher_number}`}>
                          <td>{row.credit_date || "—"}</td>
                          <td>{row.voucher_number || "—"}</td>
                          <td>{row.kind || row.voucher_type || "Credit Note"}</td>
                          <td>{row.reference || "—"}</td>
                          <td>{row.applied_to_voucher || "—"}</td>
                          <td>{formatMoney(row.amount_excl_vat)}</td>
                          <td>{formatMoney(row.amount_incl_vat)}</td>
                          <td><span className={statusClass("Credit")}>{row.kind || "Credit"}</span></td>
                        </tr>
                      ))}
                      {!(ledger.creditNotes || []).length && (
                        <tr>
                          <td colSpan={8}>No sales returns or partial/later credit notes for this customer.</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={5}><strong>Total</strong></td>
                        <td><strong>{formatMoney(ledger.totals.credit_note_excl_vat || 0)}</strong></td>
                        <td><strong>{formatMoney(ledger.totals.credit_note_amount || 0)}</strong></td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              </section>

              <section className="moduleSection" id="invoices-settlement">
                <div className="moduleSectionHeader">
                  <h2>Invoices & Settlement</h2>
                  <span>
                    {formatCount(ledger.totals.paid_invoice_count)} paid ·{" "}
                    {formatCount(ledger.totals.partial_invoice_count)} partial ·{" "}
                    {formatCount(ledger.totals.open_invoice_count)} open
                    {historyMeta?.fromDate ? ` · from ${historyMeta.fromDate}` : ""}
                    {historyMeta?.transactionCount != null
                      ? ` · ${formatCount(historyMeta.transactionCount)} sales lines`
                      : ""}
                  </span>
                </div>
                <p className="moduleHint">
                  Referenced credit notes settle the named Ref. No. and count in
                  Paid — they do not cut that invoice&apos;s sales. Machine Open is sales − cash − CN. Tally Open
                  is the outstanding upload, including a reversed voucher Tally still has pending. Open Δ — use{" "}
                  <a href="#outstanding-compare">Tally vs Computed Outstanding</a> below.
                </p>
                <ExportableTable filename="payment-settlement-invoices" sheetName="Invoices" className="moduleTableWrap">
                  <table className="moduleTable moduleBiTable paymentSettleTable paymentSettleInvoiceTable">
                    <thead>
                      <tr>
                        <th>Sales Date</th>
                        <th>Voucher</th>
                        <th>Sales excl VAT</th>
                        <th>Sales incl VAT</th>
                        <th>Paid</th>
                        <th>Machine Open</th>
                        <th>Tally Open</th>
                        <th>Open Δ</th>
                        <th>Status</th>
                        <th>Payment Days</th>
                        <th>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.invoices.map((invoice) => {
                        const key = `${invoice.invoice_date}::${invoice.voucher_number}`;
                        const open = expandedInvoice === key;
                        return (
                          <InvoiceSettlementRow
                            key={key}
                            invoice={invoice}
                            open={open}
                            onToggle={() => setExpandedInvoice(open ? "" : key)}
                          />
                        );
                      })}
                      {!ledger.invoices.length && (
                        <tr>
                          <td colSpan={11}>No sales invoices found for this customer in history.</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2}><strong>Total</strong></td>
                        <td><strong>{formatMoney(ledger.totals.invoice_sales_excl_vat ?? ledger.totals.sales_excl_vat)}</strong></td>
                        <td><strong>{formatMoney(ledger.totals.invoice_sales_incl_vat ?? ledger.totals.sales_incl_vat)}</strong></td>
                        <td><strong>{formatMoney(
                          Number(ledger.totals.paid_amount || 0) - Number(ledger.totals.reversed_sales_incl_vat || 0),
                        )}</strong></td>
                        <td><strong>{formatMoney(unpaidSummary?.machineOpenTotal ?? ledger.totals.open_sales_amount)}</strong></td>
                        <td><strong>{formatMoney(unpaidSummary?.tallyOpenTotal || 0)}</strong></td>
                        <td className={deltaClass(
                          Number(unpaidSummary?.machineOpenTotal || 0) - Number(unpaidSummary?.tallyOpenTotal || 0),
                        )}>
                          <strong>{formatDelta(
                            Number(unpaidSummary?.machineOpenTotal || 0) - Number(unpaidSummary?.tallyOpenTotal || 0),
                          )}</strong>
                        </td>
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              </section>

              <section className="moduleSection" id="outstanding-compare">
                <div className="moduleSectionHeader">
                  <h2>Tally vs Computed Outstanding</h2>
                  <span>
                    {formatCount(ledger.outstandingCompareTotals?.discrepancy_count || 0)} gaps ·{" "}
                    computed {formatMoney(ledger.outstandingCompareTotals?.computed_open || 0)} ·{" "}
                    Tally {formatMoney(ledger.outstandingCompareTotals?.tally_open || 0)}
                  </span>
                </div>
                <p className="moduleHint">
                  Computed open = sales − cash receipts (FIFO) − credit notes allocated to that invoice.
                  Compare that to Tally outstanding. Gaps that remain after credit notes are real
                  differences between the books and our calculation.
                </p>
                <div className="auditSummaryGrid" style={{ marginBottom: 12 }}>
                  <div className="auditSummaryCard">
                    <span>Tally outstanding</span>
                    <strong>{formatMoney(ledger.outstandingCompareTotals?.tally_open || 0)}</strong>
                  </div>
                  <div className="auditSummaryCard">
                    <span>Computed outstanding</span>
                    <strong>{formatMoney(ledger.outstandingCompareTotals?.computed_open || 0)}</strong>
                    <em className="auditSummaryCardMeta">
                      Cash {formatMoney(ledger.outstandingCompareTotals?.cash_settled || 0)}
                      {" + CN "}
                      {formatMoney(ledger.outstandingCompareTotals?.credit_note_settled || 0)}
                    </em>
                  </div>
                  <div className="auditSummaryCard">
                    <span>Open gap (computed − Tally)</span>
                    <strong className={deltaClass(ledger.outstandingCompareTotals?.open_delta || 0)}>
                      {formatDelta(ledger.outstandingCompareTotals?.open_delta || 0)}
                    </strong>
                    <em className="auditSummaryCardMeta">
                      Higher {formatMoney(ledger.outstandingCompareTotals?.computed_higher || 0)}
                      {" · Lower "}
                      {formatMoney(Math.abs(ledger.outstandingCompareTotals?.computed_lower || 0))}
                    </em>
                  </div>
                </div>
                <ExportableTable filename="payment-settlement-outstanding-compare" sheetName="OutstandingCompare" className="moduleTableWrap">
                  <table className="moduleTable moduleBiTable paymentSettleTable">
                    <thead>
                      <tr>
                        <th>Sales Date</th>
                        <th>Voucher</th>
                        <th>Sales incl VAT</th>
                        <th>Cash FIFO</th>
                        <th>Credit Notes</th>
                        <th>Computed Settled</th>
                        <th>Computed Open</th>
                        <th>Tally Open</th>
                        <th>Open Δ</th>
                        <th>Status / note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        (ledger.outstandingCompareTotals?.has_outstanding_rows
                          ? ledger.outstandingCompareRows
                          : ledger.outstandingCompareAllRows)
                        || []
                      ).map((row) => (
                        <tr key={`oc-${row.invoice_date}-${row.voucher_number}`}>
                          <td>{row.invoice_date || "—"}</td>
                          <td>{row.voucher_number || "—"}</td>
                          <td>{formatMoney(row.sales_incl_vat)}</td>
                          <td>{formatMoney(row.cash_settled)}</td>
                          <td>{formatMoney(row.credit_note_settled)}</td>
                          <td className="moduleBiTotalCol">{formatMoney(row.computed_settled)}</td>
                          <td>{formatMoney(row.computed_open)}</td>
                          <td>{formatMoney(row.tally_open)}</td>
                          <td className={deltaClass(row.open_delta)}>{formatDelta(row.open_delta)}</td>
                          <td>
                            <span className={statusClass(
                              row.status === "Match" || row.status === "Computed only"
                                ? "Paid"
                                : (row.open_delta > 0 ? "Open" : "Partial"),
                            )}
                            >
                              {row.status}
                            </span>
                            <div className="auditSummaryCardMeta">{row.note}</div>
                            {(row.credit_chunks || []).length ? (
                              <div className="auditSummaryCardMeta">
                                {(row.credit_chunks || []).map((chunk, index) => (
                                  <div key={`cn-${chunk.voucher_number}-${index}`}>
                                    CN {chunk.voucher_number || "—"}
                                    {chunk.credit_date ? ` · ${chunk.credit_date}` : ""}
                                    {`: ${formatMoney(chunk.amount)}`}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            {(row.receipt_chunks || []).length ? (
                              <div className="auditSummaryCardMeta">
                                {(row.receipt_chunks || []).map((chunk, index) => (
                                  <div key={`rc-${chunk.vch_no}-${index}`}>
                                    Rcpt {chunk.vch_no || "—"} on {chunk.receipt_date}: {formatMoney(chunk.amount)}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                      {!(
                        (ledger.outstandingCompareTotals?.has_outstanding_rows
                          ? ledger.outstandingCompareRows
                          : ledger.outstandingCompareAllRows)
                        || []
                      ).length && (
                        <tr>
                          <td colSpan={10}>
                            {Number(ledger.summary?.outstandingTotal || ledger.totals?.outstanding_unpaid || 0) > 0
                              || ledger.outstandingCompareTotals?.has_outstanding_rows
                              ? "No Tally vs computed outstanding gaps for this customer."
                              : "Upload outstanding invoice rows to compare Tally with computed open (cash + CN)."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2}><strong>Total</strong></td>
                        <td><strong>{formatMoney(ledger.outstandingCompareTotals?.sales_incl_vat || 0)}</strong></td>
                        <td><strong>{formatMoney(ledger.outstandingCompareTotals?.cash_settled || 0)}</strong></td>
                        <td><strong>{formatMoney(ledger.outstandingCompareTotals?.credit_note_settled || 0)}</strong></td>
                        <td className="moduleBiTotalCol">
                          <strong>{formatMoney(ledger.outstandingCompareTotals?.computed_settled || 0)}</strong>
                        </td>
                        <td><strong>{formatMoney(ledger.outstandingCompareTotals?.computed_open || 0)}</strong></td>
                        <td><strong>{formatMoney(ledger.outstandingCompareTotals?.tally_open || 0)}</strong></td>
                        <td className={deltaClass(ledger.outstandingCompareTotals?.open_delta || 0)}>
                          <strong>{formatDelta(ledger.outstandingCompareTotals?.open_delta || 0)}</strong>
                        </td>
                        <td>
                          Unmatched receipts {formatMoney(ledger.outstandingCompareTotals?.unmatched_receipt_amount || 0)}
                          {" · Unapplied CN "}
                          {formatMoney(ledger.outstandingCompareTotals?.unmatched_credit_note_amount || 0)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              </section>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>Cash-only FIFO check</h2>
                  <span>
                    {formatCount(ledger.totals.tally_fifo_discrepancy_count || 0)} invoices ·{" "}
                    over {formatMoney(ledger.totals.tally_fifo_over_allocated || 0)} ·{" "}
                    under {formatMoney(Math.abs(ledger.totals.tally_fifo_under_allocated || 0))}
                  </span>
                </div>
                <p className="moduleHint">
                  Same invoices without counting credit notes — useful to see how much of a book gap
                  is explained by CNs in the table above.
                </p>
                <ExportableTable filename="payment-settlement-tally-fifo" sheetName="TallyVsFifo" className="moduleTableWrap">
                  <table className="moduleTable moduleBiTable paymentSettleTable">
                    <thead>
                      <tr>
                        <th>Sales Date</th>
                        <th>Voucher</th>
                        <th>Sales incl VAT</th>
                        <th>Book Paid</th>
                        <th>FIFO Paid</th>
                        <th>Paid Δ</th>
                        <th>Book Open</th>
                        <th>FIFO Open</th>
                        <th>Open Δ</th>
                        <th>Where / note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(ledger.tallyFifoDiscrepancies || []).map((row) => (
                        <tr key={`disc-${row.invoice_date}-${row.voucher_number}`}>
                          <td>{row.invoice_date || "—"}</td>
                          <td>{row.voucher_number || "—"}</td>
                          <td>{formatMoney(row.sales_incl_vat)}</td>
                          <td>{formatMoney(row.book_paid)}</td>
                          <td>{formatMoney(row.fifo_paid)}</td>
                          <td className={deltaClass(row.paid_delta)}>{formatDelta(row.paid_delta)}</td>
                          <td>{formatMoney(row.book_open)}</td>
                          <td>{formatMoney(row.fifo_open)}</td>
                          <td className={deltaClass(row.open_delta)}>{formatDelta(row.open_delta)}</td>
                          <td>
                            {row.note}
                            {(row.receipt_chunks || []).length ? (
                              <div className="auditSummaryCardMeta">
                                {(row.receipt_chunks || []).map((chunk, index) => (
                                  <div key={`${chunk.receipt_date}-${chunk.vch_no}-${index}`}>
                                    Rcpt {chunk.vch_no || "—"} on {chunk.receipt_date}: {formatMoney(chunk.amount)}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                      {!(ledger.tallyFifoDiscrepancies || []).length && (
                        <tr>
                          <td colSpan={10}>
                            {Number(ledger.summary?.outstandingTotal || ledger.totals?.outstanding_unpaid || 0) > 0
                              ? "No cash-only Tally vs FIFO gaps for this customer."
                              : "Upload outstanding invoice rows to compare Tally book settlement with FIFO."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3}><strong>Discrepancy total</strong></td>
                        <td><strong>{formatMoney(ledger.tallyFifoTotals?.book_paid || 0)}</strong></td>
                        <td><strong>{formatMoney(ledger.tallyFifoTotals?.fifo_paid || 0)}</strong></td>
                        <td className={deltaClass(ledger.tallyFifoTotals?.paid_delta || 0)}>
                          <strong>{formatDelta(ledger.tallyFifoTotals?.paid_delta || 0)}</strong>
                        </td>
                        <td><strong>{formatMoney(ledger.tallyFifoTotals?.book_open || 0)}</strong></td>
                        <td><strong>{formatMoney(ledger.tallyFifoTotals?.fifo_open || 0)}</strong></td>
                        <td className={deltaClass(ledger.tallyFifoTotals?.open_delta || 0)}>
                          <strong>{formatDelta(ledger.tallyFifoTotals?.open_delta || 0)}</strong>
                        </td>
                        <td>
                          Unmatched receipts: {formatMoney(ledger.tallyFifoTotals?.unmatched_receipt_amount || 0)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              </section>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>Reversed by Credit Note</h2>
                  <span>
                    {formatCount(ledger.totals.reversed_invoice_count || 0)} excluded from avg days to pay
                  </span>
                </div>
                <p className="moduleHint">
                  Same-day, next-day, or previous-day credit notes that fully reverse an invoice
                  (including reissue pairs like CN on 31 Dec against invoice on 1 Jan). These are not
                  customer payments.
                </p>
                <ExportableTable filename="payment-settlement-reversed" sheetName="Reversed" className="moduleTableWrap">
                  <table className="moduleTable moduleBiTable paymentSettleTable">
                    <thead>
                      <tr>
                        <th>Sales Date</th>
                        <th>Invoice Voucher</th>
                        <th>Sales excl VAT</th>
                        <th>Sales incl VAT</th>
                        <th>Credit Note Date</th>
                        <th>Credit Note Voucher</th>
                        <th>Credit Note Amount</th>
                        <th>Reversal Days</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(ledger.reversedInvoices || []).map((row) => (
                        <tr key={`${row.invoice_date}::${row.voucher_number}::${row.credit_note_voucher}`}>
                          <td>{row.invoice_date || "—"}</td>
                          <td>{row.voucher_number || "—"}</td>
                          <td>{formatMoney(row.amount_excl_vat)}</td>
                          <td>{formatMoney(row.amount_incl_vat)}</td>
                          <td>{row.credit_note_date || "—"}</td>
                          <td>{row.credit_note_voucher || "—"}</td>
                          <td>{formatMoney(row.credit_note_amount)}</td>
                          <td>{row.reversal_days != null ? row.reversal_days : "—"}</td>
                          <td><span className={statusClass("Reversed")}>Reversed</span></td>
                        </tr>
                      ))}
                      {!(ledger.reversedInvoices || []).length && (
                        <tr>
                          <td colSpan={9}>No immediate credit-note reversals for this customer.</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2}><strong>Total</strong></td>
                        <td><strong>{formatMoney(ledger.totals.reversed_sales_excl_vat || 0)}</strong></td>
                        <td><strong>{formatMoney(ledger.totals.reversed_sales_incl_vat || 0)}</strong></td>
                        <td colSpan={5} />
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              </section>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>Payment Matched to Purchase</h2>
                  <span>
                    {formatCount(ledger.totals.matched_purchase_payment_count || 0)} purchase applications
                  </span>
                </div>
                <p className="moduleHint">
                  Dual customer+supplier Payments applied to Purchase bills. Exact same-amount pairs
                  are Matched; other amounts are Applied oldest-open FIFO. Leftover Payment after
                  Purchases settles open sales invoices.
                </p>
                <ExportableTable filename="payment-settlement-purchase-matches" sheetName="PurchaseMatches" className="moduleTableWrap">
                  <table className="moduleTable moduleBiTable paymentSettleTable">
                    <thead>
                      <tr>
                        <th>Purchase Date</th>
                        <th>Purchase Voucher</th>
                        <th>Purchase Amount</th>
                        <th>Payment Date</th>
                        <th>Payment Voucher</th>
                        <th>Payment Amount</th>
                        <th>Match Days</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(ledger.matchedPurchasePayments || []).map((row) => (
                        <tr key={`${row.purchase_date}::${row.purchase_voucher}::${row.payment_voucher}`}>
                          <td>{row.purchase_date || "—"}</td>
                          <td>{row.purchase_voucher || "—"}</td>
                          <td>{formatMoney(row.purchase_amount)}</td>
                          <td>{row.payment_date || "—"}</td>
                          <td>{row.payment_voucher || "—"}</td>
                          <td>{formatMoney(row.amount)}</td>
                          <td>{row.match_days != null ? row.match_days : "—"}</td>
                          <td>
                            <span className={statusClass(row.status || "Matched")}>
                              {row.status || "Matched"}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {!(ledger.matchedPurchasePayments || []).length && (
                        <tr>
                          <td colSpan={8}>No Payment↔Purchase applications for this customer.</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={2}><strong>Total</strong></td>
                        <td><strong>{formatMoney(ledger.totals.matched_purchase_payment_amount || 0)}</strong></td>
                        <td colSpan={2} />
                        <td><strong>{formatMoney(ledger.totals.matched_purchase_payment_amount || 0)}</strong></td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              </section>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>Datewise Sales & Collections</h2>
                </div>
                <p className="moduleHint">
                  Use + / − on a date to see that day’s invoices, receipts, and the purchase or sales bills a Payment was adjusted against. A Purchase no Payment covers is listed against the earlier sales invoice it settles. Collected is sales cash only.
                </p>
                <ExportableTable filename="payment-settlement-datewise" sheetName="Datewise" className="moduleTableWrap">
                  <table className="moduleTable moduleBiTable paymentSettleTable">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Invoices</th>
                        <th>Sales excl VAT</th>
                        <th>Sales incl VAT</th>
                        <th>Receipts</th>
                        <th>Collected</th>
                        <th>Open Sales on Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.datewise.map((row) => {
                        const open = expandedDate === row.date;
                        return (
                          <DatewiseDayRow
                            key={row.date}
                            row={row}
                            open={open}
                            onToggle={() => setExpandedDate(open ? "" : row.date)}
                          />
                        );
                      })}
                      {!ledger.datewise.length && (
                        <tr>
                          <td colSpan={7}>No dated sales or collections found.</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td><strong>Total</strong></td>
                        <td><strong>{formatCount(ledger.totals.invoice_count)}</strong></td>
                        <td><strong>{formatMoney(ledger.totals.invoice_sales_excl_vat ?? ledger.totals.sales_excl_vat)}</strong></td>
                        <td><strong>{formatMoney(ledger.totals.invoice_sales_incl_vat ?? ledger.totals.sales_incl_vat)}</strong></td>
                        <td />
                        <td><strong>{formatMoney(ledger.totals.collected_amount)}</strong></td>
                        <td><strong>{formatMoney(ledger.totals.open_sales_amount)}</strong></td>
                      </tr>
                    </tfoot>
                  </table>
                </ExportableTable>
              </section>

              <section className="moduleSection">
                <div className="moduleSectionHeader">
                  <h2>Settlement Events (FIFO)</h2>
                  <span>
                    Unmatched receipts: {formatMoney(ledger.totals.unmatched_receipt_amount)}
                  </span>
                </div>
                <ExportableTable filename="payment-settlement-events" sheetName="Settlements" className="moduleTableWrap">
                  <table className="moduleTable moduleBiTable paymentSettleTable">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Voucher No</th>
                        <th>Applied To</th>
                        <th>Target Date</th>
                        <th>Target Voucher</th>
                        <th>Amount</th>
                        <th>Days to Pay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.settlementEvents.map((row, index) => (
                        <tr key={`${row.receipt_date}-${row.voucher_number}-${row.vch_no}-${index}`}>
                          <td>{row.receipt_date}</td>
                          <td>{row.vch_no || "—"}</td>
                          <td>{row.target_kind === "purchase" ? "Purchase" : "Sales"}</td>
                          <td>{row.invoice_date || "—"}</td>
                          <td>{row.voucher_number || "—"}</td>
                          <td>{formatMoney(row.amount)}</td>
                          <td>{row.days != null ? row.days : "—"}</td>
                        </tr>
                      ))}
                      {!ledger.settlementEvents.length && (
                        <tr>
                          <td colSpan={7}>No settlements yet — need both sales and receipt uploads for this customer.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </ExportableTable>
              </section>
            </>
          )}
        </div>
      </main>
    </MorningAttendanceGate>
  );
}
