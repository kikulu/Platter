'use strict';

/**
 * test/domCapture.test.js
 *
 * extractors/domCapture.js 是注入瀏覽器執行的腳本，這裡用最小的假 DOM
 * （只實作它用到的 querySelectorAll / contains / innerText / getAttribute）
 * 驗證「巢狀符合的外層容器不會造成內容重複疊加」。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeNode(text, children = []) {
  const node = {
    innerText: text,
    children,
    classList: { contains: () => false },
    tagName: 'DIV',
    getAttribute: () => null,
    contains(other) {
      if (other === node) return true;
      return children.some((c) => c.contains(other));
    },
  };
  return node;
}

function runCapture(nodes) {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'extractors', 'domCapture.js'),
    'utf-8'
  );
  const sandbox = {
    document: { title: 't', querySelectorAll: () => nodes },
    location: { href: 'http://x' },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  // 跨 vm realm 的物件原型不同，先 JSON 往返成本 realm 的普通物件再比較
  return JSON.parse(
    vm.runInContext(
      'JSON.stringify(capturePlatformConversation("claude", {turn:"x", userHint:""}))',
      sandbox
    )
  );
}

test('外層容器內含其他符合節點時，只保留最內層，不重複疊加', () => {
  const a = makeNode('第一則');
  const b = makeNode('第二則');
  const wrapper = makeNode('第一則\n第二則', [a, b]);
  const result = runCapture([wrapper, a, b]);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.messages.map((m) => m.text),
    ['第一則', '第二則']
  );
});

test('相鄰完全相同的訊息會被合併', () => {
  const a = makeNode('同一則');
  const b = makeNode('同一則');
  const result = runCapture([a, b]);
  assert.equal(result.messages.length, 1);
});

test('互不包含的節點照常全部保留', () => {
  const result = runCapture([makeNode('甲'), makeNode('乙'), makeNode('甲')]);
  assert.deepEqual(
    result.messages.map((m) => m.text),
    ['甲', '乙', '甲']
  );
});
