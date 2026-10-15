'use strict';

/**
 * test/csp.test.js
 *
 * L-3：每個 renderer 頁面都必須帶完整的 Content-Security-Policy（含 1.42.0 新增的
 * base-uri／form-action／object-src／frame-src），而且不能放寬 script-src。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RENDERER = path.join(__dirname, '..', 'renderer');
const pages = fs.readdirSync(RENDERER).filter((f) => f.endsWith('.html'));

function cspOf(file) {
  const html = fs.readFileSync(path.join(RENDERER, file), 'utf8');
  const m = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html);
  return m ? m[1] : null;
}

test('renderer 底下有 10 個頁面', () => {
  assert.equal(pages.length, 10);
});

for (const page of pages) {
  test(`CSP：${page} 帶有完整且不放寬的政策`, () => {
    const csp = cspOf(page);
    assert.ok(csp, '缺少 CSP meta');
    const directives = Object.fromEntries(
      csp
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const [name, ...vals] = s.split(/\s+/);
          return [name, vals.join(' ')];
        })
    );
    assert.equal(directives['default-src'], "'self'");
    assert.equal(directives['script-src'], "'self'", 'script-src 不可放寬');
    assert.ok(!/unsafe-eval|unsafe-inline/.test(directives['script-src']));
    assert.equal(directives['img-src'], "'self' data:");
    assert.equal(directives['base-uri'], "'none'");
    assert.equal(directives['form-action'], "'none'");
    assert.equal(directives['object-src'], "'none'");
    assert.equal(directives['frame-src'], "'none'");
  });
}

test('pdf.js：getDocument 都關閉 isEvalSupported', () => {
  const src = fs.readFileSync(path.join(RENDERER, 'documents.js'), 'utf8');
  const calls = src.match(/getDocument\(\{[^}]*\}\)/g) || [];
  assert.ok(calls.length >= 2);
  calls.forEach((c) => assert.ok(c.includes('isEvalSupported: false'), c));
});
