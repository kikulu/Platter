(function () {
  const collapsedBtn = document.getElementById('btn-tray-open');
  const closeBtn = document.getElementById('btn-tray-close');
  const searchInput = document.getElementById('tray-search');
  const listEl = document.getElementById('tray-list');
  const toastEl = document.getElementById('tray-toast');
  const openKnowledgeBtn = document.getElementById('btn-tray-open-knowledge');

  let allItems = []; // 知識庫的「項目」清單（不含分階段套餐——套餐是多步驟的操作，
  // 這個小托盤只做「單一提示詞，點了就複製」這件事，套餐留給完整的知識庫視窗）
  let projectEmptyReason = null; // 專案區塊為空時的原因（'unassigned' | 'allDone' | null），見 lib/workflow.js
  let projectGroups = []; // 專案計畫「已指派、未完成」的流程任務 + 各階段相關提示詞（見 lib/workflow.js buildTrayProjectGroups）
  let recentIds = []; // 最近使用的知識庫項目 id（新的在前；存在 appState.ui.tray.recent）
  let recentLimit = 5;
  let toastTimer = null;

  function matchesQuery(item, query) {
    if (!query) return true;
    const haystack = (item.title + ' ' + (item.tags || []).join(' ')).toLowerCase();
    return haystack.includes(query.toLowerCase());
  }

  function buildItemRow(item) {
    const row = document.createElement('div');
    row.className = 'tray-item';

    const title = document.createElement('div');
    title.className = 'tray-item-title';
    title.textContent = item.title;

    const tags = document.createElement('div');
    tags.className = 'tray-item-tags';
    tags.textContent = (item.tags || []).join(' · ');

    row.appendChild(title);
    row.appendChild(tags);
    row.title = item.content; // 滑鼠停留可以看到完整提示詞內容
    row.addEventListener('click', () => copyItem(item));
    return row;
  }

  // 分成「角色提示詞」（item.roleIds 非空——企業角色範本那批，見
  // lib/stores.js 知識庫的資料結構說明）跟「其他」兩區顯示，跟設定視窗
  // 角色清單拆「基本/延展」是類似的分類邏輯，方便在角色跟一般任務型
  // 提示詞之間快速定位，不用整串從頭找。沒有符合搜尋字串的區塊整個
  // 不顯示（不留一個空標題在那裡）。
  function appendSection(titleKey, items) {
    if (items.length === 0) return;
    const heading = document.createElement('div');
    heading.className = 'tray-section-heading';
    heading.textContent = window.i18n.t(titleKey);
    listEl.appendChild(heading);
    items.forEach((item) => listEl.appendChild(buildItemRow(item)));
  }

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
  }

  function buildSimpleRow(title, sub, tooltip, onClick) {
    const row = document.createElement('div');
    row.className = 'tray-item';
    const t = document.createElement('div');
    t.className = 'tray-item-title';
    t.textContent = title;
    row.appendChild(t);
    if (sub) {
      const s = document.createElement('div');
      s.className = 'tray-item-tags';
      s.textContent = sub;
      row.appendChild(s);
    }
    if (tooltip) row.title = tooltip;
    row.addEventListener('click', onClick);
    return row;
  }

  // 點專案任務：複製「該步驟完整提示詞」（已帶入主題與前面產出），
  // 並把還沒開始的步驟標成進行中——跟專案視窗按「複製提示詞」的行為一致。
  async function copyProjectTask(group, task) {
    const text = await window.workspaceAPI.composeWorkflowPrompt(
      group.projectId,
      task.stepId
    );
    await navigator.clipboard.writeText(text || '');
    showToast(window.i18n.t('tray.copied', { title: task.title }));
    if (task.status === 'todo') {
      await window.workspaceAPI.setWorkflowStepStatus(
        group.projectId,
        task.stepId,
        'doing'
      );
    }
  }

  // 「專案任務與階段提示詞」區塊：每個專案 → 每個階段 → 已指派的任務
  // （點了複製完整步驟提示詞）+ 該階段的相關提示詞（點了複製）。
  function appendProjectSection(query) {
    const q = query.toLowerCase();
    const matches = (...texts) => !q || texts.join(' ').toLowerCase().includes(q);
    const blocks = [];
    projectGroups.forEach((group) => {
      group.stages.forEach((st) => {
        const tasks = st.tasks.filter((t) =>
          matches(t.title, group.projectName, st.stage, t.assigneeName)
        );
        const prompts = st.prompts.filter((p) =>
          matches(p.title, group.projectName, st.stage)
        );
        if (tasks.length || prompts.length) blocks.push({ group, st, tasks, prompts });
      });
    });
    if (blocks.length === 0) return false;

    const heading = document.createElement('div');
    heading.className = 'tray-section-heading';
    heading.textContent = window.i18n.t('tray.projectSection');
    listEl.appendChild(heading);

    blocks.forEach(({ group, st, tasks, prompts }) => {
      const label = document.createElement('div');
      label.className = 'tray-project-label';
      label.textContent = [group.projectName, st.stage].filter(Boolean).join(' · ');
      listEl.appendChild(label);
      tasks.forEach((task) => {
        const sub = [
          task.assigneeName
            ? window.i18n.t('tray.assignedTo', { name: task.assigneeName })
            : '',
          window.i18n.t(`tray.taskStatus.${task.status}`),
        ]
          .filter(Boolean)
          .join(' · ');
        listEl.appendChild(
          buildSimpleRow(task.title, sub, window.i18n.t('tray.taskHint'), () =>
            copyProjectTask(group, task)
          )
        );
      });
      prompts.forEach((p) => {
        listEl.appendChild(
          buildSimpleRow(
            `📎 ${p.title}`,
            window.i18n.t('tray.stagePrompt'),
            p.prompt,
            async () => {
              await navigator.clipboard.writeText(p.prompt || '');
              showToast(window.i18n.t('tray.copied', { title: p.title }));
            }
          )
        );
      });
    });
    return true;
  }

  // 「最近使用」：清單最上方。id 對不到項目（已從知識庫刪除）就略過，不顯示也不報錯。
  function appendRecentSection(query) {
    if (recentLimit <= 0) return false;
    const byId = new Map(allItems.map((it) => [it.id, it]));
    const items = [];
    recentIds.forEach((id) => {
      const it = byId.get(id);
      if (it && items.length < recentLimit && matchesQuery(it, query)) items.push(it);
    });
    if (items.length === 0) return false;
    appendSection('tray.recentSection', items);
    return true;
  }

  function renderList() {
    const query = searchInput.value.trim();
    const filtered = allItems.filter((item) => matchesQuery(item, query));
    listEl.innerHTML = '';

    const hasRecent = appendRecentSection(query);
    const hasProjectBlock = appendProjectSection(query);
    // 專案區塊是空的、而且不是因為搜尋字串過濾掉的：說明原因與怎麼改
    if (!hasProjectBlock && !query && projectEmptyReason) {
      const hint = document.createElement('div');
      hint.className = 'tray-hint';
      hint.textContent = window.i18n.t(`tray.projectEmpty.${projectEmptyReason}`);
      listEl.appendChild(hint);
    }

    if (filtered.length === 0) {
      if (hasProjectBlock || hasRecent) return;
      const empty = document.createElement('div');
      empty.id = 'tray-empty';
      empty.textContent = window.i18n.t(
        allItems.length === 0 ? 'tray.empty' : 'tray.noMatch'
      );
      listEl.appendChild(empty);
      return;
    }

    const roleItems = filtered.filter((item) => item.roleIds && item.roleIds.length > 0);
    const otherItems = filtered.filter(
      (item) => !item.roleIds || item.roleIds.length === 0
    );
    appendSection('tray.roleSection', roleItems);
    appendSection('tray.otherSection', otherItems);
  }

  async function copyItem(item) {
    await navigator.clipboard.writeText(item.content || '');
    showToast(window.i18n.t('tray.copied', { title: item.title }));
    // 記進「最近使用」。不立刻重畫清單（避免使用者眼前的項目突然換位置），下次展開才會更新。
    try {
      recentIds = await window.workspaceAPI.trayRecordRecent(item.id);
    } catch (err) {
      // 記錄失敗不影響複製
    }
  }

  async function expand() {
    document.body.classList.add('expanded');
    await window.workspaceAPI.trayToggleExpanded(true);
    searchInput.value = '';
    renderList();
    searchInput.focus();
  }

  async function collapse() {
    document.body.classList.remove('expanded');
    await window.workspaceAPI.trayToggleExpanded(false);
  }

  collapsedBtn.addEventListener('click', expand);
  closeBtn.addEventListener('click', collapse);
  searchInput.addEventListener('input', renderList);
  openKnowledgeBtn.addEventListener('click', () => {
    window.workspaceAPI.openKnowledgeWindow();
  });
  // 內容工具快速連結（跟主視窗側邊欄「內容工具」群組的視窗入口一致）
  [
    ['btn-tray-knowledge', 'openKnowledgeWindow'],
    ['btn-tray-documents', 'openDocumentsWindow'],
    ['btn-tray-conversations', 'openConversationsWindow'],
    ['btn-tray-logs', 'openLogWindow'],
  ].forEach(([id, api]) => {
    document.getElementById(id).addEventListener('click', () => window.workspaceAPI[api]());
  });

  // Esc 收起，跟其他視窗裡「全螢幕遮罩按 Esc 關閉」的習慣一致
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('expanded')) collapse();
  });

  async function refreshItems() {
    const kb = await window.workspaceAPI.listKnowledge();
    allItems = kb.items || [];
    await loadProjectData();
    renderList();
  }

  async function loadProjectData() {
    const data = await window.workspaceAPI.trayProjectPrompts();
    projectGroups = (data && data.groups) || [];
    projectEmptyReason = (data && data.emptyReason) || null;
    const prefs = await window.workspaceAPI.getTrayPrefs();
    recentIds = Array.isArray(prefs.recent) ? prefs.recent : [];
    recentLimit = Number.isFinite(prefs.recentLimit) ? prefs.recentLimit : 5;
  }

  async function refreshProjects() {
    await loadProjectData();
    renderList();
  }

  window.workspaceAPI.onKnowledgeChanged(refreshItems);
  window.workspaceAPI.onProjectsChanged(refreshProjects);
  window.workspaceAPI.onAccountsChanged(refreshProjects);
  window.workspaceAPI.onTrayPrefsChanged(refreshProjects);

  // 全域快捷鍵（lib/trayHotkey.js → lib/windows.js toggleTrayFromHotkey）：
  // 'toggle' 展開／收合切換；'expand' 只展開（Platter 剛從背景被帶到前景時）
  window.workspaceAPI.onTrayHotkey((action) => {
    const isExpanded = document.body.classList.contains('expanded');
    if (action === 'expand') {
      if (!isExpanded) expand();
    } else if (isExpanded) collapse();
    else expand();
  });

  (async () => {
    await window.i18n.init();
    await refreshItems();
  })();
})();
