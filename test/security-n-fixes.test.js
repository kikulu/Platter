'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { isUrlAllowedForFetch, fetchWithGuard } = require('../lib/attachments');
const { decidePermission } = require('../lib/permissions');
const { validateArgs } = require('../lib/ipcValidate');
const { guardIpc } = require('../lib/security');
const { schemas } = require('../lib/ipc/schemas');

const PAGE = 'https://chatgpt.com/c/1';
const dnsTable = {
  'cdn.example.com': [{ address: '93.184.216.34' }],
  '127.0.0.1.nip.io': [{ address: '127.0.0.1' }],
  'mixed.example.com': [{ address: '93.184.216.34' }, { address: '10.0.0.5' }],
  'v6.example.com': [{ address: '::1' }],
};
const lookup = async (host) => {
  if (!dnsTable[host]) throw new Error('ENOTFOUND');
  return dnsTable[host];
};

test('N-1：網域解析到內網位址的網址不下載', async () => {
  assert.equal(
    await isUrlAllowedForFetch('https://cdn.example.com/a.png', PAGE, lookup),
    true
  );
  assert.equal(
    await isUrlAllowedForFetch('https://127.0.0.1.nip.io/a', PAGE, lookup),
    false
  );
  assert.equal(
    await isUrlAllowedForFetch('https://mixed.example.com/a', PAGE, lookup),
    false
  );
  assert.equal(
    await isUrlAllowedForFetch('https://v6.example.com/a', PAGE, lookup),
    false
  );
  assert.equal(
    await isUrlAllowedForFetch('https://unknown.example.com/a', PAGE, lookup),
    false
  );
  assert.equal(
    await isUrlAllowedForFetch('http://cdn.example.com/a', PAGE, lookup),
    false
  );
});

test('N-1：跟頁面同源不做 DNS 檢查（本地端 AI 服務）', async () => {
  const never = async () => {
    throw new Error('should not resolve');
  };
  assert.equal(
    await isUrlAllowedForFetch(
      'http://localhost:11434/f',
      'http://localhost:11434/',
      never
    ),
    true
  );
});

function fakeFetch(map) {
  const calls = [];
  const fetchOnce = async (u) => {
    calls.push(u);
    const r = map[u];
    if (!r) throw new Error('no route ' + u);
    return {
      status: r.status,
      headers: { get: (n) => (n === 'location' ? r.location || null : null) },
    };
  };
  return { fetchOnce, calls };
}

test('N-1：重導向每一跳都重新檢查', async () => {
  const f = fakeFetch({
    'https://cdn.example.com/a': {
      status: 302,
      location: 'https://127.0.0.1.nip.io/secret',
    },
    'https://127.0.0.1.nip.io/secret': { status: 200 },
  });
  await assert.rejects(
    fetchWithGuard('https://cdn.example.com/a', PAGE, { fetchOnce: f.fetchOnce, lookup }),
    /blocked-url/
  );
  assert.deepEqual(f.calls, ['https://cdn.example.com/a']);

  const ok = fakeFetch({
    'https://cdn.example.com/a': { status: 301, location: '/b' },
    'https://cdn.example.com/b': { status: 200 },
  });
  const res = await fetchWithGuard('https://cdn.example.com/a', PAGE, {
    fetchOnce: ok.fetchOnce,
    lookup,
  });
  assert.equal(res.status, 200);
});

test('N-1：重導向次數有上限、缺 Location 會失敗', async () => {
  const loop = fakeFetch({
    'https://cdn.example.com/a': { status: 302, location: '/a' },
  });
  await assert.rejects(
    fetchWithGuard('https://cdn.example.com/a', PAGE, {
      fetchOnce: loop.fetchOnce,
      lookup,
    }),
    /too-many-redirects/
  );
  const bad = fakeFetch({ 'https://cdn.example.com/a': { status: 302 } });
  await assert.rejects(
    fetchWithGuard('https://cdn.example.com/a', PAGE, {
      fetchOnce: bad.fetchOnce,
      lookup,
    }),
    /bad-redirect/
  );
});

test('N-3：權限政策預設拒絕，只放行麥克風／複製／全螢幕', () => {
  const url = 'https://chatgpt.com/';
  assert.equal(decidePermission('geolocation', url), false);
  assert.equal(decidePermission('notifications', url), false);
  assert.equal(decidePermission('clipboard-read', url), false);
  assert.equal(decidePermission('display-capture', url), false);
  assert.equal(decidePermission('openExternal', url), false);
  assert.equal(decidePermission('clipboard-sanitized-write', url), true);
  assert.equal(decidePermission('fullscreen', url), true);
  assert.equal(decidePermission('media', url, { mediaTypes: ['audio'] }), true);
  assert.equal(decidePermission('media', url, { mediaType: 'audio' }), true);
  assert.equal(decidePermission('media', url, { mediaTypes: ['audio', 'video'] }), false);
  assert.equal(decidePermission('media', url, { mediaTypes: ['video'] }), false);
  assert.equal(decidePermission('media', url, {}), false);
});

test('N-3：非 https 來源一律拒絕（localhost 除外）', () => {
  assert.equal(decidePermission('fullscreen', 'http://evil.example.com/'), false);
  assert.equal(decidePermission('fullscreen', 'file:///etc/passwd'), false);
  assert.equal(decidePermission('fullscreen', 'http://localhost:11434/'), true);
  assert.equal(decidePermission('fullscreen', 'not a url'), false);
});

test('N-5：validateArgs 基本規則', () => {
  assert.equal(validateArgs(['id'], ['abc-1']), true);
  assert.equal(validateArgs(['id'], ['']), false);
  assert.equal(validateArgs(['id'], ['../x']), false);
  assert.equal(validateArgs(['id'], [{ a: 1 }]), false);
  assert.equal(validateArgs([{ id: 'id', n: 'int' }], [{ id: 'a', n: 1.5 }]), false);
  assert.equal(validateArgs([{ id: 'id', n: 'int' }], [{ id: 'a', n: 2 }]), true);
  assert.equal(validateArgs([{ id: 'id' }], [undefined]), false);
  assert.equal(validateArgs(['bool'], ['true']), false);
  assert.equal(validateArgs(['str:3?'], [undefined]), true);
  assert.equal(validateArgs(['str:3'], ['abcd']), false);
  assert.equal(validateArgs(['strs'], [['a', 1]]), false);
});

test('N-5：guardIpc 套用規格，格式錯誤丟 INVALID_PAYLOAD 且不呼叫 handler', async () => {
  const rendererDir = path.join(__dirname, '..', 'renderer');
  const handlers = {};
  const raw = { handle: (c, l) => (handlers[c] = l), on() {}, removeHandler() {} };
  const invalid = [];
  const g = guardIpc(raw, {
    rendererDir,
    schemas: { 'x:y': ['id'] },
    onInvalid: (c) => invalid.push(c),
  });
  let called = 0;
  g.handle('x:y', () => ++called);
  const event = {
    senderFrame: {
      url: require('url').pathToFileURL(path.join(rendererDir, 'index.html')).href,
    },
  };
  assert.equal(await handlers['x:y'](event, 'ok'), 1);
  assert.throws(() => handlers['x:y'](event, '../evil'), /INVALID_PAYLOAD/);
  assert.equal(called, 1);
  assert.deepEqual(invalid, ['x:y']);
});

test('N-5：schemas 裡的每個頻道都真的有 handler', () => {
  const dir = path.join(__dirname, '..', 'lib', 'ipc');
  const src = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js') && f !== 'schemas.js')
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');
  for (const channel of Object.keys(schemas)) {
    assert.ok(
      src.includes(`'${channel}'`),
      `schemas 有 ${channel}，但找不到對應的 handler`
    );
  }
});

test('N-4：有 lockfile、CI 用 npm ci、build 設定了 Electron fuses', () => {
  const root = path.join(__dirname, '..');
  assert.ok(fs.existsSync(path.join(root, 'package-lock.json')), '缺 package-lock.json');
  const ci = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /npm ci/);
  assert.doesNotMatch(ci, /npm install/);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const fuses = pkg.build && pkg.build.electronFuses;
  assert.ok(fuses, 'build.electronFuses 未設定');
  assert.equal(fuses.runAsNode, false);
  assert.equal(fuses.enableNodeOptionsEnvironmentVariable, false);
  assert.equal(fuses.enableNodeCliInspectArguments, false);
});
