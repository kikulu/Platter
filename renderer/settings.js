(function () {
  // --- 語言 ---
  const langSelect = document.getElementById('lang-select');
  langSelect.addEventListener('change', () => {
    window.i18n.setLanguage(langSelect.value);
  });

  // --- 設定檔存放位置 ---
  const dataDirDisplay = document.getElementById('data-dir-display');
  const btnChooseDataDir = document.getElementById('btn-choose-datadir');
  const btnResetDataDir = document.getElementById('btn-reset-datadir');

  async function refreshDataDir() {
    const { dataDir, isDefault } = await window.workspaceAPI.getDataDir();
    dataDirDisplay.textContent = window.i18n.t('settings.dataDir.current', {
      path: dataDir,
    });
    btnResetDataDir.style.display = isDefault ? 'none' : 'inline-block';
  }

  btnChooseDataDir.addEventListener('click', async () => {
    await window.workspaceAPI.chooseDataDir();
  });
  btnResetDataDir.addEventListener('click', async () => {
    await window.workspaceAPI.resetDataDir();
  });

  // --- 擴充功能 ---
  const extList = document.getElementById('ext-list');

  async function refreshExtensions() {
    const extensions = await window.workspaceAPI.getExtensions();
    extList.innerHTML = '';
    if (extensions.length === 0) {
      const p = document.createElement('div');
      p.className = 'settings-hint';
      p.textContent = window.i18n.t('settings.extensions.empty');
      extList.appendChild(p);
      return;
    }
    extensions.forEach((ext) => {
      const row = document.createElement('div');
      row.className = 'ext-item';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = ext.enabled;
      checkbox.addEventListener('change', async () => {
        await window.workspaceAPI.toggleExtension(ext.id, checkbox.checked);
      });

      const name = document.createElement('div');
      name.className = 'ext-name';
      name.textContent = ext.name;

      const version = document.createElement('div');
      version.className = 'ext-version';
      version.textContent = ext.version;

      const removeBtn = document.createElement('button');
      removeBtn.textContent = window.i18n.t('settings.extensions.remove');
      removeBtn.addEventListener('click', async () => {
        await window.workspaceAPI.removeExtension(ext.id);
        refreshExtensions();
      });

      row.appendChild(checkbox);
      row.appendChild(name);
      row.appendChild(version);
      row.appendChild(removeBtn);
      extList.appendChild(row);
    });
  }

  document.getElementById('btn-add-ext').addEventListener('click', async () => {
    await window.workspaceAPI.addExtension();
    refreshExtensions();
  });

  // --- 檔案預設儲存路徑 ---
  const savePathDisplay = document.getElementById('save-path-display');
  const skipDialogCheckbox = document.getElementById('skip-dialog-checkbox');

  async function refreshSavePath() {
    const { defaultSavePath, skipSaveDialog } =
      await window.workspaceAPI.getSavePathConfig();
    savePathDisplay.textContent = window.i18n.t('settings.savePath.current', {
      path: defaultSavePath,
    });
    skipDialogCheckbox.checked = skipSaveDialog;
  }

  document.getElementById('btn-choose-savepath').addEventListener('click', async () => {
    await window.workspaceAPI.chooseDefaultSavePath();
    refreshSavePath();
  });

  skipDialogCheckbox.addEventListener('change', async () => {
    await window.workspaceAPI.setSkipSaveDialog(skipDialogCheckbox.checked);
  });

  // --- 備份與還原 ---
  document.getElementById('btn-export-backup').addEventListener('click', async () => {
    const result = await window.workspaceAPI.exportBackup();
    if (result.ok)
      alert(window.i18n.t('settings.backup.exportSuccess', { path: result.filePath }));
  });

  document.getElementById('btn-import-backup').addEventListener('click', async () => {
    const result = await window.workspaceAPI.importBackup();
    if (result.ok) {
      alert(window.i18n.t('settings.backup.importSuccess'));
      refreshExtensions();
    } else if (result.error) {
      alert(window.i18n.t('settings.backup.importFail'));
    }
  });

  // --- 選擇器設定 ---
  const selectorTabs = document.getElementById('selector-tabs');
  const selectorTurnInput = document.getElementById('selector-turn');
  const selectorUserHintInput = document.getElementById('selector-user-hint');

  const selectorTestResultEl = document.getElementById('selector-test-result');

  let allSelectors = {};
  let currentPlatform = 'claude';
  let pendingUserSample = null;
  let pendingAiSample = null;
  let testCaptureInFlight = false;

  function hideTestResult() {
    selectorTestResultEl.style.display = 'none';
    selectorTestResultEl.innerHTML = '';
  }

  function loadSelectorIntoForm(platform) {
    const sel = allSelectors[platform] || { turn: '', userHint: '' };
    selectorTurnInput.value = sel.turn || '';
    selectorUserHintInput.value = sel.userHint || '';
  }

  selectorTabs.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectorTabs
        .querySelectorAll('button')
        .forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentPlatform = btn.getAttribute('data-platform');
      pendingUserSample = null;
      pendingAiSample = null;
      loadSelectorIntoForm(currentPlatform);
      hideTestResult();
    });
  });

  async function refreshSelectors() {
    allSelectors = await window.workspaceAPI.getSelectors();
    loadSelectorIntoForm(currentPlatform);
  }

  document.getElementById('btn-save-selector').addEventListener('click', async () => {
    allSelectors = await window.workspaceAPI.saveSelector(currentPlatform, {
      turn: selectorTurnInput.value.trim(),
      userHint: selectorUserHintInput.value.trim(),
    });
    alert(window.i18n.t('settings.selectors.saved'));
  });

  document.getElementById('btn-reset-selector').addEventListener('click', async () => {
    allSelectors = await window.workspaceAPI.resetSelector(currentPlatform);
    loadSelectorIntoForm(currentPlatform);
    hideTestResult();
  });

  // --- 選擇器設定：測試擷取預覽 ---
  // 用表單裡目前填的內容（不管有沒有按過「儲存」）直接測試擷取，方便
  // 邊調整 selector 邊確認結果，不用真的匯出一次才知道有沒有抓對。
  function renderTestResult(result) {
    selectorTestResultEl.innerHTML = '';
    selectorTestResultEl.style.display = 'block';

    if (!result || result.error === 'NO_ACCOUNT_FOR_PLATFORM') {
      const err = document.createElement('div');
      err.className = 'selector-test-error';
      err.textContent = window.i18n.t('settings.selectors.testNoAccount');
      selectorTestResultEl.appendChild(err);
      return;
    }

    if (!result.ok) {
      const debug = result.debug || {};
      const err = document.createElement('div');
      err.className = 'selector-test-error';
      err.textContent = window.i18n.t('settings.selectors.testFailed', {
        error: result.error || 'UNKNOWN',
      });
      selectorTestResultEl.appendChild(err);

      const hint = document.createElement('div');
      hint.className = 'settings-hint';
      hint.textContent = window.i18n.t('settings.selectors.testDebug', {
        matched: debug.matchedNodeCount != null ? debug.matchedNodeCount : '?',
        nonEmpty: debug.nonEmptyMessageCount != null ? debug.nonEmptyMessageCount : '?',
      });
      selectorTestResultEl.appendChild(hint);
      return;
    }

    const summary = document.createElement('div');
    summary.className = 'selector-test-summary';
    summary.textContent = window.i18n.t('settings.selectors.testSuccess', {
      count: result.messages.length,
    });
    selectorTestResultEl.appendChild(summary);

    const previewCount = 5;
    result.messages.slice(0, previewCount).forEach((m) => {
      const row = document.createElement('div');
      row.className = 'selector-test-msg';

      const roleSpan = document.createElement('span');
      roleSpan.className = 'selector-test-msg-role';
      roleSpan.textContent = m.role === 'user' ? '🧑' : '🤖';

      const textSpan = document.createElement('span');
      textSpan.className = 'selector-test-msg-text';
      textSpan.textContent = m.text.length > 80 ? `${m.text.slice(0, 80)}…` : m.text;

      row.appendChild(roleSpan);
      row.appendChild(textSpan);
      selectorTestResultEl.appendChild(row);
    });

    if (result.messages.length > previewCount) {
      const more = document.createElement('div');
      more.className = 'settings-hint';
      more.textContent = window.i18n.t('settings.selectors.testMore', {
        count: result.messages.length - previewCount,
      });
      selectorTestResultEl.appendChild(more);
    }
  }

  document.getElementById('btn-test-capture').addEventListener('click', async () => {
    if (testCaptureInFlight) return;
    testCaptureInFlight = true;

    selectorTestResultEl.innerHTML = '';
    selectorTestResultEl.style.display = 'block';
    const loading = document.createElement('div');
    loading.className = 'settings-hint';
    loading.textContent = window.i18n.t('settings.selectors.testing');
    selectorTestResultEl.appendChild(loading);

    const selector = {
      turn: selectorTurnInput.value.trim(),
      userHint: selectorUserHintInput.value.trim(),
    };

    try {
      const result = await window.workspaceAPI.testCaptureSelector(
        currentPlatform,
        selector
      );
      renderTestResult(result);
    } finally {
      testCaptureInFlight = false;
    }
  });

  async function tryDeriveAndFill() {
    if (!pendingUserSample || !pendingAiSample) return;
    const derived = await window.workspaceAPI.deriveSelector(
      pendingUserSample,
      pendingAiSample
    );
    selectorTurnInput.value = derived.turn || '';
    selectorUserHintInput.value = derived.userHint || '';
    hideTestResult();
    if (!derived.userHint) {
      alert(window.i18n.t('settings.selectors.derivedNoHint'));
    }
  }

  document.getElementById('btn-pick-user').addEventListener('click', async () => {
    const result = await window.workspaceAPI.pickUserSample();
    if (result.cancelled) {
      alert(window.i18n.t('settings.selectors.pickCancelled'));
      return;
    }
    pendingUserSample = result;
    await tryDeriveAndFill();
  });

  document.getElementById('btn-pick-ai').addEventListener('click', async () => {
    const result = await window.workspaceAPI.pickAiSample();
    if (result.cancelled) {
      alert(window.i18n.t('settings.selectors.pickCancelled'));
      return;
    }
    pendingAiSample = result;
    await tryDeriveAndFill();
  });

  // --- 疑難排解 ---
  document.getElementById('btn-open-devtools').addEventListener('click', async () => {
    await window.workspaceAPI.openCurrentDevTools();
  });

  document.getElementById('btn-clear-cache').addEventListener('click', async () => {
    const ok = window.confirm(window.i18n.t('settings.troubleshoot.clearCacheConfirm'));
    if (!ok) return;
    await window.workspaceAPI.clearAppCache();
    alert(window.i18n.t('settings.troubleshoot.clearCacheDone'));
  });

  // --- 帳號角色機制 ---
  const ROLE_COLOR_PALETTE = [
    '#4f8cff',
    '#e5484d',
    '#f5a623',
    '#2ecc71',
    '#9b59b6',
    '#1abc9c',
    '#e91e8c',
    '#95a5a6',
  ];

  const roleListEl = document.getElementById('role-list');
  const roleNameInput = document.getElementById('role-name-input');
  const roleDescInput = document.getElementById('role-desc-input');
  const rolePaletteEl = document.getElementById('role-color-palette');
  const btnSaveRole = document.getElementById('btn-save-role');
  const btnCancelRoleEdit = document.getElementById('btn-role-cancel-edit');

  let editingRoleId = null;
  let selectedRoleColor = ROLE_COLOR_PALETTE[0];

  function renderRolePalette() {
    rolePaletteEl.innerHTML = '';
    ROLE_COLOR_PALETTE.forEach((color) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className =
        'color-swatch' + (color === selectedRoleColor ? ' selected' : '');
      swatch.style.background = color;
      swatch.addEventListener('click', () => {
        selectedRoleColor = color;
        renderRolePalette();
      });
      rolePaletteEl.appendChild(swatch);
    });
  }

  function resetRoleForm() {
    editingRoleId = null;
    roleNameInput.value = '';
    roleDescInput.value = '';
    selectedRoleColor = ROLE_COLOR_PALETTE[0];
    btnCancelRoleEdit.style.display = 'none';
    btnSaveRole.textContent = window.i18n.t('settings.roles.save');
    renderRolePalette();
  }

  async function refreshRoles() {
    const roles = await window.workspaceAPI.listRoles();
    roleListEl.innerHTML = '';
    if (roles.length === 0) {
      const p = document.createElement('div');
      p.className = 'settings-hint';
      p.textContent = window.i18n.t('settings.roles.empty');
      roleListEl.appendChild(p);
      return;
    }
    roles.forEach((role) => {
      const row = document.createElement('div');
      row.className = 'role-item';

      const dot = document.createElement('span');
      dot.className = 'role-color-dot';
      dot.style.background = role.color;

      const info = document.createElement('div');
      info.className = 'role-info';
      const name = document.createElement('div');
      name.className = 'role-name';
      name.textContent = role.name;
      const desc = document.createElement('div');
      desc.className = 'role-desc';
      desc.textContent = role.description || '';
      info.appendChild(name);
      info.appendChild(desc);

      const copyBtn = document.createElement('button');
      copyBtn.textContent = window.i18n.t('settings.roles.copyPrompt');
      copyBtn.addEventListener('click', async () => {
        await navigator.clipboard.writeText(role.description || '');
        alert(window.i18n.t('knowledge.copied'));
      });

      const editBtn = document.createElement('button');
      editBtn.textContent = window.i18n.t('settings.roles.edit');
      editBtn.addEventListener('click', () => {
        editingRoleId = role.id;
        roleNameInput.value = role.name;
        roleDescInput.value = role.description || '';
        selectedRoleColor = role.color || ROLE_COLOR_PALETTE[0];
        btnCancelRoleEdit.style.display = 'inline-block';
        btnSaveRole.textContent = window.i18n.t('settings.roles.update');
        renderRolePalette();
        roleNameInput.focus();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'danger';
      deleteBtn.textContent = window.i18n.t('settings.roles.delete');
      deleteBtn.addEventListener('click', async () => {
        const ok = window.confirm(
          window.i18n.t('settings.roles.deleteConfirm', { name: role.name })
        );
        if (!ok) return;
        await window.workspaceAPI.deleteRole(role.id);
        if (editingRoleId === role.id) resetRoleForm();
        refreshRoles();
      });

      row.appendChild(dot);
      row.appendChild(info);
      row.appendChild(copyBtn);
      row.appendChild(editBtn);
      row.appendChild(deleteBtn);
      roleListEl.appendChild(row);
    });
  }

  btnSaveRole.addEventListener('click', async () => {
    const name = roleNameInput.value.trim();
    if (!name) {
      alert(window.i18n.t('settings.roles.nameRequired'));
      return;
    }
    await window.workspaceAPI.saveRole({
      id: editingRoleId,
      name,
      description: roleDescInput.value,
      color: selectedRoleColor,
    });
    resetRoleForm();
    refreshRoles();
  });

  btnCancelRoleEdit.addEventListener('click', () => {
    resetRoleForm();
  });

  // --- 本地端 AI 服務（Ollama／LM Studio／SD WebUI／ComfyUI 等） ---
  const LOCAL_SERVICE_TYPE_ICONS = { llm: '🧠', image: '🎨', custom: '🧩' };
  const localServiceSettingsList = document.getElementById('local-service-settings-list');
  const localServiceStatusCache = new Map(); // accountId -> 'checking' | 'online' | 'offline'

  async function refreshLocalServices() {
    const accounts = await window.workspaceAPI.listAccounts();
    const localAccounts = accounts.filter((a) => a.platform === 'local');
    localServiceSettingsList.innerHTML = '';

    if (localAccounts.length === 0) {
      const p = document.createElement('div');
      p.className = 'settings-hint';
      p.textContent = window.i18n.t('settings.localServices.empty');
      localServiceSettingsList.appendChild(p);
      return;
    }

    localAccounts.forEach((acc) => {
      const row = document.createElement('div');
      row.className = 'local-service-row';

      const icon = document.createElement('div');
      icon.className = 'ls-icon';
      icon.textContent = LOCAL_SERVICE_TYPE_ICONS[acc.serviceType] || '🧩';

      const meta = document.createElement('div');
      meta.className = 'ls-meta';
      const name = document.createElement('div');
      name.className = 'ls-name';
      name.textContent = acc.name;
      const url = document.createElement('div');
      url.className = 'ls-url';
      url.textContent = acc.url || window.i18n.t('account.localUrlMissing');
      meta.appendChild(name);
      meta.appendChild(url);

      const status = document.createElement('div');
      status.className = 'ls-status';
      status.textContent = statusLabel(localServiceStatusCache.get(acc.id));

      const testBtn = document.createElement('button');
      testBtn.textContent = window.i18n.t('settings.localServices.test');
      testBtn.addEventListener('click', () => checkStatus(acc, status));

      const editBtn = document.createElement('button');
      editBtn.textContent = window.i18n.t('common.edit');
      editBtn.addEventListener('click', () => editLocalService(acc));

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = window.i18n.t('settings.localServices.remove');
      deleteBtn.addEventListener('click', async () => {
        const ok = window.confirm(
          window.i18n.t('sidebar.deleteAccountConfirm', { name: acc.name })
        );
        if (!ok) return;
        localServiceStatusCache.delete(acc.id);
        await window.workspaceAPI.removeAccount(acc.id);
        await refreshLocalServices();
      });

      const actions = document.createElement('div');
      actions.className = 'ls-actions';
      actions.appendChild(testBtn);
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);

      row.appendChild(icon);
      row.appendChild(meta);
      row.appendChild(status);
      row.appendChild(actions);
      localServiceSettingsList.appendChild(row);

      checkStatus(acc, status);
    });
  }

  function statusLabel(status) {
    if (status === 'online')
      return `🟢 ${window.i18n.t('settings.localServices.online')}`;
    if (status === 'offline')
      return `🔴 ${window.i18n.t('settings.localServices.offline')}`;
    if (status === 'checking')
      return `⚪ ${window.i18n.t('settings.localServices.checking')}`;
    return `⚪ ${window.i18n.t('settings.localServices.unknown')}`;
  }

  async function checkStatus(acc, statusEl) {
    if (!acc.url) {
      localServiceStatusCache.set(acc.id, 'offline');
      statusEl.textContent = statusLabel('offline');
      return;
    }
    localServiceStatusCache.set(acc.id, 'checking');
    statusEl.textContent = statusLabel('checking');
    const result = await window.workspaceAPI.testLocalService(acc.url);
    const next = result && result.ok ? 'online' : 'offline';
    localServiceStatusCache.set(acc.id, next);
    statusEl.textContent = statusLabel(next);
  }

  // 用三個依序彈出的 prompt() 編輯名稱/類型/網址——欄位少，不值得
  // 為了編輯另開一個表單視窗。
  async function editLocalService(acc) {
    const name = window.prompt(window.i18n.t('account.name'), acc.name);
    if (name === null) return;
    const serviceType = window.prompt(
      window.i18n.t('settings.localServices.editServiceTypePrompt'),
      acc.serviceType || 'custom'
    );
    if (serviceType === null) return;
    const url = window.prompt(window.i18n.t('account.localUrl'), acc.url || '');
    if (url === null) return;
    if (url.trim() && !/^https?:\/\//i.test(url.trim())) {
      alert(window.i18n.t('account.localUrlInvalid'));
      return;
    }
    await window.workspaceAPI.updateLocalService(acc.id, {
      name: name.trim() || acc.name,
      url: url.trim(),
      serviceType: ['llm', 'image', 'custom'].includes(serviceType.trim())
        ? serviceType.trim()
        : acc.serviceType,
    });
    localServiceStatusCache.delete(acc.id);
    await refreshLocalServices();
  }

  document
    .getElementById('btn-add-local-service-settings')
    .addEventListener('click', () => {
      window.workspaceAPI.openAccountWindow('local');
    });

  // 從主視窗側邊欄新增/刪除本地服務時（或這裡自己操作完），兩邊都要
  // 同步——跟主視窗的帳號清單是同一份資料，用既有的 accounts:changed
  // 廣播即可，不用再另開一種事件。
  window.workspaceAPI.onAccountsChanged(() => {
    refreshLocalServices();
  });

  // data-i18n 靜態字串替換，因為裡面要內插版本號）
  document.addEventListener('i18n:updated', async () => {
    const version = await window.workspaceAPI.getAppVersion();
    document.getElementById('about-version').textContent = window.i18n.t(
      'settings.about.version',
      { version }
    );
  });

  // --- 初始化 ---
  (async () => {
    await window.i18n.init();
    langSelect.value = window.i18n.lang;
    await refreshDataDir();
    await refreshExtensions();
    await refreshSavePath();
    await refreshSelectors();
    resetRoleForm();
    await refreshRoles();
    await refreshLocalServices();

    const version = await window.workspaceAPI.getAppVersion();
    document.getElementById('about-version').textContent = window.i18n.t(
      'settings.about.version',
      { version }
    );
  })();
})();
