import test from 'node:test';
import assert from 'node:assert/strict';

import { buildQuickOrderSuggestions } from '../app/management/customer-audit/lib/quickOrder.js';

test('New Items falls back to unseen catalog items from purchased categories', () => {
  const suggestions = buildQuickOrderSuggestions({
    analytics: { months: ['2026-08'] },
    transactions: [{
      item_code: 'A001',
      item_name: 'Bought Item',
      category: 'Office',
      quantity: 2,
      rate: 0,
      sales_amount: 100,
      transaction_date: '2026-08-01',
    }],
    peerTransactions: [],
    itemMaster: [
      { item_code: 'A001', item_name: 'Bought Item', category: 'Office', is_active: true },
      { item_code: 'B001', item_name: 'Related New Item', category: 'Office', is_active: true },
      { item_code: 'C001', item_name: 'Other New Item', category: 'Sundry', is_active: true },
    ],
  });

  assert.equal(suggestions.newItems[0].item_code, 'B001');
  assert.equal(suggestions.newItems[0].recommendationReason, 'Related to Office purchases');
  assert.equal(suggestions.notBoughtRecently[0].item_code, 'A001');
});