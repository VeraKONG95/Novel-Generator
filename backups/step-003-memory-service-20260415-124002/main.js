const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  buildBlueprintMessages,
  buildChapterMessages,
  buildFallbackBlueprint,
  buildFallbackChapter,
  extractJSONObject,
  normalizeBlueprintResult,
  normalizeChapterResult,
  safeErrorMessage
} = require("./services/story-engine");

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

function normalizedBaseUrl(baseUrl) {
  return String(baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
}

async function requestChatCompletion({ settings, messages, temperature = 0.7 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(`${normalizedBaseUrl(settings.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        temperature,
        messages
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`模型请求失败 (${response.status})：${errorText.slice(0, 400)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("模型没有返回可用内容。");
    }

    return content;
  } finally {
    clearTimeout(timeout);
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

ipcMain.handle("generation:blueprint", async (_event, payload) => {
  const settings = await readSettings();
  const fallback = buildFallbackBlueprint(payload?.setup || {});

  if (!settings.apiKey) {
    return {
      ok: true,
      mode: "fallback",
      reason: "missing_api_key",
      data: fallback
    };
  }

  try {
    const content = await requestChatCompletion({
      settings,
      messages: buildBlueprintMessages(payload),
      temperature: 0.8
    });
    const parsed = extractJSONObject(content);
    return {
      ok: true,
      mode: "api",
      data: normalizeBlueprintResult(parsed, payload?.setup || {}, fallback)
    };
  } catch (error) {
    return {
      ok: true,
      mode: "fallback",
      reason: "api_error",
      warning: safeErrorMessage(error),
      data: fallback
    };
  }
});

ipcMain.handle("generation:chapter", async (_event, payload) => {
  const settings = await readSettings();
  const fallback = buildFallbackChapter(payload);

  if (!settings.apiKey) {
    return {
      ok: true,
      mode: "fallback",
      reason: "missing_api_key",
      data: fallback
    };
  }

  try {
    const content = await requestChatCompletion({
      settings,
      messages: buildChapterMessages(payload),
      temperature: payload?.isContinuation ? 0.85 : 0.75
    });
    const parsed = extractJSONObject(content);
    return {
      ok: true,
      mode: "api",
      data: normalizeChapterResult(parsed, payload, fallback)
    };
  } catch (error) {
    return {
      ok: true,
      mode: "fallback",
      reason: "api_error",
      warning: safeErrorMessage(error),
      data: fallback
    };
  }
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
