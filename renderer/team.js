(function () {
  const PLATFORM_LABELS = {
    claude: 'Claude',
    chatgpt: 'ChatGPT',
    gemini: 'Gemini',
    grok: 'Grok',
  };

  const roleColumnsEl = document.getElementById('role-columns');
  const teamEmptyEl = document.getElementById('team-empty');

  document.getElementById('btn-add-account').addEventListener('click', () => {
    window.workspaceAPI.openAccountWindow();
  });
  document.getElementById('btn-manage-roles').addEventListener('click', () => {
    window.workspaceAPI.openSettingsWindow();
  });

  function buildRoleSelectOptions(select, roles, selectedRoleId) {
    select.innerHTML = `<option value="">${window.i18n.t('account.noRole')}</option>`;
    roles.forEach((r) => {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.name;
      select.appendChild(opt);
    });
    select.value = selectedRoleId || '';
  }

  function renderMemberCard(acc, roles) {
    const card = document.createElement('div');
    card.className = 'member-card';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = (PLATFORM_LABELS[acc.platform] || acc.platform)[0];

    const meta = document.createElement('div');
    meta.className = 'member-meta';
    const name = document.createElement('div');
    name.className = 'member-name';
    name.textContent = acc.name;
    const platform = document.createElement('div');
    platform.className = 'member-platform';
    platform.textContent = PLATFORM_LABELS[acc.platform] || acc.platform;
    meta.appendChild(name);
    meta.appendChild(platform);

    const select = document.createElement('select');
    buildRoleSelectOptions(select, roles, acc.roleId);
    select.addEventListener('change', async () => {
      await window.workspaceAPI.setAccountRole(acc.id, select.value || null);
      await refresh();
    });

    card.appendChild(avatar);
    card.appendChild(meta);
    card.appendChild(select);
    return card;
  }

  function renderColumn(title, color, accounts, roles) {
    const col = document.createElement('div');
    col.className = 'role-column';

    const header = document.createElement('div');
    header.className = 'role-column-header';
    if (color) {
      const dot = document.createElement('span');
      dot.className = 'role-color-dot';
      dot.style.background = color;
      header.appendChild(dot);
    }
    const name = document.createElement('div');
    name.className = 'role-column-name';
    name.textContent = title;
    const count = document.createElement('div');
    count.className = 'role-column-count';
    count.textContent = accounts.length;
    header.appendChild(name);
    header.appendChild(count);
    col.appendChild(header);

    if (accounts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'role-column-empty';
      empty.textContent = window.i18n.t('team.noMembers');
      col.appendChild(empty);
    } else {
      accounts.forEach((acc) => col.appendChild(renderMemberCard(acc, roles)));
    }

    return col;
  }

  async function refresh() {
    const [accounts, roles] = await Promise.all([
      window.workspaceAPI.listAccounts(),
      window.workspaceAPI.listRoles(),
    ]);

    roleColumnsEl.innerHTML = '';
    teamEmptyEl.style.display = accounts.length === 0 ? 'block' : 'none';
    if (accounts.length === 0) return;

    roles.forEach((role) => {
      const members = accounts.filter((a) => a.roleId === role.id);
      roleColumnsEl.appendChild(renderColumn(role.name, role.color, members, roles));
    });

    const unassigned = accounts.filter((a) => !a.roleId || !roles.some((r) => r.id === a.roleId));
    roleColumnsEl.appendChild(
      renderColumn(window.i18n.t('team.unassigned'), null, unassigned, roles)
    );
  }

  window.workspaceAPI.onAccountsChanged(() => refresh());

  (async () => {
    await window.i18n.init();
    await refresh();
  })();
})();
