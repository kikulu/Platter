(function () {
  const collapsedBtn = document.getElementById('btn-tray-open');
  const closeBtn = document.getElementById('btn-tray-close');
  const searchInput = document.getElementById('tray-search');
  const listEl = document.getElementById('tray-list');
  const toastEl = document.getElementById('tray-toast');
  const openKnowledgeBtn = document.getElementById('btn-tray-open-knowledge');

  let allItems = []; // 知識庫的「項目」清單（不含分階段套餐——套餐是多步驟的操作，
  // 這個小托盤只做「單一提示詞，點了就複製」這件事，套餐留給完整的知識庫視窗）
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

  function renderList() {
    const query = searchInput.value.trim();
    const filtered = allItems.filter((item) => matchesQuery(item, query));
    listEl.innerHTML = '';

    if (filtered.length === 0) {
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
    toastEl.textContent = window.i18n.t('tray.copied', { title: item.title });
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
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
    renderList();
  }

  window.workspaceAPI.onKnowledgeChanged(refreshItems);

  (async () => {
    await window.i18n.init();
    await refreshItems();
  })();
})();
