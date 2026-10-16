'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { APPAREL, MEN_SHOES, sizeProfile, sizeSku, sellableVariant } = require('../lib/size-variants');
test('apparel whitelist stays S/M/L/XL', () => assert.deepEqual(APPAREL, ['S','M','L','XL']));
test('men shoe whitelist has exactly 12 labels, no EU prefix', () =>
  assert.deepEqual(MEN_SHOES, ['39','40','40.5','41','42','42.5','43','44','44.5','45','45.5','46']));
test('category plus explicit men slug classifies shoes; vague name never classifies', () => {
  assert.equal(sizeProfile({ category_slug: 'sanpham-giay', slug: 'giay-nam-slide' }).kind, 'mens-shoes');
  assert.equal(sizeProfile({ category_slug: 'sanpham-giay', name_vi: 'Giày nam' }).kind, 'base-only');
  assert.equal(sizeProfile({ category_slug: 'handbags', slug: 'giay-nam-slide' }).kind, 'base-only');
});
test('SKU deterministic and decimal-safe, independent of names', () => {
  assert.equal(sizeSku(10,'40.5'), 'BR-P10-40-5'); assert.equal(sizeSku(10,'M'), 'BR-P10-M');
});
const p = { is_active: true, size_configured: true, category_slug: 'sanpham-ao' };
const v = { is_active: true, is_base: false, size: 'M', color: null };
test('configured product never sells BASE even with physical stock', () =>
  assert.equal(sellableVariant(p, { is_active: true, is_base: true, stock: 50 }), false));
test('valid size identity is sellable', () => assert.equal(sellableVariant(p,v), true));
for (const patch of [{ is_active: false }, { size: 'XS' }, { size: 'EU 40' }, { color: 'red' }, { size: 'm' }]) {
  test('invalid/inactive variant rejected: ' + JSON.stringify(patch), () => assert.equal(sellableVariant(p,{ ...v, ...patch }),false));
}
test('inactive product rejected independently of variant status', () => assert.equal(sellableVariant({ ...p,is_active:false },v),false));
test('unconfigured product retains BASE compatibility', () => assert.equal(sellableVariant({ ...p,size_configured:false },{ ...v,is_base:true,size:null }),true));
