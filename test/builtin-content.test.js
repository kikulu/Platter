'use strict';

/**
 * test/builtin-content.test.js
 *
 * 內建角色／提示詞／套餐／專案範本的多語系（1.43.0）：
 *   - 疊加檔的完整性與結構一致（每個 id 都有、陣列長度相同、佔位符數量相同）
 *   - 切換語言時只換「沒被使用者改過」的欄位
 *   - 全新安裝直接用目前語言種進來；OpenSpec 解析標記在三種語言都能用
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const builtin = require('../lib/builtinContent');
const { extractSuggestedChangeId } = require('../lib/openspec');

const CJK = /[一-鿿]/;
const KANA = /[぀-ヿ]/;
const ZH = builtin.BASE_LANGUAGE;

function count(text, re) {
  return (String(text).match(re) || []).length;
}

// ---- 疊加檔完整性 ----

for (const lang of ['en', 'ja']) {
  test(`疊加檔 ${lang}：每個角色／提示詞／套餐／範本都有譯文，結構與原文一致`, () => {
    const base = {
      roles: builtin.localizedDefaultRoles(ZH),
      kb: builtin.localizedDefaultKnowledgeBase(ZH),
      tpl: builtin.localizedDefaultProjectTemplates(ZH),
    };
    const tr = {
      roles: builtin.localizedDefaultRoles(lang),
      kb: builtin.localizedDefaultKnowledgeBase(lang),
      tpl: builtin.localizedDefaultProjectTemplates(lang),
    };
    assert.equal(base.roles.length, 8);
    assert.equal(base.kb.items.length, 85);
    assert.equal(base.kb.groups.length, 9);
    assert.equal(base.tpl.length, 7);

    base.roles.forEach((r, i) => {
      assert.notEqual(tr.roles[i].name, r.name, `role ${r.id} name`);
      assert.notEqual(tr.roles[i].description, r.description, `role ${r.id} description`);
      assert.equal(tr.roles[i].id, r.id);
    });
    base.kb.items.forEach((it, i) => {
      const t = tr.kb.items[i];
      assert.equal(t.defaultId, it.defaultId);
      assert.deepEqual(t.roleIds, it.roleIds);
      ['title', 'content', 'systemPrompt', 'userPrompt'].forEach((f) => {
        if (it[f] === undefined) return;
        assert.notEqual(t[f], it[f], `${it.defaultId}.${f} 還是原文`);
        // 譯文的斷行可以不同（長句換行位置不一樣），但整體行數不應差太多
        const zhLines = it[f].split('\n').length;
        assert.ok(
          Math.abs(t[f].split('\n').length - zhLines) <= Math.max(6, zhLines / 4),
          `${it.defaultId}.${f} 行數差太多`
        );
        assert.equal(
          count(t[f], /```/g),
          count(it[f], /```/g),
          `${it.defaultId}.${f} 圍欄`
        );
        assert.equal(
          count(t[f], /^#{1,6} /gm),
          count(it[f], /^#{1,6} /gm),
          `${it.defaultId}.${f} 標題`
        );
        assert.deepEqual(
          t[f].match(/^={3,}\s*FILE:.*$/gm),
          it[f].match(/^={3,}\s*FILE:.*$/gm)
        );
        if (lang === 'en') assert.ok(!CJK.test(t[f]), `${it.defaultId}.${f} 殘留中文`);
      });
      assert.equal(t.tags.length, it.tags.length, `${it.defaultId} tags`);
    });
    base.kb.groups.forEach((g, i) => {
      const t = tr.kb.groups[i];
      assert.notEqual(t.title, g.title);
      assert.equal(t.stages.length, g.stages.length);
      t.stages.forEach((s, j) => {
        assert.deepEqual(s.itemDefaultIds, g.stages[j].itemDefaultIds);
        if (lang === 'en') assert.ok(!CJK.test(s.title));
      });
      if (lang === 'en') assert.ok(!CJK.test(t.title + t.description + t.tags.join()));
    });
    base.tpl.forEach((tpl, i) => {
      const t = tr.tpl[i];
      assert.equal(t.id, tpl.id);
      assert.notEqual(t.name, tpl.name);
      assert.equal(t.stages.length, tpl.stages.length);
      t.stages.forEach((st, si) => {
        const bs = tpl.stages[si];
        assert.equal(st.steps.length, bs.steps.length);
        st.steps.forEach((step, k) => {
          assert.equal(step.itemDefaultId, bs.steps[k].itemDefaultId);
          assert.equal(step.artifact, bs.steps[k].artifact);
          assert.equal(step.useBaseContext, bs.steps[k].useBaseContext);
          if (bs.steps[k].prompt) assert.notEqual(step.prompt, bs.steps[k].prompt);
        });
        if (lang === 'en')
          assert.ok(!CJK.test(JSON.stringify(st)), `${tpl.id} 階段殘留中文`);
      });
    });
    if (lang === 'ja') {
      assert.ok(
        tr.kb.items.every((it) => KANA.test(it.content)),
        '每則提示詞本文都應含假名'
      );
    }
  });
}

test('三語言的填空佔位符數量一致（[請填入]／[請貼上]／[待確認：）', () => {
  const all = (lang) => JSON.stringify(builtin.localizedDefaultKnowledgeBase(lang));
  const zh = all(ZH);
  const en = all('en');
  assert.equal(count(en, /\[Please fill in\]/g), count(zh, /\[請填入\]/g));
  assert.equal(count(en, /\[Please paste\]/g), count(zh, /\[請貼上\]/g));
  assert.equal(count(en, /\[TBD:/g), count(zh, /\[待確認：/g));
});

test('OpenSpec 建議變更名稱標記：三種語言都能被程式解析', () => {
  const lines = {
    [ZH]: '建議變更名稱：add-dark-mode',
    en: 'Suggested change name: add-dark-mode',
    ja: '変更名の提案：add-dark-mode',
  };
  for (const [lang, line] of Object.entries(lines)) {
    assert.equal(
      extractSuggestedChangeId([{ output: `...\n${line}` }]),
      'add-dark-mode',
      lang
    );
    const proposal = builtin
      .localizedDefaultKnowledgeBase(lang)
      .items.find((i) => i.defaultId === 'kb-default-050');
    assert.ok(
      proposal.content.includes(line.split('add-dark-mode')[0]),
      `${lang} 提示詞要用同一個標籤`
    );
  }
});

test('OpenSpec 範本的產出檔名（artifact）在各語言都不變', () => {
  const names = (lang) =>
    builtin
      .localizedDefaultProjectTemplates(lang)
      .find((t) => t.id === 'proj-tpl-openspec')
      .stages.flatMap((s) => s.steps.map((x) => x.artifact));
  assert.deepEqual(names('en'), names(ZH));
  assert.deepEqual(names('ja'), names(ZH));
});

// ---- 切換語言 ----

function makeKb(lang) {
  const kb = builtin.localizedDefaultKnowledgeBase(lang);
  const items = kb.items.map((it, i) => ({
    id: `kb_${i}`,
    defaultId: it.defaultId,
    title: it.title,
    content: it.content,
    tags: [...it.tags],
    systemPrompt: it.systemPrompt || '',
    userPrompt: it.userPrompt || '',
  }));
  const groups = kb.groups.map((g, i) => ({
    id: `g_${i}`,
    defaultId: g.defaultId,
    title: g.title,
    description: g.description,
    tags: [...g.tags],
    steps: g.stages.map((s) => ({ id: s.title, itemId: 'x', stage: s.title })),
  }));
  return { items, groups };
}

test('applyKnowledgeLanguage：沒改過的整個換成新語言，來回切換可還原', () => {
  const data = makeKb(ZH);
  const original = JSON.parse(JSON.stringify(data));
  assert.equal(builtin.applyKnowledgeLanguage(data, 'en'), true);
  const en = builtin.localizedDefaultKnowledgeBase('en');
  assert.equal(data.items[0].title, en.items[0].title);
  assert.equal(data.items[0].content, en.items[0].content);
  assert.deepEqual(data.items[0].tags, en.items[0].tags);
  assert.equal(data.groups[0].title, en.groups[0].title);
  assert.equal(data.groups[0].steps[0].stage, en.groups[0].stages[0].title);
  assert.equal(
    builtin.applyKnowledgeLanguage(data, 'en'),
    false,
    '已經是 en，不應再有變動'
  );

  builtin.applyKnowledgeLanguage(data, 'ja');
  assert.equal(
    data.items[3].title,
    builtin.localizedDefaultKnowledgeBase('ja').items[3].title
  );
  builtin.applyKnowledgeLanguage(data, ZH);
  data.items.forEach((it, i) => {
    assert.equal(it.title, original.items[i].title);
    assert.equal(it.content, original.items[i].content);
    assert.deepEqual(it.tags, original.items[i].tags);
  });
  assert.deepEqual(
    data.groups.map((g) => g.steps.map((s) => s.stage)),
    original.groups.map((g) => g.steps.map((s) => s.stage))
  );
});

test('applyKnowledgeLanguage：使用者改過的欄位不動，自訂標籤與自建項目保留', () => {
  const data = makeKb(ZH);
  data.items[0].title = '我自己的會議紀要';
  data.items[0].content = data.items[0].content + '\n\n（我加的備註）';
  data.items[0].tags = [...data.items[0].tags, '我的標籤'];
  data.items.push({
    id: 'mine',
    title: '自建提示詞',
    content: '內容',
    tags: ['企業日常作業'],
  });
  builtin.applyKnowledgeLanguage(data, 'en');
  assert.equal(data.items[0].title, '我自己的會議紀要');
  assert.ok(data.items[0].content.endsWith('（我加的備註）'));
  assert.deepEqual(data.items[0].tags, ['Everyday Business Tasks', '我的標籤']);
  // 沒改過的其他項目照換
  assert.equal(
    data.items[1].title,
    builtin.localizedDefaultKnowledgeBase('en').items[1].title
  );
  // 自建項目沒有 defaultId：完全不動（連標籤也不動）
  assert.deepEqual(data.items.at(-1).tags, ['企業日常作業']);
  assert.equal(data.items.at(-1).title, '自建提示詞');
});

test('applyRolesLanguage：改過名字的角色不換、其他欄位照換；自訂角色不動', () => {
  const zh = builtin.localizedDefaultRoles(ZH);
  const roles = zh.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    color: r.color,
  }));
  roles[0].name = '人資小幫手';
  roles.push({
    id: 'role_custom_1',
    name: '我的角色',
    description: '自訂',
    color: '#fff',
  });
  assert.equal(builtin.applyRolesLanguage(roles, 'ja'), true);
  const ja = builtin.localizedDefaultRoles('ja');
  assert.equal(roles[0].name, '人資小幫手');
  assert.equal(roles[0].description, ja[0].description);
  assert.equal(roles[1].name, ja[1].name);
  assert.equal(roles.at(-1).name, '我的角色');
  assert.equal(builtin.applyRolesLanguage(roles, 'xx'), true, '不認得的語言退回 zh-TW');
  assert.equal(roles[1].name, zh[1].name);
});

test('localizeTags：任一語言的標籤都能轉成目標語言，未知標籤保留、去重', () => {
  assert.deepEqual(builtin.localizeTags(['Sales', '業務銷售', 'x'], 'ja'), [
    '営業・セールス',
    'x',
  ]);
  assert.equal(builtin.localizeTags('not array', 'en'), 'not array');
});

// ---- 與資料層整合（假的 electron）----

test('stores：全新安裝用目前語言種進內建內容；切換語言後只換沒改過的', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-builtin-'));
  const fakeElectron = {
    app: { getPath: () => tmp, getVersion: () => 'test' },
    BrowserWindow: { getAllWindows: () => [] },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'electron') return fakeElectron;
    return originalLoad.call(this, request, ...rest);
  };
  try {
    const state = require('../lib/state');
    const stores = require('../lib/stores');
    // 全新安裝但介面語言已是英文（例如之後會依系統語言決定預設語言）：角色與知識庫直接用英文種進來
    fs.writeFileSync(
      path.join(tmp, 'app-state.json'),
      JSON.stringify({ accounts: [], ui: { language: 'en' }, extensions: [], roles: [] })
    );
    stores.loadAppState();
    assert.equal(state.appState.roles[0].name, 'Human Resources (HR)');

    let kb = stores.loadKnowledgeBase();
    assert.equal(kb.items[0].title, 'Meeting Minutes');
    assert.deepEqual(kb.items[0].tags, ['Everyday Business Tasks']);
    assert.ok(stores.loadDefaultProjectTemplates().every((t) => !CJK.test(t.name)));

    kb.items[1].title = 'My custom title';
    stores.saveKnowledgeBase(kb);

    state.appState.ui.language = 'ja';
    stores.syncBuiltinLanguage();
    assert.equal(state.appState.roles[0].name, '人事（HR）');
    kb = stores.loadKnowledgeBase();
    assert.equal(kb.items[0].title, '議事録の作成');
    assert.equal(kb.items[1].title, 'My custom title');
    assert.equal(
      stores.loadDefaultProjectTemplates()[0].name,
      builtin.localizedDefaultProjectTemplates('ja')[0].name
    );

    // 重新載入（模擬重開 App）：不會再有變動，語言記錄已更新
    const before = JSON.stringify(kb);
    assert.equal(JSON.stringify(stores.loadKnowledgeBase()), before);

    // 範本解析提示詞用目前語言的內建檔；使用者知識庫裡的版本優先
    const resolve = stores.makeKnowledgePromptResolver();
    assert.equal(resolve('kb-default-001').title, '議事録の作成');
  } finally {
    Module._load = originalLoad;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
