import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLast12Months, salesUnitQty, trendClass } from './format.js';

test('buildLast12Months returns the last 12 monthly keys', () => {
  const months = buildLast12Months('2024-03-15');
  assert.equal(months.length, 12);
  assert.equal(months[0], '2023-04');
  assert.equal(months[11], '2024-03');
});

test('salesUnitQty derives quantity from sales_amount and rate', () => {
  assert.equal(salesUnitQty({ sales_amount: 120, rate: 10 }), 12);
  assert.equal(salesUnitQty({ sales_amount: 0, rate: 10 }), 0);
});

test('trendClass returns the expected CSS class', () => {
  assert.equal(trendClass(5, 3), 'auditTrendUp');
  assert.equal(trendClass(2, 3), 'auditTrendDown');
  assert.equal(trendClass(2, 2), 'auditTrendSame');
});
