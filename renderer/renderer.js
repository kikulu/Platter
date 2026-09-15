(function () {
  const PLATFORM_LABELS = {
    claude: 'Claude',
    chatgpt: 'ChatGPT',
    gemini: 'Gemini',
    grok: 'Grok',
  };

  const sidebar = document.getElementById('sidebar');
  const accountList = document.getElementById('account-list');
  const placeholder = document.getElementById('placeholder');
  const collapseBtn = document.getElementById('collapse-btn');

  let collapsed = false;
  let rolesById = new Map();
  let lastAccounts = [];
  let draggedAccountId = null; // 帳號清單拖曳排序：目前正在被拖曳的帳號 id

  function applyCollapsedState() {
    sidebar.classList.toggle('collapsed', collapsed);
  }

  collapseBtn.addEventListener('click', async () => {
    collapsed = !collapsed;
    applyCollapsedState();
    await window.workspaceAPI.setSidebarCollapsed(collapsed);
  });

  // --- 側邊欄多層清單：群組展開/收合 ---
  function setGroupState(header, childrenEl, expanded) {
    header.classList.toggle('expanded', expanded);
    childrenEl.classList.toggle('expanded', expanded);
    header.querySelector('.chevron').textContent = expanded ? '▾' : '▸';
  }

  function initGroups(sidebarGroups) {
    document.querySelectorAll('.group-header').forEach((header) => {
      const key = header.getAttribute('data-group-key');
      const childrenEl = document.getElementById(`group-${key}-children`);
      const expanded = sidebarGroups ? sidebarGroups[key] !== false : true;
      setGroupState(header, childrenEl, expanded);

      header.addEventListener('click', async () => {
        const nowExpanded = !childrenEl.classList.contains('expanded');
        setGroupState(header, childrenEl, nowExpanded);
        await window.workspaceAPI.setGroupExpanded(key, nowExpanded);
      });
    });
  }

  document.getElementById('btn-add-account').addEventListener('click', () => {
    window.workspaceAPI.openAccountWindow();
  });

  document.getElementById('btn-knowledge').addEventListener('click', () => {
    window.workspaceAPI.openKnowledgeWindow();
  });

  document.getElementById('btn-team').addEventListener('click', () => {
    window.workspaceAPI.openTeamWindow();
  });

  document.getElementById('btn-projects').addEventListener('click', () => {
    window.workspaceAPI.openProjectWindow();
  });

  document.getElementById('btn-documents').addEventListener('click', () => {
    window.workspaceAPI.openDocumentsWindow();
  });

  document.getElementById('btn-conversations').addEventListener('click', () => {
    window.workspaceAPI.openConversationsWindow();
  });

  document.getElementById('btn-logs').addEventListener('click', () => {
    window.workspaceAPI.openLogWindow();
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    window.workspaceAPI.openSettingsWindow();
  });

  document.getElementById('btn-export').addEventListener('click', async () => {
    const format = window.confirm(
      `${window.i18n.t('export.choosingFormat')}\n\nOK = ${window.i18n.t('export.markdown')}  /  Cancel = ${window.i18n.t('export.json')}`
    )
      ? 'md'
      : 'json';
    const result = await window.workspaceAPI.exportCurrentConversation(format);
    if (result.ok) {
      alert(window.i18n.t('export.success', { path: result.filePath }));
    } else if (result.error === 'CANCELLED') {
      // 使用者自行取消，不用提示
    } else if (result.error === 'EMPTY_RESULT' || result.error === 'NO_SELECTOR') {
      const debug = result.debug;
      const detail =
        debug && typeof debug.matchedNodeCount === 'number'
          ? window.i18n.t('export.selectorHintDetail', {
              matched: debug.matchedNodeCount,
              nonEmpty: debug.nonEmptyMessageCount,
            })
          : '';
      alert(`${window.i18n.t('export.selectorHint')}${detail ? '\n\n' + detail : ''}`);
    } else {
      alert(`${window.i18n.t('export.fail')}: ${result.error || ''}`);
    }
  });

  function renderAccounts(accounts) {
    accountList.innerHTML = '';
    placeholder.style.display = accounts.length === 0 ? 'flex' : 'none';

    accounts.forEach((acc) => {
      const role = acc.roleId ? rolesById.get(acc.roleId) : null;

      const item = document.createElement('div');
      item.className = 'account-item' + (acc.active ? ' active' : '');
      item.title = acc.name;

      // 帳號清單拖曳排序（原生 HTML5 drag & drop，不用額外套件）
      item.draggable = true;
      item.dataset.accountId = acc.id;

      item.addEventListener('dragstart', (e) => {
        draggedAccountId = acc.id;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        // Firefox 系瀏覽器要求一定要呼叫 setData 才會真的觸發拖曳，
        // Electron/Chromium 其實用不到這行讀出來的值（用上面的閉包變數
        // draggedAccountId 判斷），但保留呼叫確保行為一致。
        e.dataTransfer.setData('text/plain', acc.id);
      });

      item.addEventListener('dragend', () => {
        draggedAccountId = null;
        item.classList.remove('dragging');
        accountList
          .querySelectorAll('.account-item.drag-over')
          .forEach((el) => el.classList.remove('drag-over'));
      });

      item.addEventListener('dragover', (e) => {
        if (!draggedAccountId || draggedAccountId === acc.id) return;
        e.preventDefault(); // 一定要呼叫，不然瀏覽器不允許 drop
        e.dataTransfer.dropEffect = 'move';
        item.classList.add('drag-over');
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over');
      });

      item.addEventListener('drop', async (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        if (!draggedAccountId || draggedAccountId === acc.id) return;

        const order = lastAccounts.map((a) => a.id);
        const fromIndex = order.indexOf(draggedAccountId);
        const toIndex = order.indexOf(acc.id);
        if (fromIndex === -1 || toIndex === -1) return;

        order.splice(fromIndex, 1);
        order.splice(toIndex, 0, draggedAccountId);
        await window.workspaceAPI.reorderAccounts(order);
        await refreshAccounts();
      });

      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.textContent = (PLATFORM_LABELS[acc.platform] || acc.platform)[0];
      avatar.style.boxShadow = `0 0 0 2px ${role ? role.color : 'transparent'}`;

      const meta = document.createElement('div');
      meta.className = 'meta';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = acc.name;
      const platform = document.createElement('div');
      platform.className = 'platform';
      platform.textContent = PLATFORM_LABELS[acc.platform] || acc.platform;
      meta.appendChild(name);
      meta.appendChild(platform);

      // 帳號角色機制：可直接在側邊欄快速切換這個帳號套用的角色
      const roleSelect = document.createElement('select');
      roleSelect.className = 'role-select';
      roleSelect.draggable = false; // 避免在下拉選單上點擊被誤判成拖曳排序的起手勢
      if (role) roleSelect.style.color = role.color;
      const noRoleOpt = document.createElement('option');
      noRoleOpt.value = '';
      noRoleOpt.textContent = window.i18n.t('account.noRole');
      roleSelect.appendChild(noRoleOpt);
      Array.from(rolesById.values()).forEach((r) => {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = r.name;
        roleSelect.appendChild(opt);
      });
      roleSelect.value = acc.roleId || '';
      roleSelect.addEventListener('click', (e) => e.stopPropagation());
      roleSelect.addEventListener('mousedown', (e) => e.stopPropagation());
      roleSelect.addEventListener('change', async (e) => {
        e.stopPropagation();
        await window.workspaceAPI.setAccountRole(acc.id, roleSelect.value || null);
        await refreshAccounts();
      });
      meta.appendChild(roleSelect);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.draggable = false;
      deleteBtn.textContent = '🗑';
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = window.confirm(
          window.i18n.t('sidebar.deleteAccountConfirm', { name: acc.name })
        );
        if (ok) {
          await window.workspaceAPI.removeAccount(acc.id);
          await refreshAccounts();
        }
      });

      item.appendChild(avatar);
      item.appendChild(meta);
      item.appendChild(deleteBtn);

      item.addEventListener('click', async () => {
        await window.workspaceAPI.switchAccount(acc.id);
        await refreshAccounts();
      });

      accountList.appendChild(item);
    });
  }

  async function refreshAccounts() {
    const [accounts, roles] = await Promise.all([
      window.workspaceAPI.listAccounts(),
      window.workspaceAPI.listRoles(),
    ]);
    rolesById = new Map(roles.map((r) => [r.id, r]));
    lastAccounts = accounts;
    renderAccounts(accounts);
    await refreshPromptList();
  }

  // --- 預設提示詞區塊：依目前選中帳號的角色，列出知識庫裡配置給該角色的提示詞 ---
  const promptListEl = document.getElementById('prompt-list');

  function renderPromptEmptyHint(text) {
    promptListEl.innerHTML = '';
    const hint = document.createElement('div');
    hint.className = 'prompt-empty-hint';
    hint.textContent = text;
    promptListEl.appendChild(hint);
  }

  async function refreshPromptList() {
    const activeAccount = lastAccounts.find((a) => a.active);
    if (!activeAccount) {
      renderPromptEmptyHint(window.i18n.t('sidebar.promptsNoActiveAccount'));
      return;
    }
    if (!activeAccount.roleId) {
      renderPromptEmptyHint(window.i18n.t('sidebar.promptsNoRole'));
      return;
    }
    const role = rolesById.get(activeAccount.roleId);
    const kb = await window.workspaceAPI.listKnowledge();
    const matched = kb.items.filter((it) =>
      (it.roleIds || []).includes(activeAccount.roleId)
    );

    if (matched.length === 0) {
      renderPromptEmptyHint(
        window.i18n.t('sidebar.promptsEmpty', { role: role ? role.name : '' })
      );
      return;
    }

    promptListEl.innerHTML = '';
    matched.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'prompt-row';
      row.title = item.title;

      const name = document.createElement('span');
      name.className = 'prompt-row-name';
      name.textContent = item.title;

      const copyBtn = document.createElement('button');
      copyBtn.className = 'prompt-row-copy';
      copyBtn.textContent = '⧉';
      copyBtn.title = window.i18n.t('knowledge.copy');
      copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(item.content);
      });

      row.appendChild(name);
      row.appendChild(copyBtn);
      promptListEl.appendChild(row);
    });
  }

  window.workspaceAPI.onKnowledgeChanged(() => {
    refreshPromptList();
  });

  window.workspaceAPI.onAccountsChanged(() => {
    refreshAccounts();
  });

  // --- 專案到期提醒角標 ---
  const dueBadgeEl = document.getElementById('projects-due-badge');
  function renderDueBadge(summary) {
    const total = (summary.overdueCount || 0) + (summary.dueTodayCount || 0);
    if (total === 0) {
      dueBadgeEl.style.display = 'none';
      dueBadgeEl.textContent = '';
      return;
    }
    dueBadgeEl.style.display = '';
    dueBadgeEl.textContent = String(total);
    dueBadgeEl.title =
      summary.overdueCount > 0
        ? window.i18n.t('project.dueBadgeOverdueTitle', {
            overdue: summary.overdueCount,
            today: summary.dueTodayCount,
          })
        : window.i18n.t('project.dueBadgeTodayTitle', { today: summary.dueTodayCount });
  }
  window.workspaceAPI.onRemindersChanged((summary) => {
    renderDueBadge(summary);
  });

  // ---------------------------------------------------------------------
  // 跨模組快速搜尋（命令面板）：Ctrl/⌘+K 或點側邊欄「快速搜尋」開啟，
  // 一次搜尋橫跨知識庫/文件庫/對話庫/專案，Enter 跳到選中的項目（開啟
  // 對應視窗＋直接選中該項目，見 lib/ipc/search.js）。
  // ---------------------------------------------------------------------
  const paletteOverlay = document.getElementById('command-palette-overlay');
  const paletteInput = document.getElementById('command-palette-input');
  const paletteResultsEl = document.getElementById('command-palette-results');

  const RESULT_KIND_META = {
    'knowledge-item': { icon: '📝', labelKey: 'search.kindKnowledgeItem' },
    'knowledge-group': { icon: '📦', labelKey: 'search.kindKnowledgeGroup' },
    document: { icon: '📄', labelKey: 'search.kindDocument' },
    conversation: { icon: '💬', labelKey: 'search.kindConversation' },
    project: { icon: '🗂️', labelKey: 'search.kindProject' },
    task: { icon: '☑️', labelKey: 'search.kindTask' },
    issue: { icon: '🐞', labelKey: 'search.kindIssue' },
  };

  let paletteResults = [];
  let paletteActiveIndex = -1;

  function openPalette() {
    paletteOverlay.classList.add('open');
    paletteInput.value = '';
    paletteResults = [];
    paletteActiveIndex = -1;
    renderPaletteResults();
    paletteInput.focus();
  }

  function closePalette() {
    paletteOverlay.classList.remove('open');
  }

  function renderPaletteResults() {
    paletteResultsEl.innerHTML = '';

    if (paletteInput.value.trim() && paletteResults.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cmdp-empty';
      empty.textContent = window.i18n.t('search.noResults');
      paletteResultsEl.appendChild(empty);
      return;
    }

    paletteResults.forEach((result, idx) => {
      const meta = RESULT_KIND_META[result.kind] || { icon: '❓', labelKey: '' };
      const row = document.createElement('div');
      row.className = 'cmdp-result' + (idx === paletteActiveIndex ? ' active' : '');

      const icon = document.createElement('span');
      icon.className = 'cmdp-result-icon';
      icon.textContent = meta.icon;

      const main = document.createElement('div');
      main.className = 'cmdp-result-main';
      const title = document.createElement('div');
      title.className = 'cmdp-result-title';
      title.textContent = result.title || '';
      main.appendChild(title);
      if (result.snippet) {
        const snippet = document.createElement('div');
        snippet.className = 'cmdp-result-snippet';
        snippet.textContent = result.snippet;
        main.appendChild(snippet);
      }

      const kind = document.createElement('span');
      kind.className = 'cmdp-result-kind';
      kind.textContent = window.i18n.t(meta.labelKey);

      row.appendChild(icon);
      row.appendChild(main);
      row.appendChild(kind);
      row.addEventListener('mouseenter', () => {
        paletteActiveIndex = idx;
        renderPaletteResults();
      });
      row.addEventListener('click', () => jumpToResult(result));
      paletteResultsEl.appendChild(row);
    });
  }

  async function jumpToResult(result) {
    if (!result) return;
    await window.workspaceAPI.jumpToSearchResult(result.open);
    closePalette();
  }

  let paletteSearchInFlight = 0;
  paletteInput.addEventListener('input', async () => {
    const query = paletteInput.value.trim();
    const requestId = ++paletteSearchInFlight;
    if (!query) {
      paletteResults = [];
      paletteActiveIndex = -1;
      renderPaletteResults();
      return;
    }
    const results = await window.workspaceAPI.searchGlobal(query);
    if (requestId !== paletteSearchInFlight) return; // 使用者輸入期間又打了新的搜尋，這次的結果已經過期
    paletteResults = results;
    paletteActiveIndex = results.length > 0 ? 0 : -1;
    renderPaletteResults();
  });

  paletteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (paletteResults.length === 0) return;
      paletteActiveIndex = (paletteActiveIndex + 1) % paletteResults.length;
      renderPaletteResults();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (paletteResults.length === 0) return;
      paletteActiveIndex =
        (paletteActiveIndex - 1 + paletteResults.length) % paletteResults.length;
      renderPaletteResults();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      jumpToResult(paletteResults[paletteActiveIndex]);
    }
  });

  paletteOverlay.addEventListener('click', (e) => {
    if (e.target === paletteOverlay) closePalette();
  });

  document
    .getElementById('btn-open-command-palette')
    .addEventListener('click', openPalette);

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (paletteOverlay.classList.contains('open')) {
        closePalette();
      } else {
        openPalette();
      }
    }
  });

  window.addEventListener('resize', () => {
    // main process 自己監聽 resize 來重新計算 WebContentsView bounds
  });

  (async () => {
    const ui = await window.workspaceAPI.getUIState();
    collapsed = !!ui.sidebarCollapsed;
    applyCollapsedState();
    initGroups(ui.sidebarGroups);
    await window.i18n.init();
    await refreshAccounts();

    const version = await window.workspaceAPI.getAppVersion();
    document.getElementById('app-version-label').textContent = `v${version}`;

    renderDueBadge(await window.workspaceAPI.getDueSummary());
  })();
})();
