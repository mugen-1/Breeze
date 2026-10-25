'use strict';
const { getPool } = require('../db');
const { getAuth } = require('../firebase');
const { SupportError, streamAccess } = require('../lib/customer-support');
const { hub } = require('../lib/support-events');
const { allowedOrigins } = require('./security');
async function authorize(req, principal) {
  if (principal.kind !== 'guest') {
    const match = String(req.headers.authorization || '').match(/^Bearer ([^\s]+)$/i);
    try {
      const token = match && await getAuth().verifyIdToken(match[1], true);
      if (!token || token.uid !== principal.firebaseUid || (typeof token.exp === 'number' && token.exp * 1000 <= Date.now())) throw Error('inactive');
    } catch (_) { throw new SupportError(401, 'SUPPORT_AUTH_REQUIRED', 'Phiên đăng nhập không hợp lệ'); }
  }
  return streamAccess(await getPool(), principal);
}
function createStream(options = {}) {
  const connections = new Set(), bus = options.hub || hub, check = options.authorize || authorize;
  const pingMs = options.pingMs || 15000, checkMs = options.checkMs || 30000, lifetimeMs = options.lifetimeMs || 120000;
  async function open(req, res, principal) {
    if (Object.keys(req.query).length) throw new SupportError(400, 'SUPPORT_INVALID_INPUT', 'Luồng chat không nhận tham số URL');
    if (!String(req.headers.accept || '').split(',').some(v => v.trim().split(';')[0] === 'text/event-stream')) {
      throw new SupportError(406, 'SUPPORT_STREAM_REQUIRED', 'Yêu cầu luồng sự kiện');
    }
    if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && !allowedOrigins().includes(req.headers.origin))) {
      throw new SupportError(403, 'SUPPORT_ORIGIN_BLOCKED', 'Nguồn gửi yêu cầu không hợp lệ');
    }
    let scope = await check(req, principal);
    if (req.aborted || res.destroyed || res.writableEnded) return;
    const key = principal.kind === 'guest' ? 'g:' + principal.hash.toString('hex') : 'u:' + principal.userId;
    if (connections.size >= (options.maxTotal || 200) || [...connections].filter(c => c.key === key).length >= (options.maxPerIdentity || 6)) {
      res.set('Retry-After', '30');
      throw new SupportError(429, 'SUPPORT_STREAM_LIMIT', 'Quá nhiều kết nối chat');
    }
    let ended = false, running = false, dirty = false, needCheck = false, unsubscribe;
    let resetPending = false, resetAll = false; const resetIds = new Set();
    let leaseTimer, pingTimer, checkTimer, lifetimeTimer;
    const connection = { key, close: () => close() };
    function close() {
      if (ended) return;
      ended = true; if (unsubscribe) unsubscribe(); connections.delete(connection);
      clearTimeout(leaseTimer); clearInterval(pingTimer); clearInterval(checkTimer); clearTimeout(lifetimeTimer);
      res.removeListener('close', close); res.removeListener('error', close);
      if (!res.writableEnded && !res.destroyed) res.end();
    }
    function write(frame) {
      if (ended || res.destroyed || res.writableEnded) { close(); return false; }
      try { if (!res.write(frame)) { close(); return false; } return true; }
      catch (_) { close(); return false; }
    }
    function event(name, data) { return write('event: ' + name + '\ndata: ' + JSON.stringify(data) + '\n\n'); }
    function lease() {
      clearTimeout(leaseTimer);
      if (scope.kind === 'guest') leaseTimer = setTimeout(() => { needCheck = true; drain(); }, Math.max(1, scope.leaseMs + 1));
    }
    async function drain() {
      if (ended || running) return;
      running = true;
      try {
        while (!ended && (dirty || needCheck)) {
          const changed = dirty;
          const data = scope.kind === 'admin' ? (resetAll ? { resetAll: true } : resetIds.size ? { resetConversations: [...resetIds] } : {}) : resetPending ? { reset: true } : {};
          dirty = false; needCheck = false; resetPending = false; resetAll = false; resetIds.clear();
          scope = await check(req, principal);
          if (ended) break;
          lease();
          if (changed) event('change', data);
        }
      } catch (error) {
        if (!ended) {
          if (error instanceof SupportError && [401, 403].includes(error.status)) event('auth-lost', { status: error.status });
          else event('unavailable', {});
          close();
        }
      } finally { running = false; }
    }
    connections.add(connection);
    res.on('close', close); res.on('error', close);
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    try { res.flushHeaders(); } catch (_) { close(); return; }
    unsubscribe = bus.subscribe(notice => {
      if (notice.audience === 'admin' && scope.kind !== 'admin') return;
      if (scope.kind !== 'admin' && notice.conversationId !== scope.conversationId &&
          !(scope.kind === 'customer' && notice.customerId === scope.userId)) return;
      if (notice.reset) {
        if (scope.kind === 'admin') { if (resetIds.size < 100) resetIds.add(notice.conversationId); else resetAll = true; }
        else resetPending = true;
      }
      // Coalesce notifications. No message/PII queue and at most one auth query per connection in flight.
      dirty = true; drain();
    });
    if (!event('ready', {})) return;
    lease();
    pingTimer = setInterval(() => write(': keep-alive\n\n'), pingMs);
    checkTimer = setInterval(() => { needCheck = true; drain(); }, checkMs);
    const remaining = req.firebaseToken && typeof req.firebaseToken.exp === 'number' ? req.firebaseToken.exp * 1000 - Date.now() - 5000 : lifetimeMs;
    lifetimeTimer = setTimeout(close, Math.max(1000, Math.min(lifetimeMs, remaining)));
  }
  return { open, closeAll() { for (const c of [...connections]) c.close(); }, get size() { return connections.size; } };
}
module.exports = { createStream, stream: createStream() };
