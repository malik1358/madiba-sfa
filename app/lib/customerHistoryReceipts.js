/**
 * Fold a customer-history payload into the audit screen state.
 * A response with receipts still loading must not replace Paid / Machine Open.
 * Sales without the receipt register marks paid invoices Open.
 */
export function mergeCustomerHistoryState(current = {}, history = {}) {
  const transactions = Array.isArray(history?.transactions) ? history.transactions : [];
  const peerTransactions = Array.isArray(history?.peerTransactions) ? history.peerTransactions : [];

  if (history?.receiptsPending) {
    if (current?.receiptsSettled) {
      return {
        transactions,
        peerTransactions,
        receipts: Array.isArray(current.receipts) ? current.receipts : [],
        receiptsPending: false,
        receiptsSettled: true,
      };
    }
    return {
      transactions,
      peerTransactions,
      receipts: [],
      receiptsPending: true,
      receiptsSettled: false,
    };
  }

  return {
    transactions,
    peerTransactions,
    receipts: Array.isArray(history?.receipts) ? history.receipts : [],
    receiptsPending: false,
    receiptsSettled: true,
  };
}
