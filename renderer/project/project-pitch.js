/**
 * renderer/project/project-pitch.js — 簡報橋接
 *
 * 專案視窗（project.html）的一部分。這些檔案是「一般 <script>」，彼此共用全域詞法作用域
 * （頂層的 const／let／function 互相看得到），載入順序見 project.html，project-main.js 必須最後載入。
 */
/* global allKnowledgeItems, currentProject, currentWorkflow, templates */
/* exported renderPitchBridge */

// ---------------------------------------------------------------------
// 簡報橋接：把已完成步驟的產出，套進知識庫「簡報製作」分類底下的範本，
// 組成一份提示詞複製到剪貼簿。最初是為了「AI 短劇製作」範本而做（角色
// 聖經、分集大綱都是很適合直接拿去提案的素材），但不綁定特定範本。
// ---------------------------------------------------------------------
const wfPitchStepsEl = document.getElementById('wf-pitch-steps');
const wfPitchTemplateEl = document.getElementById('wf-pitch-template');
const wfPitchResultEl = document.getElementById('wf-pitch-result');
const wfPitchGenerateBtn = document.getElementById('btn-wf-pitch-generate');

function presentationKnowledgeItems() {
  // 標籤文字跟著介面語言變（內建項目切換語言時會換成對應語言），三種寫法都要認得
  const pitchTags = ['簡報製作', 'Presentation Making', 'プレゼン資料作成'];
  return allKnowledgeItems.filter((item) =>
    (item.tags || []).some((tag) => pitchTags.includes(tag))
  );
}

function renderPitchBridge(wf) {
  if (!wf) return;
  const stepsWithOutput = wf.steps.filter((s) => String(s.output || '').trim());
  wfPitchStepsEl.innerHTML = '';
  if (stepsWithOutput.length === 0) {
    const empty = document.createElement('div');
    empty.id = 'wf-pitch-steps-empty';
    empty.textContent = window.i18n.t('project.pitchBridgeNoSteps');
    wfPitchStepsEl.appendChild(empty);
  }
  stepsWithOutput.forEach((step) => {
    const row = document.createElement('div');
    row.className = 'wf-pitch-step-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.dataset.stepId = step.id;
    checkbox.id = `wf-pitch-step-${step.id}`;
    const label = document.createElement('label');
    label.setAttribute('for', checkbox.id);
    label.textContent = step.title;
    row.appendChild(checkbox);
    row.appendChild(label);
    wfPitchStepsEl.appendChild(row);
  });

  const templates = presentationKnowledgeItems();
  const prevValue = wfPitchTemplateEl.value;
  wfPitchTemplateEl.innerHTML = '';
  if (templates.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = window.i18n.t('project.pitchBridgeNoTemplates');
    wfPitchTemplateEl.appendChild(opt);
    wfPitchTemplateEl.disabled = true;
  } else {
    wfPitchTemplateEl.disabled = false;
    templates.forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.title;
      wfPitchTemplateEl.appendChild(opt);
    });
    if (templates.some((t) => t.id === prevValue)) wfPitchTemplateEl.value = prevValue;
  }
  wfPitchGenerateBtn.disabled = stepsWithOutput.length === 0 || templates.length === 0;
  wfPitchResultEl.textContent = '';
  wfPitchResultEl.className = '';
}

wfPitchGenerateBtn.addEventListener('click', async () => {
  const wf = currentWorkflow();
  if (!wf) return;
  const template = presentationKnowledgeItems().find(
    (t) => t.id === wfPitchTemplateEl.value
  );
  if (!template) return;
  const checkedIds = Array.from(
    wfPitchStepsEl.querySelectorAll('input[type="checkbox"]:checked')
  ).map((cb) => cb.dataset.stepId);
  const selectedSteps = wf.steps.filter((s) => checkedIds.includes(s.id));
  if (selectedSteps.length === 0) {
    wfPitchResultEl.textContent = window.i18n.t('project.pitchBridgeNoStepsSelected');
    wfPitchResultEl.className = '';
    return;
  }

  const outputsSection = selectedSteps
    .map((s) => `## ${s.title}\n\n${s.output}`)
    .join('\n\n');
  const composed =
    window.i18n.t('project.pitchBridgeComposedHeader', {
      name: currentProject()?.name || '',
    }) +
    '\n\n' +
    outputsSection +
    '\n\n---\n\n' +
    template.content;

  await navigator.clipboard.writeText(composed);
  wfPitchResultEl.textContent = window.i18n.t('project.pitchBridgeCopied');
  wfPitchResultEl.className = 'ok';
});
