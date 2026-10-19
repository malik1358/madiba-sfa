import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeImportedItemName } from '../app/lib/itemName.js';

test('normalizeImportedItemName removes repeated markers with single-letter prefixes', () => {
  assert.equal(
    normalizeImportedItemName('photocopy paper paperline A3 80 GSM x 5 pkt BRepeated'),
    'photocopy paper paperline A3 80 GSM x 5 pkt'
  );

  assert.equal(
    normalizeImportedItemName('A Repeated item'),
    'item'
  );

  assert.equal(
    normalizeImportedItemName('PHOTOCOPY PAPER OMNIA 80GSM 500SHEE/PCK , 5PCK/BOX ANew'),
    'PHOTOCOPY PAPER OMNIA 80GSM 500SHEE/PCK , 5PCK/BOX'
  );
});
