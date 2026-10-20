/**
 * renderer/project/project-stage-prompts.js — 階段流程：本階段相關提示詞
 *
 * 專案視窗（project.html）的一部分。這些檔案是「一般 <script>」，彼此共用全域詞法作用域
 * （頂層的 const／let／function 互相看得到），載入順序見 project.html，project-main.js 必須最後載入。
 */
/* global adoptProjects, currentProjectId, currentWorkflow, listEl, wfFlash, wfSelectedStepId */
/* exported renderStagePrompts */

// 本階段相關提示詞（workflow.stagePrompts）：不是步驟、不產生任務，
// 純粹是這個階段做事時可以隨時複製來用的輔助提示詞。
// 1.41.0 起可以新增（從知識庫挑或自訂）、編輯、移除，以及「從知識庫重新整理」；
// 所有修改只影響這個專案的快照。
let spEditingId = null; // null | 'new' | 某個階段提示詞的 id
let spRefresh = null; // null | { changes, missing }（「從知識庫重新整理」的比對結果）
let spContextKey = '';
let spKnowledgeItems = null;

function currentStep() {
  const wf = currentWorkflow();
  return wf ? wf.steps.find((s) => s.id === wfSelectedStepId) : null;
}

function refreshStagePrompts() {
  const wf = currentWorkflow();
  const step = currentStep();
  if (wf && step) renderStagePrompts(wf, step);
}

function spButton(label, onClick, className) {
  const btn = document.createElement('button');
  btn.textContent = label;
  if (className) btn.className = className;
  btn.addEventListener('click', onClick);
  return btn;
}

function spEditorForm(stage, existing) {
  const t = window.i18n.t;
  const form = document.createElement('div');
  form.className = 'wf-sp-form';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.placeholder = t('project.spTitleLabel');
  titleInput.value = existing ? existing.title : '';
  const promptInput = document.createElement('textarea');
  promptInput.placeholder = t('project.spPromptLabel');
  promptInput.value = existing ? existing.prompt : '';
  const actions = document.createElement('div');
  actions.className = 'wf-sp-actions';
  actions.appendChild(
    spButton(t('project.spSave'), async () => {
      if (!promptInput.value.trim()) {
        alert(t('project.spNeedPrompt'));
        return;
      }
      const list = existing
        ? await window.workspaceAPI.updateWorkflowStagePrompt(
            currentProjectId,
            existing.id,
            { title: titleInput.value, prompt: promptInput.value }
          )
        : await window.workspaceAPI.addWorkflowStagePrompt(currentProjectId, {
            stage,
            title: titleInput.value,
            prompt: promptInput.value,
          });
      spEditingId = null;
      adoptProjects(list);
      refreshStagePrompts();
    })
  );
  actions.appendChild(
    spButton(t('project.spCancel'), () => {
      spEditingId = null;
      refreshStagePrompts();
    })
  );
  form.appendChild(titleInput);
  form.appendChild(promptInput);
  form.appendChild(actions);
  return form;
}

async function spKnowledgePicker(stage) {
  const t = window.i18n.t;
  if (!spKnowledgeItems) {
    const kb = await window.workspaceAPI.listKnowledge();
    spKnowledgeItems = (kb && kb.items) || [];
  }
  const row = document.createElement('div');
  row.className = 'wf-sp-actions';
  const select = document.createElement('select');
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = t('project.spKbPlaceholder');
  select.appendChild(placeholder);
  spKnowledgeItems.forEach((it) => {
    const opt = document.createElement('option');
    opt.value = it.id;
    opt.textContent = it.title || it.id;
    select.appendChild(opt);
  });
  row.appendChild(select);
  row.appendChild(
    spButton(t('project.spAddBtn'), async () => {
      if (!select.value) return;
      adoptProjects(
        await window.workspaceAPI.addWorkflowStagePrompt(currentProjectId, {
          stage,
          sourceItemId: select.value,
        })
      );
      spEditingId = null;
      refreshStagePrompts();
    })
  );
  row.appendChild(
    spButton(t('project.spCancel'), () => {
      spEditingId = null;
      refreshStagePrompts();
    })
  );
  return row;
}

function spRefreshPanel() {
  const t = window.i18n.t;
  const panel = document.createElement('div');
  panel.className = 'wf-sp-refresh';
  if (spRefresh.changes.length === 0) {
    const none = document.createElement('div');
    none.textContent = t('project.spRefreshNoChange');
    panel.appendChild(none);
  }
  const checks = [];
  spRefresh.changes.forEach((c) => {
    const box = document.createElement('div');
    box.className = 'wf-sp-change';
    const head = document.createElement('label');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = true;
    checks.push({ id: c.id, check });
    head.appendChild(check);
    head.appendChild(
      document.createTextNode(` ${c.stage ? c.stage + ' · ' : ''}${c.currentTitle}`)
    );
    box.appendChild(head);
    [
      [t('project.spRefreshCurrent'), c.currentPrompt],
      [t('project.spRefreshSource'), c.sourcePrompt],
    ].forEach(([label, text]) => {
      const caption = document.createElement('div');
      caption.className = 'wf-sp-caption';
      caption.textContent = label;
      const area = document.createElement('textarea');
      area.readOnly = true;
      area.value = text;
      box.appendChild(caption);
      box.appendChild(area);
    });
    panel.appendChild(box);
  });
  if (spRefresh.missing.length) {
    const miss = document.createElement('div');
    miss.className = 'wf-sp-caption';
    miss.textContent = t('project.spRefreshMissing', { n: spRefresh.missing.length });
    panel.appendChild(miss);
  }
  const actions = document.createElement('div');
  actions.className = 'wf-sp-actions';
  if (spRefresh.changes.length) {
    actions.appendChild(
      spButton(t('project.spRefreshApply'), async () => {
        const ids = checks.filter((x) => x.check.checked).map((x) => x.id);
        spRefresh = null;
        adoptProjects(
          await window.workspaceAPI.applyWorkflowStagePromptUpdates(
            currentProjectId,
            ids
          )
        );
        refreshStagePrompts();
        wfFlash(t('project.spRefreshApplied', { n: ids.length }));
      })
    );
  }
  actions.appendChild(
    spButton(t('project.spCancel'), () => {
      spRefresh = null;
      refreshStagePrompts();
    })
  );
  panel.appendChild(actions);
  return panel;
}

async function renderStagePrompts(wf, step) {
  const t = window.i18n.t;
  const box = document.getElementById('wf-stage-prompts-box');
  const listEl = document.getElementById('wf-stage-prompts');
  const toolsEl = document.getElementById('wf-stage-prompts-tools');
  const stage = step.stage || '';
  // 換專案或換階段時，收起編輯中的表單與比對結果
  const contextKey = `${currentProjectId}::${stage}`;
  if (contextKey !== spContextKey) {
    spContextKey = contextKey;
    spEditingId = null;
    spRefresh = null;
  }
  const prompts = (wf.stagePrompts || []).filter((p) => (p.stage || '') === stage);
  // 沒有提示詞時也要顯示，這樣才能新增
  box.style.display = '';
  document.getElementById('wf-stage-prompts-summary').textContent = t(
    'project.wfStagePrompts',
    { n: prompts.length }
  );
  listEl.innerHTML = '';
  if (!prompts.length) {
    const empty = document.createElement('div');
    empty.className = 'wf-sp-caption';
    empty.textContent = t('project.spEmpty');
    listEl.appendChild(empty);
  }
  prompts.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'wf-stage-prompt-row';
    const title = document.createElement('span');
    title.className = 'wf-stage-prompt-title';
    title.textContent = p.title;
    title.title = p.prompt;
    const tag = document.createElement('span');
    tag.className = 'wf-sp-tag';
    tag.textContent =
      p.sourceItemId || p.sourceDefaultId
        ? t('project.spSourceTag')
        : t('project.spCustomTag');
    const btn = spButton(t('project.wfCopy'), async () => {
      await navigator.clipboard.writeText(p.prompt);
      btn.textContent = t('project.wfCopied');
      setTimeout(() => {
        btn.textContent = t('project.wfCopy');
      }, 1500);
    });
    row.appendChild(title);
    row.appendChild(tag);
    row.appendChild(btn);
    row.appendChild(
      spButton(t('project.spEdit'), () => {
        spEditingId = p.id;
        spRefresh = null;
        refreshStagePrompts();
      })
    );
    row.appendChild(
      spButton(
        t('project.spRemove'),
        async () => {
          if (!window.confirm(t('project.spRemoveConfirm', { title: p.title }))) return;
          adoptProjects(
            await window.workspaceAPI.removeWorkflowStagePrompt(currentProjectId, p.id)
          );
          refreshStagePrompts();
        },
        'danger-text'
      )
    );
    listEl.appendChild(row);
    if (spEditingId === p.id) listEl.appendChild(spEditorForm(stage, p));
  });

  toolsEl.innerHTML = '';
  if (spEditingId === 'new') {
    toolsEl.appendChild(spEditorForm(stage, null));
  } else if (spEditingId === 'kb') {
    toolsEl.appendChild(await spKnowledgePicker(stage));
  } else if (spRefresh) {
    toolsEl.appendChild(spRefreshPanel());
  } else {
    const actions = document.createElement('div');
    actions.className = 'wf-sp-actions';
    actions.appendChild(
      spButton(t('project.spAddFromKb'), () => {
        spEditingId = 'kb';
        refreshStagePrompts();
      })
    );
    actions.appendChild(
      spButton(t('project.spAddCustom'), () => {
        spEditingId = 'new';
        refreshStagePrompts();
      })
    );
    actions.appendChild(
      spButton(t('project.spRefresh'), async () => {
        spRefresh = await window.workspaceAPI.checkWorkflowStagePromptUpdates(
          currentProjectId
        );
        refreshStagePrompts();
      })
    );
    toolsEl.appendChild(actions);
  }
}
