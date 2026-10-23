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
 * SFA sales minus the Tally figure on the same voucher.
 * A Tally amount of 0 means that voucher is not on the outstanding file.
 * A Tally amount within 1 SAR of the sale is still that bill.
 * A much smaller Tally amount is only the unpaid remainder. A fils of 0.05 or
 * less between Machine Open and that remainder stays here. Anything larger is
 * a different transaction and is left to the statement, not painted on this sale.
 */
const BILL_AMOUNT_SPAN = 1;
const REMAINDER_FILS = 0.05;

export function settlementTransactionDelta(invoice) {
  if (invoice?.outstanding_pending == null) return null;
  const tally = Number(invoice.outstanding_pending || 0);
  if (!Number.isFinite(tally)) return null;
  if (Math.abs(tally) <= SETTLEMENT_OPEN_DELTA_DUST) return 0;
  const sales = Number(invoice.gross_amount_incl_vat ?? invoice.amount_incl_vat ?? 0);
  if (Math.abs(sales - tally) <= BILL_AMOUNT_SPAN) return roundMoney(sales - tally);
  const machine = Number(invoice.remaining || 0);
  const remainderGap = roundMoney(machine - tally);
  if (Math.abs(remainderGap) <= REMAINDER_FILS) return remainderGap;
  return 0;
}
