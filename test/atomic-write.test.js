'use strict';

/**
 * test/atomic-write.test.js
 *
 * lib/utils.js 的 writeFileAtomicSync()／readJsonFileWithBackup()：
 * 正常寫入、保留 .bak、寫入失敗不破壞原檔且不留暫存檔、主檔損毀時改讀備份。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeFileAtomicSync, readJsonFileWithBackup } = require('../lib/utils');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'platter-atomic-'));
}

test('writeFileAtomicSync：寫入內容、不留暫存檔', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'sub', 'a.json');
  writeFileAtomicSync(file, '{"a":1}');
  assert.equal(fs.readFileSync(file, 'utf-8'), '{"a":1}');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'sub')), ['a.json']);
});

test('writeFileAtomicSync：backup 選項會把舊內容留成 .bak', () => {
  const file = path.join(tmpDir(), 'a.json');
  writeFileAtomicSync(file, '{"v":1}', { backup: true });
  assert.equal(fs.existsSync(`${file}.bak`), false, '第一次寫入沒有舊檔可備份');
  writeFileAtomicSync(file, '{"v":2}', { backup: true });
  assert.equal(fs.readFileSync(file, 'utf-8'), '{"v":2}');
  assert.equal(fs.readFileSync(`${file}.bak`, 'utf-8'), '{"v":1}');
});

test('writeFileAtomicSync：寫入失敗時原檔不被破壞、不留暫存檔', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'a.json');
  fs.writeFileSync(file, '{"keep":true}');
  assert.throws(() => writeFileAtomicSync(file, Symbol('bad')));
  assert.equal(fs.readFileSync(file, 'utf-8'), '{"keep":true}');
  assert.deepEqual(fs.readdirSync(dir), ['a.json']);
});

test('readJsonFileWithBackup：不存在 → fallback；正常 → main', () => {
  const file = path.join(tmpDir(), 'a.json');
  assert.deepEqual(readJsonFileWithBackup(file, { x: 0 }), { data: { x: 0 }, source: 'fallback' });
  fs.writeFileSync(file, '{"x":1}');
  assert.deepEqual(readJsonFileWithBackup(file, null), { data: { x: 1 }, source: 'main' });
});

test('readJsonFileWithBackup：主檔損毀時改讀 .bak；備份也壞則 fallback', () => {
  const file = path.join(tmpDir(), 'a.json');
  writeFileAtomicSync(file, '{"v":1}', { backup: true });
  writeFileAtomicSync(file, '{"v":2}', { backup: true });
  fs.writeFileSync(file, '{"v":2'); // 模擬被截斷
  const r = readJsonFileWithBackup(file, null);
  assert.equal(r.source, 'backup');
  assert.deepEqual(r.data, { v: 1 });
  fs.writeFileSync(`${file}.bak`, 'broken');
  const r2 = readJsonFileWithBackup(file, { d: 1 });
  assert.equal(r2.source, 'fallback');
  assert.deepEqual(r2.data, { d: 1 });
});
