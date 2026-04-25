const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  normalizeAutosaveSnapshot,
  normalizeProject
} = require("./services/project-schema");
const {
  buildChapterAnalysisMessages,
  buildBlueprintMessages,
  buildChapterMessages,
  buildFallbackBlueprint,
  buildFallbackChapterAnalysis,
  buildFallbackChapter,
  buildFallbackProjectMemory,
  buildFallbackRewriteResult,
  buildProjectMemoryRefreshMessages,
  buildRewriteMessages,
  extractJSONObject,
  normalizeBlueprintResult,
  normalizeChapterAnalysisResult,
  normalizeChapterResult,
  normalizeMemoryRefreshResult,
  normalizeRewriteResult,
  safeErrorMessage
} = require("./services/story-engine");

const SETTINGS_PATH = () => path.join(app.getPath("userData"), "settings.json");
const AUTOSAVE_PATH = () => path.join(app.getPath("userData"), "autosave-recovery.json");
const DRAFTS_DIR = () => path.join(app.getPath("userData"), "draft-projects");

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readJSONFile(filePath, fallback = null) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

function countWords(content) {
  return String(content || "").replace(/\s+/g, "").length;
}

function projectToDraftSummary(project) {
  const chaptersCompleted = (project.chapters || []).filter((chapter) =>
    Boolean(String(chapter?.content || "").trim())
  ).length;

  return {
    id: String(project.id || ""),
    title: String(project.title || "未命名项目"),
    genre: String(project?.setup?.genre || "未分类"),
    description: String(project?.blueprint?.synopsis || project?.setup?.premise || ""),
    updatedAt: String(project.updatedAt || new Date().toISOString()),
    chaptersCompleted,
    totalChapters:
      Number(project?.blueprint?.chapterPlans?.length || 0) ||
      Number(project?.chapters?.length || 0),
    wordCount: (project.chapters || []).reduce(
      (sum, chapter) => sum + countWords(chapter?.content),
      0
    )
  };
}

function draftFilePath(draftId) {
  return path.join(DRAFTS_DIR(), `${draftId}.json`);
}

async function listDraftSummaries() {
  try {
    await fs.mkdir(DRAFTS_DIR(), { recursive: true });
    const files = await fs.readdir(DRAFTS_DIR());
    const summaries = [];

    for (const fileName of files) {
      if (!fileName.endsWith(".json")) continue;
      const snapshot = await readJSONFile(path.join(DRAFTS_DIR(), fileName));
      if (!snapshot) continue;

      try {
        const normalized = normalizeProject(snapshot);
        summaries.push(projectToDraftSummary(normalized.project));
      } catch {
        continue;
      }
    }

    return summaries.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  } catch {
    return [];
  }
}

async function readSettings() {
  return (
    (await readJSONFile(SETTINGS_PATH())) || {
      provider: "openai-compatible",
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1-mini"
    }
  );
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

async function resolveRendererEntry() {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    return {
      type: "url",
      value: devServerUrl
    };
  }

  const distIndex = path.join(__dirname, "dist", "index.html");
  try {
    await fs.access(distIndex);
    return {
      type: "file",
      value: distIndex
    };
  } catch {
    return {
      type: "file",
      value: path.join(__dirname, "src", "index.html")
    };
  }
}

async function createWindow() {
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

  const entry = await resolveRendererEntry();
  if (entry.type === "url") {
    await mainWindow.loadURL(entry.value);
    return;
  }

  await mainWindow.loadFile(entry.value);
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

  const normalized = normalizeProject(payload);
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, JSON.stringify(normalized.project, null, 2), "utf8");
  return {
    canceled: false,
    filePath,
    data: normalized.project,
    meta: normalized.meta
  };
});

ipcMain.handle("project:saveToPath", async (_event, { filePath, payload }) => {
  const normalized = normalizeProject(payload);
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, JSON.stringify(normalized.project, null, 2), "utf8");
  return {
    canceled: false,
    filePath,
    data: normalized.project,
    meta: normalized.meta
  };
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
  try {
    const content = await fs.readFile(filePath, "utf8");
    const normalized = normalizeProject(JSON.parse(content));
    return {
      canceled: false,
      filePath,
      data: normalized.project,
      meta: normalized.meta
    };
  } catch (error) {
    return {
      canceled: false,
      error: safeErrorMessage(error)
    };
  }
});

ipcMain.handle("project:openPath", async (_event, { filePath }) => {
  if (!filePath) {
    return {
      error: "缺少项目路径。"
    };
  }

  try {
    const content = await fs.readFile(filePath, "utf8");
    const normalized = normalizeProject(JSON.parse(content));
    return {
      canceled: false,
      filePath,
      data: normalized.project,
      meta: normalized.meta
    };
  } catch (error) {
    return {
      canceled: false,
      error: safeErrorMessage(error)
    };
  }
});

ipcMain.handle("drafts:list", async () => {
  return {
    ok: true,
    data: await listDraftSummaries()
  };
});

ipcMain.handle("drafts:save", async (_event, payload) => {
  const normalized = normalizeProject(payload);
  const filePath = draftFilePath(normalized.project.id);
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, JSON.stringify(normalized.project, null, 2), "utf8");
  return {
    ok: true,
    draftId: normalized.project.id,
    summary: projectToDraftSummary(normalized.project),
    meta: normalized.meta
  };
});

ipcMain.handle("drafts:open", async (_event, { draftId }) => {
  if (!draftId) {
    return {
      ok: false,
      error: "缺少草稿 ID。"
    };
  }

  try {
    const snapshot = await readJSONFile(draftFilePath(draftId));
    if (!snapshot) {
      return {
        ok: false,
        error: "草稿不存在或已被删除。"
      };
    }
    const normalized = normalizeProject(snapshot);
    return {
      ok: true,
      draftId,
      data: normalized.project,
      meta: normalized.meta
    };
  } catch (error) {
    return {
      ok: false,
      error: safeErrorMessage(error)
    };
  }
});

ipcMain.handle("drafts:delete", async (_event, { draftId }) => {
  if (!draftId) {
    return { ok: false, error: "缺少草稿 ID。" };
  }

  try {
    await fs.unlink(draftFilePath(draftId));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      return { ok: false, error: safeErrorMessage(error) };
    }
  }

  return { ok: true, draftId };
});

ipcMain.handle("drafts:rename", async (_event, { draftId, title }) => {
  if (!draftId) {
    return { ok: false, error: "缺少草稿 ID。" };
  }

  try {
    const snapshot = await readJSONFile(draftFilePath(draftId));
    if (!snapshot) {
      return {
        ok: false,
        error: "草稿不存在或已被删除。"
      };
    }

    const normalized = normalizeProject(snapshot);
    const nextProject = {
      ...normalized.project,
      title: String(title || normalized.project.title || "未命名项目").trim() || "未命名项目",
      updatedAt: new Date().toISOString()
    };

    await fs.writeFile(
      draftFilePath(draftId),
      JSON.stringify(nextProject, null, 2),
      "utf8"
    );

    return {
      ok: true,
      draftId,
      summary: projectToDraftSummary(nextProject)
    };
  } catch (error) {
    return {
      ok: false,
      error: safeErrorMessage(error)
    };
  }
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

ipcMain.handle("autosave:save", async (_event, payload) => {
  const filePath = AUTOSAVE_PATH();
  const normalized = normalizeAutosaveSnapshot({
    savedAt: new Date().toISOString(),
    currentPath: String(payload?.currentPath || ""),
    currentChapterId: String(payload?.currentChapterId || ""),
    route: String(payload?.route || "home"),
    project: payload?.project || null
  });

  await ensureParentDir(filePath);
  await fs.writeFile(filePath, JSON.stringify(normalized.snapshot, null, 2), "utf8");
  return {
    ok: true,
    savedAt: normalized.snapshot.savedAt,
    meta: normalized.meta
  };
});

ipcMain.handle("autosave:load", async () => {
  const snapshot = await readJSONFile(AUTOSAVE_PATH());
  if (!snapshot?.project) {
    return {
      ok: true,
      data: null
    };
  }

  try {
    const normalized = normalizeAutosaveSnapshot(snapshot);
    return {
      ok: true,
      data: normalized.snapshot,
      meta: normalized.meta
    };
  } catch (error) {
    return {
      ok: true,
      data: null,
      warning: safeErrorMessage(error)
    };
  }
});

ipcMain.handle("autosave:clear", async () => {
  try {
    await fs.unlink(AUTOSAVE_PATH());
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

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

ipcMain.handle("analysis:chapter", async (_event, payload) => {
  const settings = await readSettings();
  const fallback = buildFallbackChapterAnalysis(payload);

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
      messages: buildChapterAnalysisMessages(payload),
      temperature: 0.3
    });
    const parsed = extractJSONObject(content);
    return {
      ok: true,
      mode: "api",
      data: normalizeChapterAnalysisResult(parsed, payload, fallback)
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

ipcMain.handle("memory:refresh", async (_event, payload) => {
  const settings = await readSettings();
  const fallback = buildFallbackProjectMemory(payload?.project || {});

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
      messages: buildProjectMemoryRefreshMessages(payload),
      temperature: 0.25
    });
    const parsed = extractJSONObject(content);
    return {
      ok: true,
      mode: "api",
      data: normalizeMemoryRefreshResult(parsed, payload, fallback)
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

ipcMain.handle("rewrite:text", async (_event, payload) => {
  const settings = await readSettings();
  const fallback = buildFallbackRewriteResult(payload);

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
      messages: buildRewriteMessages(payload),
      temperature: payload?.mode === "rewrite_chapter" ? 0.7 : 0.5
    });
    const parsed = extractJSONObject(content);
    return {
      ok: true,
      mode: "api",
      data: normalizeRewriteResult(parsed, payload, fallback)
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
