const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("novalAPI", {
  saveProject: (payload) => ipcRenderer.invoke("project:save", payload),
  saveProjectToPath: (filePath, payload) =>
    ipcRenderer.invoke("project:saveToPath", { filePath, payload }),
  openProject: () => ipcRenderer.invoke("project:open"),
  openProjectFromPath: (filePath) => ipcRenderer.invoke("project:openPath", { filePath }),
  chooseWorkspaceCreatePath: () => ipcRenderer.invoke("workspace:chooseCreatePath"),
  createWorkspace: (root, project) => ipcRenderer.invoke("workspace:create", { root, project }),
  openWorkspace: () => ipcRenderer.invoke("workspace:open"),
  openWorkspaceFromPath: (root) => ipcRenderer.invoke("workspace:openPath", { root }),
  saveWorkspace: (payload) => ipcRenderer.invoke("workspace:save", payload),
  reloadWorkspace: (root) => ipcRenderer.invoke("workspace:reload", { root }),
  listWorkspaceFiles: (root) => ipcRenderer.invoke("workspace:listFiles", { root }),
  readWorkspaceFile: (root, relativePath) =>
    ipcRenderer.invoke("workspace:readFile", { root, relativePath }),
  mergeWorkspaceConflict: (root, relativePath, content) =>
    ipcRenderer.invoke("workspace:mergeConflict", { root, relativePath, content }),
  importLegacyProject: () => ipcRenderer.invoke("workspace:importLegacy"),
  importNovel: (project) => ipcRenderer.invoke("workspace:importNovel", { project }),
  listDraftProjects: () => ipcRenderer.invoke("drafts:list"),
  saveDraftProject: (payload) => ipcRenderer.invoke("drafts:save", payload),
  openDraftProject: (draftId) => ipcRenderer.invoke("drafts:open", { draftId }),
  deleteDraftProject: (draftId) => ipcRenderer.invoke("drafts:delete", { draftId }),
  renameDraftProject: (draftId, title) =>
    ipcRenderer.invoke("drafts:rename", { draftId, title }),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  probeModel: (settings) => ipcRenderer.invoke("model:probe", settings),
  saveAutosave: (payload) => ipcRenderer.invoke("autosave:save", payload),
  loadAutosave: () => ipcRenderer.invoke("autosave:load"),
  clearAutosave: () => ipcRenderer.invoke("autosave:clear"),
  startTask: (payload) => ipcRenderer.invoke("task:start", payload),
  stopTask: (taskId) => ipcRenderer.invoke("task:stop", { taskId }),
  answerTask: (payload) => ipcRenderer.invoke("task:answer", payload),
  listTasks: (projectId, workspaceRoot) =>
    ipcRenderer.invoke("task:list", { projectId, workspaceRoot }),
  getTask: (taskId) => ipcRenderer.invoke("task:get", { taskId }),
  confirmTask: (payload) => ipcRenderer.invoke("task:confirm", payload),
  rejectTask: (taskId) => ipcRenderer.invoke("task:reject", { taskId }),
  abandonTask: (taskId) => ipcRenderer.invoke("task:abandon", { taskId }),
  onTaskEvent: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("task:event", handler);
    return () => ipcRenderer.removeListener("task:event", handler);
  },
  onWorkspaceExternalChange: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("workspace:externalChange", handler);
    return () => ipcRenderer.removeListener("workspace:externalChange", handler);
  },
  exportDocument: (format, defaultName, content) =>
    ipcRenderer.invoke("export:document", { format, defaultName, content })
});
