/**
 * renderer/project/project-openspec.js — OpenSpec 整合
 *
 * 專案視窗（project.html）的一部分。這些檔案是「一般 <script>」，彼此共用全域詞法作用域
 * （頂層的 const／let／function 互相看得到），載入順序見 project.html，project-main.js 必須最後載入。
 */
/* global adoptProjects, currentProjectId, editorEl, refreshComposedPrompt, renderTemplateList, renderWorkflow, templatePickerEl */
/* exported ospChangeIdEdited, refreshOpenSpecInfo, wfOspChangeIdEl, wfOspEl, wfOspResultEl */

// ---------------------------------------------------------------------
// OpenSpec 整合（範本步驟帶匯出檔案／既有規格旗標時才顯示，見 lib/openspec.js）
//   · 匯入專案現有的 openspec/specs，讓差異規格與封存預演的提示詞帶入既有需求
//   · 把各步驟的產出匯出成 <專案資料夾>/openspec/changes/<變更名稱>/…
// 檔案怎麼拆、路徑怎麼檢查都在主行程；這裡只顯示預覽與呼叫。
// ---------------------------------------------------------------------
let ospChangeIdEdited = false; // 使用者手動改過變更名稱後，就不再被建議值覆蓋
const wfOspEl = document.getElementById('wf-openspec');
const wfOspBaseStatusEl = document.getElementById('wf-osp-base-status');
const wfOspChangeIdEl = document.getElementById('wf-osp-change-id');
const wfOspFilesEl = document.getElementById('wf-osp-files');
const wfOspResultEl = document.getElementById('wf-osp-result');
const wfOspClearBtn = document.getElementById('btn-osp-clear');

function ospMessage(text, kind) {
  wfOspResultEl.textContent = text;
  wfOspResultEl.className = kind || '';
}

async function refreshOpenSpecInfo() {
  const info = await window.workspaceAPI.getOpenSpecInfo(currentProjectId);
  if (!info || !info.available) {
    wfOspEl.style.display = 'none';
    return;
  }
  wfOspEl.style.display = 'flex';

  if (info.baseContext) {
    let text = window.i18n.t('project.ospBaseStatus', {
      count: info.baseContext.capabilityCount,
      chars: info.baseContext.chars,
      source: info.baseContext.source,
    });
    if (info.baseContext.truncated.length > 0) {
      text +=
        ' · ' +
        window.i18n.t('project.ospBaseTruncated', {
          names: info.baseContext.truncated.join(', '),
        });
    }
    wfOspBaseStatusEl.textContent = text;
  } else {
    wfOspBaseStatusEl.textContent = window.i18n.t('project.ospBaseNone');
  }
  wfOspClearBtn.disabled = !info.baseContext;

  // 變更名稱：使用者沒手動改過時，跟著建議值（AI 在提案產出裡建議的名稱，或由主題轉出）
  if (!ospChangeIdEdited) wfOspChangeIdEl.value = info.changeId;

  wfOspFilesEl.innerHTML = '';
  const addLine = (text, cls) => {
    const div = document.createElement('div');
    div.textContent = text;
    if (cls) div.className = cls;
    wfOspFilesEl.appendChild(div);
  };
  if (info.files.length === 0) {
    addLine(window.i18n.t('project.ospFilesNone'));
  } else {
    addLine(
      window.i18n.t('project.ospFilesTitle', {
        id: wfOspChangeIdEl.value || info.changeId,
      })
    );
    info.files.forEach((f) => addLine(`  ${f.path}`));
  }
  if (info.files.length > 0 && info.skipped.length > 0) {
    addLine(
      window.i18n.t('project.ospSkipped', {
        titles: info.skipped.map((x) => x.title).join(', '),
      })
    );
  }
  info.warnings.forEach((w) =>
    addLine(
      window.i18n.t('project.ospWarnNoMarker', { title: w.title, path: w.path }),
      'osp-warn'
    )
  );
  if (info.rejected.length > 0) {
    addLine(
      window.i18n.t('project.ospRejected', { n: info.rejected.length }),
      'osp-warn'
    );
  }
}

wfOspChangeIdEl.addEventListener('input', () => {
  ospChangeIdEdited = true;
  refreshOpenSpecInfo();
});

document.getElementById('btn-osp-import').addEventListener('click', async () => {
  const res = await window.workspaceAPI.importOpenSpecSpecs(currentProjectId);
  if (res && res.ok) {
    adoptProjects(res.projects);
    ospMessage(
      window.i18n.t('project.ospImported', { count: res.capabilityCount }),
      'ok'
    );
    refreshComposedPrompt();
  } else if (res && res.error === 'no-specs-dir') {
    ospMessage(window.i18n.t('project.ospErrNoSpecsDir'), 'error');
  } else if (res && res.error === 'no-specs') {
    ospMessage(window.i18n.t('project.ospErrNoSpecs'), 'error');
  }
  // 'canceled'：使用者按取消，不用提示
  refreshOpenSpecInfo();
});

wfOspClearBtn.addEventListener('click', async () => {
  adoptProjects(await window.workspaceAPI.clearOpenSpecBaseContext(currentProjectId));
  ospMessage('');
  refreshComposedPrompt();
  refreshOpenSpecInfo();
});

document.getElementById('btn-osp-export').addEventListener('click', async () => {
  const res = await window.workspaceAPI.exportOpenSpec(
    currentProjectId,
    wfOspChangeIdEl.value.trim()
  );
  if (res && res.ok) {
    ospMessage(
      window.i18n.t('project.ospExported', { count: res.files.length, dir: res.dir }),
      'ok'
    );
  } else if (res && res.error === 'invalid-change-id') {
    ospMessage(window.i18n.t('project.ospErrChangeId'), 'error');
  } else if (res && res.error === 'nothing-to-export') {
    ospMessage(window.i18n.t('project.ospErrNothing'), 'error');
  }
  // 'canceled'：使用者按取消，不用提示
});

// 切換語言時，動態產生的內容也要跟著換
document.addEventListener('i18n:updated', () => {
  if (templatePickerEl.style.display !== 'none') renderTemplateList();
  if (
    editorEl.style.display !== 'none' &&
    document.getElementById('panel-workflow').classList.contains('active')
  ) {
    renderWorkflow();
  }
});
