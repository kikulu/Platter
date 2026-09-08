(function () {
  const platformSelect = document.getElementById('platform');
  const nameInput = document.getElementById('name');
  const roleSelect = document.getElementById('role');

  document.getElementById('btn-cancel').addEventListener('click', () => {
    window.workspaceAPI.closeSelf();
  });

  document.getElementById('btn-confirm').addEventListener('click', async () => {
    const platform = platformSelect.value;
    const name = nameInput.value.trim() || platformSelect.options[platformSelect.selectedIndex].text;
    const roleId = roleSelect.value || null;

    const account = await window.workspaceAPI.addAccount(platform, name, roleId);
    if (account) {
      await window.workspaceAPI.switchAccount(account.id);
    }
    window.workspaceAPI.closeSelf();
  });

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-confirm').click();
  });

  async function loadRoles() {
    const roles = await window.workspaceAPI.listRoles();
    roleSelect.innerHTML = `<option value="">${window.i18n.t('account.noRole')}</option>`;
    roles.forEach((r) => {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.name;
      roleSelect.appendChild(opt);
    });
  }

  (async () => {
    await window.i18n.init();
    await loadRoles();
    nameInput.focus();
  })();
})();

