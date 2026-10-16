'use strict';
const { canTransition } = require('./order-state');
const STEPS = Object.freeze(['pending_pickup', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered']);

function nextShippingStatuses(order) {
  if (order.shipping_version !== 2) return [];
  const index = STEPS.indexOf(order.shipping_status);
  if (index < 0 || index === STEPS.length - 1) return [];
  const moving = order.status === 'shipping' || order.status === 'shipped';
  if (!moving && !(index === 0 && canTransition(order.status, 'shipping'))) return [];
  return [STEPS[index + 1]];
}

// Order transitions keep their existing rules; these are their shipping effects.
function shippingForOrderStatus(order, status) {
  if (order.shipping_version !== 2) return order.shipping_status || null;
  if (status === 'cancelled') return 'cancelled';
  if (status === 'completed') return 'delivered';
  if (status === 'shipping' && order.shipping_status === 'pending_pickup') return 'picked_up';
  return order.shipping_status;
}
module.exports = { STEPS, nextShippingStatuses, shippingForOrderStatus };
