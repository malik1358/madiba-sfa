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

test('history suggestions use clean catalog names for legacy transactions', () => {
  const suggestions = buildQuickOrderSuggestions({
    analytics: { months: ['2025-10'] },
    transactions: [{
      item_code: 'A004089',
      item_name: 'MADIBA NOTE BOOK Do Not Use',
      category: 'Stationery',
      quantity: 1,
      sales_amount: 123,
      transaction_date: '2025-10-01',
    }],
    peerTransactions: [],
    itemMaster: [{
      item_code: 'A004089',
      item_name: 'MADIBA A5 NOTE BOOK 80 SHEET',
      category: 'Stationery',
      is_active: true,
    }],
  });

  assert.equal(suggestions.notBoughtRecently[0].item_code, 'A004089');
  assert.equal(suggestions.notBoughtRecently[0].item_name, 'MADIBA A5 NOTE BOOK 80 SHEET');
  assert.equal(suggestions.historyMonthCount, 1);
});