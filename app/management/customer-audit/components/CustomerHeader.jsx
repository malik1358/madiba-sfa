import Link from "next/link";
import { formatPaymentDaysLabel } from "../../../lib/paymentBehavior.js";

export default function CustomerHeader({ customer, analytics, outstandingSalesman = "" }) {
  const salesmanLabel = String(outstandingSalesman || "").trim()
    || String(customer.current_salesman_code || "").trim()
    || "NO SALESMAN";
  const payment = analytics?.paymentBehavior || null;
  const avgDaysLabel = formatPaymentDaysLabel(payment);
  const unpaidTotal = Number(payment?.outstandingTotal || 0);
  const unpaidOldest = Number(payment?.outstandingOldestDays || 0);
  const receiptAmountLast10Days = Number(analytics?.receiptAmountLast10Days || 0);
  const settlementHref = `/management/payment-settlement?customer_code=${encodeURIComponent(customer.customer_code || "")}`;

  return (
    <section className="auditCustomerHero">
      <div className="auditHeroCode">{customer.customer_code}</div>
      <h2>
        {customer.customer_code} {customer.customer_name}
      </h2>
      <div className="auditHeroSalesman">{salesmanLabel}</div>

      <section className="auditSummaryGrid">
        <div className="auditSummaryCard">
          <span>Orders</span>
          <strong>{analytics?.orderCount ?? 0}</strong>
        </div>
        <div className="auditSummaryCard">
          <span>Last Purchase</span>
          <strong>{analytics?.latestDate || "-"}</strong>
        </div>
        <div className="auditSummaryCard">
          <span>Avg Days to Pay</span>
          <strong>{avgDaysLabel}</strong>
          {payment?.avgDaysToPay != null ? (
            <em className="auditSummaryCardMeta">
              {Number(payment.openAmountInAvg || 0) > 0.009
                ? "Paid avg + open older than that avg only"
                : "From collected receipts"}
            </em>
          ) : null}
          {payment?.avgDaysPaidOnly != null
            && Number(payment.openAmountInAvg || 0) > 0.009
            && payment.avgDaysPaidOnly !== payment.avgDaysToPay ? (
            <em className="auditSummaryCardMeta">
              Paid-only avg: {payment.avgDaysPaidOnly}d
            </em>
          ) : null}
          {unpaidTotal > 0 && unpaidOldest > 0 ? (
            <em className="auditSummaryCardMeta">
              Oldest unpaid invoice: {unpaidOldest}d
            </em>
          ) : null}
          <Link href={settlementHref} className="auditSummaryCardLink">
            Settlement detail
          </Link>
        </div>
        <div className="auditSummaryCard">
          <span>Unpaid Bills</span>
          <strong>
            {unpaidTotal > 0
              ? unpaidTotal.toLocaleString("en-US", { maximumFractionDigits: 0 })
              : "0"}
          </strong>
          {unpaidTotal > 0 && unpaidOldest > 0 ? (
            <em style={{ display: "block", fontStyle: "normal", fontSize: "0.78rem", opacity: 0.8 }}>
              oldest {unpaidOldest}d
              {payment?.outstandingOverdueCount > 0
                ? ` · ${payment.outstandingOverdueCount} overdue`
                : ""}
            </em>
          ) : null}
        </div>
        <div className="auditSummaryCard">
          <span>Receipt amount (last 10 days)</span>
          <strong>
            {receiptAmountLast10Days > 0
              ? receiptAmountLast10Days.toLocaleString("en-US", { maximumFractionDigits: 0 })
              : "0"}
          </strong>
        </div>
      </section>
    </section>
  );
}
