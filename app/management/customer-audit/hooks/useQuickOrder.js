import { useMemo } from 'react';
import { buildQuickOrderSuggestions } from '../lib/quickOrder';

export function useQuickOrder({ analytics, transactions, peerTransactions, itemMaster }) {
  return useMemo(
    () => buildQuickOrderSuggestions({ analytics, transactions, peerTransactions, itemMaster }),
    [analytics, transactions, peerTransactions, itemMaster]
  );
}
