const { loadProjects, saveProjects } = require('../stores');
const { logAudit } = require('../logs');

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
    if (isNewProject) {
      logAudit('project', 'create', `建立專案「${project.name || ''}」`);
    }
    return projects;
  });

  ipcMain.handle('projects:delete', (e, id) => {
    const target = loadProjects().find((p) => p.id === id);
    const projects = loadProjects().filter((p) => p.id !== id);
    saveProjects(projects);
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
    return projects;
  });
}

module.exports = { registerProjectsIpc };
