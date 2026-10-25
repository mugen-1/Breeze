'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { startCleanup, mergeGuest, discardGuest } = require('../lib/support-session');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
test('cleanup runs immediately, drains full batches and never overlaps ticks', async t => {
    let calls = 0, running = 0, max = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    const worker = startCleanup(async () => ({}), { intervalMs: 5, clean: async () => {
        calls++; max = Math.max(max, ++running);
        if (calls === 1) await gate; running--;
        return { scanned: calls === 1 ? 100 : 0, removed: calls === 1 ? 100 : 0 };
    } });
    t.after(() => worker.stop()); await wait(20); assert.equal(calls, 1); release(); await wait(20);
    assert.ok(calls >= 2); assert.equal(max, 1); worker.stop(); const stopped = calls; await wait(20); assert.equal(calls, stopped);
});
test('cleanup failure is contained and a later interval can retry', async t => {
    let calls = 0; const old = console.error; console.error = () => {};
    t.after(() => { console.error = old; });
    const worker = startCleanup(async () => ({}), { intervalMs: 5, clean: async () => { if (++calls === 1) throw Error('fixture'); return { scanned: 0, removed: 0 }; } });
    t.after(() => worker.stop()); await wait(30); assert.ok(calls >= 2);
});
test('transfer and Admin discard never accept the wrong principal', async () => {
    await assert.rejects(mergeGuest(null, { kind: 'guest' }, Buffer.alloc(32)), e => e.status === 403);
    await assert.rejects(mergeGuest(null, { kind: 'admin' }, Buffer.alloc(32)), e => e.status === 403);
    await assert.rejects(discardGuest(null, { kind: 'customer' }, Buffer.alloc(32)), e => e.status === 403);
});
