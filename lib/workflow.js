'use strict';

/**
 * lib/workflow.js — 專案「階段流程（workflow）」的純函式
 *
 * 專案可以帶一份 workflow：一串分階段的提示詞步驟（例如 SDD 規格驅動開發的
 * 「專案原則 → 規格 → 釐清 → 規劃 → 任務 → 分析 → 實作」），使用者輸入一個專案主題後，
 * 依序把每個步驟的提示詞（自動帶入主題與前面步驟的產出）複製給 AI、把 AI 的產出貼回來、
 * 標記完成，再進下一步。
 *
 * 這個檔案只放「不依賴 Electron、不讀寫檔案」的邏輯（範本展開成 workflow、組合每一步
 * 要複製的完整提示詞、workflow 另存成範本），這樣可以直接用單元測試驗證，IPC handler
 * （lib/ipc/projects.js）只負責讀寫資料與廣播事件。
 *
 * 資料結構（存在 project.workflow）：
 *   {
 *     templateId, templateName,   // 來源範本（另存新範本後不再追蹤）
 *     topic,                      // 使用者輸入的專案主題
 *     contextMode,                // 'all' | 'previous' | 'none'：組合提示詞時帶入哪些前面步驟的產出
 *     currentStepId,              // 目前停在哪一步（重開視窗後接續）
 *     steps: [{
 *       id, stage, title, prompt, // stage 是階段名稱，相鄰且相同的步驟屬於同一階段（同套餐 step.stage）
 *       output,                   // 使用者貼回來的 AI 產出
 *       status,                   // 'todo' | 'doing' | 'done'
 *       taskId                    // 對應的專案任務 id（狀態會同步）
 *     }]
 *   }
 */

const { genId, groupStepsByStage } = require('./utils');

const STEP_STATUSES = ['todo', 'doing', 'done'];
const CONTEXT_MODES = ['all', 'previous', 'none'];

function normalizeContextMode(mode) {
  return CONTEXT_MODES.includes(mode) ? mode : 'all';
}

/**
 * 每個步驟的「階段序號-階段內序號」編號（例如 '1-1'、'1-2'、'2-1'），
 * 用在任務標題與組合提示詞時標示「前面步驟」。
 */
function stepNumbers(steps) {
  const numbers = [];
  groupStepsByStage(steps).forEach((run, stageIdx) => {
    run.steps.forEach((_, i) => numbers.push(`${stageIdx + 1}-${i + 1}`));
  });
  return numbers;
}

/**
 * 把一個範本步驟解析成 { title, prompt }：
 *   - 有 prompt（內嵌提示詞）就直接用；
 *   - 否則有 itemDefaultId 就呼叫 resolveItem(defaultId) 取得知識庫的提示詞
 *     （回傳 { title, prompt } 或 null）。
 * 兩者都拿不到（例如引用的知識庫提示詞已被刪除且內建檔也沒有）回傳 null，呼叫端略過該步驟。
 */
function resolveTemplateStep(step, resolveItem) {
  let title = typeof step.title === 'string' ? step.title.trim() : '';
  let prompt = typeof step.prompt === 'string' ? step.prompt : '';
  if (!prompt.trim() && step.itemDefaultId && typeof resolveItem === 'function') {
    const item = resolveItem(step.itemDefaultId);
    if (item && item.prompt && item.prompt.trim()) {
      prompt = item.prompt;
      title = title || item.title || '';
    }
  }
  if (!prompt.trim()) return null;
  return { title: title || '(未命名步驟)', prompt };
}

/**
 * 把範本展開成專案的 workflow 與一組對應的任務（每個步驟一個任務）。
 *
 * 範本格式：{ id, name, description, stages: [{ title, steps: [{ title?, prompt?, itemDefaultId? }] }] }
 * 內建範本大量重用知識庫裡的提示詞（itemDefaultId），建立專案當下就把提示詞內容「快照」
 * 進 workflow.steps[].prompt：之後使用者改動或刪除知識庫項目，不會影響已經在跑的專案，
 * 專案備份還原時也是自成一體。
 *
 * @returns {{ workflow: object, tasks: object[] } | null} 一個步驟都解析不出來時回傳 null
 */
function buildWorkflowFromTemplate(template, topic, resolveItem) {
  const steps = [];
  (Array.isArray(template.stages) ? template.stages : []).forEach((stage) => {
    const stageTitle = typeof stage.title === 'string' ? stage.title.trim() : '';
    (Array.isArray(stage.steps) ? stage.steps : []).forEach((rawStep) => {
      const resolved = resolveTemplateStep(rawStep, resolveItem);
      if (!resolved) return;
      steps.push({
        id: genId('wfstep'),
        stage: stageTitle,
        title: resolved.title,
        prompt: resolved.prompt,
        output: '',
        status: 'todo',
        taskId: null,
      });
    });
  });
  if (steps.length === 0) return null;

  const numbers = stepNumbers(steps);
  const tasks = steps.map((step, i) => {
    const task = {
      id: genId('task'),
      title: `${numbers[i]} ${step.title}`,
      description: step.stage,
      assigneeId: null,
      status: 'todo',
      startDate: null,
      dueDate: null,
      timeEntries: [],
    };
    step.taskId = task.id;
    return task;
  });

  return {
    workflow: {
      templateId: template.id || null,
      templateName: template.name || '',
      topic: String(topic || '').trim(),
      contextMode: 'all',
      currentStepId: steps[0].id,
      steps,
    },
    tasks,
  };
}

const PROMPT_NOTE =
  '# 補充說明\n' +
  '- 上面「本步驟提示詞」中的 [請填入] 欄位，請優先依「專案主題」與「前面步驟的產出」直接帶入；' +
  '無法從中得知的，請標示為「待確認」並列出需要我補充的問題，不要自行編造。';

/**
 * 組合某一步「要複製給 AI 的完整提示詞」：
 *   專案主題 → 目前步驟（階段與進度）→ 前面步驟的產出（依 contextMode）→ 本步驟提示詞 → 補充說明
 *
 * - 提示詞內的 {{topic}} 會被換成專案主題（給自訂範本用，內建提示詞用 [請填入] 風格，
 *   靠最後的補充說明請 AI 從主題與前面產出帶入）。
 * - contextMode：'all' 帶入所有「有產出」的前面步驟；'previous' 只帶入緊鄰的上一步；
 *   'none' 完全不帶（同一段 AI 對話裡已經有前面內容時可以省 token）。
 * - 找不到步驟回傳空字串。
 */
function composeStepPrompt(workflow, stepId) {
  const steps = Array.isArray(workflow && workflow.steps) ? workflow.steps : [];
  const idx = steps.findIndex((s) => s.id === stepId);
  if (idx < 0) return '';
  const step = steps[idx];
  const topic = String(workflow.topic || '').trim();
  const numbers = stepNumbers(steps);
  const stepLabel = (i) => `${numbers[i]} ${steps[i].title}`;

  const parts = [];
  if (topic) parts.push(`# 專案主題\n${topic}`);

  const stagePart = step.stage ? `${step.stage} › ` : '';
  parts.push(
    `# 目前步驟\n${stagePart}${stepLabel(idx)}（第 ${idx + 1}/${steps.length} 步）`
  );

  const mode = normalizeContextMode(workflow.contextMode);
  let previous = [];
  if (mode === 'all') previous = steps.slice(0, idx).map((s, i) => ({ s, i }));
  else if (mode === 'previous' && idx > 0) previous = [{ s: steps[idx - 1], i: idx - 1 }];
  previous = previous.filter(({ s }) => String(s.output || '').trim());
  if (previous.length > 0) {
    parts.push(
      '# 前面步驟的產出\n' +
        previous.map(({ s, i }) => `## ${stepLabel(i)}\n${s.output.trim()}`).join('\n\n')
    );
  }

  const prompt = String(step.prompt || '').replace(/\{\{\s*topic\s*\}\}/g, topic);
  parts.push(`# 本步驟提示詞\n${prompt.trim()}`);
  parts.push(PROMPT_NOTE);
  return parts.join('\n\n') + '\n';
}

/**
 * 步驟狀態改變後，決定「目前步驟」該停在哪：標成完成時往後找第一個還沒完成的步驟，
 * 找不到（後面都做完了）就留在原地。其他狀態不移動。
 */
function nextCurrentStepId(workflow, stepId, newStatus) {
  const steps = workflow.steps;
  if (newStatus !== 'done') return workflow.currentStepId;
  const idx = steps.findIndex((s) => s.id === stepId);
  const next = steps.slice(idx + 1).find((s) => s.status !== 'done');
  return next ? next.id : stepId;
}

/**
 * 把專案目前的 workflow 另存成使用者範本（提示詞用專案裡「目前的內容」，含使用者在專案內
 * 改過的版本；不含產出、狀態、主題）。
 */
function templateFromWorkflow(workflow, { name, description } = {}) {
  const stages = groupStepsByStage(workflow.steps).map((run) => ({
    title: run.stage,
    steps: run.steps.map((s) => ({ title: s.title, prompt: s.prompt })),
  }));
  return {
    id: genId('ptpl'),
    name: String(name || '').trim() || workflow.templateName || '自訂範本',
    description: String(description || '').trim(),
    stages,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 範本的預覽摘要（給範本選擇畫面用，不含提示詞內容）。
 * 內建範本引用知識庫提示詞的步驟，標題要靠 resolveItem 解析；解析不到的步驟略過，
 * 跟 buildWorkflowFromTemplate() 實際會展開出來的步驟一致。
 */
function summarizeTemplate(template, builtIn, resolveItem) {
  const stages = [];
  (Array.isArray(template.stages) ? template.stages : []).forEach((stage) => {
    const steps = [];
    (Array.isArray(stage.steps) ? stage.steps : []).forEach((rawStep) => {
      const resolved = resolveTemplateStep(rawStep, resolveItem);
      if (resolved) steps.push({ title: resolved.title });
    });
    if (steps.length > 0) stages.push({ title: stage.title || '', steps });
  });
  return {
    id: template.id,
    name: template.name || '',
    description: template.description || '',
    builtIn: !!builtIn,
    stages,
  };
}

/**
 * 正規化從磁碟讀進來的 workflow（備份還原、手動改過的資料檔可能欄位不全）。
 * 沒有 workflow 回傳 null。
 */
function normalizeWorkflow(workflow) {
  if (!workflow || !Array.isArray(workflow.steps)) return null;
  workflow.topic = typeof workflow.topic === 'string' ? workflow.topic : '';
  workflow.contextMode = normalizeContextMode(workflow.contextMode);
  workflow.steps.forEach((s) => {
    if (typeof s.stage !== 'string') s.stage = '';
    if (typeof s.output !== 'string') s.output = '';
    if (typeof s.prompt !== 'string') s.prompt = '';
    if (!STEP_STATUSES.includes(s.status)) s.status = 'todo';
    if (!s.taskId) s.taskId = null;
  });
  if (!workflow.steps.some((s) => s.id === workflow.currentStepId)) {
    workflow.currentStepId = workflow.steps.length ? workflow.steps[0].id : null;
  }
  return workflow;
}

module.exports = {
  STEP_STATUSES,
  CONTEXT_MODES,
  normalizeContextMode,
  stepNumbers,
  resolveTemplateStep,
  buildWorkflowFromTemplate,
  composeStepPrompt,
  nextCurrentStepId,
  templateFromWorkflow,
  summarizeTemplate,
  normalizeWorkflow,
};
