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
      alert(window.i18n.t('export.selectorHint'));
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
    const matched = kb.items.filter((it) => (it.roleIds || []).includes(activeAccount.roleId));

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
  })();
})();

