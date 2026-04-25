const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("novalAPI", {
  saveProject: (payload) => ipcRenderer.invoke("project:save", payload),
  saveProjectToPath: (filePath, payload) =>
    ipcRenderer.invoke("project:saveToPath", { filePath, payload }),
  openProject: () => ipcRenderer.invoke("project:open"),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  generateBlueprint: (payload) => ipcRenderer.invoke("generation:blueprint", payload),
  generateChapter: (payload) => ipcRenderer.invoke("generation:chapter", payload),
  exportDocument: (format, defaultName, content) =>
    ipcRenderer.invoke("export:document", { format, defaultName, content })
});
