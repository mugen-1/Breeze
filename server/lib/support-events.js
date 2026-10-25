'use strict';
// Post-commit hints only. SQL remains authoritative; no message/token/PII buffer.
function createHub() {
  const listeners = new Set();
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    publish(notice) {
      for (const listener of listeners) {
        try { listener(notice); } catch (_) { console.error('[support-stream] subscriber failed'); }
      }
    },
    get size() { return listeners.size; },
  };
}
module.exports = { createHub, hub: createHub() };
