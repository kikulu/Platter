'use strict';

/**
 * lib/openspec.js — 與 OpenSpec（https://github.com/Fission-AI/OpenSpec，規格驅動開發框架）整合
 *
 * OpenSpec 把每個變更（change）放在 `openspec/changes/<變更名稱>/` 資料夾：
 *   proposal.md、design.md、tasks.md，以及 specs/<capability>/spec.md 差異規格
 *   （ADDED／MODIFIED／REMOVED Requirements）；實作完成後封存，把差異合併進 `openspec/specs/`。
 *
 * Platter 不執行 OpenSpec CLI，也不改使用者專案的程式碼；整合的方式是兩個方向的檔案交換：
 *   - 匯出：把「專案階段流程」裡各步驟的 AI 產出，依 OpenSpec 的資料夾結構寫成檔案
 *     （openspec/changes/<變更名稱>/…），使用者再用 OpenSpec 的指令驗證、實作、封存。
 *   - 匯入：讀專案現有的 `openspec/specs/<capability>/spec.md`，當作「既有規格」帶進差異規格與封存預演
 *     步驟的提示詞（差異規格的 MODIFIED／REMOVED 要對得上現有需求名稱，才寫得對）。
 *
 * 這個檔案的純函式（路徑檢查、解析 AI 產出裡的檔案標記、組出匯出計畫、組合既有規格）不依賴 Electron，
 * 有單元測試；檔案讀寫的部分（readOpenSpecSpecs / findExistingFiles / writeExportFiles）只用 fs。
 *
 * ⚠️ AI 的產出是不可信的輸入：檔案標記裡的路徑一律經過 sanitizeRelativePath() 檢查
 *    （不允許絕對路徑、.. 、非 .md 副檔名、奇怪字元），寫檔前還會再確認最終路徑仍在變更資料夾之內。
 */

const fs = require('fs');
const path = require('path');

// 匯出檔案的路徑片段只允許英數、點、底線、連字號，且不能以點開頭（擋掉 . 與 ..、隱藏檔）
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_PATH_DEPTH = 5;
const MAX_PATH_LENGTH = 120;
const MAX_SPEC_FILE_BYTES = 200 * 1024;
const DEFAULT_BASE_CONTEXT_MAX_CHARS = 60000;

// 提示詞請 AI 在每份檔案前面加的標記行：`=== FILE: specs/auth/spec.md ===`
const FILE_MARKER = /^[ \t]*={3,}[ \t]*FILE:[ \t]*(.+?)[ \t]*={3,}[ \t]*$/;
// 提案提示詞請 AI 在回覆最後一行標示的建議變更名稱（不屬於檔案內容，匯出時移除）
const SUGGESTED_ID_LINE =
  /^[ \t]*建議變更名稱[：:][ \t]*`?([a-z0-9]+(?:-[a-z0-9]+)*)`?[ \t]*$/m;
const SUGGESTED_ID_LINE_ALL = new RegExp(SUGGESTED_ID_LINE.source, 'gm');

/**
 * 檢查並正規化「變更資料夾內的相對路徑」。合法回傳正規化後的 posix 路徑，否則回傳 null。
 * 規則：非空、相對路徑、片段只含 [A-Za-z0-9._-] 且不以點開頭（所以沒有 . / ..）、
 * 副檔名必須是 .md、深度與總長有上限。
 */
function sanitizeRelativePath(input) {
  if (typeof input !== 'string') return null;
  const normalized = input.trim().replace(/\\/g, '/');
  if (!normalized || normalized.length > MAX_PATH_LENGTH) return null;
  if (normalized.startsWith('/') || normalized.includes(':')) return null;
  const segments = normalized.split('/');
  if (segments.length > MAX_PATH_DEPTH) return null;
  if (!segments.every((s) => SAFE_SEGMENT.test(s))) return null;
  if (!/\.md$/i.test(segments[segments.length - 1])) return null;
  return segments.join('/');
}

/** OpenSpec 變更資料夾名稱：小寫英數與連字號（kebab-case） */
function isValidChangeId(id) {
  return typeof id === 'string' && id.length <= 60 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id);
}

/**
 * 把任意文字（專案主題）轉成合法的變更名稱建議。中文等非 ASCII 字元會被丟掉；轉完是空的
 * （例如主題全是中文）就退回 `change-YYYYMMDD`，使用者再自己改。
 */
function slugifyChangeId(text, now = new Date()) {
  const slug = String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  if (slug) return slug;
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `change-${y}${m}${d}`;
}

/** 從步驟的產出裡找 AI 依提案提示詞標示的「建議變更名稱：xxx」，找不到回傳 null */
function extractSuggestedChangeId(steps) {
  for (const step of steps || []) {
    const m = SUGGESTED_ID_LINE.exec(String(step.output || ''));
    if (m && isValidChangeId(m[1])) return m[1];
  }
  return null;
}

/** AI 常把整份檔案包在 ``` 程式碼區塊裡；最外層剛好是一個區塊時把圍欄拿掉 */
function stripOuterFence(text) {
  const trimmed = String(text || '').trim();
  const m = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(trimmed);
  if (m && !m[1].includes('\n```')) return m[1].trim();
  return trimmed;
}

/**
 * 解析一個步驟的 AI 產出成要寫的檔案：
 *   - 產出裡有 `=== FILE: 路徑 ===` 標記：每個標記到下一個標記之間是一份檔案
 *     （第一個標記之前的內容視為前言，忽略）；
 *   - 沒有標記：整份產出寫到 defaultPath。
 * 路徑不合法的標記放進 rejected（不寫）；內容是空的略過。
 * @returns {{ files: {path, content}[], rejected: {path, reason}[], usedDefault: boolean }}
 */
function parseArtifactFiles(output, defaultPath) {
  // 提案提示詞請 AI 在回覆最後（通常在程式碼圍欄之外）補一行「建議變更名稱」，這行不屬於檔案內容；
  // 先拿掉，最外層的圍欄才剝得乾淨。
  const text = String(output || '').replace(SUGGESTED_ID_LINE_ALL, '');
  const lines = text.split(/\r?\n/);
  const files = [];
  const rejected = [];

  let current = null;
  let sawMarker = false;
  const flush = () => {
    if (!current) return;
    const content = stripOuterFence(current.lines.join('\n'));
    if (content) files.push({ path: current.path, content });
    current = null;
  };

  lines.forEach((line) => {
    const m = FILE_MARKER.exec(line);
    if (m) {
      sawMarker = true;
      flush();
      const safe = sanitizeRelativePath(m[1]);
      if (safe) current = { path: safe, lines: [] };
      else rejected.push({ path: m[1], reason: 'unsafe-path' });
      return;
    }
    if (current) current.lines.push(line);
  });
  flush();

  if (sawMarker) return { files, rejected, usedDefault: false };

  const safeDefault = sanitizeRelativePath(defaultPath);
  const content = stripOuterFence(text);
  if (safeDefault && content) {
    return { files: [{ path: safeDefault, content }], rejected, usedDefault: true };
  }
  return { files: [], rejected, usedDefault: true };
}

/**
 * 依 workflow 的步驟產出，組出匯出到 `openspec/changes/<changeId>/` 的計畫（不寫檔）。
 *
 * 只處理帶 `artifact`（預設檔案路徑）的步驟；沒有產出的步驟放進 skipped。同一路徑被多個步驟寫
 * 到時，後面的步驟覆蓋前面的。步驟用預設路徑而不是產出裡的標記時（例如差異規格沒有標 capability），
 * 放進 warnings 提醒使用者檢查檔名。
 */
function buildOpenSpecExportPlan(workflow, changeId) {
  const byPath = new Map();
  const skipped = [];
  const rejected = [];
  const warnings = [];

  (workflow.steps || []).forEach((step) => {
    if (!step.artifact) return;
    if (!String(step.output || '').trim()) {
      skipped.push({ stepId: step.id, title: step.title, reason: 'no-output' });
      return;
    }
    const parsed = parseArtifactFiles(step.output, step.artifact);
    parsed.rejected.forEach((r) =>
      rejected.push({ ...r, stepId: step.id, title: step.title })
    );
    if (parsed.files.length === 0) {
      skipped.push({ stepId: step.id, title: step.title, reason: 'no-valid-file' });
      return;
    }
    if (parsed.usedDefault && /(^|\/)specs\//.test(step.artifact)) {
      warnings.push({
        code: 'no-file-marker',
        stepId: step.id,
        title: step.title,
        path: step.artifact,
      });
    }
    parsed.files.forEach((f) => {
      const content = f.content.trim() + '\n';
      byPath.set(f.path, {
        path: f.path,
        content,
        stepId: step.id,
        stepTitle: step.title,
      });
    });
  });

  return {
    changeId,
    dirRelative: `openspec/changes/${changeId}`,
    files: [...byPath.values()],
    skipped,
    rejected,
    warnings,
  };
}

/** 計畫裡有哪些檔案在目標資料夾已經存在（寫入前要讓使用者確認覆蓋） */
function findExistingFiles(targetRoot, plan) {
  return plan.files
    .map((f) => f.path)
    .filter((rel) =>
      fs.existsSync(path.join(targetRoot, plan.dirRelative, ...rel.split('/')))
    );
}

/**
 * 把計畫裡的檔案寫到 `<targetRoot>/openspec/changes/<changeId>/`。回傳寫入的相對路徑清單
 * （相對於 targetRoot）。寫檔前再確認最終路徑仍在變更資料夾之內（縱深防禦，路徑本來就已經
 * 經過 sanitizeRelativePath()）。
 */
function writeExportFiles(targetRoot, plan) {
  const changeDir = path.resolve(targetRoot, ...plan.dirRelative.split('/'));
  const written = [];
  plan.files.forEach((f) => {
    const full = path.resolve(changeDir, ...f.path.split('/'));
    if (full !== changeDir && !full.startsWith(changeDir + path.sep)) {
      throw new Error(`拒絕寫出變更資料夾之外的路徑：${f.path}`);
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, f.content, 'utf-8');
    written.push(`${plan.dirRelative}/${f.path}`);
  });
  return written;
}

/**
 * 把多個 capability 的現有規格組成「既有規格」文字，供提示詞帶入。
 * 依 capability 名稱排序；總長超過上限時，放不下的 capability 記在 truncated（單一 capability
 * 就超過上限時截斷內容並標註），提示詞裡會註明有哪些沒帶入。
 * @param {{capability: string, content: string}[]} entries
 */
function buildBaseContext(entries, { maxChars = DEFAULT_BASE_CONTEXT_MAX_CHARS } = {}) {
  const sorted = [...entries].sort((a, b) => a.capability.localeCompare(b.capability));
  const blocks = [];
  const truncated = [];
  let total = 0;
  sorted.forEach((e) => {
    let block = `## Capability: ${e.capability}\n\n${e.content.trim()}\n`;
    if (block.length > maxChars && blocks.length === 0) {
      block = block.slice(0, maxChars) + '\n…（內容過長，已截斷）\n';
      truncated.push(e.capability);
    }
    if (total + block.length > maxChars && blocks.length > 0) {
      truncated.push(e.capability);
      return;
    }
    blocks.push(block);
    total += block.length;
  });
  let text = blocks.join('\n');
  if (truncated.length > 0) {
    text += `\n（以下 capability 因長度限制未帶入：${truncated.join('、')}）\n`;
  }
  return {
    text,
    capabilityCount: entries.length,
    includedCount: blocks.length,
    truncated,
    chars: text.length,
  };
}

/**
 * 讀專案現有的 OpenSpec 規格。接受使用者選的資料夾是：專案根目錄（有 openspec/specs）、
 * `openspec` 資料夾本身、或 `specs` 資料夾本身。每個 capability 是 specs 底下一層子資料夾裡的 spec.md。
 * 找不到 specs 資料夾回傳 null。太大的單檔（> 200KB）略過並記在 skippedLarge。
 */
function readOpenSpecSpecs(selectedDir) {
  const base = path.basename(selectedDir);
  const candidates = [path.join(selectedDir, 'openspec', 'specs')];
  if (base === 'openspec') candidates.push(path.join(selectedDir, 'specs'));
  if (base === 'specs') candidates.push(selectedDir);
  const specsDir = candidates.find((c) => {
    try {
      return fs.statSync(c).isDirectory();
    } catch {
      return false;
    }
  });
  if (!specsDir) return null;

  const entries = [];
  const skippedLarge = [];
  fs.readdirSync(specsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .forEach((d) => {
      const file = path.join(specsDir, d.name, 'spec.md');
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        return;
      }
      if (!stat.isFile()) return;
      if (stat.size > MAX_SPEC_FILE_BYTES) {
        skippedLarge.push(d.name);
        return;
      }
      entries.push({ capability: d.name, content: fs.readFileSync(file, 'utf-8') });
    });
  return { specsDir, entries, skippedLarge };
}

module.exports = {
  sanitizeRelativePath,
  isValidChangeId,
  slugifyChangeId,
  extractSuggestedChangeId,
  stripOuterFence,
  parseArtifactFiles,
  buildOpenSpecExportPlan,
  findExistingFiles,
  writeExportFiles,
  buildBaseContext,
  readOpenSpecSpecs,
};
