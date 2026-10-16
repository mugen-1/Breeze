'use strict';

// Simulated fees and ETA only; no carrier API integration. Server is the source of truth.
const METHODS = Object.freeze([
  Object.freeze({ key: 'GHN_STANDARD', provider: 'GHN', service: 'Giao hàng tiêu chuẩn',
    label: 'GHN — Giao hàng tiêu chuẩn', label_key: 'ship.ghn', fee: 20000, eta: '2–4 ngày', eta_key: 'ship.etaGhn', tracking_prefix: 'GHN-BR' }),
  Object.freeze({ key: 'GHTK_ECONOMY', provider: 'GHTK', service: 'Giao hàng tiết kiệm',
    label: 'GHTK — Giao hàng tiết kiệm', label_key: 'ship.ghtk', fee: 15000, eta: '3–5 ngày', eta_key: 'ship.etaGhtk', tracking_prefix: 'GHTK-BR' }),
  Object.freeze({ key: 'BREEZE_EXPRESS', provider: 'BREEZE EXPRESS', service: 'Giao hàng nhanh',
    label: 'BREEZE EXPRESS — Giao hàng nhanh', label_key: 'ship.express', fee: 35000, eta: '1–2 ngày', eta_key: 'ship.etaExpress', tracking_prefix: 'BRX' }),
]);

function validateShipping(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'INVALID_SHIPPING', field: 'shipping_name' };
  }
  const fields = { shipping_name: 150, shipping_phone: 30, shipping_address: 400,
    shipping_ward: 120, shipping_district: 120, shipping_city: 120, delivery_note: 500 };
  const value = {};
  for (const [field, max] of Object.entries(fields)) {
    const raw = body[field] == null && field === 'delivery_note' ? '' : body[field];
    if (typeof raw !== 'string' || raw.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) {
      return { error: 'INVALID_SHIPPING', field };
    }
    value[field] = raw.trim();
    if (!value[field] && field !== 'delivery_note') return { error: 'INVALID_SHIPPING', field };
  }
  value.shipping_phone = value.shipping_phone.replace(/[\s().-]/g, '');
  if (!/^(?:0\d{9,10}|\+[1-9]\d{7,14})$/.test(value.shipping_phone) ||
      /^(?:\+)?(\d)\1+$/.test(value.shipping_phone)) {
    return { error: 'INVALID_SHIPPING', field: 'shipping_phone' };
  }
  const method = METHODS.find(m => m.key === body.shipping_method);
  if (!method) return { error: 'INVALID_SHIPPING', field: 'shipping_method' };
  return { value: { ...value, shipping_method: method.key, shipping_fee: method.fee,
    shipping_provider: method.provider, shipping_service: method.service, shipping_eta: method.eta } };
}

function grandTotal(subtotal, discount, fee) {
  return Math.max(0, subtotal - discount) + fee;
}

module.exports = { METHODS, validateShipping, grandTotal };
