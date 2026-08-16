import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePricePayload } from '../app/lib/pricePayload.js';

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
