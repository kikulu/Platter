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
    dataDirDisplay.textContent = window.i18n.t('settings.dataDir.current', { path: dataDir });
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
    const { defaultSavePath, skipSaveDialog } = await window.workspaceAPI.getSavePathConfig();
    savePathDisplay.textContent = window.i18n.t('settings.savePath.current', { path: defaultSavePath });
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
    if (result.ok) alert(window.i18n.t('settings.backup.exportSuccess', { path: result.filePath }));
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

  let allSelectors = {};
  let currentPlatform = 'claude';
  let pendingUserSample = null;
  let pendingAiSample = null;

  function loadSelectorIntoForm(platform) {
    const sel = allSelectors[platform] || { turn: '', userHint: '' };
    selectorTurnInput.value = sel.turn || '';
    selectorUserHintInput.value = sel.userHint || '';
  }

  selectorTabs.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectorTabs.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentPlatform = btn.getAttribute('data-platform');
      pendingUserSample = null;
      pendingAiSample = null;
      loadSelectorIntoForm(currentPlatform);
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
  });

  async function tryDeriveAndFill() {
    if (!pendingUserSample || !pendingAiSample) return;
    const derived = await window.workspaceAPI.deriveSelector(pendingUserSample, pendingAiSample);
    selectorTurnInput.value = derived.turn || '';
    selectorUserHintInput.value = derived.userHint || '';
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

  // --- 帳號角色機制 ---
  const ROLE_COLOR_PALETTE = [
    '#4f8cff', '#e5484d', '#f5a623', '#2ecc71',
    '#9b59b6', '#1abc9c', '#e91e8c', '#95a5a6',
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
      swatch.className = 'color-swatch' + (color === selectedRoleColor ? ' selected' : '');
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
        const ok = window.confirm(window.i18n.t('settings.roles.deleteConfirm', { name: role.name }));
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
  })();
})();
