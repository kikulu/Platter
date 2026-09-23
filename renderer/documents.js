(function () {
  const PLATFORM_LABELS = {
    claude: 'Claude',
    chatgpt: 'ChatGPT',
    gemini: 'Gemini',
    grok: 'Grok',
  };

  const ICONS = {
    md: '📝', markdown: '📝',
    json: '🗂',
    pdf: '📕',
    png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', webp: '🖼', svg: '🖼',
    js: '💻', ts: '💻', py: '💻', html: '💻', css: '💻', jsx: '💻', tsx: '💻',
    txt: '📄',
  };

  const listEl = document.getElementById('doc-list');
  const emptyEl = document.getElementById('doc-empty');
  const editorEl = document.getElementById('doc-editor');
  const tagFilterEl = document.getElementById('doc-tag-filter');
  const missingBanner = document.getElementById('doc-missing-banner');

  const nameInput = document.getElementById('doc-name');
  const tagsInput = document.getElementById('doc-tags');
  const notesInput = document.getElementById('doc-notes');

  const infoOriginal = document.getElementById('doc-info-original');
  const infoSource = document.getElementById('doc-info-source');
  const infoSize = document.getElementById('doc-info-size');
  const infoCreated = document.getElementById('doc-info-created');
  const infoPath = document.getElementById('doc-info-path');

  let allDocs = [];
  let allAccounts = [];
  let currentDocId = null;

  function extOf(name) {
    const m = /\.([a-zA-Z0-9]+)$/.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  function iconFor(name) {
    return ICONS[extOf(name)] || '📎';
  }

  function formatSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function sourceLabel(doc) {
    if (!doc.sourceAccountId) return window.i18n.t('documents.manualImport');
    const acc = allAccounts.find((a) => a.id === doc.sourceAccountId);
    const platformName = PLATFORM_LABELS[doc.sourcePlatform] || doc.sourcePlatform || '';
    return acc ? `${platformName} · ${acc.name}` : platformName || window.i18n.t('documents.manualImport');
  }

  function parseTags(str) {
    return str.split(',').map((s) => s.trim()).filter(Boolean);
  }

  function rebuildTagOptions() {
    const tagSet = new Set();
    allDocs.forEach((d) => (d.tags || []).forEach((t) => tagSet.add(t)));
    const currentValue = tagFilterEl.value;
    tagFilterEl.innerHTML = `<option value="">${window.i18n.t('knowledge.filterAll')}</option>`;
    Array.from(tagSet).sort().forEach((tag) => {
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
    const filtered = filterTag ? allDocs.filter((d) => (d.tags || []).includes(filterTag)) : allDocs;

    listEl.innerHTML = '';
    filtered
      .slice()
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .forEach((doc) => {
        const item = document.createElement('div');
        item.className = 'doc-item' + (doc.id === currentDocId ? ' active' : '');

        const icon = document.createElement('div');
        icon.className = 'doc-icon';
        icon.textContent = iconFor(doc.name);

        const meta = document.createElement('div');
        meta.className = 'doc-item-meta';
        const name = document.createElement('div');
        name.className = 'doc-item-name';
        name.textContent = doc.name;
        const sub = document.createElement('div');
        sub.className = 'doc-item-sub';
        sub.textContent = [sourceLabel(doc), formatSize(doc.size)].filter(Boolean).join(' · ');
        meta.appendChild(name);
        meta.appendChild(sub);
        if (doc.missing) {
          const flag = document.createElement('div');
          flag.className = 'doc-missing-flag';
          flag.textContent = window.i18n.t('documents.missingFlag');
          meta.appendChild(flag);
        }

        item.appendChild(icon);
        item.appendChild(meta);
        item.addEventListener('click', () => selectDoc(doc.id));
        listEl.appendChild(item);
      });
  }

  function selectDoc(id) {
    currentDocId = id;
    const doc = allDocs.find((d) => d.id === id);
    if (!doc) {
      editorEl.style.display = 'none';
      emptyEl.style.display = 'flex';
      return;
    }
    editorEl.style.display = 'flex';
    emptyEl.style.display = 'none';

    nameInput.value = doc.name || '';
    tagsInput.value = (doc.tags || []).join(', ');
    notesInput.value = doc.notes || '';

    infoOriginal.textContent = doc.originalName || doc.name || '';
    infoSource.textContent = sourceLabel(doc);
    infoSize.textContent = formatSize(doc.size);
    infoCreated.textContent = doc.createdAt ? new Date(doc.createdAt).toLocaleString() : '';
    infoPath.textContent = doc.filePath || '';
    infoPath.title = doc.filePath || '';

    missingBanner.style.display = doc.missing ? 'block' : 'none';

    renderList();
  }

  document.getElementById('btn-import-doc').addEventListener('click', async () => {
    allDocs = await window.workspaceAPI.importDocuments();
    rebuildTagOptions();
    renderList();
  });

  document.getElementById('btn-save-doc').addEventListener('click', async () => {
    if (!currentDocId) return;
    allDocs = await window.workspaceAPI.saveDocument(
      currentDocId,
      nameInput.value.trim() || infoOriginal.textContent,
      parseTags(tagsInput.value),
      notesInput.value
    );
    rebuildTagOptions();
    renderList();
  });

  document.getElementById('btn-delete-doc').addEventListener('click', async () => {
    if (!currentDocId) return;
    const doc = allDocs.find((d) => d.id === currentDocId);
    const ok = window.confirm(window.i18n.t('documents.deleteConfirm', { name: doc ? doc.name : '' }));
    if (!ok) return;

    let alsoDeleteFile = false;
    if (doc && doc.managed) {
      alsoDeleteFile = window.confirm(window.i18n.t('documents.deleteFileConfirm'));
    }

    allDocs = await window.workspaceAPI.deleteDocument(currentDocId, alsoDeleteFile);
    currentDocId = null;
    editorEl.style.display = 'none';
    emptyEl.style.display = 'flex';
    rebuildTagOptions();
    renderList();
  });

  document.getElementById('btn-open-file').addEventListener('click', async () => {
    if (!currentDocId) return;
    const result = await window.workspaceAPI.openDocumentFile(currentDocId);
    if (!result.ok) alert(window.i18n.t('documents.missingFlag'));
  });

  document.getElementById('btn-show-in-folder').addEventListener('click', async () => {
    if (!currentDocId) return;
    const result = await window.workspaceAPI.showDocumentInFolder(currentDocId);
    if (!result.ok) alert(window.i18n.t('documents.missingFlag'));
  });

  window.workspaceAPI.onDocumentsChanged(async () => {
    allDocs = await window.workspaceAPI.listDocuments();
    rebuildTagOptions();
    renderList();
  });

  (async () => {
    await window.i18n.init();
    [allDocs, allAccounts] = await Promise.all([
      window.workspaceAPI.listDocuments(),
      window.workspaceAPI.listAccounts(),
    ]);
    rebuildTagOptions();
    renderList();
  })();
})();
