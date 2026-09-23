(function () {
  // --- DOM refs ---
  const tabItemsBtn = document.getElementById('tab-items');
  const tabGroupsBtn = document.getElementById('tab-groups');
  const btnNewItem = document.getElementById('btn-new-item');
  const btnNewGroup = document.getElementById('btn-new-group');
  const btnImportMd = document.getElementById('btn-import-md');
  const listEl = document.getElementById('kb-list');
  const searchInput = document.getElementById('kb-search');
  const tagFilterEl = document.getElementById('kb-tag-filter');
  const emptyEl = document.getElementById('kb-empty');

  const itemEditorEl = document.getElementById('kb-editor');
  const titleInput = document.getElementById('kb-title');
  const tagsInput = document.getElementById('kb-tags');
  const contentInput = document.getElementById('kb-content');
  const systemPromptInput = document.getElementById('kb-system-prompt');
  const userPromptInput = document.getElementById('kb-user-prompt');
  const checklistListEl = document.getElementById('kb-checklist-list');
  const checklistNewInput = document.getElementById('kb-checklist-new-input');
  const roleConfigListEl = document.getElementById('kb-role-config-list');

  const groupEditorEl = document.getElementById('kb-group-editor');
  const grpTitleInput = document.getElementById('grp-title');
  const grpTagsInput = document.getElementById('grp-tags');
  const grpDescInput = document.getElementById('grp-description');
  const grpStepsListEl = document.getElementById('grp-steps-list');
  const grpAddStepSelect = document.getElementById('grp-add-step-select');
  const grpProgressEl = document.getElementById('grp-progress');

  // --- State ---
  let allItems = [];
  let allGroups = [];
  let allRoles = [];
  let mode = 'items'; // 'items' | 'groups'
  let currentItemId = null; // null = 新項目（尚未儲存）
  let currentGroupId = null; // null = 新套餐（尚未儲存）
  let editingChecklist = []; // 目前項目編輯器裡的檢核表（記憶體內，按「儲存」才寫入）
  let editingRoleIds = []; // 目前項目編輯器裡的角色配置（記憶體內，按「儲存」才寫入）
  let editingSteps = []; // 目前套餐編輯器裡的步驟（記憶體內，結構性變更要按「儲存套餐」才寫入）

  function parseTags(str) {
    return str
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function genLocalId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // ---------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------
  function switchTab(newMode) {
    mode = newMode;
    tabItemsBtn.classList.toggle('active', mode === 'items');
    tabGroupsBtn.classList.toggle('active', mode === 'groups');
    btnNewItem.style.display = mode === 'items' ? 'inline-block' : 'none';
    btnNewGroup.style.display = mode === 'groups' ? 'inline-block' : 'none';
    btnImportMd.style.display = mode === 'items' ? 'inline-block' : 'none';

    itemEditorEl.style.display = 'none';
    groupEditorEl.style.display = 'none';
    emptyEl.style.display = 'flex';
    emptyEl.textContent = window.i18n.t(
      mode === 'items' ? 'knowledge.selectPrompt' : 'knowledge.selectGroupPrompt'
    );
    currentItemId = null;
    currentGroupId = null;

    rebuildTagOptions();
    renderList();
  }

  tabItemsBtn.addEventListener('click', () => switchTab('items'));
  tabGroupsBtn.addEventListener('click', () => switchTab('groups'));

  // ---------------------------------------------------------------------
  // 標籤篩選（依目前分頁動態組出選項）
  // ---------------------------------------------------------------------
  function rebuildTagOptions() {
    const tagSet = new Set();
    const source = mode === 'items' ? allItems : allGroups;
    source.forEach((it) => (it.tags || []).forEach((t) => tagSet.add(t)));
    const currentValue = tagFilterEl.value;
    tagFilterEl.innerHTML = `<option value="">${window.i18n.t('knowledge.filterAll')}</option>`;
    Array.from(tagSet)
      .sort()
      .forEach((tag) => {
        const opt = document.createElement('option');
        opt.value = tag;
        opt.textContent = tag;
        tagFilterEl.appendChild(opt);
      });
    tagFilterEl.value = currentValue;
  }
  tagFilterEl.addEventListener('change', renderList);

  // ---------------------------------------------------------------------
  // 全文搜尋（即時篩選，不用按 Enter；跟標籤篩選是 AND 關係）
  // ---------------------------------------------------------------------
  searchInput.addEventListener('input', renderList);

  // ---------------------------------------------------------------------
  // List rendering
  // ---------------------------------------------------------------------
  function renderList() {
    listEl.innerHTML = '';
    if (mode === 'items') renderItemList();
    else renderGroupList();
  }

  function renderItemList() {
    const filterTag = tagFilterEl.value;
    const query = searchInput.value.trim().toLowerCase();
    const filtered = allItems.filter((it) => {
      if (filterTag && !(it.tags || []).includes(filterTag)) return false;
      if (query && !itemMatchesQuery(it, query)) return false;
      return true;
    });

    if (filtered.length === 0) {
      renderListEmptyHint(
        allItems.length === 0 ? 'knowledge.selectPrompt' : 'knowledge.searchNoResult'
      );
      return;
    }

    filtered.forEach((it) => {
      const div = document.createElement('div');
      div.className = 'kb-item' + (it.id === currentItemId ? ' active' : '');

      const title = document.createElement('div');
      title.className = 'kb-title';
      title.textContent = it.title || '(未命名)';

      const meta = document.createElement('div');
      meta.className = 'kb-tags';
      const tagText = (it.tags || []).map((t) => `#${t}`).join(' ');
      const checklistTotal = (it.checklist || []).length;
      const checklistDone = (it.checklist || []).filter((c) => c.checked).length;
      const hasSplitPrompt = it.systemPrompt || it.userPrompt;
      meta.textContent = [
        tagText,
        hasSplitPrompt ? window.i18n.t('knowledge.splitPromptBadge') : '',
        checklistTotal ? `☑ ${checklistDone}/${checklistTotal}` : '',
      ]
        .filter(Boolean)
        .join('  ');

      div.appendChild(title);
      div.appendChild(meta);
      div.addEventListener('click', () => selectItem(it.id));
      listEl.appendChild(div);
    });
  }

  // 全文搜尋比對範圍：標題、內容、標籤——標籤篩選下拉選單已經可以精準篩
  // 單一標籤，這裡額外也比對標籤是為了「只記得標籤片段、不確定完整拼法」
  // 這種情況也能搜到。
  function itemMatchesQuery(it, query) {
    if ((it.title || '').toLowerCase().includes(query)) return true;
    if ((it.content || '').toLowerCase().includes(query)) return true;
    if ((it.systemPrompt || '').toLowerCase().includes(query)) return true;
    if ((it.userPrompt || '').toLowerCase().includes(query)) return true;
    if ((it.tags || []).some((t) => t.toLowerCase().includes(query))) return true;
    return false;
  }

  function renderGroupList() {
    const filterTag = tagFilterEl.value;
    const query = searchInput.value.trim().toLowerCase();
    const filtered = allGroups.filter((g) => {
      if (filterTag && !(g.tags || []).includes(filterTag)) return false;
      if (query && !groupMatchesQuery(g, query)) return false;
      return true;
    });

    if (filtered.length === 0) {
      renderListEmptyHint(
        allGroups.length === 0
          ? 'knowledge.selectGroupPrompt'
          : 'knowledge.searchNoResult'
      );
      return;
    }

    filtered.forEach((g) => {
      const div = document.createElement('div');
      div.className = 'kb-item' + (g.id === currentGroupId ? ' active' : '');

      const title = document.createElement('div');
      title.className = 'kb-title';
      title.textContent = `📦 ${g.title || '(未命名套餐)'}`;

      const meta = document.createElement('div');
      meta.className = 'kb-tags';
      const tagText = (g.tags || []).map((t) => `#${t}`).join(' ');
      const total = (g.steps || []).length;
      const done = (g.steps || []).filter((s) => s.checked).length;
      meta.textContent = [tagText, `${done}/${total}`].filter(Boolean).join('  ');

      div.appendChild(title);
      div.appendChild(meta);
      div.addEventListener('click', () => selectGroup(g.id));
      listEl.appendChild(div);
    });
  }

  // 全文搜尋比對範圍：套餐標題、說明、標籤，外加「套餐裡任一步驟引用的
  // 提示詞標題」——這樣可以直接搜「這個提示詞被用在哪些套餐裡」，不用
  // 自己一個個套餐點開看步驟。itemTitleById() 定義在後面（函式宣告會
  // hoist，執行順序沒問題）。
  function groupMatchesQuery(g, query) {
    if ((g.title || '').toLowerCase().includes(query)) return true;
    if ((g.description || '').toLowerCase().includes(query)) return true;
    if ((g.tags || []).some((t) => t.toLowerCase().includes(query))) return true;
    if (
      (g.steps || []).some((s) => itemTitleById(s.itemId).toLowerCase().includes(query))
    )
      return true;
    return false;
  }

  // 標籤/搜尋篩選後完全沒有符合的項目時顯示的提示；如果清單本身就是空的
  // （還沒建立過任何項目/套餐），顯示原本的「選擇或新增」提示，不要誤導
  // 使用者以為是搜尋沒搜到。
  function renderListEmptyHint(i18nKey) {
    const hint = document.createElement('div');
    hint.className = 'kb-list-empty';
    hint.textContent = window.i18n.t(i18nKey);
    listEl.appendChild(hint);
  }

  // ---------------------------------------------------------------------
  // 提示詞項目編輯（含檢核表）
  // ---------------------------------------------------------------------
  function renderChecklist() {
    checklistListEl.innerHTML = '';
    editingChecklist.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'checklist-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!entry.checked;
      checkbox.addEventListener('change', () => {
        entry.checked = checkbox.checked;
        text.classList.toggle('checked', entry.checked);
      });

      const text = document.createElement('span');
      text.className = 'checklist-text' + (entry.checked ? ' checked' : '');
      text.textContent = entry.text;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'checklist-remove';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => {
        editingChecklist = editingChecklist.filter((c) => c.id !== entry.id);
        renderChecklist();
      });

      row.appendChild(checkbox);
      row.appendChild(text);
      row.appendChild(removeBtn);
      checklistListEl.appendChild(row);
    });
  }

  document.getElementById('btn-add-checklist-entry').addEventListener('click', () => {
    const text = checklistNewInput.value.trim();
    if (!text) return;
    editingChecklist.push({ id: genLocalId('chk'), text, checked: false });
    checklistNewInput.value = '';
    renderChecklist();
  });
  checklistNewInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-add-checklist-entry').click();
  });

  // --- 角色配置：這個提示詞要當成哪些角色的預設提示詞 ---
  function renderRoleConfig() {
    roleConfigListEl.innerHTML = '';
    if (allRoles.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'role-config-empty';
      empty.textContent = window.i18n.t('knowledge.noRolesYet');
      roleConfigListEl.appendChild(empty);
      return;
    }
    allRoles.forEach((role) => {
      const row = document.createElement('label');
      row.className = 'role-config-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = editingRoleIds.includes(role.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          if (!editingRoleIds.includes(role.id)) editingRoleIds.push(role.id);
        } else {
          editingRoleIds = editingRoleIds.filter((id) => id !== role.id);
        }
      });

      const dot = document.createElement('span');
      dot.className = 'role-color-dot';
      dot.style.background = role.color;

      const name = document.createElement('span');
      name.textContent = role.name;

      row.appendChild(checkbox);
      row.appendChild(dot);
      row.appendChild(name);
      roleConfigListEl.appendChild(row);
    });
  }

  function selectItem(id) {
    currentItemId = id;
    const item = allItems.find((i) => i.id === id);
    itemEditorEl.style.display = 'flex';
    groupEditorEl.style.display = 'none';
    emptyEl.style.display = 'none';
    if (item) {
      titleInput.value = item.title || '';
      tagsInput.value = (item.tags || []).join(', ');
      contentInput.value = item.content || '';
      systemPromptInput.value = item.systemPrompt || '';
      userPromptInput.value = item.userPrompt || '';
      editingChecklist = (item.checklist || []).map((c) => ({ ...c }));
      editingRoleIds = [...(item.roleIds || [])];
    } else {
      titleInput.value = '';
      tagsInput.value = '';
      contentInput.value = '';
      systemPromptInput.value = '';
      userPromptInput.value = '';
      editingChecklist = [];
      editingRoleIds = [];
    }
    renderChecklist();
    renderRoleConfig();
    renderList();
  }

  btnNewItem.addEventListener('click', () => {
    selectItem(null);
    titleInput.focus();
  });

  document.getElementById('btn-save').addEventListener('click', async () => {
    const item = {
      id: currentItemId,
      title: titleInput.value.trim() || '未命名',
      tags: parseTags(tagsInput.value),
      content: contentInput.value,
      systemPrompt: systemPromptInput.value,
      userPrompt: userPromptInput.value,
      checklist: editingChecklist,
      roleIds: editingRoleIds,
    };
    const kb = await window.workspaceAPI.saveKnowledge(item);
    allItems = kb.items;
    allGroups = kb.groups;
    if (!currentItemId) currentItemId = allItems[allItems.length - 1].id;
    rebuildTagOptions();
    renderList();
  });

  document.getElementById('btn-delete').addEventListener('click', async () => {
    if (!currentItemId) {
      itemEditorEl.style.display = 'none';
      emptyEl.style.display = 'flex';
      return;
    }
    const item = allItems.find((i) => i.id === currentItemId);
    const ok = window.confirm(
      window.i18n.t('knowledge.deleteConfirm', { title: item ? item.title : '' })
    );
    if (!ok) return;
    const kb = await window.workspaceAPI.deleteKnowledge(currentItemId);
    allItems = kb.items;
    allGroups = kb.groups; // 套餐裡引用到這個項目的步驟，main 端已一併移除
    currentItemId = null;
    itemEditorEl.style.display = 'none';
    emptyEl.style.display = 'flex';
    rebuildTagOptions();
    renderList();
  });

  document.getElementById('btn-copy').addEventListener('click', async () => {
    // 內容欄位留空（改用系統／使用者提示詞拆分欄位）時，「複製內容」改
    // 複製兩者組合起來的版本，維持這顆按鈕「一鍵複製完整提示詞」的用途。
    const text =
      contentInput.value ||
      [systemPromptInput.value, userPromptInput.value].filter(Boolean).join('\n\n');
    await navigator.clipboard.writeText(text);
    alert(window.i18n.t('knowledge.copied'));
  });

  document.getElementById('btn-copy-system').addEventListener('click', async () => {
    await navigator.clipboard.writeText(systemPromptInput.value);
    alert(window.i18n.t('knowledge.copied'));
  });

  document.getElementById('btn-copy-user').addEventListener('click', async () => {
    await navigator.clipboard.writeText(userPromptInput.value);
    alert(window.i18n.t('knowledge.copied'));
  });

  // ---------------------------------------------------------------------
  // 群組順序提示詞套餐編輯
  // ---------------------------------------------------------------------
  function itemTitleById(itemId) {
    const it = allItems.find((i) => i.id === itemId);
    return it ? it.title : window.i18n.t('knowledge.deletedItem');
  }

  function renderGroupProgress() {
    const total = editingSteps.length;
    const done = editingSteps.filter((s) => s.checked).length;
    grpProgressEl.textContent = window.i18n.t('knowledge.groupProgress', { done, total });
  }

  function renderSteps() {
    grpStepsListEl.innerHTML = '';
    editingSteps.forEach((step, idx) => {
      const row = document.createElement('div');
      row.className = 'step-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!step.checked;
      checkbox.addEventListener('change', async () => {
        step.checked = checkbox.checked;
        renderGroupProgress();
        renderList();
        // 檢核表機制：套餐的勾選狀態即時持久化，不用等按「儲存套餐」
        if (currentGroupId) {
          const kb = await window.workspaceAPI.toggleGroupStep(
            currentGroupId,
            step.id,
            step.checked
          );
          allGroups = kb.groups;
        }
      });

      const order = document.createElement('span');
      order.className = 'step-order';
      order.textContent = `${idx + 1}.`;

      const text = document.createElement('span');
      text.className = 'step-text' + (step.checked ? ' checked' : '');
      text.textContent = itemTitleById(step.itemId);

      const upBtn = document.createElement('button');
      upBtn.className = 'step-icon-btn';
      upBtn.textContent = '↑';
      upBtn.disabled = idx === 0;
      upBtn.addEventListener('click', () => {
        [editingSteps[idx - 1], editingSteps[idx]] = [
          editingSteps[idx],
          editingSteps[idx - 1],
        ];
        renderSteps();
      });

      const downBtn = document.createElement('button');
      downBtn.className = 'step-icon-btn';
      downBtn.textContent = '↓';
      downBtn.disabled = idx === editingSteps.length - 1;
      downBtn.addEventListener('click', () => {
        [editingSteps[idx + 1], editingSteps[idx]] = [
          editingSteps[idx],
          editingSteps[idx + 1],
        ];
        renderSteps();
      });

      const copyBtn = document.createElement('button');
      copyBtn.className = 'step-icon-btn';
      copyBtn.textContent = '⧉';
      copyBtn.title = window.i18n.t('knowledge.copyStep');
      copyBtn.addEventListener('click', async () => {
        const it = allItems.find((i) => i.id === step.itemId);
        await navigator.clipboard.writeText(it ? it.content : '');
        alert(window.i18n.t('knowledge.copied'));
      });

      const removeBtn = document.createElement('button');
      removeBtn.className = 'step-icon-btn danger-text';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => {
        editingSteps = editingSteps.filter((s) => s.id !== step.id);
        renderSteps();
        renderGroupProgress();
      });

      row.appendChild(checkbox);
      row.appendChild(order);
      row.appendChild(text);
      row.appendChild(upBtn);
      row.appendChild(downBtn);
      row.appendChild(copyBtn);
      row.appendChild(removeBtn);
      grpStepsListEl.appendChild(row);
    });

    if (editingSteps.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'settings-hint';
      empty.textContent = window.i18n.t('knowledge.emptySteps');
      grpStepsListEl.appendChild(empty);
    }

    renderGroupProgress();
  }

  function rebuildAddStepSelect() {
    grpAddStepSelect.innerHTML = '';
    allItems.forEach((it) => {
      const opt = document.createElement('option');
      opt.value = it.id;
      opt.textContent = it.title;
      grpAddStepSelect.appendChild(opt);
    });
  }

  function selectGroup(id) {
    currentGroupId = id;
    const group = allGroups.find((g) => g.id === id);
    groupEditorEl.style.display = 'flex';
    itemEditorEl.style.display = 'none';
    emptyEl.style.display = 'none';
    rebuildAddStepSelect();
    if (group) {
      grpTitleInput.value = group.title || '';
      grpTagsInput.value = (group.tags || []).join(', ');
      grpDescInput.value = group.description || '';
      editingSteps = (group.steps || []).map((s) => ({ ...s }));
    } else {
      grpTitleInput.value = '';
      grpTagsInput.value = '';
      grpDescInput.value = '';
      editingSteps = [];
    }
    renderSteps();
    renderList();
  }

  btnNewGroup.addEventListener('click', () => {
    if (allItems.length === 0) {
      alert(window.i18n.t('knowledge.needItemsFirst'));
      return;
    }
    selectGroup(null);
    grpTitleInput.focus();
  });

  document.getElementById('btn-add-step').addEventListener('click', () => {
    const itemId = grpAddStepSelect.value;
    if (!itemId) return;
    editingSteps.push({ id: genLocalId('step'), itemId, checked: false });
    renderSteps();
  });

  document.getElementById('btn-save-group').addEventListener('click', async () => {
    const group = {
      id: currentGroupId,
      title: grpTitleInput.value.trim() || '未命名套餐',
      tags: parseTags(grpTagsInput.value),
      description: grpDescInput.value,
      steps: editingSteps,
    };
    const kb = await window.workspaceAPI.saveKnowledgeGroup(group);
    allItems = kb.items;
    allGroups = kb.groups;
    if (!currentGroupId) currentGroupId = allGroups[allGroups.length - 1].id;
    rebuildTagOptions();
    renderList();
  });

  document.getElementById('btn-delete-group').addEventListener('click', async () => {
    if (!currentGroupId) {
      groupEditorEl.style.display = 'none';
      emptyEl.style.display = 'flex';
      return;
    }
    const group = allGroups.find((g) => g.id === currentGroupId);
    const ok = window.confirm(
      window.i18n.t('knowledge.deleteGroupConfirm', { title: group ? group.title : '' })
    );
    if (!ok) return;
    const kb = await window.workspaceAPI.deleteKnowledgeGroup(currentGroupId);
    allGroups = kb.groups;
    currentGroupId = null;
    groupEditorEl.style.display = 'none';
    emptyEl.style.display = 'flex';
    rebuildTagOptions();
    renderList();
  });

  document.getElementById('btn-reset-progress').addEventListener('click', async () => {
    editingSteps.forEach((s) => (s.checked = false));
    renderSteps();
    if (currentGroupId) {
      const kb = await window.workspaceAPI.resetGroupChecklist(currentGroupId);
      allGroups = kb.groups;
      renderList();
    }
  });

  document.getElementById('btn-copy-all-group').addEventListener('click', async () => {
    const text = editingSteps
      .map((s) => {
        const it = allItems.find((i) => i.id === s.itemId);
        return it ? it.content : '';
      })
      .filter(Boolean)
      .join('\n\n---\n\n');
    await navigator.clipboard.writeText(text);
    alert(window.i18n.t('knowledge.copied'));
  });

  // ---------------------------------------------------------------------
  // 匯出全部 / 匯入（項目 + 套餐一起）
  // ---------------------------------------------------------------------
  document.getElementById('btn-export-all').addEventListener('click', async () => {
    const format = window.confirm(
      `${window.i18n.t('export.choosingFormat')}\n\nOK = ${window.i18n.t('export.markdown')}  /  Cancel = ${window.i18n.t('export.json')}`
    )
      ? 'md'
      : 'json';
    const result = await window.workspaceAPI.exportAllKnowledge(format);
    if (result.ok) alert(window.i18n.t('export.success', { path: result.filePath }));
  });

  document.getElementById('btn-import').addEventListener('click', async () => {
    const kb = await window.workspaceAPI.importKnowledge();
    allItems = kb.items;
    allGroups = kb.groups;
    rebuildTagOptions();
    renderList();
  });

  // 匯入現成的 .md 檔案（例如之前匯出的對話紀錄），直接變成新的提示詞
  // 項目，匯入完直接把最後一個開起來，方便馬上檢視/編輯內容
  btnImportMd.addEventListener('click', async () => {
    const result = await window.workspaceAPI.importKnowledgeMarkdown();
    allItems = result.kb.items;
    allGroups = result.kb.groups;
    rebuildTagOptions();
    if (result.importedIds && result.importedIds.length > 0) {
      selectItem(result.importedIds[result.importedIds.length - 1]);
    } else {
      renderList();
    }
  });

  // 語言切換後，重新套用動態產生內容裡的翻譯字串（空狀態提示、進度文字等）
  document.addEventListener('i18n:updated', () => {
    emptyEl.textContent = window.i18n.t(
      mode === 'items' ? 'knowledge.selectPrompt' : 'knowledge.selectGroupPrompt'
    );
    renderList();
    if (groupEditorEl.style.display !== 'none') renderGroupProgress();
  });

  // ---------------------------------------------------------------------
  // 跨模組快速搜尋（命令面板）跳轉過來時要選中的項目
  // ---------------------------------------------------------------------
  function applySearchSelection(payload) {
    if (!payload) return;
    if (payload.tab === 'groups') {
      switchTab('groups');
      selectGroup(payload.id);
    } else {
      switchTab('items');
      selectItem(payload.id);
    }
  }
  window.workspaceAPI.onSearchSelect(applySearchSelection);

  // ---------------------------------------------------------------------
  // 初始化
  // ---------------------------------------------------------------------
  (async () => {
    await window.i18n.init();
    const kb = await window.workspaceAPI.listKnowledge();
    allItems = kb.items;
    allGroups = kb.groups;
    allRoles = await window.workspaceAPI.listRoles();
    rebuildTagOptions();
    renderList();

    // 如果是命令面板叫我們開起來的（視窗剛建立），主動拉一次待選項目；
    // 如果視窗本來就開著，上面的 onSearchSelect 監聽器已經處理過了，這裡
    // 通常會拉到 null。
    applySearchSelection(await window.workspaceAPI.consumePendingSelection('knowledge'));
  })();

  // 角色是在設定視窗管理的，異動時會廣播 accounts:changed；
  // 這裡重新抓角色清單，並在項目編輯器開著時即時刷新角色配置勾選框
  window.workspaceAPI.onAccountsChanged(async () => {
    allRoles = await window.workspaceAPI.listRoles();
    if (itemEditorEl.style.display !== 'none') renderRoleConfig();
  });
})();
