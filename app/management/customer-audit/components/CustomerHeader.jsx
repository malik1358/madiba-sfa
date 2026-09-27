import Link from "next/link";
import { formatPaymentDaysLabel, HISTORIC_PERFORMANCE_PERIOD_LABEL, HISTORIC_PERFORMANCE_SHORT_LABEL } from "../../../lib/paymentBehavior.js";
import { blockedByAvgDaysMessage } from "../../../lib/customerOrderBlock.js";

export default function CustomerHeader({
  customer,
  analytics,
  outstandingSalesman = "",
  orderBlock = null,
  canManageOrderBlock = false,
  updatingOrderBlock = false,
  onToggleOrderBlock = null,
}) {
  const salesmanLabel = String(outstandingSalesman || "").trim()
    || String(customer.current_salesman_code || "").trim()
    || "NO SALESMAN";
  const payment = analytics?.paymentBehavior || null;
  const avgDaysLabel = formatPaymentDaysLabel(payment);
  const unpaidTotal = Number(payment?.outstandingTotal || 0);
  const unpaidOldest = Number(payment?.outstandingOldestDays || 0);
  const receiptAmountLast10Days = Number(analytics?.receiptAmountLast10Days || 0);
  const settlementHref = `/management/payment-settlement?customer_code=${encodeURIComponent(customer.customer_code || "")}`;
  const blockMessage = orderBlock?.blocked
    ? blockedByAvgDaysMessage({
      threshold: orderBlock.threshold,
      avgDaysToPay: orderBlock.avgDaysToPay,
    })
    : "";

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
              Lifetime
              {Number(payment.openAmountInAvg || 0) > 0.009
                ? " · paid avg + open older than that avg only"
                : " · from collected receipts"}
            </em>
          ) : null}
          {payment?.avgDaysToPay6m != null ? (
            <em className="auditSummaryCardMeta">
              {HISTORIC_PERFORMANCE_PERIOD_LABEL}: {payment.avgDaysToPay6m} days
              {Number(payment.openAmountInAvg6m || 0) > 0.009
                ? ` · includes open older than ${HISTORIC_PERFORMANCE_SHORT_LABEL} paid avg`
                : ""}
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
        <div className="auditSummaryCard">
          <span>Order block (Avg ≥ 120)</span>
          <strong style={{ color: orderBlock?.blocked ? "#b42318" : "#0f766e" }}>
            {orderBlock?.blocked ? "Blocked" : "Allowed"}
          </strong>
          {orderBlock?.isAdminUnblocked ? (
            <em className="auditSummaryCardMeta">Unblocked by admin override</em>
          ) : null}
          {blockMessage ? (
            <em className="auditSummaryCardMeta">{blockMessage}</em>
          ) : null}
          {canManageOrderBlock && typeof onToggleOrderBlock === "function" ? (
            <button
              type="button"
              className="moduleInlineButton moduleActionButton"
              style={{ marginTop: "8px", alignSelf: "flex-start" }}
              onClick={onToggleOrderBlock}
              disabled={updatingOrderBlock || !orderBlock?.isOverThreshold}
              title={!orderBlock?.isOverThreshold ? "Average below threshold; unblock override is not needed." : ""}
            >
              {updatingOrderBlock
                ? "Saving..."
                : (orderBlock?.isAdminUnblocked ? "Re-enable block rule" : "Unblock for orders")}
            </button>
          ) : null}
        </div>
      </section>
    </section>
  );
}
