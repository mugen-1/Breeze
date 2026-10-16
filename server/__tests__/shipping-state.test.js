'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { STEPS, nextShippingStatuses, shippingForOrderStatus } = require('../lib/shipping-state');
const order = { status: 'shipping', shipping_version: 2, shipping_status: 'picked_up' };
for (const [index, status] of STEPS.entries()) {
  test('shipping only offers the next step: ' + status, () => {
    assert.deepEqual(nextShippingStatuses({ ...order, shipping_status: status }), STEPS.slice(index + 1, index + 2));
  });
}
test('legacy, pending, cancelled and completed orders cannot move shipping', () => {
  for (const status of ['pending','confirmed','cancelled','completed']) {
    assert.deepEqual(nextShippingStatuses({ ...order, status }), []);
  }
  assert.deepEqual(nextShippingStatuses({ ...order, shipping_version: 1 }), []);
  assert.deepEqual(nextShippingStatuses({ ...order, shipping_status: 'cancelled' }), []);
});
test('pickup from processing can use the existing processing -> shipping order transition', () => {
  assert.deepEqual(nextShippingStatuses({ ...order, status: 'processing', shipping_status: 'pending_pickup' }), ['picked_up']);
  assert.deepEqual(nextShippingStatuses({ ...order, status: 'processing' }), []);
});
test('order transition effects preserve legacy and never move shipping backwards', () => {
  assert.equal(shippingForOrderStatus({ ...order, shipping_status: 'pending_pickup' }, 'shipping'), 'picked_up');
  assert.equal(shippingForOrderStatus({ ...order, shipping_status: 'out_for_delivery' }, 'shipping'), 'out_for_delivery');
  assert.equal(shippingForOrderStatus(order, 'completed'), 'delivered');
  assert.equal(shippingForOrderStatus(order, 'cancelled'), 'cancelled');
  assert.equal(shippingForOrderStatus({ shipping_version: 1 }, 'completed'), null);
});
