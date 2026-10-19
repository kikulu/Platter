'use strict';

/**
 * lib/builtinContent.js
 *
 * 內建角色、提示詞、分階段套餐、專案範本的多語系（1.43.0）。
 *
 * 原始內容（繁體中文）仍放在 `extractors/default-*.json`；英文與日文放在
 * `extractors/i18n/<lang>/{roles,knowledge-base,project-templates}.json`，只含可翻譯的欄位，
 * 以 id／defaultId 對應（id、roleIds、itemDefaultId、artifact 等結構欄位永遠取自原始檔）。
 *
 * 兩個用途：
 *   1. 取得「某個語言的內建預設內容」：全新安裝、補種新範本、範本展開成專案時用。
 *   2. 切換介面語言時，把使用者資料裡「沒有被改過」的內建項目換成新語言：逐欄位比對，
 *      欄位內容等於任何一種語言的內建原文才換；使用者改過的欄位保持不動。
 *
 * 刻意不依賴 Electron，可以直接用 `node --test` 測試。
 */

const fs = require('fs');
const path = require('path');

const SUPPORTED_LANGUAGES = ['zh-TW', 'en', 'ja'];
const BASE_LANGUAGE = 'zh-TW';
const EXTRACTORS_DIR = path.join(__dirname, '..', 'extractors');

const cache = new Map();

function readJson(file, fallback) {
  if (cache.has(file)) return cache.get(file);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    data = fallback;
  }
  cache.set(file, data);
  return data;
}

/** 清掉快取（測試或熱更新用）。 */
function clearCache() {
  cache.clear();
}

function baseFile(name) {
  return path.join(EXTRACTORS_DIR, `default-${name}.json`);
}

function overlayFile(lang, name) {
  return path.join(EXTRACTORS_DIR, 'i18n', lang, `${name}.json`);
}

function normalizeLanguage(lang) {
  return SUPPORTED_LANGUAGES.includes(lang) ? lang : BASE_LANGUAGE;
}

function norm(text) {
  return String(text == null ? '' : text)
    .replace(/\r\n/g, '\n')
    .trim();
}

// ---------------------------------------------------------------------------
// 原始內容與疊加檔
// ---------------------------------------------------------------------------

function baseRoles() {
  const data = readJson(baseFile('roles'), { roles: [] });
  return Array.isArray(data.roles) ? data.roles : [];
}

function baseKnowledge() {
  const data = readJson(baseFile('knowledge-base'), { items: [], groups: [] });
  return {
    items: Array.isArray(data.items) ? data.items : [],
    groups: Array.isArray(data.groups) ? data.groups : [],
  };
}

function baseTemplates() {
  const data = readJson(baseFile('project-templates'), { templates: [] });
  return Array.isArray(data.templates) ? data.templates : [];
}

function overlay(lang, name, fallback) {
  if (lang === BASE_LANGUAGE) return fallback;
  return readJson(overlayFile(lang, name), fallback);
}

function pick(source, keys) {
  const out = {};
  if (!source) return out;
  keys.forEach((k) => {
    if (source[k] !== undefined) out[k] = source[k];
  });
  return out;
}

// ---------------------------------------------------------------------------
// 取得某個語言的內建預設內容
// ---------------------------------------------------------------------------

function localizedDefaultRoles(lang) {
  const language = normalizeLanguage(lang);
  const ov = overlay(language, 'roles', {});
  return baseRoles().map((role) => ({
    ...role,
    ...pick(ov[role.id], ['name', 'description']),
  }));
}

function localizedDefaultKnowledgeBase(lang) {
  const language = normalizeLanguage(lang);
  const base = baseKnowledge();
  const ov = overlay(language, 'knowledge-base', { items: {}, groups: {} });
  const items = base.items.map((it) => ({
    ...it,
    ...pick((ov.items || {})[it.defaultId], [
      'title',
      'tags',
      'content',
      'systemPrompt',
      'userPrompt',
    ]),
  }));
  const groups = base.groups.map((g) => {
    const t = (ov.groups || {})[g.defaultId] || {};
    const stages = (g.stages || []).map((stage, i) => ({
      ...stage,
      ...(t.stages && t.stages[i] && t.stages[i].title
        ? { title: t.stages[i].title }
        : {}),
    }));
    return { ...g, ...pick(t, ['title', 'description', 'tags']), stages };
  });
  return { items, groups };
}

function localizeStep(step, translated) {
  return { ...step, ...pick(translated, ['title', 'prompt']) };
}

function localizedDefaultProjectTemplates(lang) {
  const language = normalizeLanguage(lang);
  const ov = overlay(language, 'project-templates', {});
  return baseTemplates().map((tpl) => {
    const t = ov[tpl.id];
    if (!t) return tpl;
    return {
      ...tpl,
      ...pick(t, ['name', 'description']),
      stages: (tpl.stages || []).map((stage, si) => {
        const ts = (t.stages || [])[si] || {};
        return {
          ...stage,
          ...pick(ts, ['title']),
          steps: (stage.steps || []).map((s, i) => localizeStep(s, (ts.steps || [])[i])),
          relatedPrompts: (stage.relatedPrompts || []).map((s, i) =>
            localizeStep(s, (ts.relatedPrompts || [])[i])
          ),
        };
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// 切換語言：把使用者資料裡「沒改過」的內建項目換成新語言
// ---------------------------------------------------------------------------

/** 某個內建欄位在各語言的原文（zh-TW 一定在第一個）。 */
function fieldVariants(getter) {
  return SUPPORTED_LANGUAGES.map((lang) => getter(lang));
}

/** 欄位值等於任一語言的內建原文時，回傳目標語言的原文；否則回傳 undefined（不動）。 */
function replacementFor(current, variants, targetLang) {
  const target = variants[SUPPORTED_LANGUAGES.indexOf(targetLang)];
  if (target === undefined || target === null) return undefined;
  if (norm(current) === norm(target)) return undefined;
  const matched = variants.some(
    (v) => v !== undefined && v !== null && norm(v) === norm(current)
  );
  return matched ? target : undefined;
}

let tagTableCache = null;

/** 各語言標籤的對照：任一語言的標籤 → { 'zh-TW', en, ja }。 */
function tagTable() {
  if (tagTableCache) return tagTableCache;
  const table = new Map();
  const perLang = {};
  SUPPORTED_LANGUAGES.forEach((lang) => {
    const kb = localizedDefaultKnowledgeBase(lang);
    perLang[lang] = [...kb.items, ...kb.groups].map((x) => x.tags || []);
  });
  perLang[BASE_LANGUAGE].forEach((zhTags, i) => {
    zhTags.forEach((zh, j) => {
      const row = {};
      SUPPORTED_LANGUAGES.forEach((lang) => {
        row[lang] = (perLang[lang][i] || [])[j] || zh;
      });
      SUPPORTED_LANGUAGES.forEach((lang) => table.set(row[lang], row));
    });
  });
  tagTableCache = table;
  return table;
}

function localizeTags(tags, targetLang) {
  if (!Array.isArray(tags)) return tags;
  const table = tagTable();
  const out = [];
  tags.forEach((tag) => {
    const row = table.get(tag);
    const next = row ? row[targetLang] : tag;
    if (!out.includes(next)) out.push(next);
  });
  return out;
}

function sameArray(a, b) {
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((x, i) => x === b[i])
  );
}

function setIfChanged(obj, key, value) {
  if (value === undefined || obj[key] === value) return false;
  obj[key] = value;
  return true;
}

/** roles：陣列，會直接修改。回傳是否有變動。 */
function applyRolesLanguage(roles, lang) {
  const language = normalizeLanguage(lang);
  if (!Array.isArray(roles)) return false;
  const byLang = {};
  SUPPORTED_LANGUAGES.forEach((l) => {
    byLang[l] = new Map(localizedDefaultRoles(l).map((r) => [r.id, r]));
  });
  let changed = false;
  roles.forEach((role) => {
    if (!role || !byLang[BASE_LANGUAGE].has(role.id)) return;
    let roleChanged = false;
    ['name', 'description'].forEach((field) => {
      const variants = fieldVariants((l) => (byLang[l].get(role.id) || {})[field]);
      if (setIfChanged(role, field, replacementFor(role[field], variants, language))) {
        roleChanged = true;
      }
    });
    if (roleChanged) {
      role.updatedAt = new Date().toISOString();
      changed = true;
    }
  });
  return changed;
}

/** knowledge：{ items, groups }，會直接修改。回傳是否有變動。 */
function applyKnowledgeLanguage(knowledge, lang) {
  const language = normalizeLanguage(lang);
  if (!knowledge) return false;
  const kbByLang = {};
  SUPPORTED_LANGUAGES.forEach((l) => {
    const kb = localizedDefaultKnowledgeBase(l);
    kbByLang[l] = {
      items: new Map(kb.items.map((x) => [x.defaultId, x])),
      groups: new Map(kb.groups.map((x) => [x.defaultId, x])),
    };
  });
  let changed = false;
  const now = new Date().toISOString();

  (knowledge.items || []).forEach((item) => {
    if (!item || !item.defaultId || !kbByLang[BASE_LANGUAGE].items.has(item.defaultId))
      return;
    let itemChanged = false;
    ['title', 'content', 'systemPrompt', 'userPrompt'].forEach((field) => {
      const variants = fieldVariants(
        (l) => (kbByLang[l].items.get(item.defaultId) || {})[field]
      );
      if (setIfChanged(item, field, replacementFor(item[field], variants, language)))
        itemChanged = true;
    });
    const tags = localizeTags(item.tags, language);
    if (Array.isArray(tags) && !sameArray(tags, item.tags)) {
      item.tags = tags;
      itemChanged = true;
    }
    if (itemChanged) {
      item.updatedAt = now;
      changed = true;
    }
  });

  (knowledge.groups || []).forEach((group) => {
    if (
      !group ||
      !group.defaultId ||
      !kbByLang[BASE_LANGUAGE].groups.has(group.defaultId)
    )
      return;
    let groupChanged = false;
    ['title', 'description'].forEach((field) => {
      const variants = fieldVariants(
        (l) => (kbByLang[l].groups.get(group.defaultId) || {})[field]
      );
      if (setIfChanged(group, field, replacementFor(group[field], variants, language))) {
        groupChanged = true;
      }
    });
    const tags = localizeTags(group.tags, language);
    if (Array.isArray(tags) && !sameArray(tags, group.tags)) {
      group.tags = tags;
      groupChanged = true;
    }
    // 步驟的階段名稱（step.stage）：對照內建套餐的第 n 個階段
    const stageCount = (
      (kbByLang[BASE_LANGUAGE].groups.get(group.defaultId) || {}).stages || []
    ).length;
    for (let i = 0; i < stageCount; i += 1) {
      const variants = fieldVariants((l) => {
        const g = kbByLang[l].groups.get(group.defaultId);
        return g && g.stages && g.stages[i] ? g.stages[i].title : undefined;
      });
      (group.steps || []).forEach((step) => {
        if (setIfChanged(step, 'stage', replacementFor(step.stage, variants, language))) {
          groupChanged = true;
        }
      });
    }
    if (groupChanged) {
      group.updatedAt = now;
      changed = true;
    }
  });
  return changed;
}

module.exports = {
  SUPPORTED_LANGUAGES,
  BASE_LANGUAGE,
  normalizeLanguage,
  clearCache,
  localizedDefaultRoles,
  localizedDefaultKnowledgeBase,
  localizedDefaultProjectTemplates,
  applyRolesLanguage,
  applyKnowledgeLanguage,
  localizeTags,
};
