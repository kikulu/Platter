'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/startupPolicy');

const GB = 1024 * 1024; // KB

test('isLowMemory：可用不到 1GB 或不到 8% 視為吃緊；讀不到不誤判', () => {
  assert.equal(P.isLowMemory({ total: 8 * GB, free: 0.5 * GB }), true);
  assert.equal(P.isLowMemory({ total: 32 * GB, free: 2 * GB }), true); // 6.25%
  assert.equal(P.isLowMemory({ total: 16 * GB, free: 6 * GB }), false);
  assert.equal(P.isLowMemory({ total: 16 * GB, free: 0 }), false);
  assert.equal(P.isLowMemory(null), false);
  assert.equal(P.isLowMemory({}), false);
});

test('shouldDeferAccountLoad：defer／load 固定，auto 看記憶體，非法值當 auto', () => {
  const low = { total: 8 * GB, free: 0.3 * GB };
  const ok = { total: 8 * GB, free: 4 * GB };
  assert.equal(P.shouldDeferAccountLoad('defer', ok), true);
  assert.equal(P.shouldDeferAccountLoad('load', low), false);
  assert.equal(P.shouldDeferAccountLoad('auto', low), true);
  assert.equal(P.shouldDeferAccountLoad('auto', ok), false);
  assert.equal(P.shouldDeferAccountLoad('bogus', low), true);
  assert.equal(P.normalizeStartupLoad(undefined), 'auto');
});

test('trayStartDelayMs：記憶體吃緊時延後更久', () => {
  assert.ok(P.trayStartDelayMs(true) > P.trayStartDelayMs(false));
});

test('decideCrashAction：帳號頁面', () => {
  const t0 = 1_000_000;
  const cool = { now: t0, lastAutoReloadAt: 0 };
  const hot = { now: t0, lastAutoReloadAt: t0 - 1000 };
  assert.equal(P.decideCrashAction('clean-exit', cool), 'ignore');
  assert.equal(P.decideCrashAction('crashed', cool), 'auto-reload');
  assert.equal(P.decideCrashAction('crashed', hot), 'prompt'); // 剛重載過又崩潰：不要迴圈
  assert.equal(P.decideCrashAction('oom', cool), 'prompt');
  assert.equal(P.decideCrashAction('memory-eviction', cool), 'prompt');
  assert.equal(P.decideCrashAction('launch-failed', cool), 'prompt');
});

test('decideCrashAction：自己的視窗先自動重載，連續崩潰才停', () => {
  const t0 = 1_000_000;
  assert.equal(
    P.decideCrashAction('oom', { now: t0, lastAutoReloadAt: 0, isOwnWindow: true }),
    'auto-reload'
  );
  assert.equal(
    P.decideCrashAction('crashed', { now: t0, lastAutoReloadAt: t0 - 500, isOwnWindow: true }),
    'prompt'
  );
});

test('crashKind', () => {
  assert.equal(P.crashKind('oom'), 'oom');
  assert.equal(P.crashKind('memory-eviction'), 'oom');
  assert.equal(P.crashKind('killed'), 'crashed');
});
