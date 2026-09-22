const { loadProjects, saveProjects } = require('../stores');
const { logAudit } = require('../logs');
const { broadcastToAllWindows } = require('../broadcast');
const { getDueSummary, checkDueTasksAndNotify } = require('../reminders');

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

  // 到期摘要：側邊欄角標跟原生系統通知都用這個（見 lib/reminders.js）。
  // 每次呼叫都重新掃描，不快取——專案資料量對這個計算來說不會是效能問題。
  ipcMain.handle('projects:getDueSummary', () => getDueSummary());
}

module.exports = { registerProjectsIpc };
