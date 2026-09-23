(function () {
  // --- DOM refs ---
  const tabItemsBtn = document.getElementById('tab-items');
  const tabGroupsBtn = document.getElementById('tab-groups');
  const btnNewItem = document.getElementById('btn-new-item');
  const btnNewGroup = document.getElementById('btn-new-group');
  const listEl = document.getElementById('kb-list');
  const tagFilterEl = document.getElementById('kb-tag-filter');
  const emptyEl = document.getElementById('kb-empty');

  const itemEditorEl = document.getElementById('kb-editor');
  const titleInput = document.getElementById('kb-title');
  const tagsInput = document.getElementById('kb-tags');
  const contentInput = document.getElementById('kb-content');
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
  // List rendering
  // ---------------------------------------------------------------------
  function renderList() {
    listEl.innerHTML = '';
    if (mode === 'items') renderItemList();
    else renderGroupList();
  }

  function renderItemList() {
    const filterTag = tagFilterEl.value;
    const filtered = filterTag ? allItems.filter((it) => (it.tags || []).includes(filterTag)) : allItems;

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
      meta.textContent = [tagText, checklistTotal ? `☑ ${checklistDone}/${checklistTotal}` : '']
        .filter(Boolean)
        .join('  ');

      div.appendChild(title);
      div.appendChild(meta);
      div.addEventListener('click', () => selectItem(it.id));
      listEl.appendChild(div);
    });
  }

  function renderGroupList() {
    const filterTag = tagFilterEl.value;
    const filtered = filterTag ? allGroups.filter((g) => (g.tags || []).includes(filterTag)) : allGroups;

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
      editingChecklist = (item.checklist || []).map((c) => ({ ...c }));
      editingRoleIds = [...(item.roleIds || [])];
    } else {
      titleInput.value = '';
      tagsInput.value = '';
      contentInput.value = '';
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
    const ok = window.confirm(window.i18n.t('knowledge.deleteConfirm', { title: item ? item.title : '' }));
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
    await navigator.clipboard.writeText(contentInput.value);
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
          const kb = await window.workspaceAPI.toggleGroupStep(currentGroupId, step.id, step.checked);
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
        [editingSteps[idx - 1], editingSteps[idx]] = [editingSteps[idx], editingSteps[idx - 1]];
        renderSteps();
      });

      const downBtn = document.createElement('button');
      downBtn.className = 'step-icon-btn';
      downBtn.textContent = '↓';
      downBtn.disabled = idx === editingSteps.length - 1;
      downBtn.addEventListener('click', () => {
        [editingSteps[idx + 1], editingSteps[idx]] = [editingSteps[idx], editingSteps[idx + 1]];
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
    const ok = window.confirm(window.i18n.t('knowledge.deleteGroupConfirm', { title: group ? group.title : '' }));
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

  // 語言切換後，重新套用動態產生內容裡的翻譯字串（空狀態提示、進度文字等）
  document.addEventListener('i18n:updated', () => {
    emptyEl.textContent = window.i18n.t(
      mode === 'items' ? 'knowledge.selectPrompt' : 'knowledge.selectGroupPrompt'
    );
    renderList();
    if (groupEditorEl.style.display !== 'none') renderGroupProgress();
  });

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
  })();

  // 角色是在設定視窗管理的，異動時會廣播 accounts:changed；
  // 這裡重新抓角色清單，並在項目編輯器開著時即時刷新角色配置勾選框
  window.workspaceAPI.onAccountsChanged(async () => {
    allRoles = await window.workspaceAPI.listRoles();
    if (itemEditorEl.style.display !== 'none') renderRoleConfig();
  });
})();
