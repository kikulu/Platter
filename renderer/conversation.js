(function () {
  const PLATFORM_LABELS = {
    claude: 'Claude',
    chatgpt: 'ChatGPT',
    gemini: 'Gemini',
    grok: 'Grok',
  };

  const listEl = document.getElementById('conv-list');
  const emptyEl = document.getElementById('conv-empty');
  const editorEl = document.getElementById('conv-editor');
  const tagFilterEl = document.getElementById('conv-tag-filter');

  const titleInput = document.getElementById('conv-title');
  const tagsInput = document.getElementById('conv-tags');
  const contentInput = document.getElementById('conv-content');
  const sourceInfoEl = document.getElementById('conv-source-info');

  const linkedListEl = document.getElementById('conv-linked-list');
  const linkSelectEl = document.getElementById('conv-link-select');

  let allConversations = [];
  let allDocuments = [];
  let currentConvId = null;

  function parseTags(str) {
    return str
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function sourceLabel(conv) {
    if (!conv.sourcePlatform) return '';
    const platformName = PLATFORM_LABELS[conv.sourcePlatform] || conv.sourcePlatform;
    return window.i18n.t('conversations.sourceFrom', { platform: platformName });
  }

  function rebuildTagOptions() {
    const tagSet = new Set();
    allConversations.forEach((c) => (c.tags || []).forEach((t) => tagSet.add(t)));
    const currentValue = tagFilterEl.value;
    tagFilterEl.innerHTML = `<option value="">${window.i18n.t('knowledge.filterAll')}</option>`;
    Array.from(tagSet)
      .sort()
      .forEach((tag) => {
        const opt = document.createElement('option');
        opt.value = tag;
        opt.textContent = tag;
        tagFilterEl.appendChild(opt);
      });
    tagFilterEl.value = currentValue;
  }
  tagFilterEl.addEventListener('change', renderList);

  function renderList() {
    const filterTag = tagFilterEl.value;
    const filtered = filterTag
      ? allConversations.filter((c) => (c.tags || []).includes(filterTag))
      : allConversations;

    listEl.innerHTML = '';
    filtered
      .slice()
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .forEach((conv) => {
        const item = document.createElement('div');
        item.className = 'conv-item' + (conv.id === currentConvId ? ' active' : '');

        const title = document.createElement('div');
        title.className = 'conv-item-title';
        title.textContent = conv.title || window.i18n.t('conversations.untitled');

        const sub = document.createElement('div');
        sub.className = 'conv-item-sub';
        const left = document.createElement('span');
        left.textContent = (conv.tags || []).map((t) => `#${t}`).join(' ');
        const right = document.createElement('span');
        right.className = 'conv-item-linked';
        const linkedCount = (conv.linkedDocumentIds || []).length;
        right.textContent = linkedCount
          ? window.i18n.t('conversations.linkedCount', { count: linkedCount })
          : '';
        sub.appendChild(left);
        sub.appendChild(right);

        item.appendChild(title);
        item.appendChild(sub);
        item.addEventListener('click', () => selectConversation(conv.id));
        listEl.appendChild(item);
      });
  }

  function docIconFor(doc) {
    const ext = /\.([a-zA-Z0-9]+)$/.exec((doc && doc.name) || '');
    const map = { md: '📝', markdown: '📝', json: '🗂', pdf: '📕', txt: '📄' };
    return (ext && map[ext[1].toLowerCase()]) || '📎';
  }

  function rebuildLinkSelect(conv) {
    const linkedIds = new Set((conv && conv.linkedDocumentIds) || []);
    const available = allDocuments.filter((d) => !linkedIds.has(d.id));
    linkSelectEl.innerHTML = '';
    if (available.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = window.i18n.t('conversations.noAvailableDocuments');
      linkSelectEl.appendChild(opt);
      linkSelectEl.disabled = true;
      return;
    }
    linkSelectEl.disabled = false;
    available.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name;
      linkSelectEl.appendChild(opt);
    });
  }

  function renderLinkedDocuments(conv) {
    linkedListEl.innerHTML = '';
    const linkedIds = (conv && conv.linkedDocumentIds) || [];
    if (linkedIds.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'linked-doc-empty';
      empty.textContent = window.i18n.t('conversations.noLinkedDocuments');
      linkedListEl.appendChild(empty);
    }
    linkedIds.forEach((docId) => {
      const doc = allDocuments.find((d) => d.id === docId);
      const row = document.createElement('div');
      row.className = 'linked-doc-row';

      const icon = document.createElement('span');
      icon.className = 'linked-doc-icon';
      icon.textContent = doc ? docIconFor(doc) : '⚠';

      const name = document.createElement('span');
      name.className = 'linked-doc-name' + (!doc || doc.missing ? ' missing' : '');
      name.textContent = doc
        ? doc.missing
          ? `${doc.name} (${window.i18n.t('documents.missingFlag')})`
          : doc.name
        : window.i18n.t('conversations.linkedDocumentGone');
      name.title = doc ? doc.filePath || '' : '';

      const actions = document.createElement('div');
      actions.className = 'linked-doc-actions';

      if (doc && !doc.missing) {
        const openBtn = document.createElement('button');
        openBtn.textContent = '📂';
        openBtn.title = window.i18n.t('documents.openFile');
        openBtn.addEventListener('click', async () => {
          await window.workspaceAPI.openDocumentFile(doc.id);
        });
        actions.appendChild(openBtn);
      }

      const unlinkBtn = document.createElement('button');
      unlinkBtn.className = 'danger-text';
      unlinkBtn.textContent = '✕';
      unlinkBtn.title = window.i18n.t('conversations.unlink');
      unlinkBtn.addEventListener('click', async () => {
        allConversations = await window.workspaceAPI.unlinkConversationDocument(currentConvId, docId);
        rebuildTagOptions();
        renderList();
        selectConversation(currentConvId);
      });
      actions.appendChild(unlinkBtn);

      row.appendChild(icon);
      row.appendChild(name);
      row.appendChild(actions);
      linkedListEl.appendChild(row);
    });
  }

  function selectConversation(id) {
    currentConvId = id;
    const conv = allConversations.find((c) => c.id === id);
    if (!conv) {
      editorEl.style.display = 'none';
      emptyEl.style.display = 'flex';
      return;
    }
    editorEl.style.display = 'flex';
    emptyEl.style.display = 'none';

    titleInput.value = conv.title || '';
    tagsInput.value = (conv.tags || []).join(', ');
    contentInput.value = conv.content || '';
    sourceInfoEl.textContent = sourceLabel(conv);

    renderLinkedDocuments(conv);
    rebuildLinkSelect(conv);

    renderList();
  }

  function currentDraft() {
    return {
      id: currentConvId,
      title: titleInput.value.trim(),
      tags: parseTags(tagsInput.value),
      content: contentInput.value,
    };
  }

  document.getElementById('btn-new-conv').addEventListener('click', () => {
    currentConvId = null;
    editorEl.style.display = 'flex';
    emptyEl.style.display = 'none';
    titleInput.value = '';
    tagsInput.value = '';
    contentInput.value = '';
    sourceInfoEl.textContent = '';
    renderLinkedDocuments(null);
    rebuildLinkSelect(null);
    renderList();
    titleInput.focus();
  });

  document.getElementById('btn-capture-conv').addEventListener('click', async () => {
    const result = await window.workspaceAPI.captureCurrentConversationDraft();
    if (!result || !result.ok) {
      const debug = result && result.debug;
      const detail =
        debug && typeof debug.matchedNodeCount === 'number'
          ? window.i18n.t('conversations.captureFailDetail', {
              matched: debug.matchedNodeCount,
              nonEmpty: debug.nonEmptyMessageCount,
            })
          : '';
      alert(`${window.i18n.t('conversations.captureFail')}${detail ? '\n\n' + detail : ''}`);
      return;
    }
    currentConvId = null;
    editorEl.style.display = 'flex';
    emptyEl.style.display = 'none';
    titleInput.value = result.title || '';
    tagsInput.value = result.sourcePlatform ? result.sourcePlatform : '';
    contentInput.value = result.content || '';
    sourceInfoEl.textContent = result.sourcePlatform
      ? window.i18n.t('conversations.sourceFrom', {
          platform: PLATFORM_LABELS[result.sourcePlatform] || result.sourcePlatform,
        })
      : '';
    sourceInfoEl.dataset.sourceAccountId = result.sourceAccountId || '';
    sourceInfoEl.dataset.sourcePlatform = result.sourcePlatform || '';
    renderLinkedDocuments(null);
    rebuildLinkSelect(null);
    renderList();
  });

  // 匯入現成的 .md 檔案（例如之前用其他工具匯出的對話紀錄），直接變成
  // 新的對話庫項目，匯入完直接把最後一個開起來，方便馬上檢視/編輯內容
  document.getElementById('btn-import-conv-md').addEventListener('click', async () => {
    const result = await window.workspaceAPI.importConversationMarkdown();
    allConversations = result.conversations;
    rebuildTagOptions();
    if (result.importedIds && result.importedIds.length > 0) {
      selectConversation(result.importedIds[result.importedIds.length - 1]);
    } else {
      renderList();
    }
  });

  document.getElementById('btn-save-conv').addEventListener('click', async () => {
    const draft = currentDraft();
    const isNew = !draft.id;
    if (isNew) {
      draft.sourceAccountId = sourceInfoEl.dataset.sourceAccountId || null;
      draft.sourcePlatform = sourceInfoEl.dataset.sourcePlatform || null;
    }
    const previousIds = new Set(allConversations.map((c) => c.id));
    allConversations = await window.workspaceAPI.saveConversation(draft);
    if (isNew) {
      // 剛新增的對話：找出這次回傳結果裡「先前不存在」的那個新 id，接續編輯它
      const created = allConversations.find((c) => !previousIds.has(c.id));
      currentConvId = created ? created.id : null;
    }
    rebuildTagOptions();
    selectConversation(currentConvId);
  });

  document.getElementById('btn-delete-conv').addEventListener('click', async () => {
    if (!currentConvId) return;
    const conv = allConversations.find((c) => c.id === currentConvId);
    const ok = window.confirm(
      window.i18n.t('conversations.deleteConfirm', { title: conv ? conv.title : '' })
    );
    if (!ok) return;
    allConversations = await window.workspaceAPI.deleteConversation(currentConvId);
    currentConvId = null;
    editorEl.style.display = 'none';
    emptyEl.style.display = 'flex';
    rebuildTagOptions();
    renderList();
  });

  document.getElementById('btn-export-conv').addEventListener('click', async () => {
    if (!currentConvId) {
      alert(window.i18n.t('conversations.saveBeforeExport'));
      return;
    }
    const format = window.confirm(
      `${window.i18n.t('export.choosingFormat')}\n\nOK = ${window.i18n.t('export.markdown')}  /  Cancel = ${window.i18n.t('export.json')}`
    )
      ? 'md'
      : 'json';
    const result = await window.workspaceAPI.exportConversation(currentConvId, format);
    if (result.ok) {
      alert(window.i18n.t('export.success', { path: result.filePath }));
      allDocuments = await window.workspaceAPI.listDocuments();
      allConversations = await window.workspaceAPI.listConversations();
      rebuildTagOptions();
      selectConversation(currentConvId);
    } else if (result.error !== 'CANCELLED') {
      alert(`${window.i18n.t('export.fail')}: ${result.error || ''}`);
    }
  });

  document.getElementById('btn-link-doc').addEventListener('click', async () => {
    if (!currentConvId || !linkSelectEl.value) return;
    allConversations = await window.workspaceAPI.linkConversationDocument(
      currentConvId,
      linkSelectEl.value
    );
    rebuildTagOptions();
    renderList();
    selectConversation(currentConvId);
  });

  window.workspaceAPI.onConversationsChanged(async () => {
    allConversations = await window.workspaceAPI.listConversations();
    rebuildTagOptions();
    renderList();
  });

  window.workspaceAPI.onDocumentsChanged(async () => {
    allDocuments = await window.workspaceAPI.listDocuments();
    if (currentConvId) selectConversation(currentConvId);
  });

  (async () => {
    await window.i18n.init();
    [allConversations, allDocuments] = await Promise.all([
      window.workspaceAPI.listConversations(),
      window.workspaceAPI.listDocuments(),
    ]);
    rebuildTagOptions();
    renderList();
  })();
})();
