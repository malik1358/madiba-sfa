import test from 'node:test';
import assert from 'node:assert/strict';

import { loadPricePayload, parsePricePayload } from '../app/lib/pricePayload.js';

test('parsePricePayload reads wholesale price headers from pricing sheets', () => {
  const payload = [
    [
      'Date',
      'File Number',
      'Product Code',
      'Item Name',
      'Pack Size',
      'Approx Selling Price W/O Vat',
      'Mark Up',
      'Ctn/Bag',
      'Wholesale Price (Riyal)',
    ],
    [
      '',
      '',
      'A005425',
      'PHOTOCOPY PAPER A4 80GSM 500SHEE/PCK , 5PCK/BOX, GOLDEN STAR',
      '5',
      '52.83 SAR',
      '21.92%',
      '52.83 SAR',
      '52.83',
    ],
  ];

  const { priceMap } = parsePricePayload(payload);
  assert.equal(priceMap.A005425, 52.83);
});

test('parsePricePayload applies alias fallback for missing target code', () => {
  const payload = {
    A004555: 51.3,
    A000057: 71.74,
  };

  const { priceMap } = parsePricePayload(payload);
  assert.equal(priceMap.A005425, 51.3);
});

test('parsePricePayload reads nested priceMap objects from source payload', () => {
  const payload = {
    success: true,
    generatedAt: '2026-08-16T10:24:08.496Z',
    priceMap: {
      A005425: 76,
      A000057: 71.74,
    },
    sheetItems: [
      {
        item_code: 'A005425',
        item_name: 'PHOTOCOPY PAPER A4',
        category: 'Stationery',
      },
    ],
  };

  const { priceMap } = parsePricePayload(payload);
  assert.equal(priceMap.A005425, 76);
  assert.equal(priceMap.A000057, 71.74);
});

test('parsePricePayload reads regional wholesale prices and scheme discounts', () => {
  const header = [];
  const data = [];
  header[1] = 'Product Code';
  header[2] = 'Item Name';
  header[79] = 'Wholesale Price Without VAT (Riyadh)';
  header[83] = 'Wholesale Price Without VAT (Dammam)';
  header[87] = 'Jeddah - Wholesale Price Without VAT';
  header[89] = 'Sales Value > 5000 SAR';
  header[90] = 'Cash Discount';

  data[1] = 'A006061';
  data[2] = 'PHOTOCOPY PAPER A3 80GSM';
  data[79] = '114.33 SAR';
  data[83] = '115.33 SAR';
  data[87] = '122.33 SAR';
  data[89] = '3.00%';
  data[90] = '2.00%';

  const parsed = parsePricePayload([header, data]);

  assert.equal(parsed.priceMap.A006061, 114.33);
  assert.equal(parsed.regionPriceMaps.riyadh.A006061, 114.33);
  assert.equal(parsed.regionPriceMaps.dammam.A006061, 115.33);
  assert.equal(parsed.regionPriceMaps.jeddah.A006061, 122.33);
  assert.equal(parsed.cashDiscountMap.A006061, 0.02);
  assert.equal(parsed.valueDiscountMap.A006061, 0.03);
});

test('loadPricePayload clears stale browser cache before loading fresh prices', async () => {
  const cacheKey = 'madiba.pricePayload.v3';
  const storage = new Map();
  let cleared = false;

  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => {
        if (key === cacheKey) cleared = true;
        storage.delete(key);
      },
    },
  };

  storage.set(cacheKey, JSON.stringify({ priceMap: { A000057: 9.99 }, sheetItems: [] }));

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ priceMap: { A000057: 71.74 }, sheetItems: [] }),
  });

  const result = await loadPricePayload('/api/pricing/cache', cacheKey);

  assert.equal(cleared, true);
  assert.equal(result.priceMap.A000057, 71.74);

  delete globalThis.window;
  delete globalThis.fetch;
});
