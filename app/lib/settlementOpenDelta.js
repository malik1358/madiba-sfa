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
 * Open Δ on the invoice table is Machine Open minus Tally Open.
 * A paid invoice whose Tally bill is one fil off the sales amount still
 * shows the full open gap (machine 0 minus that bill), not the one fil.
 * A Tally amount of 0 is a listed bill with nothing pending, so Machine Open still counts.
 */
export function settlementTransactionDelta(invoice) {
  if (invoice?.outstanding_pending == null) return null;
  const tally = Number(invoice.outstanding_pending || 0);
  if (!Number.isFinite(tally)) return null;
  const machine = Number(invoice.remaining || 0);
  if (!Number.isFinite(machine)) return null;
  return roundMoney(machine - tally);
}

/**
 * Outstanding Compare keeps the sales-versus-bill gap. A one-fil difference
 * still counts as that bill. A larger gap is Machine Open minus Tally Open.
 */
const BILL_AMOUNT_SPAN = 0.01;

export function settlementSalesBillDelta(invoice) {
  if (invoice?.outstanding_pending == null) return null;
  const tally = Number(invoice.outstanding_pending || 0);
  if (!Number.isFinite(tally)) return null;
  const sales = Number(invoice.gross_amount_incl_vat ?? invoice.amount_incl_vat ?? 0);
  const machine = Number(invoice.remaining || 0);
  if (Math.abs(tally) > SETTLEMENT_OPEN_DELTA_DUST && Math.abs(roundMoney(sales - tally)) <= BILL_AMOUNT_SPAN) {
    return roundMoney(sales - tally);
  }
  return roundMoney(machine - tally);
}
