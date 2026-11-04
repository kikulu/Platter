'use strict';

/**
 * lib/ipcValidate.js
 *
 * 資安稽核 N-5：IPC 來源檢查（guardIpc）之外，再加一層 payload 形狀檢查。
 * 規則很小：只擋「型別不對、長度爆量、含控制字元的識別碼」這類不該出現的東西，
 * 不取代各 handler 自己的業務檢查。
 *
 * 規則字串：
 *   'id'      非空字串、≤200 字、不含控制字元／路徑分隔符
 *   'str'     字串，≤ 2,000,000 字（'str:N' 指定上限）
 *   'int'     有限整數
 *   'num'     有限數字
 *   'bool'    布林
 *   'obj'     一般物件（非陣列、非 null）
 *   'strs'    字串陣列（≤ 5000 個，每個 ≤ 2000 字）
 *   'any'     不檢查
 *   結尾加 '?' 表示可以是 undefined／null
 * 物件規格：{ 欄位: 規則 }，沒列出的欄位不檢查。
 */

const MAX_STR = 2000000;

function checkRule(rule, value, depth) {
  if (rule && typeof rule === 'object') {
    if (value === undefined || value === null) return false;
    if (typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.keys(rule).every((k) => checkRule(rule[k], value[k], depth + 1));
  }
  const spec = String(rule);
  const optional = spec.endsWith('?');
  const base = optional ? spec.slice(0, -1) : spec;
  if (value === undefined || value === null) return optional;
  const [name, arg] = base.split(':');
  switch (name) {
    case 'any':
      return true;
    case 'id':
      return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= 200 &&
        !/[\u0000-\u001f\u007f/\\]/.test(value)
      );
    case 'str':
      return typeof value === 'string' && value.length <= (arg ? Number(arg) : MAX_STR);
    case 'int':
      return Number.isInteger(value);
    case 'num':
      return typeof value === 'number' && Number.isFinite(value);
    case 'bool':
      return typeof value === 'boolean';
    case 'obj':
      return typeof value === 'object' && !Array.isArray(value);
    case 'strs':
      return (
        Array.isArray(value) &&
        value.length <= 5000 &&
        value.every((x) => typeof x === 'string' && x.length <= 2000)
      );
    default:
      return false;
  }
}

/** @param {Array} rules 每個參數一條規則 @param {Array} args */
function validateArgs(rules, args) {
  if (!Array.isArray(rules)) return true;
  return rules.every((rule, i) => checkRule(rule, args[i], 0));
}

module.exports = { validateArgs, checkRule };
