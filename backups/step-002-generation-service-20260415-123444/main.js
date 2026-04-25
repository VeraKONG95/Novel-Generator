const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");

const SETTINGS_PATH = () => path.join(app.getPath("userData"), "settings.json");

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readSettings() {
  try {
    const content = await fs.readFile(SETTINGS_PATH(), "utf8");
    return JSON.parse(content);
  } catch {
    return {
      provider: "openai-compatible",
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini"
    };
  }
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#f2ece2",
    title: "Noval 小说生成器",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "src/index.html"));
}

ipcMain.handle("project:save", async (_event, payload) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "保存小说项目",
    defaultPath: "noval-project.json",
    filters: [{ name: "JSON", extensions: ["json"] }]
  });

  if (canceled || !filePath) {
    return { canceled: true };
  }

  await ensureParentDir(filePath);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return { canceled: false, filePath };
});

ipcMain.handle("project:saveToPath", async (_event, { filePath, payload }) => {
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return { canceled: false, filePath };
});

ipcMain.handle("project:open", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "打开小说项目",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }]
  });

  if (canceled || filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = filePaths[0];
  const content = await fs.readFile(filePath, "utf8");
  return {
    canceled: false,
    filePath,
    data: JSON.parse(content)
  };
});

ipcMain.handle("settings:load", async () => {
  return readSettings();
});

ipcMain.handle("settings:save", async (_event, settings) => {
  const filePath = SETTINGS_PATH();
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, JSON.stringify(settings, null, 2), "utf8");
  return { ok: true };
});

ipcMain.handle("export:document", async (_event, { format, defaultName, content }) => {
  const extension = format === "markdown" ? "md" : "txt";
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "导出小说",
    defaultPath: `${defaultName || "noval-export"}.${extension}`,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }]
  });

  if (canceled || !filePath) {
    return { canceled: true };
  }

  await ensureParentDir(filePath);
  await fs.writeFile(filePath, content, "utf8");
  return { canceled: false, filePath };
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
