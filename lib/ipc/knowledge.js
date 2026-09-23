const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const { genId } = require('../utils');
const { readJSONSafe } = require('../dataDir');
const { loadKnowledgeBase, saveKnowledgeBase } = require('../stores');
const { broadcastToAllWindows } = require('../broadcast');
const { logError, logAudit } = require('../logs');
const state = require('../state');

// --- 知識庫：提示詞項目 / 群組順序提示詞套餐 / 匯出 / 匯入 ---
function registerKnowledgeIpc(ipcMain) {
  ipcMain.handle('knowledge:list', () => loadKnowledgeBase());

  ipcMain.handle('knowledge:save', (e, item) => {
    const kb = loadKnowledgeBase();
    const now = new Date().toISOString();
    const checklist = Array.isArray(item.checklist) ? item.checklist : [];
    const roleIds = Array.isArray(item.roleIds) ? item.roleIds : [];
    // systemPrompt／userPrompt：提示詞拆成「系統提示詞」跟「使用者提示詞」
    // 兩欄的可選欄位，沒填就是空字串，畫面上會退回顯示單一的 content。
    const systemPrompt = typeof item.systemPrompt === 'string' ? item.systemPrompt : '';
    const userPrompt = typeof item.userPrompt === 'string' ? item.userPrompt : '';
    if (item.id) {
      const idx = kb.items.findIndex((i) => i.id === item.id);
      if (idx >= 0) {
        kb.items[idx] = {
          ...kb.items[idx],
          ...item,
          checklist,
          roleIds,
          systemPrompt,
          userPrompt,
          updatedAt: now,
        };
      } else {
        kb.items.push({
          ...item,
          checklist,
          roleIds,
          systemPrompt,
          userPrompt,
          createdAt: now,
          updatedAt: now,
        });
      }
    } else {
      item.id = `kb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      item.checklist = checklist;
      item.roleIds = roleIds;
      item.systemPrompt = systemPrompt;
      item.userPrompt = userPrompt;
      item.createdAt = now;
      item.updatedAt = now;
      kb.items.push(item);
    }
    saveKnowledgeBase(kb);
    broadcastToAllWindows('knowledge:changed');
    return kb;
  });

  ipcMain.handle('knowledge:delete', (e, id) => {
    const kb = loadKnowledgeBase();
    kb.items = kb.items.filter((i) => i.id !== id);
    // 項目刪除後，任何套餐裡引用到這個項目的步驟也一併移除，避免懸空引用
    kb.groups.forEach((g) => {
      g.steps = g.steps.filter((s) => s.itemId !== id);
    });
    saveKnowledgeBase(kb);
    broadcastToAllWindows('knowledge:changed');
    return kb;
  });

  // --- 知識庫：檢核表（單一項目自帶的獨立檢核表） ---
  ipcMain.handle('knowledge:toggleChecklistEntry', (e, { itemId, entryId, checked }) => {
    const kb = loadKnowledgeBase();
    const item = kb.items.find((i) => i.id === itemId);
    if (item) {
      const entry = (item.checklist || []).find((c) => c.id === entryId);
      if (entry) entry.checked = checked;
      item.updatedAt = new Date().toISOString();
    }
    saveKnowledgeBase(kb);
    broadcastToAllWindows('knowledge:changed');
    return kb;
  });

  // --- 知識庫：群組順序提示詞套餐 ---
  ipcMain.handle('knowledge:group:save', (e, group) => {
    const kb = loadKnowledgeBase();
    const now = new Date().toISOString();
    const steps = Array.isArray(group.steps)
      ? group.steps.map((s) => ({
          id: s.id || `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          itemId: s.itemId,
          checked: !!s.checked,
        }))
      : [];
    if (group.id) {
      const idx = kb.groups.findIndex((g) => g.id === group.id);
      if (idx >= 0) {
        kb.groups[idx] = { ...kb.groups[idx], ...group, steps, updatedAt: now };
      } else {
        kb.groups.push({ ...group, steps, createdAt: now, updatedAt: now });
      }
    } else {
      group.id = `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      group.steps = steps;
      group.createdAt = now;
      group.updatedAt = now;
      kb.groups.push(group);
    }
    saveKnowledgeBase(kb);
    broadcastToAllWindows('knowledge:changed');
    return kb;
  });

  ipcMain.handle('knowledge:group:delete', (e, id) => {
    const kb = loadKnowledgeBase();
    kb.groups = kb.groups.filter((g) => g.id !== id);
    saveKnowledgeBase(kb);
    broadcastToAllWindows('knowledge:changed');
    return kb;
  });

  // 檢核表機制：勾選/取消勾選套餐裡的某一個步驟（追蹤這個步驟是否已使用/完成）
  ipcMain.handle('knowledge:group:toggleStep', (e, { groupId, stepId, checked }) => {
    const kb = loadKnowledgeBase();
    const group = kb.groups.find((g) => g.id === groupId);
    if (group) {
      const step = group.steps.find((s) => s.id === stepId);
      if (step) step.checked = checked;
      group.updatedAt = new Date().toISOString();
    }
    saveKnowledgeBase(kb);
    broadcastToAllWindows('knowledge:changed');
    return kb;
  });

  // 重置整份套餐的檢核表進度（全部取消勾選），方便下次重新走一輪流程
  ipcMain.handle('knowledge:group:resetChecklist', (e, groupId) => {
    const kb = loadKnowledgeBase();
    const group = kb.groups.find((g) => g.id === groupId);
    if (group) {
      group.steps.forEach((s) => (s.checked = false));
      group.updatedAt = new Date().toISOString();
    }
    saveKnowledgeBase(kb);
    broadcastToAllWindows('knowledge:changed');
    return kb;
  });

  ipcMain.handle('knowledge:exportAll', async (e, format) => {
    const kb = loadKnowledgeBase();
    const { canceled, filePath } = await dialog.showSaveDialog(state.knowledgeWindow, {
      title: '匯出知識庫',
      defaultPath: `knowledge-base.${format === 'json' ? 'json' : 'md'}`,
      filters:
        format === 'json'
          ? [{ name: 'JSON', extensions: ['json'] }]
          : [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (canceled || !filePath) return { ok: false };
    let content;
    if (format === 'json') {
      content = JSON.stringify(kb, null, 2);
    } else {
      const itemBlocks = kb.items.map((it) => {
        const tags = (it.tags || []).map((t) => `#${t}`).join(' ');
        const checklist = (it.checklist || [])
          .map((c) => `- [${c.checked ? 'x' : ' '}] ${c.text}`)
          .join('\n');
        // 有拆分系統／使用者提示詞的項目（例如企業角色範本）匯出時分成
        // 兩個小節；沒有拆分的項目維持原本直接輸出 content 的舊行為。
        const hasSplitPrompt = it.systemPrompt || it.userPrompt;
        const bodyLines = hasSplitPrompt
          ? [
              '### 系統提示詞（System Prompt）',
              '',
              it.systemPrompt || '（未填寫）',
              '',
              '### 使用者提示詞（User Prompt）',
              '',
              it.userPrompt || '（未填寫）',
            ]
          : [it.content];
        return [
          `## ${it.title}`,
          '',
          tags,
          '',
          ...bodyLines,
          checklist ? `\n**檢核表**\n\n${checklist}` : '',
        ]
          .join('\n')
          .trim();
      });
      const itemsById = new Map(kb.items.map((it) => [it.id, it]));
      const groupBlocks = kb.groups.map((g) => {
        const tags = (g.tags || []).map((t) => `#${t}`).join(' ');
        const steps = g.steps
          .map((s, idx) => {
            const item = itemsById.get(s.itemId);
            return `${idx + 1}. [${s.checked ? 'x' : ' '}] ${item ? item.title : '(已刪除的項目)'}`;
          })
          .join('\n');
        return [`## 📦 套餐：${g.title}`, '', tags, '', g.description || '', '', steps]
          .join('\n')
          .trim();
      });
      content = [...itemBlocks, ...groupBlocks].join('\n\n---\n\n');
    }
    fs.writeFileSync(filePath, content, 'utf-8');
    return { ok: true, filePath };
  });

  ipcMain.handle('knowledge:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(state.knowledgeWindow, {
      title: '匯入知識庫',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return loadKnowledgeBase();
    const raw = readJSONSafe(filePaths[0], null);
    if (!raw || !Array.isArray(raw.items)) return loadKnowledgeBase();

    const kb = loadKnowledgeBase();
    const now = new Date().toISOString();

    // 匯入項目：重新產生 id，避免撞號；同時記住新舊 id 對照，讓套餐引用可以跟著轉換
    const idMap = new Map();
    raw.items.forEach((it) => {
      const newId = `kb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      idMap.set(it.id, newId);
      kb.items.push({
        id: newId,
        title: it.title || '未命名',
        content: it.content || '',
        tags: Array.isArray(it.tags) ? it.tags : [],
        checklist: Array.isArray(it.checklist)
          ? it.checklist.map((c) => ({
              id: `chk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              text: c.text || '',
              checked: !!c.checked,
            }))
          : [],
        roleIds: [], // 角色是各安裝環境自己的資料，匯入不帶入來源檔案的角色配置
        systemPrompt: typeof it.systemPrompt === 'string' ? it.systemPrompt : '',
        userPrompt: typeof it.userPrompt === 'string' ? it.userPrompt : '',
        createdAt: it.createdAt || now,
        updatedAt: now,
      });
    });

    // 匯入套餐：steps 裡的 itemId 依 idMap 轉換；找不到對照的（來源檔案本身就缺項目）就跳過該步驟
    if (Array.isArray(raw.groups)) {
      raw.groups.forEach((g) => {
        const steps = (g.steps || [])
          .map((s) => ({
            id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            itemId: idMap.get(s.itemId) || null,
            checked: false,
          }))
          .filter((s) => s.itemId);
        kb.groups.push({
          id: `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          title: g.title || '未命名套餐',
          description: g.description || '',
          tags: Array.isArray(g.tags) ? g.tags : [],
          steps,
          createdAt: g.createdAt || now,
          updatedAt: now,
        });
      });
    }

    saveKnowledgeBase(kb);
    broadcastToAllWindows('knowledge:changed');
    return kb;
  });

  // 匯入現成的 Markdown 檔案（例如之前用對話庫/其他工具匯出的 .md），直接
  // 變成一則新的提示詞項目，檔名（去掉副檔名）當標題、檔案內容整份塞進
  // content，匯入後照樣可以在編輯器裡檢視/編輯，跟手動新增的項目沒有差別。
  ipcMain.handle('knowledge:importMarkdown', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(state.knowledgeWindow, {
      title: '匯入 Markdown 檔案',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (canceled || filePaths.length === 0)
      return { kb: loadKnowledgeBase(), importedIds: [] };

    const kb = loadKnowledgeBase();
    const now = new Date().toISOString();
    const importedIds = [];

    filePaths.forEach((filePath) => {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const title = path.basename(filePath).replace(/\.[^.]+$/, '');
        const id = genId('kb');
        kb.items.push({
          id,
          title,
          content,
          tags: [],
          checklist: [],
          roleIds: [],
          systemPrompt: '',
          userPrompt: '',
          createdAt: now,
          updatedAt: now,
        });
        importedIds.push(id);
      } catch (err) {
        logError('knowledge:importMarkdown', `匯入 Markdown 檔案失敗: ${filePath}`, err);
      }
    });

    saveKnowledgeBase(kb);
    if (importedIds.length > 0) {
      logAudit(
        'knowledge',
        'importMarkdown',
        `匯入 ${importedIds.length} 個 Markdown 檔案`
      );
    }
    broadcastToAllWindows('knowledge:changed');
    return { kb, importedIds };
  });
}

module.exports = { registerKnowledgeIpc };
