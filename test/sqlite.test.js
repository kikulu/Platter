'use strict';

/**
 * test/sqlite.test.js
 *
 * 對 lib/sqlite.js（sql.js 包裝）以及日誌主控台實際會用到的存取模式做
 * 整合測試：開檔/建表、寫入、裁剪到上限筆數、清除、關檔重開後資料還在、
 * 從舊版 logs.json 搬遷資料。
 *
 * 這些測試會真的去讀 sql.js 的 WASM 模組（非同步），需要先 `npm install`
 * 讓 node_modules/sql.js 存在才能跑。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { openDatabaseFile, saveDatabaseFile, queryAll } = require('../lib/sqlite');

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'platter-sqlite-test-'));
}

async function createSchema(dbPath) {
  const db = await openDatabaseFile(dbPath);
  db.run(`
    CREATE TABLE IF NOT EXISTS errors (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      scope TEXT,
      message TEXT,
      stack TEXT
    );
    CREATE TABLE IF NOT EXISTS audits (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      category TEXT,
      action TEXT,
      detail TEXT
    );
  `);
  return db;
}

test('openDatabaseFile：檔案不存在時給一個可以直接建表寫入的空白資料庫', async () => {
  const dir = makeTempDir();
  try {
    const dbPath = path.join(dir, 'logs.sqlite');
    const db = await createSchema(dbPath);
    db.run(
      'INSERT INTO errors (id, timestamp, scope, message, stack) VALUES (?, ?, ?, ?, ?)',
      ['e1', '2025-01-01T00:00:00.000Z', 'test', 'hello', null]
    );
    const rows = queryAll(db, 'SELECT * FROM errors');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].message, 'hello');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('saveDatabaseFile + openDatabaseFile：存檔後重新開檔，資料還在（模擬 App 重啟）', async () => {
  const dir = makeTempDir();
  try {
    const dbPath = path.join(dir, 'logs.sqlite');
    const db = await createSchema(dbPath);
    db.run(
      'INSERT INTO audits (id, timestamp, category, action, detail) VALUES (?, ?, ?, ?, ?)',
      ['a1', '2025-01-01T00:00:00.000Z', 'account', 'add', '新增帳號測試']
    );
    saveDatabaseFile(db, dbPath);

    const reopened = await openDatabaseFile(dbPath);
    const rows = queryAll(reopened, 'SELECT * FROM audits');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].detail, '新增帳號測試');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('裁剪邏輯：超過上限筆數時，只留下時間最新的那幾筆', async () => {
  const dir = makeTempDir();
  try {
    const dbPath = path.join(dir, 'logs.sqlite');
    const db = await createSchema(dbPath);
    const MAX = 3;

    for (let i = 0; i < 10; i++) {
      db.run(
        'INSERT INTO errors (id, timestamp, scope, message, stack) VALUES (?, ?, ?, ?, ?)',
        [
          genId('log'),
          new Date(2025, 0, 1, 0, 0, i).toISOString(),
          'test',
          `err-${i}`,
          null,
        ]
      );
      db.run(
        `DELETE FROM errors WHERE id NOT IN (SELECT id FROM errors ORDER BY timestamp DESC LIMIT ${MAX})`
      );
    }

    const rows = queryAll(db, 'SELECT message FROM errors ORDER BY timestamp ASC');
    assert.equal(rows.length, MAX);
    assert.deepEqual(
      rows.map((r) => r.message),
      ['err-7', 'err-8', 'err-9']
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('清除邏輯：只清 errors 不會動到 audits', async () => {
  const dir = makeTempDir();
  try {
    const dbPath = path.join(dir, 'logs.sqlite');
    const db = await createSchema(dbPath);
    db.run(
      "INSERT INTO errors (id, timestamp, scope, message) VALUES ('e1', '2025-01-01T00:00:00.000Z', 's', 'm')"
    );
    db.run(
      "INSERT INTO audits (id, timestamp, category, action, detail) VALUES ('a1', '2025-01-01T00:00:00.000Z', 'c', 'x', 'd')"
    );

    db.run('DELETE FROM errors');

    assert.equal(queryAll(db, 'SELECT * FROM errors').length, 0);
    assert.equal(queryAll(db, 'SELECT * FROM audits').length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('從舊版 logs.json 搬遷：資料庫是空的且舊檔存在時，把內容匯入並改名舊檔', async () => {
  const dir = makeTempDir();
  try {
    const dbPath = path.join(dir, 'logs.sqlite');
    const legacyPath = path.join(dir, 'logs.json');
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        errors: [
          {
            id: 'e_old',
            timestamp: '2024-01-01T00:00:00.000Z',
            scope: 'old',
            message: '舊錯誤',
            stack: null,
          },
        ],
        audits: [
          {
            id: 'a_old',
            timestamp: '2024-01-01T00:00:00.000Z',
            category: 'account',
            action: 'add',
            detail: '舊稽核',
          },
        ],
      })
    );

    const db = await createSchema(dbPath);

    // 搬遷邏輯（跟 main.js 的 migrateLegacyJsonLogsIfNeeded 對應）：
    // 資料庫是空的才搬，搬完把舊檔改名成 .migrated。
    const errorCount = queryAll(db, 'SELECT COUNT(*) AS c FROM errors')[0].c;
    const auditCount = queryAll(db, 'SELECT COUNT(*) AS c FROM audits')[0].c;
    assert.equal(errorCount, 0);
    assert.equal(auditCount, 0);

    const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
    legacy.errors.forEach((e) => {
      db.run(
        'INSERT OR IGNORE INTO errors (id, timestamp, scope, message, stack) VALUES (?, ?, ?, ?, ?)',
        [e.id, e.timestamp, e.scope, e.message, e.stack]
      );
    });
    legacy.audits.forEach((a) => {
      db.run(
        'INSERT OR IGNORE INTO audits (id, timestamp, category, action, detail) VALUES (?, ?, ?, ?, ?)',
        [a.id, a.timestamp, a.category, a.action, a.detail]
      );
    });
    fs.renameSync(legacyPath, `${legacyPath}.migrated`);

    assert.equal(queryAll(db, 'SELECT * FROM errors').length, 1);
    assert.equal(queryAll(db, 'SELECT * FROM audits').length, 1);
    assert.ok(fs.existsSync(`${legacyPath}.migrated`));
    assert.ok(!fs.existsSync(legacyPath));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
