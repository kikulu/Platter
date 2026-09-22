(function () {
  let allErrors = [];
  let allAudits = [];

  const errorListEl = document.getElementById('error-list');
  const auditListEl = document.getElementById('audit-list');
  const errorScopeFilterEl = document.getElementById('error-scope-filter');
  const auditCategoryFilterEl = document.getElementById('audit-category-filter');
  const errorSearchEl = document.getElementById('error-search');
  const auditSearchEl = document.getElementById('audit-search');
  const errorCountEl = document.getElementById('error-count');
  const auditCountEl = document.getElementById('audit-count');

  function formatTimestamp(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // i18n.t() 找不到翻譯時會原樣回傳 key，這裡失敗時退回原始英文分類代碼
  function categoryLabel(category) {
    if (!category) return '-';
    const translated = window.i18n.t(`logs.category.${category}`);
    return translated === `logs.category.${category}` ? category : translated;
  }

  // ---------------------------------------------------------------------
  // 分頁切換
  // ---------------------------------------------------------------------
  const TAB_IDS = ['errors', 'audits', 'console'];
  function switchTab(tab) {
    TAB_IDS.forEach((id) => {
      document.getElementById(`tab-${id}`).classList.toggle('active', id === tab);
      document.getElementById(`panel-${id}`).classList.toggle('active', id === tab);
    });
  }
  TAB_IDS.forEach((id) => {
    document.getElementById(`tab-${id}`).addEventListener('click', () => switchTab(id));
  });

  // ---------------------------------------------------------------------
  // 錯誤日誌
  // ---------------------------------------------------------------------
  function rebuildErrorScopeFilter() {
    const scopes = Array.from(
      new Set(allErrors.map((e) => e.scope).filter(Boolean))
    ).sort();
    const currentValue = errorScopeFilterEl.value;
    errorScopeFilterEl.innerHTML = `<option value="">${window.i18n.t('logs.filterAllScopes')}</option>`;
    scopes.forEach((scope) => {
      const opt = document.createElement('option');
      opt.value = scope;
      opt.textContent = scope;
      errorScopeFilterEl.appendChild(opt);
    });
    errorScopeFilterEl.value = currentValue;
  }

  function renderErrors() {
    const scopeFilter = errorScopeFilterEl.value;
    const searchTerm = errorSearchEl.value.trim().toLowerCase();
    const filtered = allErrors
      .filter((e) => !scopeFilter || e.scope === scopeFilter)
      .filter((e) => !searchTerm || (e.message || '').toLowerCase().includes(searchTerm))
      .slice()
      .reverse(); // 最新的排最上面

    errorCountEl.textContent = window.i18n.t('logs.countLabel', {
      count: filtered.length,
    });
    errorListEl.innerHTML = '';

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.id = 'log-empty-hint';
      empty.textContent = window.i18n.t('logs.emptyErrors');
      errorListEl.appendChild(empty);
      return;
    }

    filtered.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'log-row' + (entry.stack ? ' has-stack' : '');

      const head = document.createElement('div');
      head.className = 'log-row-head';

      const time = document.createElement('span');
      time.className = 'log-time';
      time.textContent = formatTimestamp(entry.timestamp);

      const badge = document.createElement('span');
      badge.className = 'log-badge error';
      badge.textContent = entry.scope || '-';

      const message = document.createElement('span');
      message.className = 'log-message';
      message.textContent = entry.message || '';

      head.appendChild(time);
      head.appendChild(badge);
      head.appendChild(message);

      if (entry.stack) {
        const hint = document.createElement('span');
        hint.className = 'log-expand-hint';
        hint.textContent = window.i18n.t('logs.expandHint');
        head.appendChild(hint);
        head.addEventListener('click', () => row.classList.toggle('expanded'));

        const stack = document.createElement('pre');
        stack.className = 'log-stack';
        stack.textContent = entry.stack;
        row.appendChild(head);
        row.appendChild(stack);
      } else {
        row.appendChild(head);
      }

      errorListEl.appendChild(row);
    });
  }

  errorScopeFilterEl.addEventListener('change', renderErrors);
  errorSearchEl.addEventListener('input', renderErrors);

  document.getElementById('btn-clear-errors').addEventListener('click', async () => {
    const ok = window.confirm(window.i18n.t('logs.clearErrorsConfirm'));
    if (!ok) return;
    const logs = await window.workspaceAPI.clearLogs('errors');
    allErrors = logs.errors;
    rebuildErrorScopeFilter();
    renderErrors();
  });

  // ---------------------------------------------------------------------
  // 稽核日誌
  // ---------------------------------------------------------------------
  function rebuildAuditCategoryFilter() {
    const categories = Array.from(
      new Set(allAudits.map((a) => a.category).filter(Boolean))
    ).sort();
    const currentValue = auditCategoryFilterEl.value;
    auditCategoryFilterEl.innerHTML = `<option value="">${window.i18n.t('logs.filterAllCategories')}</option>`;
    categories.forEach((category) => {
      const opt = document.createElement('option');
      opt.value = category;
      opt.textContent = categoryLabel(category);
      auditCategoryFilterEl.appendChild(opt);
    });
    auditCategoryFilterEl.value = currentValue;
  }

  function renderAudits() {
    const categoryFilter = auditCategoryFilterEl.value;
    const searchTerm = auditSearchEl.value.trim().toLowerCase();
    const filtered = allAudits
      .filter((a) => !categoryFilter || a.category === categoryFilter)
      .filter((a) => !searchTerm || (a.detail || '').toLowerCase().includes(searchTerm))
      .slice()
      .reverse();

    auditCountEl.textContent = window.i18n.t('logs.countLabel', {
      count: filtered.length,
    });
    auditListEl.innerHTML = '';

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.id = 'log-empty-hint';
      empty.textContent = window.i18n.t('logs.emptyAudits');
      auditListEl.appendChild(empty);
      return;
    }

    filtered.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'log-row';

      const head = document.createElement('div');
      head.className = 'log-row-head';

      const time = document.createElement('span');
      time.className = 'log-time';
      time.textContent = formatTimestamp(entry.timestamp);

      const badge = document.createElement('span');
      badge.className = `log-badge category-${entry.category || ''}`;
      badge.textContent = categoryLabel(entry.category);

      const detail = document.createElement('span');
      detail.className = 'log-message';
      detail.textContent = entry.detail || '';

      head.appendChild(time);
      head.appendChild(badge);
      head.appendChild(detail);
      row.appendChild(head);
      auditListEl.appendChild(row);
    });
  }

  auditCategoryFilterEl.addEventListener('change', renderAudits);
  auditSearchEl.addEventListener('input', renderAudits);

  document.getElementById('btn-clear-audits').addEventListener('click', async () => {
    const ok = window.confirm(window.i18n.t('logs.clearAuditsConfirm'));
    if (!ok) return;
    const logs = await window.workspaceAPI.clearLogs('audits');
    allAudits = logs.audits;
    rebuildAuditCategoryFilter();
    renderAudits();
  });

  // ---------------------------------------------------------------------
  // 主控台（Console）：即時 console.log/warn/error 逐行輸出，只存在記憶體
  // ---------------------------------------------------------------------
  let consoleEntries = [];
  const consoleOutputEl = document.getElementById('console-output');
  const consoleAutoscrollEl = document.getElementById('console-autoscroll');
  const consoleCountEl = document.getElementById('console-count');

  function renderConsoleEntry(entry) {
    const row = document.createElement('div');
    row.className = `console-line console-level-${entry.level || 'log'}`;

    const time = document.createElement('span');
    time.className = 'console-time';
    time.textContent = formatTimestamp(entry.timestamp);

    const level = document.createElement('span');
    level.className = 'console-level-badge';
    level.textContent = (entry.level || 'log').toUpperCase();

    const text = document.createElement('span');
    text.className = 'console-text';
    text.textContent = entry.text || '';

    row.appendChild(time);
    row.appendChild(level);
    row.appendChild(text);
    return row;
  }

  function renderConsole() {
    consoleCountEl.textContent = window.i18n.t('logs.countLabel', {
      count: consoleEntries.length,
    });
    consoleOutputEl.innerHTML = '';
    if (consoleEntries.length === 0) {
      const empty = document.createElement('div');
      empty.id = 'log-empty-hint';
      empty.textContent = window.i18n.t('logs.emptyConsole');
      consoleOutputEl.appendChild(empty);
      return;
    }
    consoleEntries.forEach((entry) => {
      consoleOutputEl.appendChild(renderConsoleEntry(entry));
    });
    if (consoleAutoscrollEl.checked) {
      consoleOutputEl.scrollTop = consoleOutputEl.scrollHeight;
    }
  }

  document.getElementById('btn-clear-console').addEventListener('click', async () => {
    consoleEntries = await window.workspaceAPI.clearConsole();
    renderConsole();
  });

  window.workspaceAPI.onConsoleEntry((entry) => {
    consoleEntries.push(entry);
    // 畫面上的即時 tail，跟 main process 那份記憶體緩衝區一樣上限筆數，避免無限長大
    if (consoleEntries.length > 300) consoleEntries.shift();
    // 只有在「主控台」分頁開著的時候才需要整份重畫，其餘分頁開著時先不畫，
    // 切過去分頁時 switchTab 不會重新抓資料，所以這裡改成不論在哪個分頁都
    // 直接增量渲染一行，成本很低（比整份重畫便宜），也不會漏看即時訊息。
    consoleOutputEl.appendChild(renderConsoleEntry(entry));
    consoleCountEl.textContent = window.i18n.t('logs.countLabel', {
      count: consoleEntries.length,
    });
    if (consoleAutoscrollEl.checked) {
      consoleOutputEl.scrollTop = consoleOutputEl.scrollHeight;
    }
  });

  // ---------------------------------------------------------------------
  // 匯出
  // ---------------------------------------------------------------------
  document.getElementById('btn-export-logs').addEventListener('click', async () => {
    const result = await window.workspaceAPI.exportLogs();
    if (result.ok) {
      alert(window.i18n.t('export.success', { path: result.filePath }));
    } else if (result.error) {
      alert(`${window.i18n.t('export.fail')}: ${result.error}`);
    }
  });

  // ---------------------------------------------------------------------
  // 即時同步 + 初始化
  // ---------------------------------------------------------------------
  window.workspaceAPI.onLogsChanged(async () => {
    const logs = await window.workspaceAPI.listLogs();
    allErrors = logs.errors;
    allAudits = logs.audits;
    rebuildErrorScopeFilter();
    rebuildAuditCategoryFilter();
    renderErrors();
    renderAudits();
  });

  (async () => {
    await window.i18n.init();
    const logs = await window.workspaceAPI.listLogs();
    allErrors = logs.errors;
    allAudits = logs.audits;
    rebuildErrorScopeFilter();
    rebuildAuditCategoryFilter();
    renderErrors();
    renderAudits();

    consoleEntries = await window.workspaceAPI.listConsole();
    renderConsole();
  })();
})();
