const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("novalAPI", {
  saveProject: (payload) => ipcRenderer.invoke("project:save", payload),
  saveProjectToPath: (filePath, payload) =>
    ipcRenderer.invoke("project:saveToPath", { filePath, payload }),
  openProject: () => ipcRenderer.invoke("project:open"),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  saveAutosave: (payload) => ipcRenderer.invoke("autosave:save", payload),
  loadAutosave: () => ipcRenderer.invoke("autosave:load"),
  clearAutosave: () => ipcRenderer.invoke("autosave:clear"),
  generateBlueprint: (payload) => ipcRenderer.invoke("generation:blueprint", payload),
  generateChapter: (payload) => ipcRenderer.invoke("generation:chapter", payload),
  analyzeChapter: (payload) => ipcRenderer.invoke("analysis:chapter", payload),
  refreshMemory: (payload) => ipcRenderer.invoke("memory:refresh", payload),
  rewriteText: (payload) => ipcRenderer.invoke("rewrite:text", payload),
  exportDocument: (format, defaultName, content) =>
    ipcRenderer.invoke("export:document", { format, defaultName, content })
});
