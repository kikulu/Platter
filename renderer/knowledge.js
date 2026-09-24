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
  // 目前套餐編輯器裡的列（記憶體內，結構性變更要按「儲存套餐」才寫入）。兩種列混排：
  //   { type: 'stage', id, title }                階段標題
  //   { type: 'step', id, itemId, checked }       步驟（屬於它上方最近的一個階段標題）
  // 資料檔裡不存標題列，儲存時由 rowsToSteps() 攤平成每個步驟的 stage 欄位。
  let editingRows = [];

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
      const stageCount = countStages(g.steps || []);
      meta.textContent = [
        tagText,
        stageCount ? window.i18n.t('knowledge.stageCount', { n: stageCount }) : '',
        `${done}/${total}`,
      ]
        .filter(Boolean)
        .join('  ');

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
    // 階段名稱（例如「階段 3：潤色與投稿」）
    if ((g.steps || []).some((s) => (s.stage || '').toLowerCase().includes(query)))
      return true;
    return false;
  }

  // 套餐有幾個階段：數「stage 名稱變化」的次數（不看空字串），跟編輯器裡
  // 會顯示幾個階段標題列一致。
  function countStages(steps) {
    let count = 0;
    let prev = '';
    steps.forEach((s) => {
      const stage = s.stage || '';
      if (stage && stage !== prev) count += 1;
      if (stage) prev = stage;
    });
    return count;
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
  // 群組順序提示詞套餐編輯（可分階段）
  //
  // 編輯器裡階段標題跟步驟是同一個清單、混排顯示：步驟屬於它上方最近的
  // 階段標題，所以「把步驟移到別的階段」就是用 ↑↓ 越過標題列，不需要另外
  // 一套指派介面。資料檔裡則是扁平的 steps，每個步驟帶一個 stage 名稱（見
  // PROJECT_SPEC.md 第 5.3 節）；兩種形式的轉換在 stepsToRows() /
  // rowsToSteps()。
  // ---------------------------------------------------------------------
  const STEP_SEPARATOR = '\n\n---\n\n';

  function itemTitleById(itemId) {
    const it = allItems.find((i) => i.id === itemId);
    return it ? it.title : window.i18n.t('knowledge.deletedItem');
  }

  // 一個提示詞項目「複製出去的完整文字」：有 content 就用 content（內建的拆分
  // 範本 content 已經是系統＋使用者兩段合併版）；content 是空的（使用者只
  // 填了系統／使用者兩欄）就把兩欄組起來，跟項目編輯器「複製內容」按鈕一致。
  function promptTextOfItem(itemId) {
    const it = allItems.find((i) => i.id === itemId);
    if (!it) return '';
    return it.content || [it.systemPrompt, it.userPrompt].filter(Boolean).join('\n\n');
  }

  function stepsToRows(steps) {
    const rows = [];
    let prev = '';
    steps.forEach((s) => {
      const stage = s.stage || '';
      if (stage && stage !== prev) {
        rows.push({ type: 'stage', id: genLocalId('stage'), title: stage });
      }
      // 沒有 stage 的步驟接在前一個階段底下（只會出現在手動改過的資料檔）
      if (stage) prev = stage;
      rows.push({
        type: 'step',
        id: s.id,
        itemId: s.itemId,
        checked: !!s.checked,
      });
    });
    return rows;
  }

  function rowsToSteps() {
    let stage = '';
    const steps = [];
    editingRows.forEach((row) => {
      if (row.type === 'stage') {
        stage = (row.title || '').trim();
        return;
      }
      steps.push({ id: row.id, itemId: row.itemId, checked: !!row.checked, stage });
    });
    return steps;
  }

  function stepRows() {
    return editingRows.filter((r) => r.type === 'step');
  }

  // 某個階段標題列底下的步驟（到下一個階段標題之前）
  function stageStepRows(stageRowIdx) {
    const out = [];
    for (let i = stageRowIdx + 1; i < editingRows.length; i++) {
      if (editingRows[i].type === 'stage') break;
      out.push(editingRows[i]);
    }
    return out;
  }

  function defaultStageName(n) {
    return window.i18n.t('knowledge.stageDefaultName', { n });
  }

  function renderGroupProgress() {
    const steps = stepRows();
    const total = steps.length;
    const done = steps.filter((s) => s.checked).length;
    grpProgressEl.textContent = window.i18n.t('knowledge.groupProgress', { done, total });
  }

  async function copyText(text) {
    await navigator.clipboard.writeText(text);
    alert(window.i18n.t('knowledge.copied'));
  }

  function moveRow(idx, delta) {
    const target = idx + delta;
    if (target < 0 || target >= editingRows.length) return;
    [editingRows[idx], editingRows[target]] = [editingRows[target], editingRows[idx]];
    renderSteps();
  }

  function makeIconButton(text, title, onClick, extraClass) {
    const btn = document.createElement('button');
    btn.className = 'step-icon-btn' + (extraClass ? ` ${extraClass}` : '');
    btn.textContent = text;
    if (title) btn.title = title;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function buildStageRow(row, idx, stageNo) {
    const el = document.createElement('div');
    el.className = 'stage-row';

    const marker = document.createElement('span');
    marker.className = 'stage-marker';
    marker.textContent = '◆';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'stage-title-input';
    titleInput.value = row.title;
    titleInput.placeholder = window.i18n.t('knowledge.stageNamePlaceholder');
    titleInput.addEventListener('input', () => {
      row.title = titleInput.value;
    });
    titleInput.addEventListener('change', () => {
      // 名稱清空就退回預設名稱，避免存成一個看不出是階段的空標題
      row.title = titleInput.value.trim() || defaultStageName(stageNo);
      titleInput.value = row.title;
    });

    const stageSteps = stageStepRows(idx);
    const progress = document.createElement('span');
    progress.className = 'stage-progress';
    progress.textContent = `${stageSteps.filter((s) => s.checked).length}/${stageSteps.length}`;

    const upBtn = makeIconButton('↑', '', () => moveRow(idx, -1));
    upBtn.disabled = idx === 0;
    const downBtn = makeIconButton('↓', '', () => moveRow(idx, 1));
    downBtn.disabled = idx === editingRows.length - 1;

    el.appendChild(marker);
    el.appendChild(titleInput);
    el.appendChild(progress);
    el.appendChild(
      makeIconButton('⧉', window.i18n.t('knowledge.copyStage'), () =>
        copyText(
          stageSteps
            .map((s) => promptTextOfItem(s.itemId))
            .filter(Boolean)
            .join(STEP_SEPARATOR)
        )
      )
    );
    el.appendChild(upBtn);
    el.appendChild(downBtn);
    el.appendChild(
      makeIconButton(
        '✕',
        window.i18n.t('knowledge.removeStage'),
        () => {
          // 只移除標題列，底下的步驟保留（併入上一個階段，或變成未分階段）
          editingRows = editingRows.filter((r) => r.id !== row.id);
          renderSteps();
        },
        'danger-text'
      )
    );
    return el;
  }

  function buildStepRow(step, idx, stepNo, staged) {
    const el = document.createElement('div');
    el.className = 'step-row' + (staged ? ' staged' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!step.checked;
    checkbox.addEventListener('change', async () => {
      step.checked = checkbox.checked;
      renderSteps();
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
    order.textContent = `${stepNo}.`;

    const text = document.createElement('span');
    text.className = 'step-text' + (step.checked ? ' checked' : '');
    text.textContent = itemTitleById(step.itemId);

    const upBtn = makeIconButton('↑', '', () => moveRow(idx, -1));
    upBtn.disabled = idx === 0;
    const downBtn = makeIconButton('↓', '', () => moveRow(idx, 1));
    downBtn.disabled = idx === editingRows.length - 1;

    el.appendChild(checkbox);
    el.appendChild(order);
    el.appendChild(text);
    el.appendChild(upBtn);
    el.appendChild(downBtn);
    el.appendChild(
      makeIconButton('⧉', window.i18n.t('knowledge.copyStep'), () =>
        copyText(promptTextOfItem(step.itemId))
      )
    );
    el.appendChild(
      makeIconButton(
        '✕',
        '',
        () => {
          editingRows = editingRows.filter((r) => r.id !== step.id);
          renderSteps();
        },
        'danger-text'
      )
    );
    return el;
  }

  function renderSteps() {
    // 重畫整份清單會讓捲動位置歸零；勾選/移動這類操作前後要停在同一個位置
    const scrollTop = grpStepsListEl.scrollTop;
    grpStepsListEl.innerHTML = '';

    let stepNo = 0;
    let stageNo = 0;
    let inStage = false;
    editingRows.forEach((row, idx) => {
      if (row.type === 'stage') {
        stageNo += 1;
        inStage = true;
        grpStepsListEl.appendChild(buildStageRow(row, idx, stageNo));
      } else {
        stepNo += 1;
        grpStepsListEl.appendChild(buildStepRow(row, idx, stepNo, inStage));
      }
    });

    if (editingRows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'stage-hint';
      empty.textContent = window.i18n.t('knowledge.emptySteps');
      grpStepsListEl.appendChild(empty);
    }

    grpStepsListEl.scrollTop = scrollTop;
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
      editingRows = stepsToRows(group.steps || []);
    } else {
      grpTitleInput.value = '';
      grpTagsInput.value = '';
      grpDescInput.value = '';
      editingRows = [];
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
    editingRows.push({ type: 'step', id: genLocalId('step'), itemId, checked: false });
    renderSteps();
    grpStepsListEl.scrollTop = grpStepsListEl.scrollHeight;
  });

  // 在清單尾端加一個新的階段標題；之後用「＋」加入的步驟會歸在這個階段底下
  document.getElementById('btn-add-stage').addEventListener('click', () => {
    const n = editingRows.filter((r) => r.type === 'stage').length + 1;
    editingRows.push({
      type: 'stage',
      id: genLocalId('stage'),
      title: defaultStageName(n),
    });
    renderSteps();
    grpStepsListEl.scrollTop = grpStepsListEl.scrollHeight;
    const inputs = grpStepsListEl.querySelectorAll('.stage-title-input');
    const last = inputs[inputs.length - 1];
    if (last) {
      last.focus();
      last.select();
    }
  });

  document.getElementById('btn-save-group').addEventListener('click', async () => {
    const group = {
      id: currentGroupId,
      title: grpTitleInput.value.trim() || '未命名套餐',
      tags: parseTags(grpTagsInput.value),
      description: grpDescInput.value,
      steps: rowsToSteps(),
    };
    const kb = await window.workspaceAPI.saveKnowledgeGroup(group);
    allItems = kb.items;
    allGroups = kb.groups;
    if (!currentGroupId) currentGroupId = allGroups[allGroups.length - 1].id;
    // 沒有任何步驟的空階段不會被存下來，存完用實際存下的內容重畫編輯器，
    // 畫面才會跟資料檔一致。
    const saved = allGroups.find((g) => g.id === currentGroupId);
    if (saved) editingRows = stepsToRows(saved.steps || []);
    renderSteps();
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
    editingRows.forEach((r) => {
      if (r.type === 'step') r.checked = false;
    });
    renderSteps();
    if (currentGroupId) {
      const kb = await window.workspaceAPI.resetGroupChecklist(currentGroupId);
      allGroups = kb.groups;
      renderList();
    }
  });

  // 複製整份套餐：依序串接所有步驟的提示詞（用 --- 分隔）。有分階段時，每個
  // 階段前加一行「=== 階段名稱 ===」，階段之間也用 --- 分隔；沒有分階段的
  // 套餐輸出跟加入階段功能之前完全一樣。
  function buildGroupCopyText() {
    const sections = [];
    let current = { title: '', texts: [] };
    const flush = () => {
      if (current.texts.length > 0) sections.push(current);
    };
    editingRows.forEach((row) => {
      if (row.type === 'stage') {
        flush();
        current = { title: (row.title || '').trim(), texts: [] };
        return;
      }
      const text = promptTextOfItem(row.itemId);
      if (text) current.texts.push(text);
    });
    flush();
    return sections
      .map((sec) => {
        const body = sec.texts.join(STEP_SEPARATOR);
        return sec.title ? `=== ${sec.title} ===\n\n${body}` : body;
      })
      .join(STEP_SEPARATOR);
  }

  document.getElementById('btn-copy-all-group').addEventListener('click', () => {
    copyText(buildGroupCopyText());
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
    if (groupEditorEl.style.display !== 'none') renderSteps();
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
