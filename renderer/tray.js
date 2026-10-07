(function () {
  const collapsedBtn = document.getElementById('btn-tray-open');
  const closeBtn = document.getElementById('btn-tray-close');
  const searchInput = document.getElementById('tray-search');
  const listEl = document.getElementById('tray-list');
  const toastEl = document.getElementById('tray-toast');
  const openKnowledgeBtn = document.getElementById('btn-tray-open-knowledge');

  let allItems = []; // 知識庫的「項目」清單（不含分階段套餐——套餐是多步驟的操作，
  // 這個小托盤只做「單一提示詞，點了就複製」這件事，套餐留給完整的知識庫視窗）
  let projectGroups = []; // 專案計畫「已指派、未完成」的流程任務 + 各階段相關提示詞（見 lib/workflow.js buildTrayProjectGroups）
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

  function renderList() {
    const query = searchInput.value.trim();
    const filtered = allItems.filter((item) => matchesQuery(item, query));
    listEl.innerHTML = '';

    const hasProjectBlock = appendProjectSection(query);

    if (filtered.length === 0) {
      if (hasProjectBlock) return;
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

  // Esc 收起，跟其他視窗裡「全螢幕遮罩按 Esc 關閉」的習慣一致
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('expanded')) collapse();
  });

  async function refreshItems() {
    const kb = await window.workspaceAPI.listKnowledge();
    allItems = kb.items || [];
    projectGroups = await window.workspaceAPI.trayProjectPrompts();
    renderList();
  }

  async function refreshProjects() {
    projectGroups = await window.workspaceAPI.trayProjectPrompts();
    renderList();
  }

  window.workspaceAPI.onKnowledgeChanged(refreshItems);
  window.workspaceAPI.onProjectsChanged(refreshProjects);
  window.workspaceAPI.onAccountsChanged(refreshProjects);

  (async () => {
    await window.i18n.init();
    await refreshItems();
  })();
})();
