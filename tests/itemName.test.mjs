import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeImportedItemName, parseCodePrefixedItemLabel } from '../app/lib/itemName.js';

test('parseCodePrefixedItemLabel splits slash SKUs used as Tally CODE_NAME', () => {
  assert.deepEqual(
    parseCodePrefixedItemLabel('A005215/1_MADIBA LUGGAGE TROLLEY BAG PP (#5215) 3PCS/SET (SIZE 18-22-26)'),
    {
      itemCode: 'A005215/1',
      itemName: 'MADIBA LUGGAGE TROLLEY BAG PP (#5215) 3PCS/SET (SIZE 18-22-26)',
      split: true,
    },
  );
  assert.deepEqual(
    parseCodePrefixedItemLabel('A004831_MADIBA DETERGENT POWDER 2KG'),
    {
      itemCode: 'A004831',
      itemName: 'MADIBA DETERGENT POWDER 2KG',
      split: true,
    },
  );
  assert.equal(parseCodePrefixedItemLabel('A004831').split, false);
});

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
