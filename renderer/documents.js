(function () {
  const PLATFORM_LABELS = {
    claude: 'Claude',
    chatgpt: 'ChatGPT',
    gemini: 'Gemini',
    grok: 'Grok',
  };

  const ICONS = {
    md: '📝',
    markdown: '📝',
    json: '🗂',
    pdf: '📕',
    png: '🖼',
    jpg: '🖼',
    jpeg: '🖼',
    gif: '🖼',
    webp: '🖼',
    svg: '🖼',
    js: '💻',
    ts: '💻',
    py: '💻',
    html: '💻',
    css: '💻',
    jsx: '💻',
    tsx: '💻',
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
  const previewBtn = document.getElementById('btn-preview-md');
  const previewBox = document.getElementById('doc-preview-box');
  const previewContent = document.getElementById('doc-preview-content');
  const complexWarning = document.getElementById('doc-complex-warning');

  const docxToolbar = document.getElementById('doc-docx-toolbar');
  const docxEditToggleBtn = document.getElementById('btn-docx-edit-toggle');
  const docxFormatButtons = document.getElementById('doc-docx-format-buttons');
  const docxSaveBtn = document.getElementById('btn-docx-save');

  const pdfToolbar = document.getElementById('doc-pdf-toolbar');
  const pdfCanvas = document.getElementById('doc-pdf-canvas');
  const pdfPageIndicator = document.getElementById('pdf-page-indicator');
  const pdfZoomIndicator = document.getElementById('pdf-zoom-indicator');

  let allDocs = [];
  let allAccounts = [];
  let currentDocId = null;
  let previewOpen = false; // 目前這個文件是否正在顯示預覽（md/docx/pdf 共用這個開關）

  const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);
  const DOCX_EXTENSIONS = new Set(['docx']);
  const PDF_EXTENSIONS = new Set(['pdf']);

  // --- PDF 檢視狀態（見 openPdfPreview()／renderPdfPage()） ---
  let pdfjsLibPromise = null;
  let pdfDocProxy = null; // pdfjs-dist 的 PDFDocumentProxy
  let pdfCurrentPage = 1;
  let pdfScale = 1.2;

  // --- .docx 編輯狀態（見 openDocxPreview()／setDocxEditing()） ---
  let docxEditing = false;
  let docxHasComplexContent = false;

  function docTypeOf(name) {
    const ext = extOf(name);
    if (MARKDOWN_EXTENSIONS.has(ext)) return 'md';
    if (DOCX_EXTENSIONS.has(ext)) return 'docx';
    if (PDF_EXTENSIONS.has(ext)) return 'pdf';
    return null;
  }

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
    return acc
      ? `${platformName} · ${acc.name}`
      : platformName || window.i18n.t('documents.manualImport');
  }

  function parseTags(str) {
    return str
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function rebuildTagOptions() {
    const tagSet = new Set();
    allDocs.forEach((d) => (d.tags || []).forEach((t) => tagSet.add(t)));
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
      ? allDocs.filter((d) => (d.tags || []).includes(filterTag))
      : allDocs;

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
        sub.textContent = [sourceLabel(doc), formatSize(doc.size)]
          .filter(Boolean)
          .join(' · ');
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
    infoCreated.textContent = doc.createdAt
      ? new Date(doc.createdAt).toLocaleString()
      : '';
    infoPath.textContent = doc.filePath || '';
    infoPath.title = doc.filePath || '';

    missingBanner.style.display = doc.missing ? 'block' : 'none';

    // 切換文件時一律收起舊的預覽（不同文件的內容不該沿用），依副檔名
    // 決定「預覽」按鈕要不要顯示、顯示什麼文字；pdf 檢視狀態跟 docx
    // 編輯狀態也要整個重置，不然會殘留上一份文件的頁碼/縮放/編輯模式。
    previewOpen = false;
    previewBox.style.display = 'none';
    previewBox.classList.remove('pdf-mode');
    previewContent.innerHTML = '';
    previewContent.contentEditable = 'false';
    complexWarning.style.display = 'none';
    docxToolbar.style.display = 'none';
    docxFormatButtons.style.display = 'none';
    pdfToolbar.style.display = 'none';
    pdfCanvas.style.display = 'none';
    docxEditing = false;
    docxHasComplexContent = false;
    pdfDocProxy = null;
    pdfCurrentPage = 1;

    const type = docTypeOf(doc.name);
    const previewLabelKey = {
      md: 'documents.previewMarkdown',
      docx: 'documents.docxPreview',
      pdf: 'documents.pdfPreview',
    }[type];
    previewBtn.style.display = !doc.missing && previewLabelKey ? '' : 'none';
    if (previewLabelKey) previewBtn.textContent = window.i18n.t(previewLabelKey);

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
    const ok = window.confirm(
      window.i18n.t('documents.deleteConfirm', { name: doc ? doc.name : '' })
    );
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

  // 預覽／編輯：點一下展開、再點一下收起。md 收起時不清掉已經渲染好的
  // 內容（下次展開不用重新讀檔+轉換）；docx/pdf 也一樣保留，直到切換到
  // 別的文件（selectDoc）才整個清空重來，避免顯示到不是目前這份文件的
  // 舊內容。
  //
  // previewContent.innerHTML 是這個 renderer 少數用 innerHTML 插入
  // 動態內容的地方——安全性完全建立在 main process 那端：md 的
  // markdownToHtml()（來源文字先 HTML escape）跟 docx 的
  // sanitizeDocxHtml()（黑名單拿掉危險標籤/屬性），這裡不需要也不應該
  // 再自己做任何字串拼接。
  previewBtn.addEventListener('click', async () => {
    if (!currentDocId) return;
    const doc = allDocs.find((d) => d.id === currentDocId);
    if (!doc) return;
    const type = docTypeOf(doc.name);

    previewOpen = !previewOpen;
    if (!previewOpen) {
      previewBox.style.display = 'none';
      previewBtn.textContent = window.i18n.t(
        {
          md: 'documents.previewMarkdown',
          docx: 'documents.docxPreview',
          pdf: 'documents.pdfPreview',
        }[type]
      );
      return;
    }

    previewBtn.textContent = window.i18n.t('documents.hidePreview');
    previewBox.style.display = 'block';

    if (type === 'md') {
      pdfToolbar.style.display = 'none';
      docxToolbar.style.display = 'none';
      pdfCanvas.style.display = 'none';
      previewContent.style.display = 'block';
      if (!previewContent.innerHTML) {
        previewContent.textContent = window.i18n.t('documents.previewLoading');
        const result = await window.workspaceAPI.getMarkdownPreview(currentDocId);
        if (!previewOpen) return; // 使用者在載入期間已經按了收起，不要再蓋回去
        previewContent.innerHTML = result.ok
          ? result.html
          : window.i18n.t('documents.previewFailed');
      }
    } else if (type === 'docx') {
      await openDocxPreview();
    } else if (type === 'pdf') {
      await openPdfPreview();
    }
  });

  // --- .docx 預覽／編輯 ---

  async function openDocxPreview() {
    pdfToolbar.style.display = 'none';
    pdfCanvas.style.display = 'none';
    previewContent.style.display = 'block';
    docxToolbar.style.display = 'block';
    docxEditToggleBtn.textContent = window.i18n.t('documents.docxEdit');
    docxFormatButtons.style.display = 'none';
    docxEditing = false;
    previewContent.contentEditable = 'false';

    previewContent.textContent = window.i18n.t('documents.previewLoading');
    const result = await window.workspaceAPI.getDocxPreview(currentDocId);
    if (!previewOpen) return; // 載入期間使用者已經按了收起
    if (!result.ok) {
      previewContent.textContent = window.i18n.t('documents.previewFailed');
      return;
    }
    previewContent.innerHTML = result.html;
    docxHasComplexContent = !!result.hasComplexContent;
    complexWarning.style.display = docxHasComplexContent ? 'block' : 'none';
  }

  function setDocxEditing(on) {
    docxEditing = on;
    previewContent.contentEditable = on ? 'true' : 'false';
    docxFormatButtons.style.display = on ? 'inline' : 'none';
    docxEditToggleBtn.textContent = window.i18n.t(
      on ? 'documents.docxEditing' : 'documents.docxEdit'
    );
    if (on) previewContent.focus();
  }

  docxEditToggleBtn.addEventListener('click', async () => {
    if (docxEditing) {
      setDocxEditing(false);
      return;
    }
    if (
      docxHasComplexContent &&
      !window.confirm(window.i18n.t('documents.docxComplexEditConfirm'))
    ) {
      return;
    }
    setDocxEditing(true);
  });

  // Bold/italic/underline/清單/段落／標題都用瀏覽器內建的
  // document.execCommand()——雖然是已標記為 deprecated 的 API，但
  // Chromium／Electron 現在仍然完整支援，這個功能的範疇（輕量文字
  // 格式編輯，不是完整排版工具）用它就足夠，換一套自己刻的 contenteditable
  // 指令系統不會有明顯的品質提升，但會多花很多力氣。
  docxFormatButtons.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cmd]');
    if (!btn) return;
    previewContent.focus();
    const cmd = btn.dataset.cmd;
    if (cmd === 'bold' || cmd === 'italic' || cmd === 'underline') {
      document.execCommand(cmd);
    } else if (cmd === 'ul') {
      document.execCommand('insertUnorderedList');
    } else if (cmd === 'ol') {
      document.execCommand('insertOrderedList');
    } else if (cmd === 'h1') {
      document.execCommand('formatBlock', false, '<H1>');
    } else if (cmd === 'h2') {
      document.execCommand('formatBlock', false, '<H2>');
    } else if (cmd === 'p') {
      document.execCommand('formatBlock', false, '<P>');
    }
  });

  docxSaveBtn.addEventListener('click', async () => {
    if (!currentDocId) return;
    if (
      docxHasComplexContent &&
      !window.confirm(window.i18n.t('documents.docxComplexSaveConfirm'))
    ) {
      return;
    }
    const result = await window.workspaceAPI.saveDocxEdit(
      currentDocId,
      previewContent.innerHTML
    );
    if (!result.ok) {
      alert(window.i18n.t('documents.docxSaveFailed'));
      return;
    }
    allDocs = result.docs;
    setDocxEditing(false);
    renderList();
  });

  // --- .pdf 檢視／編輯 ---
  // pdfjs-dist 是 ES module（見 renderer/vendor/pdfjs/），用動態 import()
  // 載入，這樣 documents.js 本身不用整份改成 <script type="module">。
  // worker 沒有另外指定路徑就會用 fake worker（主執行緒跑），這個功能
  // 是給使用者自己的文件用、不是要處理超大量 PDF，犧牲一點效能換來
  // 不用處理額外的 CSP／打包路徑問題是值得的。
  function loadPdfjs() {
    if (!pdfjsLibPromise) {
      pdfjsLibPromise = import('./vendor/pdfjs/pdf.min.mjs').then((mod) => {
        mod.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.mjs';
        return mod;
      });
    }
    return pdfjsLibPromise;
  }

  async function openPdfPreview() {
    docxToolbar.style.display = 'none';
    docxFormatButtons.style.display = 'none';
    previewContent.style.display = 'none';
    pdfToolbar.style.display = 'flex';
    pdfCanvas.style.display = 'block';
    previewBox.classList.add('pdf-mode');
    pdfPageIndicator.textContent = window.i18n.t('documents.previewLoading');

    const result = await window.workspaceAPI.getPdfBytes(currentDocId);
    if (!previewOpen) return;
    if (!result.ok) {
      pdfPageIndicator.textContent = window.i18n.t('documents.previewFailed');
      return;
    }
    const pdfjsLib = await loadPdfjs();
    pdfDocProxy = await pdfjsLib.getDocument({ data: result.data }).promise;
    pdfCurrentPage = 1;
    await renderPdfPage();
  }

  async function renderPdfPage() {
    if (!pdfDocProxy) return;
    const page = await pdfDocProxy.getPage(pdfCurrentPage);
    const viewport = page.getViewport({ scale: pdfScale });
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    const ctx = pdfCanvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    pdfPageIndicator.textContent = window.i18n.t('documents.pdfPageIndicator', {
      current: pdfCurrentPage,
      total: pdfDocProxy.numPages,
    });
    pdfZoomIndicator.textContent = `${Math.round(pdfScale * 100)}%`;
  }

  // PDF 編輯操作共用的收尾：main process 已經改完檔案，重新整份文件的
  // bytes 抓回來、pdfjs 重新載入、畫面停在原來那一頁（除非那一頁已經
  // 被刪掉，這時退回上一頁），這樣才會反映出剛剛的編輯結果。
  async function reloadPdfAfterEdit(keepPage) {
    const result = await window.workspaceAPI.getPdfBytes(currentDocId);
    if (!result.ok) return;
    const pdfjsLib = await loadPdfjs();
    pdfDocProxy = await pdfjsLib.getDocument({ data: result.data }).promise;
    pdfCurrentPage = Math.min(keepPage, pdfDocProxy.numPages);
    await renderPdfPage();
    allDocs = await window.workspaceAPI.listDocuments();
    renderList();
  }

  document.getElementById('pdf-prev').addEventListener('click', async () => {
    if (!pdfDocProxy || pdfCurrentPage <= 1) return;
    pdfCurrentPage -= 1;
    await renderPdfPage();
  });
  document.getElementById('pdf-next').addEventListener('click', async () => {
    if (!pdfDocProxy || pdfCurrentPage >= pdfDocProxy.numPages) return;
    pdfCurrentPage += 1;
    await renderPdfPage();
  });
  document.getElementById('pdf-zoom-out').addEventListener('click', async () => {
    if (!pdfDocProxy) return;
    pdfScale = Math.max(0.4, pdfScale - 0.2);
    await renderPdfPage();
  });
  document.getElementById('pdf-zoom-in').addEventListener('click', async () => {
    if (!pdfDocProxy) return;
    pdfScale = Math.min(3, pdfScale + 0.2);
    await renderPdfPage();
  });

  document.getElementById('pdf-rotate-left').addEventListener('click', async () => {
    if (!pdfDocProxy) return;
    const result = await window.workspaceAPI.pdfRotatePage(
      currentDocId,
      pdfCurrentPage - 1,
      -90
    );
    if (!result.ok) return alert(window.i18n.t('documents.pdfEditFailed'));
    await reloadPdfAfterEdit(pdfCurrentPage);
  });
  document.getElementById('pdf-rotate-right').addEventListener('click', async () => {
    if (!pdfDocProxy) return;
    const result = await window.workspaceAPI.pdfRotatePage(
      currentDocId,
      pdfCurrentPage - 1,
      90
    );
    if (!result.ok) return alert(window.i18n.t('documents.pdfEditFailed'));
    await reloadPdfAfterEdit(pdfCurrentPage);
  });

  document.getElementById('pdf-delete-page').addEventListener('click', async () => {
    if (!pdfDocProxy) return;
    if (pdfDocProxy.numPages <= 1) {
      alert(window.i18n.t('documents.pdfDeleteLastPageError'));
      return;
    }
    const ok = window.confirm(
      window.i18n.t('documents.pdfDeletePageConfirm', { page: pdfCurrentPage })
    );
    if (!ok) return;
    const result = await window.workspaceAPI.pdfDeletePage(
      currentDocId,
      pdfCurrentPage - 1
    );
    if (!result.ok) return alert(window.i18n.t('documents.pdfEditFailed'));
    await reloadPdfAfterEdit(pdfCurrentPage);
  });

  document.getElementById('pdf-watermark').addEventListener('click', async () => {
    if (!pdfDocProxy) return;
    const text = window.prompt(window.i18n.t('documents.pdfWatermarkPrompt'), '');
    if (!text || !text.trim()) return;
    const result = await window.workspaceAPI.pdfAddWatermark(currentDocId, text.trim());
    if (!result.ok) return alert(window.i18n.t('documents.pdfEditFailed'));
    await reloadPdfAfterEdit(pdfCurrentPage);
  });

  document.getElementById('pdf-merge').addEventListener('click', async () => {
    if (!pdfDocProxy) return;
    const result = await window.workspaceAPI.pdfMerge(currentDocId);
    if (!result.ok) {
      if (result.error !== 'CANCELED') alert(window.i18n.t('documents.pdfEditFailed'));
      return;
    }
    await reloadPdfAfterEdit(pdfCurrentPage);
  });

  document.getElementById('pdf-extract').addEventListener('click', async () => {
    if (!pdfDocProxy) return;
    const rangeStr = window.prompt(
      window.i18n.t('documents.pdfExtractPrompt', { total: pdfDocProxy.numPages }),
      ''
    );
    if (!rangeStr || !rangeStr.trim()) return;
    const result = await window.workspaceAPI.pdfExtractPages(
      currentDocId,
      rangeStr.trim()
    );
    if (!result.ok) {
      alert(window.i18n.t('documents.pdfExtractInvalidRange'));
      return;
    }
    allDocs = result.docs;
    rebuildTagOptions();
    renderList();
    alert(window.i18n.t('documents.pdfExtractDone'));
  });

  window.workspaceAPI.onDocumentsChanged(async () => {
    allDocs = await window.workspaceAPI.listDocuments();
    rebuildTagOptions();
    renderList();
  });

  // 跨模組快速搜尋（命令面板）跳轉過來時要選中的文件
  window.workspaceAPI.onSearchSelect((payload) => {
    if (payload) selectDoc(payload.id);
  });

  (async () => {
    await window.i18n.init();
    [allDocs, allAccounts] = await Promise.all([
      window.workspaceAPI.listDocuments(),
      window.workspaceAPI.listAccounts(),
    ]);
    rebuildTagOptions();
    renderList();

    const pending = await window.workspaceAPI.consumePendingSelection('documents');
    if (pending) selectDoc(pending.id);
  })();
})();
