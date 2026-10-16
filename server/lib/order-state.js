// Single source of truth for order status changes. `paid` and `shipped` are
// historical order statuses: existing rows keep their values and may move only
// forward into the new workflow. They are never targets of new transitions.
const ORDER_TRANSITIONS = Object.freeze({
  pending: Object.freeze(['confirmed', 'cancelled']),
  confirmed: Object.freeze(['processing', 'cancelled']),
  processing: Object.freeze(['shipping']),
  shipping: Object.freeze(['completed']),
  completed: Object.freeze([]),
  cancelled: Object.freeze([]),
  paid: Object.freeze(['processing', 'cancelled']),
  shipped: Object.freeze(['completed']),
});

const CANONICAL_STATUSES = Object.freeze([
  'pending', 'confirmed', 'processing', 'shipping', 'completed', 'cancelled',
]);
const ALL_STATUSES = Object.freeze(Object.keys(ORDER_TRANSITIONS));

function nextStatuses(current) {
  return Object.hasOwn(ORDER_TRANSITIONS, current) ? [...ORDER_TRANSITIONS[current]] : [];
}

function canTransition(current, next) {
  return typeof next === 'string' && nextStatuses(current).includes(next);
}

function isTargetStatus(value) {
  return typeof value === 'string' && CANONICAL_STATUSES.includes(value);
}

// Customer self-cancellation is deliberately narrower than the admin workflow:
// legacy `paid` can be cancelled by admin, never by the customer.
function canCustomerCancel(current) {
  return (current === 'pending' || current === 'confirmed') && canTransition(current, 'cancelled');
}

module.exports = { ORDER_TRANSITIONS, CANONICAL_STATUSES, ALL_STATUSES, nextStatuses, canTransition, isTargetStatus, canCustomerCancel };
