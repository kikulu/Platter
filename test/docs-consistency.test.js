'use strict';

/**
 * test/docs-consistency.test.js
 *
 * 文件／版本／locale／內建數量的一致性檢查，邏輯在 scripts/check-docs.js。
 * 目的：避免再發生「提示詞檔停在舊版本」「README 寫的數量跟種子資料不符」這類漂移。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { runChecks } = require('../scripts/check-docs');

test('文件、版本、locale 與內建數量一致', () => {
  const problems = runChecks(path.join(__dirname, '..'));
  assert.deepEqual(problems, []);
});
