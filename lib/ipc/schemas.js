'use strict';

/**
 * 各 IPC 頻道的 payload 規格（資安稽核 N-5，規則說明見 lib/ipcValidate.js）。
 * 一個頻道一個陣列，每個元素對應一個參數（不含 event）。
 * 優先涵蓋「會寫檔、刪檔、開外部程式、改設定檔路徑」的 handler；沒列的頻道不檢查。
 */

const ID_PAIR = (a, b) => ({ [a]: 'id', [b]: 'id' });

const schemas = {
  'accounts:add': [{ platform: 'id', name: 'str:200?', roleId: 'str:200?' }],
  'accounts:reload': ['id'],
  'accounts:continueWaiting': ['id'],
  'accounts:switch': ['id'],
  'accounts:remove': ['id'],
  'accounts:setRole': [{ accountId: 'id', roleId: 'str:200?' }],
  'accounts:reorder': ['strs'],
  'localServices:test': ['str:2000'],
  'roles:delete': ['id'],
  'ui:setLanguage': ['str:20'],

  'export:current': [
    {
      format: 'str:20?',
      forceChoosePath: 'bool?',
      addToKnowledge: 'bool?',
      downloadFiles: 'bool?',
    },
  ],
  'conversations:save': ['obj'],
  'conversations:delete': ['id'],
  'conversations:export': [{ id: 'id', format: 'str:20?' }],
  'conversations:linkDocument': [ID_PAIR('conversationId', 'documentId')],
  'conversations:unlinkDocument': [ID_PAIR('conversationId', 'documentId')],

  'documents:save': [{ id: 'id', name: 'str:500', notes: 'str:100000?' }],
  'documents:delete': [{ id: 'id', alsoDeleteFile: 'bool?' }],
  'documents:openFile': ['id'],
  'documents:showInFolder': ['id'],
  'documents:getMarkdownPreview': ['id'],
  'documents:getDocxPreview': ['id'],
  'documents:saveDocxEdit': [{ id: 'id', html: 'str' }],
  'documents:getPdfBytes': ['id'],
  'documents:pdfRotatePage': [{ id: 'id', pageIndex: 'int', delta: 'int' }],
  'documents:pdfDeletePage': [{ id: 'id', pageIndex: 'int' }],
  'documents:pdfAddWatermark': [{ id: 'id', text: 'str:500' }],
  'documents:pdfMerge': ['id'],
  'documents:pdfExtractPages': [{ id: 'id', rangeStr: 'str:200' }],

  'knowledge:save': ['obj'],
  'knowledge:delete': ['id'],
  'knowledge:group:save': ['obj'],
  'knowledge:group:delete': ['id'],
  'knowledge:exportAll': ['str:20?'],

  'logs:clear': ['str:20?'],
  'logs:export': ['str:20?'],

  'projects:save': ['obj'],
  'projects:delete': ['id'],
  'projects:task:setStatus': [{ projectId: 'id', taskId: 'id', status: 'str:50' }],
  'projects:issue:setStatus': [{ projectId: 'id', issueId: 'id', status: 'str:50' }],
  'projectTemplates:importFiles': ['any'],
  'projectTemplates:export': ['strs'],
  'projectTemplates:delete': ['id'],
  'projects:createFromTemplate': [
    { templateId: 'id', topic: 'str:5000?', name: 'str:500?' },
  ],
  'projects:workflow:saveAsTemplate': [
    { projectId: 'id', name: 'str:500', description: 'str:5000?' },
  ],
  'projects:workflow:exportOpenSpec': [{ projectId: 'id', changeId: 'str:200?' }],
  'projects:workflow:saveStepOutputAsDocument': [ID_PAIR('projectId', 'stepId')],
  'projects:linkDocument': [ID_PAIR('projectId', 'documentId')],
  'projects:unlinkDocument': [ID_PAIR('projectId', 'documentId')],

  'search:global': ['str:2000'],

  'settings:toggleExtension': [{ id: 'id', enabled: 'bool' }],
  'settings:removeExtension': ['id'],
  'settings:setSkipSaveDialog': ['bool'],
  'settings:setAutoAddToKnowledgeOnExport': ['bool'],
  'settings:setExportDownloadFiles': ['bool'],
  'settings:setTrayPrefs': ['obj'],
  'settings:saveSelector': [{ platform: 'id', selector: 'str:5000' }],
  'settings:resetSelector': ['id'],
  'settings:setStartupLoad': ['str:20'],
  'settings:setPageConsole': ['bool'],

  'app:openExternal': ['str:4000'],
  'window:openAccountWindow': ['str:100?'],
  'window:setActiveAccountViewVisible': ['bool'],
  'tray:setExpanded': ['bool'],
};

module.exports = { schemas };
