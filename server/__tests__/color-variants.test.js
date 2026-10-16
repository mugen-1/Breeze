'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { colorName, swatchHex, imagePath, sku, ColorError } = require('../lib/color-variants');
const { sellableVariant } = require('../lib/size-variants');

test('color labels normalize to one stable key, independent of display casing', () => {
  assert.deepEqual(colorName('  Đen  '), { label: 'Đen', key: 'den' });
  assert.equal(colorName('đen').key, colorName('ĐEN').key);
  assert.equal(colorName('Xanh   Navy').key, 'xanh-navy');
  assert.equal(sku(21, 'xanh-navy', '40.5'), 'BR-P21-XANH-NAVY-40-5');
  for (const value of [null, [], {}, '', '   ', '<script>', 'a'.repeat(81)])
    assert.throws(() => colorName(value), ColorError);
});

test('swatch and local image path reject unsafe input', () => {
  assert.equal(swatchHex(null), null);
  assert.equal(swatchHex('#aAbB09'), '#AABB09');
  for (const value of ['red', '#fff', '#ZZZZZZ', {}, []])
    assert.throws(() => swatchHex(value), ColorError);
  for (const value of ['../secret.jpg', 'javascript:alert(1)', 'https://example.com/a.jpg',
    'img/../secret.jpg', 'img/not-present-task08.jpg', '<img src=x>'])
    assert.throws(() => imagePath(value), ColorError);
});

test('sellability follows BASE, size-only, color-only and size × color mode', () => {
  const p = { is_active: true, category_slug: 'sanpham-ao', slug: 'ao-nam-test',
    size_configured: false, color_configured: false };
  const base = { is_base: true, is_active: true, size: null, color: null };
  const size = { is_base: false, is_active: true, size: 'M', color: null };
  const color = { is_base: false, is_active: true, size: null, color: 'den', color_active: true };
  const matrix = { ...color, size: 'M' };
  assert.equal(sellableVariant(p, base), true);
  p.size_configured = true;
  assert.equal(sellableVariant(p, base), false);
  assert.equal(sellableVariant(p, size), true);
  p.color_configured = true;
  assert.equal(sellableVariant(p, size), false);
  assert.equal(sellableVariant(p, matrix), true);
  assert.equal(sellableVariant(p, { ...matrix, color_active: false }), false);
  assert.equal(sellableVariant(p, { ...matrix, is_active: false }), false);
  p.size_configured = false;
  assert.equal(sellableVariant(p, color), true);
  assert.equal(sellableVariant(p, matrix), false);
  p.is_active = false;
  assert.equal(sellableVariant(p, color), false);
});
