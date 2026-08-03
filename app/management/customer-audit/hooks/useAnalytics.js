import { useMemo } from 'react';
import { buildAnalytics } from '../lib/analytics';

export function useAnalytics(transactions) {
  return useMemo(() => buildAnalytics(transactions), [transactions]);
}
