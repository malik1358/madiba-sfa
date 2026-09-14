import { useMemo } from 'react';
import { buildAnalytics } from '../lib/analytics';

export function useAnalytics(transactions, receipts = []) {
  return useMemo(
    () => buildAnalytics(transactions, { receipts }),
    [transactions, receipts],
  );
}
