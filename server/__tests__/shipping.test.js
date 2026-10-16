'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateShipping, grandTotal, METHODS } = require('../config/shipping');
const valid = require('./helpers/shipping');
test('normalizes snapshots, ignores monetary inputs and rejects malformed fields', () => {
  const result = validateShipping({ ...valid, shipping_name: '  A B  ', shipping_phone: '+84 (901) 234-567',
    shipping_fee: -999, subtotal: 1, total: 1 });
  assert.equal(result.value.shipping_name, 'A B');
  assert.equal(result.value.shipping_phone, '+84901234567');
  assert.equal(result.value.shipping_fee, METHODS[0].fee);
  assert.equal(result.value.shipping_fee, 20000);
  for (const field of Object.keys(valid)) {
    for (const value of [{}, [], 42, 'x'.repeat(501)]) {
      assert.equal(validateShipping({ ...valid, [field]: value }).error, 'INVALID_SHIPPING', field);
    }
    if (field !== 'delivery_note') assert.equal(validateShipping({ ...valid, [field]: '' }).error, 'INVALID_SHIPPING');
  }
  for (const phone of ['0000000000', 'hello', '123', '+0000000000', '0901234567<script>']) {
    assert.equal(validateShipping({ ...valid, shipping_phone: phone }).error, 'INVALID_SHIPPING');
  }
  assert.equal(validateShipping({ ...valid, shipping_method: 'EXPRESS' }).error, 'INVALID_SHIPPING');
  assert.equal(validateShipping({ ...valid, delivery_note: 'a\u0000b' }).error, 'INVALID_SHIPPING');
});
test('voucher affects items only, nonzero shipping survives full item discount', () => {
  assert.equal(grandTotal(189000, 9450, METHODS[0].fee), 199550);
  assert.equal(grandTotal(100000, 15000, METHODS[0].fee), 105000);
  assert.equal(grandTotal(100000, 100000, METHODS[0].fee), 20000);
  assert.equal(grandTotal(100000, 200000, METHODS[0].fee), 20000);
});
