const { app, BrowserWindow, dialog, ipcMain, utilityProcess } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  normalizeAutosaveSnapshot,
  normalizeProject
} = require("./services/project-schema");
const {
  assertInside,
  applyWorkspaceChanges,
  createWorkspace,
  createWorkspaceAtPath,
  importNovel,
  listDocuments,
  listWorkspaceFiles,
  loadWorkspace,
  readWorkspaceFile,
  saveWorkspace
} = require("./services/workspace-service");
const { TaskManager } = require("./services/task-manager");
const { classifyTask } = require("./services/pi-prompts");

if (process.env.NOVAL_USER_DATA_DIR) {
  app.setPath("userData", path.resolve(process.env.NOVAL_USER_DATA_DIR));
}

const SETTINGS_PATH = () => path.join(app.getPath("userData"), "settings.json");
const AUTOSAVE_PATH = () => path.join(app.getPath("userData"), "autosave-recovery.json");
const DRAFTS_DIR = () => path.join(app.getPath("userData"), "draft-projects");

let mainWindow = null;
let taskManager = null;
let workspaceWatcher = null;
let workspaceWriteUntil = 0;

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

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
      provider: "openrouter",
      apiKey: "",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "deepseek/deepseek-v4-flash",
      contextWindow: 1048576,
      maxOutputTokens: 65536,
      capabilityStatus: "unchecked",
      capabilityCheckedAt: "",
      capabilityMessage: ""
    }
  );
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
      type: "error",
      value: "应用界面尚未构建，请先运行 npm run build。"
    };
  }
}

async function startWorkspaceWatcher(root) {
  if (workspaceWatcher) {
    await workspaceWatcher.close();
    workspaceWatcher = null;
  }
  if (!root) return;
  const { watch } = await import("chokidar");
  let timer = null;
  const changed = new Set();
  workspaceWatcher = watch(root, {
    ignoreInitial: true,
    ignored: [
      /(^|[/\\])\.noval[/\\](?:\.stage-|\.backup-)/,
      /(^|[/\\])\.noval[/\\]tasks[/\\]/,
      /(^|[/\\])\.noval[/\\]index\.json$/,
      /(^|[/\\])\.noval[/\\]transaction\.json$/
    ],
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 }
  });
  const onChange = (filePath) => {
    if (Date.now() < workspaceWriteUntil) return;
    const relativePath = path.relative(root, filePath);
    if (!relativePath || relativePath.startsWith("..")) return;
    changed.add(relativePath);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const paths = Array.from(changed);
      changed.clear();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("workspace:externalChange", { root, paths });
      }
    }, 300);
  };
  workspaceWatcher.on("add", onChange);
  workspaceWatcher.on("change", onChange);
  workspaceWatcher.on("unlink", onChange);
}

function virtualDocuments(project) {
  const documents = [
    { id: "AGENTS.md", title: "创作章程", content: String(project.agents || "") },
    {
      id: "outline/book.md",
      title: "全书蓝图",
      content: JSON.stringify(project.blueprint || {}, null, 2)
    }
  ];
  (project.blueprint?.characters || []).forEach((character) => {
    documents.push({
      id: `character:${character.id}`,
      title: `人物：${character.name}`,
      content: JSON.stringify(character, null, 2)
    });
  });
  (project.chapters || []).forEach((chapter) => {
    documents.push({
      id: `chapter:${chapter.id}`,
      title: `第 ${chapter.index} 章 ${chapter.title}`,
      content: String(chapter.content || "")
    });
  });
  return documents;
}

function fitTaskContext(context, settings) {
  const contextWindow = Number(settings?.contextWindow) || 128000;
  const maxOutputTokens = Number(settings?.maxOutputTokens) || 16384;
  const inputTokenBudget = contextWindow - maxOutputTokens - 4000;
  if (inputTokenBudget < 4000) {
    throw new Error("模型上下文容量不足，或单次输出上限设置得过大。请调整模型设置。" );
  }
  const charBudget = Math.floor(inputTokenBudget * 1.2);
  const next = structuredClone(context);
  next.documentDirectory = (next.documents || []).map((item) => ({ id: item.id, title: item.title }));
  const size = () => JSON.stringify({
    agents: next.agents,
    materials: next.materials,
    memory: next.memory,
    recentChapters: next.recentChapters,
    conversationHistory: next.conversationHistory,
    documentDirectory: next.documentDirectory
  }).length;
  const sections = Object.keys(next.memory || {});
  while (size() > charBudget && next.documentDirectory.length > 30) {
    next.documentDirectory = next.documentDirectory.slice(-Math.max(30, Math.ceil(next.documentDirectory.length / 2)));
  }
  while (size() > charBudget && sections.some((key) => (next.memory[key] || []).length > 8)) {
    for (const key of sections) {
      const items = next.memory[key] || [];
      if (items.length > 8) next.memory[key] = items.slice(-Math.max(8, Math.ceil(items.length / 2)));
    }
  }
  while (size() > charBudget && next.recentChapters.length > 1) next.recentChapters.shift();
  while (size() > charBudget && next.conversationHistory.length > 8) next.conversationHistory.shift();
  if (size() > charBudget) {
    throw new Error("创作章程、当前目标和必要冲突资料已超过模型可处理范围；任务没有静默截断。请使用更大上下文的模型。" );
  }
  return next;
}

async function buildTaskContext(project, workspaceRoot, target, settings, conversationHistory = []) {
  const documents = workspaceRoot
    ? await listDocuments(workspaceRoot)
    : virtualDocuments(project);
  return fitTaskContext({
    agents: String(project.agents || "尚未建立创作章程。"),
    materials: {
      project: { id: project.id, title: project.title },
      target
    },
    memory: {},
    recentChapters: [],
    conversationHistory: Array.isArray(conversationHistory) ? conversationHistory.slice(-40) : [],
    documents
  }, settings);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
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

  if (entry.type === "error") {
    await mainWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`<main style="font-family:sans-serif;padding:40px"><h1>Noval 无法启动</h1><p>${entry.value}</p></main>`)}`
    );
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

ipcMain.handle("workspace:chooseCreatePath", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "选择新项目文件夹",
    buttonLabel: "使用此文件夹",
    properties: ["openDirectory", "createDirectory", "promptToCreate"]
  });
  return canceled || !filePaths[0]
    ? { canceled: true }
    : { canceled: false, filePath: filePaths[0] };
});

ipcMain.handle("workspace:create", async (_event, { project, root }) => {
  if (!root) return { canceled: false, error: "请填写项目文件地址。" };
  try {
    workspaceWriteUntil = Date.now() + 1500;
    const result = await createWorkspaceAtPath(root, project);
    await startWorkspaceWatcher(result.root);
    await taskManager?.loadWorkspaceTasks(result.root);
    return { canceled: false, filePath: result.root, ...result };
  } catch (error) {
    return { canceled: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle("workspace:open", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "打开小说创作空间",
    properties: ["openDirectory"]
  });
  if (canceled || !filePaths[0]) return { canceled: true };
  try {
    const result = await loadWorkspace(filePaths[0]);
    await startWorkspaceWatcher(result.root);
    const tasks = await taskManager?.loadWorkspaceTasks(result.root);
    return { canceled: false, filePath: result.root, ...result, tasks: tasks || [] };
  } catch (error) {
    return { canceled: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle("workspace:openPath", async (_event, { root }) => {
  if (!root) return { error: "缺少创作空间路径。" };
  try {
    const result = await loadWorkspace(root);
    await startWorkspaceWatcher(result.root);
    const tasks = await taskManager?.loadWorkspaceTasks(result.root);
    return { canceled: false, filePath: result.root, ...result, tasks: tasks || [] };
  } catch (error) {
    return { canceled: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle(
  "workspace:save",
  async (_event, { root, project, expectedRevisions, force = false }) => {
    if (!root) return { ok: false, error: "当前项目还没有创作空间。" };
    try {
      workspaceWriteUntil = Date.now() + 1500;
      const result = await saveWorkspace(root, project, { expectedRevisions, force });
      if (!result.ok) return result;
      return { ok: true, filePath: root, ...result };
    } catch (error) {
      return { ok: false, error: safeErrorMessage(error) };
    }
  }
);

ipcMain.handle("workspace:reload", async (_event, { root }) => {
  try {
    const result = await loadWorkspace(root);
    return { ok: true, filePath: root, ...result };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle("workspace:listFiles", async (_event, { root }) => {
  try {
    return { ok: true, data: await listWorkspaceFiles(root) };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error), data: [] };
  }
});

ipcMain.handle("workspace:readFile", async (_event, { root, relativePath }) => {
  try {
    return { ok: true, data: await readWorkspaceFile(root, relativePath) };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle("workspace:mergeConflict", async (_event, { root, relativePath, content }) => {
  try {
    if (!root || !relativePath) return { ok: false, error: "缺少冲突文件信息。" };
    const target = assertInside(root, path.join(root, relativePath));
    workspaceWriteUntil = Date.now() + 1500;
    await ensureParentDir(target);
    await fs.writeFile(target, String(content || ""), "utf8");
    const result = await loadWorkspace(root);
    return { ok: true, filePath: root, ...result };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle("workspace:importLegacy", async () => {
  const source = await dialog.showOpenDialog({
    title: "选择旧版小说项目",
    properties: ["openFile"],
    filters: [{ name: "Noval JSON", extensions: ["json"] }]
  });
  if (source.canceled || !source.filePaths[0]) return { canceled: true };
  const destination = await dialog.showOpenDialog({
    title: "选择新创作空间的保存位置",
    properties: ["openDirectory", "createDirectory"]
  });
  if (destination.canceled || !destination.filePaths[0]) return { canceled: true };
  try {
    const raw = JSON.parse(await fs.readFile(source.filePaths[0], "utf8"));
    const project = normalizeProject(raw).project;
    workspaceWriteUntil = Date.now() + 1500;
    const result = await createWorkspace(destination.filePaths[0], project);
    await startWorkspaceWatcher(result.root);
    return {
      canceled: false,
      filePath: result.root,
      ...result,
      migration: { sourcePath: source.filePaths[0], sourcePreserved: true }
    };
  } catch (error) {
    return { canceled: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle("workspace:importNovel", async (_event, { project }) => {
  const source = await dialog.showOpenDialog({
    title: "选择已有小说正文",
    properties: ["openFile"],
    filters: [{ name: "文本或 Markdown", extensions: ["txt", "md", "markdown"] }]
  });
  if (source.canceled || !source.filePaths[0]) return { canceled: true };
  const destination = await dialog.showOpenDialog({
    title: "选择新创作空间的保存位置",
    properties: ["openDirectory", "createDirectory"]
  });
  if (destination.canceled || !destination.filePaths[0]) return { canceled: true };
  try {
    workspaceWriteUntil = Date.now() + 1500;
    const result = await importNovel(destination.filePaths[0], source.filePaths[0], project);
    await startWorkspaceWatcher(result.root);
    return {
      canceled: false,
      filePath: result.root,
      ...result,
      import: { sourcePath: source.filePaths[0], requiresArchiveConfirmation: true }
    };
  } catch (error) {
    return { canceled: false, error: safeErrorMessage(error) };
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

ipcMain.handle("model:probe", async (_event, settings) => {
  if (!taskManager) return { ok: false, error: "Pi 后台尚未准备完成。" };
  try {
    return await taskManager.probe(settings);
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle("task:start", async (_event, payload) => {
  if (!taskManager) return { ok: false, error: "Pi 后台尚未准备完成。" };
  try {
    const project = normalizeProject(payload.project).project;
    project.agents = String(payload.project?.agents || "");
    project.creationMode = String(payload.project?.creationMode || "平衡型");
    const taskType = payload.taskType || classifyTask(payload.instruction, payload.target?.docType);
    const taskSettings = await readSettings();
    if (taskSettings.capabilityStatus !== "ready") {
      return { ok: false, error: "当前模型尚未通过完整创作能力检查。" };
    }
    const context = await buildTaskContext(project, payload.workspaceRoot || "", payload.target, taskSettings, payload.conversationHistory);
    const task = await taskManager.start({
      taskType,
      instruction: payload.instruction,
      target: payload.target,
      context,
      settings: taskSettings,
      baseRevisions: payload.expectedRevisions || {},
      workspaceRoot: payload.workspaceRoot || "",
      projectId: project.id,
      conversationId: payload.conversationId,
      conversationTitle: payload.conversationTitle
    });
    return { ok: true, task };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle("task:stop", async (_event, { taskId }) => {
  try {
    const task = await taskManager?.stop(taskId);
    return task ? { ok: true, task } : { ok: false, error: "任务不存在。" };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle("task:answer", async (_event, payload) => {
  if (!taskManager) return { ok: false, error: "Pi 后台尚未准备完成。" };
  try {
    const project = normalizeProject(payload.project).project;
    project.agents = String(payload.project?.agents || "");
    const settings = await readSettings();
    if (settings.capabilityStatus !== "ready") {
      return { ok: false, error: "当前模型尚未通过完整创作能力检查。" };
    }
    const context = await buildTaskContext(project, payload.workspaceRoot || "", payload.target, settings, payload.conversationHistory);
    const task = await taskManager.answer(payload.taskId, payload.answer, { context, settings });
    return { ok: true, task };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle("task:list", async (_event, { projectId, workspaceRoot }) => {
  try {
    if (workspaceRoot) await taskManager?.loadWorkspaceTasks(workspaceRoot);
    return { ok: true, data: taskManager?.list(projectId) || [] };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error), data: [] };
  }
});

ipcMain.handle("task:get", async (_event, { taskId }) => {
  const task = taskManager?.get(taskId);
  return task ? { ok: true, data: task } : { ok: false, error: "任务不存在。" };
});

ipcMain.handle("task:confirm", async (_event, payload) => {
  try {
    const pendingTask = taskManager?.get(payload.taskId);
    if (!pendingTask || pendingTask.status !== "awaiting_confirmation") {
      return { ok: false, error: "当前任务不在等待确认状态，正式作品没有修改。" };
    }
    let saveResult = null;
    const candidateChanges = Array.isArray(payload.changes)
      ? payload.changes
      : pendingTask.result?.kind === "candidate" && Array.isArray(pendingTask.result?.changes)
        ? pendingTask.result.changes
        : [];
    if (payload.workspaceRoot && candidateChanges.length) {
      workspaceWriteUntil = Date.now() + 1500;
      saveResult = await applyWorkspaceChanges(payload.workspaceRoot, candidateChanges, {
        expectedRevisions: pendingTask.baseRevisions || payload.expectedRevisions || {},
        force: Boolean(payload.force)
      });
      if (!saveResult.ok) return saveResult;
    } else if (payload.workspaceRoot && payload.project) {
      workspaceWriteUntil = Date.now() + 1500;
      saveResult = await saveWorkspace(payload.workspaceRoot, payload.project, {
        expectedRevisions: pendingTask.baseRevisions || payload.expectedRevisions || {},
        force: Boolean(payload.force)
      });
      if (!saveResult.ok) return saveResult;
    }
    const task = await taskManager.decide(payload.taskId, "accept");
    return {
      ok: true,
      task,
      data: saveResult?.data || payload.project,
      revisions: saveResult?.revisions || payload.expectedRevisions || {}
    };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle("task:reject", async (_event, { taskId }) => {
  try {
    return { ok: true, task: await taskManager.decide(taskId, "reject") };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle("task:abandon", async (_event, { taskId }) => {
  try {
    return { ok: true, task: await taskManager.abandon(taskId) };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle("autosave:save", async (_event, payload) => {
  const filePath = AUTOSAVE_PATH();
  const currentPath = String(payload?.currentPath || "");
  const isWorkspace = Boolean(currentPath && !currentPath.toLowerCase().endsWith(".json"));
  const normalized = isWorkspace
    ? {
        snapshot: {
          savedAt: new Date().toISOString(),
          currentPath,
          currentChapterId: String(payload?.currentChapterId || ""),
          route: String(payload?.route || "home"),
          project: null
        },
        meta: { migrated: false }
      }
    : normalizeAutosaveSnapshot({
        savedAt: new Date().toISOString(),
        currentPath,
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
  if (!snapshot?.project && !snapshot?.currentPath) {
    return {
      ok: true,
      data: null
    };
  }

  if (!snapshot.project && snapshot.currentPath) return { ok: true, data: snapshot, meta: { migrated: false } };
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

app.whenReady().then(() => {
  taskManager = new TaskManager({
    utilityProcess,
    workerPath: path.join(__dirname, "services", "pi-worker.mjs"),
    userDataDir: app.getPath("userData"),
    onEvent: (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("task:event", payload);
      }
    }
  });
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  if (workspaceWatcher) void workspaceWatcher.close();
  if (taskManager?.worker) taskManager.worker.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
