'use strict';

/**
 * lib/migrations.js
 *
 * 資料檔 schema 版本號與集中式 migration（1.45.0）。純函式，不碰檔案系統、不依賴 Electron。
 *
 * 每種資料檔（見 SCHEMA_VERSIONS）的最上層都有一個整數 `schemaVersion`：
 *   - 沒有這個欄位 = 版本 0（1.44.0 以前寫出來的舊檔）。
 *   - 讀檔時一律先經過 migrate(kind, raw)，依序套用 MIGRATIONS[kind] 裡版本比檔案新的步驟，
 *     之後程式碼可以直接假設資料是最新形狀，不必在各處再補預設值。
 *   - 寫檔時（lib/stores.js 的 writeVersionedFile）一律先 migrate(kind, payload, 0) 再寫：
 *     步驟是冪等的，所以等於「補齊成最新形狀＋蓋上目前版本」，不管各處 IPC 新建的紀錄有沒有帶齊欄位。
 *   - 檔案版本比程式支援的還新（例如降版）：不動資料、只回報 newer: true，由呼叫端決定要不要警告。
 *
 * 新增欄位或改格式時：
 *   1. 在 MIGRATIONS[kind] 結尾加一個 { to: N+1, up(envelope) { … 回傳新的 envelope … } }
 *      （step 必須是純函式、對已經是新形狀的資料要冪等，因為備份匯入的資料版本不可信）。
 *   2. 在 test/migrations.test.js 補一個舊形狀 → 新形狀的案例。
 *   3. 不需要改任何 loadX()。
 *
 * envelope 就是檔案內容本身：例如 projects.json 的 `{ schemaVersion, projects: [...] }`。
 */

const { normalizeWorkflow } = require('./workflow');

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 陣列裡只留物件（壞掉的元素直接丟掉，舊程式碼遇到這種元素會直接丟例外）。 */
function recordList(v) {
  return Array.isArray(v) ? v.filter(isPlainObject) : [];
}

function arrayOrEmpty(v) {
  return Array.isArray(v) ? v : [];
}

// ---------------------------------------------------------------------------
// 各資料檔的 migration 步驟（to = 套用後的版本號，必須從 1 開始連號）
// ---------------------------------------------------------------------------

const MIGRATIONS = {
  // app-state.json：{ accounts, ui, extensions, roles }
  // ui 預設值（含 sidebarGroups 深合併）不在這裡：那是「每次載入都補預設」，不是一次性的格式升級，
  // 仍由 lib/stores.js 的 loadAppState() 處理。
  state: [
    {
      to: 1,
      up(env) {
        return {
          ...env,
          accounts: arrayOrEmpty(env.accounts),
          ui: isPlainObject(env.ui) ? env.ui : {},
          extensions: arrayOrEmpty(env.extensions),
          roles: arrayOrEmpty(env.roles),
        };
      },
    },
  ],

  // knowledge-base.json：{ items, groups }
  knowledge: [
    {
      to: 1,
      up(env) {
        const items = recordList(env.items).map((it) => ({
          ...it,
          checklist: arrayOrEmpty(it.checklist),
          roleIds: arrayOrEmpty(it.roleIds),
          // 1.26.0 新增的系統提示詞／使用者提示詞拆分欄位
          systemPrompt: typeof it.systemPrompt === 'string' ? it.systemPrompt : '',
          userPrompt: typeof it.userPrompt === 'string' ? it.userPrompt : '',
        }));
        const groups = recordList(env.groups).map((g) => ({
          ...g,
          // 1.27.0 新增的 step.stage（階段名稱）
          steps: recordList(g.steps).map((s) => ({
            ...s,
            stage: typeof s.stage === 'string' ? s.stage : '',
          })),
        }));
        return { ...env, items, groups };
      },
    },
  ],

  // selectors.json：最上層就是「平台 → 選擇器」的對照表（沒有包一層），schemaVersion 與平台鍵並列；
  // lib/stores.js 讀進來後會把 schemaVersion 拿掉，所以其他程式碼看到的仍是純對照表。
  // 補進新版內建平台／欄位是 applyIncrementalSelectorDefaults() 的事（每次載入、不覆蓋使用者的值）。
  selectors: [
    {
      to: 1,
      up(env) {
        return { ...env };
      },
    },
  ],

  // projects.json：{ projects }
  projects: [
    {
      to: 1,
      up(env) {
        const projects = recordList(env.projects).map((p) => {
          const next = {
            ...p,
            issues: arrayOrEmpty(p.issues),
            linkedDocumentIds: arrayOrEmpty(p.linkedDocumentIds), // 1.35.0
            // 1.22.0 之前的任務沒有 timeEntries（工時紀錄）
            tasks: recordList(p.tasks).map((t) => ({
              ...t,
              timeEntries: arrayOrEmpty(t.timeEntries),
            })),
          };
          // 1.29.0 階段流程：沒有就維持沒有；有就補齊欄位；結構壞掉（不是含 steps 陣列的物件）就丟掉
          if (next.workflow) {
            const normalized = normalizeWorkflow(next.workflow);
            if (normalized) next.workflow = normalized;
            else delete next.workflow;
          }
          return next;
        });
        return { ...env, projects };
      },
    },
  ],

  // project-templates.json：{ templates }
  projectTemplates: [
    {
      to: 1,
      up(env) {
        return { ...env, templates: recordList(env.templates) };
      },
    },
  ],

  // documents.json：{ documents }
  documents: [
    {
      to: 1,
      up(env) {
        return { ...env, documents: recordList(env.documents) };
      },
    },
  ],

  // conversations.json：{ conversations }
  conversations: [
    {
      to: 1,
      up(env) {
        return {
          ...env,
          conversations: recordList(env.conversations).map((c) => ({
            ...c,
            tags: arrayOrEmpty(c.tags),
            linkedDocumentIds: arrayOrEmpty(c.linkedDocumentIds),
          })),
        };
      },
    },
  ],

  // seeded-defaults.json：「已種過哪些內建預設」的記錄，各 key 的形狀由 lib/stores.js 自己維護
  seededDefaults: [
    {
      to: 1,
      up(env) {
        return { ...env };
      },
    },
  ],
};

/** 每種資料檔目前的 schema 版本（= 該種 migration 最後一步的 to）。 */
const SCHEMA_VERSIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(MIGRATIONS).map(([kind, steps]) => [kind, steps[steps.length - 1].to])
  )
);

function assertKind(kind) {
  if (!Object.prototype.hasOwnProperty.call(MIGRATIONS, kind)) {
    throw new Error(`Unknown data kind: ${kind}`);
  }
}

/** 取出檔案裡的 schemaVersion；缺少或不是非負整數一律視為 0（舊檔）。 */
function readVersion(env) {
  const v = isPlainObject(env) ? env.schemaVersion : undefined;
  return Number.isInteger(v) && v >= 0 ? v : 0;
}

/**
 * 把讀進來的資料升到目前版本。
 * @param {string} kind SCHEMA_VERSIONS 的 key
 * @param {*} raw JSON.parse 出來的內容（可以是壞掉的值，非物件會當成空物件）
 * @param {number} [fromVersion] 強制指定來源版本（備份匯入時用備份檔自己宣告的版本）
 * @returns {{ data: object, from: number, to: number, changed: boolean, newer: boolean }}
 *   changed：版本有升級（呼叫端應該把 data 寫回磁碟）；newer：檔案比程式新，data 原樣回傳。
 */
function migrate(kind, raw, fromVersion) {
  assertKind(kind);
  const current = SCHEMA_VERSIONS[kind];
  let env = isPlainObject(raw) ? raw : {};
  const from = Number.isInteger(fromVersion) && fromVersion >= 0 ? fromVersion : readVersion(env);
  if (from > current) return { data: env, from, to: from, changed: false, newer: true };
  for (const step of MIGRATIONS[kind]) {
    if (step.to <= from) continue;
    env = step.up(env);
  }
  return { data: stamp(kind, env), from, to: current, changed: from < current, newer: false };
}

/** 寫檔前呼叫：schemaVersion 放在最前面，其餘內容照舊。 */
function stamp(kind, payload) {
  assertKind(kind);
  const rest = { ...(isPlainObject(payload) ? payload : {}) };
  delete rest.schemaVersion;
  return { schemaVersion: SCHEMA_VERSIONS[kind], ...rest };
}

module.exports = { MIGRATIONS, SCHEMA_VERSIONS, migrate, stamp, readVersion };
