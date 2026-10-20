/**
 * renderer/project/project-templates.js — 從範本建立專案
 *
 * 專案視窗（project.html）的一部分。這些檔案是「一般 <script>」，彼此共用全域詞法作用域
 * （頂層的 const／let／function 互相看得到），載入順序見 project.html，project-main.js 必須最後載入。
 */
/* global allProjects, currentProjectId, editorEl, emptyEl, renderList, selectProject, setListToolbarActive, templatePickerEl */
/* exported renderTemplateList, templates */

// ---------------------------------------------------------------------
// 從範本建立專案（選範本 + 輸入專案主題）
//
// 範本清單與展開成專案的邏輯都在主行程（lib/workflow.js、lib/ipc/projects.js），
// 這裡只負責挑選與送出。
// ---------------------------------------------------------------------
let templates = [];
let selectedTemplateId = null;
const tplListEl = document.getElementById('tpl-list');
const tplTopicEl = document.getElementById('tpl-topic');
const tplNameEl = document.getElementById('tpl-name');
const tplErrorEl = document.getElementById('tpl-error');
const tplResultEl = document.getElementById('tpl-import-result');
const tplToastEl = document.getElementById('tpl-toast');
const TPL_IMPORT_MAX_FILES = 50; // 與主行程 IMPORT_FILE_LIMITS.files 一致
const TPL_IMPORT_MAX_BYTES = 10 * 1024 * 1024; // 與主行程 IMPORT_FILE_LIMITS.bytes 一致

function renderTemplateList() {
  tplListEl.innerHTML = '';
  templates.forEach((tpl) => {
    const card = document.createElement('div');
    card.className = 'tpl-card' + (tpl.id === selectedTemplateId ? ' active' : '');

    const head = document.createElement('div');
    head.className = 'tpl-card-head';
    const name = document.createElement('span');
    name.className = 'tpl-card-name';
    name.textContent = tpl.name;
    const badge = document.createElement('span');
    badge.className = 'tpl-badge';
    badge.textContent = window.i18n.t(
      tpl.builtIn ? 'project.tplBuiltIn' : 'project.tplCustom'
    );
    const stepCount = tpl.stages.reduce((n, st) => n + st.steps.length, 0);
    const count = document.createElement('span');
    count.className = 'tpl-badge';
    count.textContent = window.i18n.t('project.tplCount', {
      stages: tpl.stages.length,
      steps: stepCount,
    });
    head.appendChild(name);
    head.appendChild(badge);
    head.appendChild(count);
    const exp = document.createElement('button');
    exp.className = 'step-icon-btn';
    exp.textContent = '↥';
    exp.title = window.i18n.t('project.tplExport');
    exp.addEventListener('click', (e) => {
      e.stopPropagation();
      exportTemplates([tpl.id]);
    });
    head.appendChild(exp);
    if (!tpl.builtIn) {
      const del = document.createElement('button');
      del.className = 'step-icon-btn';
      del.textContent = '✕';
      del.title = window.i18n.t('project.tplDelete');
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (
          !window.confirm(window.i18n.t('project.tplDeleteConfirm', { name: tpl.name }))
        )
          return;
        await window.workspaceAPI.deleteProjectTemplate(tpl.id);
        templates = await window.workspaceAPI.listProjectTemplates();
        if (!templates.some((t) => t.id === selectedTemplateId)) {
          selectedTemplateId = templates.length ? templates[0].id : null;
        }
        renderTemplateList();
      });
      head.appendChild(del);
    }
    card.appendChild(head);

    if (tpl.description) {
      const desc = document.createElement('div');
      desc.className = 'tpl-card-desc';
      desc.textContent = tpl.description;
      card.appendChild(desc);
    }

    const stages = document.createElement('div');
    stages.className = 'tpl-card-stages';
    tpl.stages.forEach((st) => {
      const line = document.createElement('div');
      const stageName = document.createElement('span');
      stageName.className = 'tpl-stage-name';
      stageName.textContent = st.title ? `${st.title}：` : '';
      const stageSteps = document.createElement('span');
      stageSteps.className = 'tpl-stage-steps';
      stageSteps.textContent = st.steps.map((x) => x.title).join(' → ');
      line.appendChild(stageName);
      line.appendChild(stageSteps);
      stages.appendChild(line);
    });
    card.appendChild(stages);

    card.addEventListener('click', () => {
      selectedTemplateId = tpl.id;
      renderTemplateList();
    });
    tplListEl.appendChild(card);
  });
}

async function showTemplatePicker({ keepResult = false } = {}) {
  currentProjectId = null;
  editorEl.style.display = 'none';
  emptyEl.style.display = 'none';
  document.getElementById('proj-overview').style.display = 'none';
  templatePickerEl.style.display = 'flex';
  setListToolbarActive('template');
  tplErrorEl.textContent = '';
  if (!keepResult) tplResultEl.style.display = 'none';
  templates = await window.workspaceAPI.listProjectTemplates();
  if (!templates.some((t) => t.id === selectedTemplateId)) {
    selectedTemplateId = templates.length ? templates[0].id : null;
  }
  renderTemplateList();
  renderList();
  tplTopicEl.focus();
}
document
  .getElementById('btn-new-from-template')
  .addEventListener('click', showTemplatePicker);

// ---------------------------------------------------------------------
// 匯入／匯出專案範本檔（格式見 docs/PROJECT_TEMPLATE_FORMAT.md）
//
// 入口在專案清單層級（左側工具列的「專案範本」區），不必先進「從範本建立」：
//   - 點擊匯入區 → 檔案對話框（可多選）→ 主行程 projectTemplates:import
//   - 把 .json 檔（可多個）拖進視窗 → 這裡讀檔 → 主行程 projectTemplates:importFiles
// 驗證與寫入都在主行程（lib/workflow.js importTemplateFiles）；每個檔案各自驗證、互不影響。
// 結果顯示：在範本選擇頁上方的「匯入結果」面板；人在別的畫面時用 toast，按鈕可跳到範本選擇頁。
// ---------------------------------------------------------------------
const TPL_REASON_KEYS = {
  'invalid-file': 'project.tplReasonInvalid',
  'too-large': 'project.tplReasonTooLarge',
  'no-valid-template': 'project.tplReasonNone',
  'not-json': 'project.tplReasonNotJson',
  'read-failed': 'project.tplReasonRead',
};
const TPL_LONG_ERROR_KEYS = {
  'invalid-file': 'project.tplImportErrInvalid',
  'too-large': 'project.tplImportErrTooLarge',
  'no-valid-template': 'project.tplImportErrNone',
  'not-json': 'project.tplReasonNotJson',
  'read-failed': 'project.tplReasonRead',
};

let tplToastTimer = null;
function showTplToast(text, { error = false, withView = false } = {}) {
  document.getElementById('tpl-toast-text').textContent = text;
  document.getElementById('btn-tpl-toast-view').style.display = withView ? '' : 'none';
  tplToastEl.classList.toggle('error', error);
  tplToastEl.classList.add('show');
  clearTimeout(tplToastTimer);
  tplToastTimer = setTimeout(() => tplToastEl.classList.remove('show'), 9000);
}
document.getElementById('btn-tpl-toast-view').addEventListener('click', () => {
  tplToastEl.classList.remove('show');
  showTemplatePicker();
});

function renderImportResult(res, extra) {
  const t = window.i18n.t;
  const files = (res && res.files) || [];
  document.getElementById('tpl-result-summary').textContent = res.ok
    ? t('project.tplResultSummary', {
        count: res.imported,
        files: files.filter((f) => f.ok).length,
        skipped: res.skipped.length,
      })
    : t('project.tplResultNone');
  const list = document.getElementById('tpl-result-files');
  list.innerHTML = '';
  files.forEach((f) => {
    const li = document.createElement('li');
    li.className = f.ok ? 'ok' : 'fail';
    const mark = document.createElement('span');
    mark.className = 'tpl-file-mark';
    mark.textContent = f.ok ? '✓' : '✕';
    const name = document.createElement('span');
    name.className = 'tpl-file-name';
    name.textContent = f.name;
    const msg = document.createElement('span');
    msg.className = 'tpl-file-msg';
    msg.textContent = f.ok
      ? f.skipped
        ? t('project.tplResultFileOkSkipped', { count: f.imported, skipped: f.skipped })
        : t('project.tplResultFileOk', { count: f.imported })
      : t(TPL_REASON_KEYS[f.error] || 'project.tplReasonInvalid');
    li.append(mark, name, msg);
    list.appendChild(li);
  });
  document.getElementById('tpl-result-extra').textContent = extra
    ? t('project.tplResultTooMany', { max: TPL_IMPORT_MAX_FILES, extra })
    : '';
  tplResultEl.style.display = 'block';
}
document.getElementById('btn-tpl-result-close').addEventListener('click', () => {
  tplResultEl.style.display = 'none';
});

// 套用匯入結果。explicit=true（使用者按了匯入鈕）一律進範本選擇頁；拖拉時只有在範本選擇頁
// 已開著、或目前沒有開任何專案（空白畫面）才切換，避免打斷正在編輯的專案，其餘用 toast 通知。
async function applyImportResult(res, { explicit, extra = 0 }) {
  if (!res || (!res.ok && res.error === 'canceled')) return;
  const pickerOpen = templatePickerEl.style.display !== 'none';
  const idle =
    editorEl.style.display === 'none' &&
    document.getElementById('proj-overview').style.display !== 'flex';
  if (explicit || pickerOpen || idle) {
    await showTemplatePicker({ keepResult: true });
    if (res.ok) {
      selectedTemplateId = res.firstId;
      renderTemplateList();
    }
    renderImportResult(res, extra);
    return;
  }
  if (res.ok) {
    showTplToast(
      window.i18n.t('project.tplResultSummary', {
        count: res.imported,
        files: res.files.filter((f) => f.ok).length,
        skipped: res.skipped.length,
      }),
      { withView: true }
    );
  } else {
    const code = res.files && res.files.length === 1 ? res.error : 'no-valid-template';
    showTplToast(window.i18n.t(TPL_LONG_ERROR_KEYS[code] || 'project.tplImportErrInvalid'), {
      error: true,
    });
  }
}

document.getElementById('btn-tpl-import').addEventListener('click', async () => {
  const res = await window.workspaceAPI.importProjectTemplates();
  await applyImportResult(res, { explicit: true });
});

// 讀取拖進來的檔案（只收 .json、單檔上限與主行程一致；讀不了的帶原因交給主行程一起回報）
async function importDroppedFiles(fileList) {
  const all = Array.from(fileList || []);
  if (all.length === 0) return;
  const picked = all.slice(0, TPL_IMPORT_MAX_FILES);
  const files = await Promise.all(
    picked.map(async (f) => {
      if (!/\.json$/i.test(f.name)) return { name: f.name, error: 'not-json' };
      if (f.size > TPL_IMPORT_MAX_BYTES) return { name: f.name, error: 'too-large' };
      try {
        return { name: f.name, text: await f.text() };
      } catch (err) {
        return { name: f.name, error: 'read-failed' };
      }
    })
  );
  const res = await window.workspaceAPI.importProjectTemplateFiles(files);
  await applyImportResult(res, { explicit: false, extra: all.length - picked.length });
}

// 拖拉：只處理「檔案」的拖曳（拖文字不理它）。一律 preventDefault，
// 否則 Electron 會把視窗導向被放開的檔案。
const tplDropOverlayEl = document.getElementById('tpl-drop-overlay');
let tplDragDepth = 0;
const dragHasFiles = (e) =>
  !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
document.addEventListener('dragenter', (e) => {
  if (!dragHasFiles(e)) return;
  e.preventDefault();
  tplDragDepth += 1;
  tplDropOverlayEl.classList.add('show');
});
document.addEventListener('dragover', (e) => {
  if (!dragHasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', (e) => {
  if (!dragHasFiles(e)) return;
  tplDragDepth = Math.max(0, tplDragDepth - 1);
  if (tplDragDepth === 0) tplDropOverlayEl.classList.remove('show');
});
document.addEventListener('drop', (e) => {
  if (!dragHasFiles(e)) return;
  e.preventDefault();
  tplDragDepth = 0;
  tplDropOverlayEl.classList.remove('show');
  importDroppedFiles(e.dataTransfer.files);
});

// 匯出專案範本檔（1.47.0）：單一範本（卡片上的 ↥，內建或自訂都可）或全部自訂範本，存成可再匯入的 .json
async function exportTemplates(ids) {
  const res = await window.workspaceAPI.exportProjectTemplates(ids);
  if (!res || (!res.ok && res.error === 'canceled')) return;
  if (!res.ok) {
    showTplToast(
      window.i18n.t(
        res.error === 'nothing-to-export'
          ? 'project.tplExportErrNone'
          : 'project.tplExportErrWrite'
      ),
      { error: true }
    );
    return;
  }
  showTplToast(window.i18n.t('project.tplExportDone', { count: res.exported }));
}
document
  .getElementById('btn-tpl-export-all')
  .addEventListener('click', () => exportTemplates(null));

document.getElementById('btn-tpl-cancel').addEventListener('click', () => {
  templatePickerEl.style.display = 'none';
  setListToolbarActive('project');
  emptyEl.style.display = 'flex';
});

document.getElementById('btn-tpl-create').addEventListener('click', async () => {
  const topic = tplTopicEl.value.trim();
  if (!topic) {
    tplErrorEl.textContent = window.i18n.t('project.tplErrTopic');
    tplTopicEl.focus();
    return;
  }
  if (!selectedTemplateId) {
    tplErrorEl.textContent = window.i18n.t('project.tplErrGeneric');
    return;
  }
  tplErrorEl.textContent = '';
  const res = await window.workspaceAPI.createProjectFromTemplate({
    templateId: selectedTemplateId,
    topic,
    name: tplNameEl.value.trim(),
  });
  if (!res || !res.ok) {
    tplErrorEl.textContent = window.i18n.t(
      res && res.error === 'topic-required'
        ? 'project.tplErrTopic'
        : 'project.tplErrGeneric'
    );
    return;
  }
  tplTopicEl.value = '';
  tplNameEl.value = '';
  allProjects = res.projects;
  selectProject(res.projectId, 'workflow');
});
