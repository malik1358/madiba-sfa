import test from 'node:test';
import assert from 'node:assert/strict';

import { isBuildingMaterialItem, isExcludedCategory, loadPricePayload, parsePricePayload, pickCatalogCategory } from '../app/lib/pricePayload.js';

test('isExcludedCategory hides building material from order catalogs', () => {
  assert.equal(isExcludedCategory('Building Material'), true);
  assert.equal(isExcludedCategory('Building Materials'), true);
  assert.equal(isExcludedCategory('Body Care'), false);
});

test('isBuildingMaterialItem hides unclassified boards, ladders, and fans', () => {
  assert.equal(isBuildingMaterialItem({
    item_code: 'A003622',
    item_name: 'A003622_GRADE-E2 5 MM X 1220MM X 2440MM',
    category: 'Unclassified',
  }), true);
  assert.equal(isBuildingMaterialItem({
    item_code: 'A003623',
    item_name: 'A003623_MDF 7.5 MM X 1220MM X 2440MM X',
    category: 'Unclassified',
  }), true);
  assert.equal(isBuildingMaterialItem({
    item_code: '16',
    item_name: '16-Inch portable Ventilation Fan',
    category: 'Unclassified',
  }), true);
  assert.equal(isBuildingMaterialItem({
    item_code: 'A',
    item_name: 'A Type Ladder - 5.2 Mtr',
    category: 'Unclassified',
  }), true);
  assert.equal(isBuildingMaterialItem({
    item_code: 'A005425',
    item_name: 'PHOTOCOPY PAPER A4 80GSM',
    category: 'Stationery',
  }), false);
  assert.equal(isBuildingMaterialItem({
    item_code: 'A003234',
    item_name: 'A003234_GOLDEN STAR PHOTOCOPY PAPER A4 80 GSM - 5RM/Ctn',
    category: 'Missing Category',
  }), false);
  assert.equal(isBuildingMaterialItem({
    item_code: 'A005425',
    item_name: 'PHOTOCOPY PAPER A4 80GSM 500SHEE/PCK , 5PCK/BOX, GOLDEN STAR',
    category: 'Missing Category',
  }), false);
  assert.equal(isBuildingMaterialItem({
    item_code: 'LP00190',
    item_name: 'Cement Board 1.22X2.44MtrX12MM',
    category: 'Unclassified',
  }), true);
  assert.equal(isBuildingMaterialItem({
    item_code: 'LP00268',
    item_name: 'Steel Mesh 1X2MtrX3MM',
    category: 'Unclassified',
  }), true);
  assert.equal(isBuildingMaterialItem({
    item_code: 'A004429',
    item_name: 'A004429_MADIBA LVL Board 38*225*4000mm Fushi Woods China',
    category: 'Missing Category',
  }), true);
  assert.equal(isBuildingMaterialItem({
    item_code: 'A004456',
    item_name: 'A004456_Welding Rod 6013 2.5 mm x 350 L 21gm per stick, Per Carton 16kg.',
    category: 'Missing Category',
  }), true);
  assert.equal(isBuildingMaterialItem({
    item_code: 'A004458',
    item_name: 'A004458- WING NUT 160 GRAM',
    category: 'Missing Category',
  }), true);
  assert.equal(isBuildingMaterialItem({
    item_code: 'A004460',
    item_name: 'A004460- JUTE HESSIAN CLOTH FOR CURING, 38INCH X 5OZ',
    category: 'Missing Category',
  }), true);
  assert.equal(isBuildingMaterialItem({
    item_code: 'A004601',
    item_name: 'A004601_MADIBA 6 x 16 MM MTR TIE ROD, 8 KG EACH PCS X 8 KG PCS',
    category: 'Missing Category',
  }), true);
  assert.equal(isBuildingMaterialItem({
    item_code: 'A004999',
    item_name: 'Unmapped hardware leftover',
    category: 'Missing Category',
  }), true);
});

test('parsePricePayload drops building material rows from the order catalog', () => {
  const { priceMap, sheetItems } = parsePricePayload([
    {
      item_code: 'A003623',
      item_name: 'A003623_MDF 7.5 MM X 1220MM X 2440MM X',
      category: 'Unclassified',
      rate: 29,
    },
    {
      item_code: 'A005425',
      item_name: 'PHOTOCOPY PAPER A4 80GSM',
      category: 'Stationery',
      rate: 76,
    },
  ]);

  assert.equal(priceMap.A003623, undefined);
  assert.equal(priceMap.A005425, 76);
  assert.equal(sheetItems.some((item) => item.item_code === 'A003623'), false);
  assert.equal(sheetItems.some((item) => item.item_code === 'A005425'), true);
});

test('pickCatalogCategory prefers live sales or sheet over stale Cosmetics', () => {
  assert.equal(pickCatalogCategory('Cosmetics', 'Body Care'), 'Body Care');
  assert.equal(pickCatalogCategory('Sundry', 'Cosmetics'), 'Sundry');
  assert.equal(pickCatalogCategory('Cosmetics', 'Unclassified'), '');
});

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
  assert.equal(priceMap.A003234, 51.3);
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

test('parsePricePayload prefers current Product Category and reads A004409 schemes', () => {
  const header = [];
  const data = [];
  header[1] = 'Product Code';
  header[2] = 'Item Name';
  header[79] = 'Wholesale Price Without VAT (Riyad)';
  header[83] = 'Wholesale Price Without VAT (Dammam)';
  header[87] = 'Jeddah - Wholesale Price Without VAT';
  header[89] = 'Sales Value > 5000 SAR';
  header[90] = 'Cash Discount';
  header[92] = 'Prev-Product Category';
  header[93] = 'Product Category';

  data[1] = 'A004409';
  data[2] = 'MADIBA RAZOR TWIN BLADE, BLUE';
  data[79] = '244.00 SAR';
  data[83] = '244.00 SAR';
  data[87] = '261.08 SAR';
  data[89] = '5.00%';
  data[90] = '5.00%';
  data[92] = 'China Sundry';
  data[93] = 'Sundry';

  const parsed = parsePricePayload([header, data]);
  const item = parsed.sheetItems.find((entry) => entry.item_code === 'A004409');

  assert.equal(parsed.cashDiscountMap.A004409, 0.05);
  assert.equal(parsed.valueDiscountMap.A004409, 0.05);
  assert.equal(item?.category, 'Sundry');
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
