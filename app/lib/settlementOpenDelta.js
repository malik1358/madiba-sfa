/** One fil. Smaller Machine Open vs Tally Open gaps are rounding dust. */
export const SETTLEMENT_OPEN_DELTA_DUST = 0.009;

export function isSettlementOpenDeltaDust(value) {
  const number = Number(value || 0);
  return Math.abs(number) <= SETTLEMENT_OPEN_DELTA_DUST;
}

/** Open Δ on Payment Settlement and Customer Audit. Dust shows as 0 on both. */
export function formatSettlementOpenDelta(value) {
  const number = Number(value || 0);
  if (isSettlementOpenDeltaDust(number)) return "0";
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

/**
 * SFA sales amount minus the Tally bill on the same voucher.
 * A Tally amount of 0 means that voucher is not on the outstanding file, so there is no bill to compare.
 */
export function settlementTransactionDelta(invoice) {
  if (invoice?.outstanding_pending == null) return null;
  const tally = Number(invoice.outstanding_pending || 0);
  if (!Number.isFinite(tally)) return null;
  if (Math.abs(tally) <= SETTLEMENT_OPEN_DELTA_DUST) return 0;
  const sales = Number(invoice.gross_amount_incl_vat ?? invoice.amount_incl_vat ?? 0);
  return roundMoney(sales - tally);
}
