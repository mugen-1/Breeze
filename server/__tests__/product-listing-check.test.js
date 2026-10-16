'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkListings } = require('../tools/product-listing-check');

function fixture() {
  const catalog = Array.from({ length: 6 }, (_, i) => ({
    id: i + 1, is_active: true, category_slug: 'sanpham-ao', sale_price: null, name_vi: 'Áo',
  }));
  catalog.push(
    { ...catalog[0], id: 7, sale_price: 100 },
    { ...catalog[0], id: 8, category_slug: 'sanpham-quan', name_vi: 'Quần dài' },
    { ...catalog[0], id: 9, is_active: false },
  );
  const lists = { all: catalog.slice(0, 8), category: catalog.slice(0, 6), sale: [catalog[6]] };
  return { catalog, lists };
}
function check({ catalog, lists }, overrides = {}) {
  const responses = Object.fromEntries(Object.entries(lists).map(([key, data]) =>
    [key, { status: 200, body: JSON.stringify(data) }]));
  return checkListings(catalog, { ...responses, ...overrides });
}

test('six eligible shirts give expected 6 / actual 6', () => {
  const result = check(fixture());
  assert.equal(result.ok, true);
  assert.match(result.detail, /ao 6\/6/);
});
test('a seventh eligible product changes the expected set without changing the checker', () => {
  const data = fixture(), added = { ...data.catalog[0], id: 144 };
  data.catalog.push(added); data.lists.all.push(added); data.lists.category.push(added);
  assert.equal(check(data).ok, true);
  data.lists.category.pop();
  assert.equal(check(data).ok, false, 'a hard limit of six must fail');
});
for (const [label, index] of [['sale product', 6], ['wrong category', 7], ['inactive product', 8]]) {
  test('same count cannot hide an extra ' + label + ' replacing an eligible shirt', () => {
    const data = fixture(); data.lists.category[0] = data.catalog[index];
    assert.equal(data.lists.category.length, 6);
    assert.equal(check(data).ok, false);
  });
}
test('duplicate ID fails even when the count remains six', () => {
  const data = fixture(); data.lists.category[0] = data.lists.category[1];
  assert.equal(check(data).ok, false);
});
test('inactive products also fail in the unfiltered public list', () => {
  const data = fixture(); data.lists.all.push(data.catalog[8]);
  assert.equal(check(data).ok, false);
});
test('missing promotion fails and sale_price zero is still a promotion', () => {
  const data = fixture(); data.catalog[6].sale_price = 0;
  assert.equal(check(data).ok, true);
  data.lists.sale = []; assert.equal(check(data).ok, false);
});
test('search compares IDs against SQL names, including accent folding and English names', () => {
  const data = fixture(); data.catalog[0].name_en = 'quan';
  assert.equal(check(data).ok, true);
  data.lists.all = data.lists.all.map(p => p.id === 8 ? { ...p, name_vi: 'Áo' } : p);
  assert.equal(check(data).ok, false);
});
test('a genuinely empty catalog passes while empty responses for populated SQL fail', () => {
  const empty = { catalog: [], lists: { all: [], category: [], sale: [] } };
  assert.equal(check(empty).ok, true);
  empty.catalog = fixture().catalog; assert.equal(check(empty).ok, false);
});
for (const key of ['all', 'category', 'sale']) {
  for (const [label, response] of Object.entries({
    http: { status: 500, body: '[]' },
    html: { status: 200, body: '<html>Error</html>' },
    error: { status: 200, body: '{"status":"error"}' },
    null: { status: 200, body: 'null' },
    invalidID: { status: 200, body: '[{"id":"1"}]' },
  })) test(key + ' rejects ' + label + ' without crashing', () => {
    assert.equal(check(fixture(), { [key]: response }).ok, false);
  });
}
