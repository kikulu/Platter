(function () {
  const platformSelect = document.getElementById('platform');
  const nameInput = document.getElementById('name');
  const roleSelect = document.getElementById('role');
  const localFields = document.getElementById('local-fields');
  const serviceTypeSelect = document.getElementById('service-type');
  const localUrlInput = document.getElementById('local-url');

  function updateLocalFieldsVisibility() {
    localFields.style.display = platformSelect.value === 'local' ? 'block' : 'none';
  }
  platformSelect.addEventListener('change', updateLocalFieldsVisibility);

  document.getElementById('btn-cancel').addEventListener('click', () => {
    window.workspaceAPI.closeSelf();
  });

  document.getElementById('btn-confirm').addEventListener('click', async () => {
    const platform = platformSelect.value;
    const name =
      nameInput.value.trim() || platformSelect.options[platformSelect.selectedIndex].text;
    const roleId = roleSelect.value || null;

    let extra;
    if (platform === 'local') {
      const url = localUrlInput.value.trim();
      // 網址至少要看起來像個網址，不然直接丟給 loadURL() 會讓帳號一切
      // 過去就整片空白，使用者搞不清楚是網址打錯還是程式壞了。
      if (!/^https?:\/\//i.test(url)) {
        alert(window.i18n.t('account.localUrlInvalid'));
        localUrlInput.focus();
        return;
      }
      extra = { url, serviceType: serviceTypeSelect.value };
    }

    const account = await window.workspaceAPI.addAccount(platform, name, roleId, extra);
    if (account) {
      await window.workspaceAPI.switchAccount(account.id);
    }
    window.workspaceAPI.closeSelf();
  });

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-confirm').click();
  });
  localUrlInput.addEventListener('keydown', (e) => {
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

    // 側邊欄「新增本地服務」按鈕會帶 ?platform=local 過來，開窗就直接選好，
    // 不用使用者自己再從下拉選單裡找。
    const presetPlatform = new URLSearchParams(window.location.search).get('platform');
    if (presetPlatform) {
      platformSelect.value = presetPlatform;
      updateLocalFieldsVisibility();
      localUrlInput.focus();
    } else {
      nameInput.focus();
    }
  })();
})();
