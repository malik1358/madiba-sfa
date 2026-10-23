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
 * When Tally still shows the bill, Open Δ is the sales amount minus that bill.
 * Otherwise Tally's figure is the unpaid remainder, and Open Δ is Machine Open minus it.
 * A Tally amount of 0 is a listed bill with nothing pending, so Machine Open still counts.
 */
const BILL_AMOUNT_SPAN = 1;

export function settlementTransactionDelta(invoice) {
  if (invoice?.outstanding_pending == null) return null;
  const tally = Number(invoice.outstanding_pending || 0);
  if (!Number.isFinite(tally)) return null;
  const sales = Number(invoice.gross_amount_incl_vat ?? invoice.amount_incl_vat ?? 0);
  const machine = Number(invoice.remaining || 0);
  if (Math.abs(tally) > SETTLEMENT_OPEN_DELTA_DUST && Math.abs(sales - tally) <= BILL_AMOUNT_SPAN) {
    return roundMoney(sales - tally);
  }
  return roundMoney(machine - tally);
}
