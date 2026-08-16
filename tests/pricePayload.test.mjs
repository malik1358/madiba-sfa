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

test('loadPricePayload clears stale browser cache before loading fresh prices', async () => {
  const cacheKey = 'madiba.pricePayload.v2';
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
