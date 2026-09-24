const {
  loadProjects,
  saveProjects,
  loadDefaultProjectTemplates,
  loadProjectTemplates,
  saveProjectTemplates,
  makeKnowledgePromptResolver,
} = require('../stores');
const {
  STEP_STATUSES,
  buildWorkflowFromTemplate,
  composeStepPrompt,
  nextCurrentStepId,
  templateFromWorkflow,
  summarizeTemplate,
  normalizeContextMode,
} = require('../workflow');
const { logAudit } = require('../logs');
const { broadcastToAllWindows } = require('../broadcast');
const { getDueSummary, checkDueTasksAndNotify } = require('../reminders');

// 專案「階段流程（workflow）」與專案範本（1.29.0）：邏輯在 lib/workflow.js（純函式），
// 這裡只負責讀寫資料、同步對應任務狀態、廣播事件。
function genProjectId() {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function findTemplate(templateId) {
  const builtIn = loadDefaultProjectTemplates().find((t) => t.id === templateId);
  if (builtIn) return { template: builtIn, builtIn: true };
  const custom = loadProjectTemplates().find((t) => t.id === templateId);
  return custom ? { template: custom, builtIn: false } : null;
}

// --- 專案計畫管理 ---
function registerProjectsIpc(ipcMain) {
  ipcMain.handle('projects:list', () => loadProjects());

  ipcMain.handle('projects:save', (e, project) => {
    const projects = loadProjects();
    const now = new Date().toISOString();
    const isNewProject = !project.id;
    const tasks = Array.isArray(project.tasks)
      ? project.tasks.map((t) => ({
          id: t.id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          title: t.title || '',
          description: t.description || '',
          assigneeId: t.assigneeId || null,
          status: t.status || 'todo',
          startDate: t.startDate || null,
          dueDate: t.dueDate || null,
          // timeEntries 是「工時紀錄」各自透過 projects:task:addTimeEntry/
          // removeTimeEntry 兩個獨立頻道維護的（見下方），不是這個表單
          // 負責編輯的欄位。這裡一定要沿用呼叫端帶來的值（渲染層的
          // editingTasks 本來就是從 projects:list 載入的完整 task 物件
          // spread 出來，會一路帶著 timeEntries），絕對不能預設成空陣列
          // 去覆蓋——不然使用者改個任務標題存檔，記錄好的工時就會被清空
          // （對話庫的 linkedDocumentIds 就是同一種寫法踩到的真實 bug，
          // 見 CHANGELOG.md 1.21.1）。
          timeEntries: Array.isArray(t.timeEntries) ? t.timeEntries : [],
        }))
      : [];
    const issues = Array.isArray(project.issues)
      ? project.issues.map((i) => ({
          id: i.id || `issue_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          title: i.title || '',
          description: i.description || '',
          type: i.type || 'task',
          priority: i.priority || 'medium',
          status: i.status || 'open',
          assigneeId: i.assigneeId || null,
          dueDate: i.dueDate || null,
          tags: Array.isArray(i.tags) ? i.tags : [],
        }))
      : [];
    if (project.id) {
      const idx = projects.findIndex((p) => p.id === project.id);
      if (idx >= 0) {
        projects[idx] = { ...projects[idx], ...project, tasks, issues, updatedAt: now };
      } else {
        projects.push({ ...project, tasks, issues, createdAt: now, updatedAt: now });
      }
    } else {
      project.id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      project.tasks = tasks;
      project.issues = issues;
      project.createdAt = now;
      project.updatedAt = now;
      projects.push(project);
    }
    saveProjects(projects);
    broadcastToAllWindows('projects:changed');
    checkDueTasksAndNotify(); // 專案資料變了，立刻重新算到期摘要，不用等下一次排程
    if (isNewProject) {
      logAudit('project', 'create', `建立專案「${project.name || ''}」`);
    }
    return projects;
  });

  ipcMain.handle('projects:delete', (e, id) => {
    const target = loadProjects().find((p) => p.id === id);
    const projects = loadProjects().filter((p) => p.id !== id);
    saveProjects(projects);
    broadcastToAllWindows('projects:changed');
    checkDueTasksAndNotify(); // 專案資料變了，立刻重新算到期摘要，不用等下一次排程
    if (target) {
      logAudit('project', 'delete', `刪除專案「${target.name || ''}」`);
    }
    return projects;
  });

  // 任務狀態即時持久化（例如在看板上直接切換 待辦/進行中/已完成），不用等按「儲存專案」
  ipcMain.handle('projects:task:setStatus', (e, { projectId, taskId, status }) => {
    const projects = loadProjects();
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      const task = project.tasks.find((t) => t.id === taskId);
      if (task) task.status = status;
      project.updatedAt = new Date().toISOString();
    }
    saveProjects(projects);
    broadcastToAllWindows('projects:changed');
    checkDueTasksAndNotify(); // 專案資料變了，立刻重新算到期摘要，不用等下一次排程
    return projects;
  });

  // Issue 狀態即時持久化，用途同上
  ipcMain.handle('projects:issue:setStatus', (e, { projectId, issueId, status }) => {
    const projects = loadProjects();
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      const issue = (project.issues || []).find((i) => i.id === issueId);
      if (issue) issue.status = status;
      project.updatedAt = new Date().toISOString();
    }
    saveProjects(projects);
    broadcastToAllWindows('projects:changed');
    checkDueTasksAndNotify(); // 專案資料變了，立刻重新算到期摘要，不用等下一次排程
    return projects;
  });

  // --- 工時紀錄 ---
  // 每筆是一次性的紀錄（哪天花了幾小時、做了什麼），性質上更像「事件」
  // 而不是使用者會反覆編輯的欄位，所以跟任務/Issue 狀態一樣即時持久化，
  // 不用等按「儲存專案」——不然使用者剛記完工時就忘記按儲存，紀錄就
  // 白做了。
  ipcMain.handle(
    'projects:task:addTimeEntry',
    (e, { projectId, taskId, date, hours, note }) => {
      const projects = loadProjects();
      const project = projects.find((p) => p.id === projectId);
      if (project) {
        const task = project.tasks.find((t) => t.id === taskId);
        if (task) {
          if (!Array.isArray(task.timeEntries)) task.timeEntries = [];
          task.timeEntries.push({
            id: `time_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            date: date || new Date().toISOString().slice(0, 10),
            hours: Number(hours) || 0,
            note: note || '',
          });
        }
        project.updatedAt = new Date().toISOString();
      }
      saveProjects(projects);
      broadcastToAllWindows('projects:changed');
      checkDueTasksAndNotify(); // 專案資料變了，立刻重新算到期摘要，不用等下一次排程
      return projects;
    }
  );

  ipcMain.handle('projects:task:removeTimeEntry', (e, { projectId, taskId, entryId }) => {
    const projects = loadProjects();
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      const task = project.tasks.find((t) => t.id === taskId);
      if (task) {
        task.timeEntries = (task.timeEntries || []).filter(
          (entry) => entry.id !== entryId
        );
      }
      project.updatedAt = new Date().toISOString();
    }
    saveProjects(projects);
    broadcastToAllWindows('projects:changed');
    checkDueTasksAndNotify(); // 專案資料變了，立刻重新算到期摘要，不用等下一次排程
    return projects;
  });

  // --- 專案範本與階段流程（workflow） ---

  // 範本清單（內建在前、使用者自訂在後），只回傳預覽用的階段/步驟標題，不含提示詞內容。
  ipcMain.handle('projectTemplates:list', () => {
    const resolve = makeKnowledgePromptResolver();
    return [
      ...loadDefaultProjectTemplates().map((t) => summarizeTemplate(t, true, resolve)),
      ...loadProjectTemplates().map((t) => summarizeTemplate(t, false, resolve)),
    ];
  });

  // 只能刪使用者自訂範本；內建範本是唯讀的
  ipcMain.handle('projectTemplates:delete', (e, id) => {
    const templates = loadProjectTemplates();
    const target = templates.find((t) => t.id === id);
    if (target) {
      saveProjectTemplates(templates.filter((t) => t.id !== id));
      logAudit('project', 'delete', `刪除專案範本「${target.name || ''}」`);
    }
    return { ok: !!target };
  });

  // 從範本建立專案：輸入主題 → 依範本展開 workflow 與對應任務（每個步驟一個任務）。
  // 提示詞內容在這裡「快照」進專案，之後改動知識庫不影響已建立的專案。
  ipcMain.handle('projects:createFromTemplate', (e, { templateId, topic, name } = {}) => {
    const cleanTopic = String(topic || '').trim();
    if (!cleanTopic) return { ok: false, error: 'topic-required' };
    const found = findTemplate(templateId);
    if (!found) return { ok: false, error: 'template-not-found' };
    const built = buildWorkflowFromTemplate(
      found.template,
      cleanTopic,
      makeKnowledgePromptResolver()
    );
    if (!built) return { ok: false, error: 'empty-template' };

    const now = new Date().toISOString();
    const project = {
      id: genProjectId(),
      name: String(name || '').trim() || cleanTopic,
      description: `以「${found.template.name}」範本建立。專案主題：${cleanTopic}`,
      status: 'planning',
      startDate: null,
      endDate: null,
      tasks: built.tasks,
      issues: [],
      workflow: built.workflow,
      createdAt: now,
      updatedAt: now,
    };
    const projects = loadProjects();
    projects.push(project);
    saveProjects(projects);
    broadcastToAllWindows('projects:changed');
    checkDueTasksAndNotify();
    logAudit(
      'project',
      'create',
      `以範本「${found.template.name}」建立專案「${project.name}」`
    );
    return { ok: true, projectId: project.id, projects };
  });

  // 讀取 → 修改專案的 workflow → 存檔 → 廣播，這一串 workflow 相關 handler 共用。
  // mutate(project, workflow) 回傳 false 代表沒有實際變更（找不到步驟等），不寫檔。
  function mutateWorkflow(projectId, mutate) {
    const projects = loadProjects();
    const project = projects.find((p) => p.id === projectId);
    if (project && project.workflow) {
      if (mutate(project, project.workflow) !== false) {
        project.updatedAt = new Date().toISOString();
        saveProjects(projects);
        broadcastToAllWindows('projects:changed');
        checkDueTasksAndNotify();
      }
    }
    return projects;
  }

  // 專案主題、前面步驟產出的帶入方式、目前停在哪一步
  ipcMain.handle(
    'projects:workflow:setMeta',
    (e, { projectId, topic, contextMode, currentStepId }) =>
      mutateWorkflow(projectId, (project, workflow) => {
        if (typeof topic === 'string') workflow.topic = topic.trim();
        if (contextMode !== undefined)
          workflow.contextMode = normalizeContextMode(contextMode);
        if (currentStepId && workflow.steps.some((s) => s.id === currentStepId)) {
          workflow.currentStepId = currentStepId;
        }
      })
  );

  // 步驟的產出（使用者貼回來的 AI 回覆）、提示詞、標題。只接受這三個欄位。
  ipcMain.handle('projects:workflow:updateStep', (e, { projectId, stepId, patch }) =>
    mutateWorkflow(projectId, (project, workflow) => {
      const step = workflow.steps.find((s) => s.id === stepId);
      if (!step || !patch) return false;
      ['output', 'prompt', 'title'].forEach((key) => {
        if (typeof patch[key] === 'string') step[key] = patch[key];
      });
    })
  );

  // 步驟狀態即時持久化，並同步對應任務的狀態（任務清單、甘特圖、進度、到期提醒都跟著動）。
  // 標成完成時自動把「目前步驟」移到下一個還沒完成的步驟。
  ipcMain.handle('projects:workflow:setStepStatus', (e, { projectId, stepId, status }) =>
    mutateWorkflow(projectId, (project, workflow) => {
      const step = workflow.steps.find((s) => s.id === stepId);
      if (!step || !STEP_STATUSES.includes(status)) return false;
      step.status = status;
      const task = step.taskId && project.tasks.find((t) => t.id === step.taskId);
      if (task) task.status = status;
      workflow.currentStepId = nextCurrentStepId(workflow, stepId, status);
    })
  );

  // 組合某一步要複製給 AI 的完整提示詞（主題 + 前面產出 + 本步驟提示詞）
  ipcMain.handle('projects:workflow:compose', (e, { projectId, stepId }) => {
    const project = loadProjects().find((p) => p.id === projectId);
    return project && project.workflow ? composeStepPrompt(project.workflow, stepId) : '';
  });

  // 把專案目前的流程（含在專案內改過的提示詞）另存成使用者範本
  ipcMain.handle(
    'projects:workflow:saveAsTemplate',
    (e, { projectId, name, description }) => {
      const project = loadProjects().find((p) => p.id === projectId);
      if (!project || !project.workflow) return { ok: false, error: 'no-workflow' };
      const template = templateFromWorkflow(project.workflow, { name, description });
      saveProjectTemplates([...loadProjectTemplates(), template]);
      logAudit('project', 'create', `另存專案範本「${template.name}」`);
      return { ok: true, templateId: template.id };
    }
  );

  // 到期摘要：側邊欄角標跟原生系統通知都用這個（見 lib/reminders.js）。
  // 每次呼叫都重新掃描，不快取——專案資料量對這個計算來說不會是效能問題。
  ipcMain.handle('projects:getDueSummary', () => getDueSummary());
}

module.exports = { registerProjectsIpc };
