import { useMemo } from 'react';
import { buildAnalytics } from '../lib/analytics';

export function useAnalytics(transactions, receipts = [], lifetime = {}, outstanding = {}) {
  return useMemo(
    () => buildAnalytics(transactions, {
      receipts,
      lifetimeSales: lifetime.lifetimeSales,
      lifetimeSkuCount: lifetime.lifetimeSkuCount,
      lifetimeReceipts: lifetime.lifetimeReceipts,
      outstandingCustomer: outstanding.customer,
      outstandingInvoices: outstanding.customerInvoices,
    }),
    [
      transactions,
      receipts,
      lifetime.lifetimeSales,
      lifetime.lifetimeSkuCount,
      lifetime.lifetimeReceipts,
      outstanding.customer,
      outstanding.customerInvoices,
    ],
  );
}
