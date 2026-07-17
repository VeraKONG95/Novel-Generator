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
const { WorkflowTaskRunner } = require("./services/workflow-task-runner");
const { classifyTask } = require("./services/pi-prompts");
const { AnalysisOrchestrator } = require("./services/analysis-orchestrator");
const { UtilityAnalysisExecutor } = require("./services/analysis-worker-executor");
const { readCurrentGeneration, readGraph, resolveEvidence } = require("./services/analysis/graph-store");
const { selectWritingContext } = require("./services/analysis/context-selector");
const { ChapterAnalysisQueue } = require("./services/analysis/chapter-analysis-queue");
const { detectChangedChapterPaths } = require("./services/analysis/chapter-change-detector");
const { shouldRetryWithFreshContext } = require("./services/fresh-context-retry");

if (process.env.NOVAL_USER_DATA_DIR) {
  app.setPath("userData", path.resolve(process.env.NOVAL_USER_DATA_DIR));
}

const SETTINGS_PATH = () => path.join(app.getPath("userData"), "settings.json");
const AUTOSAVE_PATH = () => path.join(app.getPath("userData"), "autosave-recovery.json");
const DRAFTS_DIR = () => path.join(app.getPath("userData"), "draft-projects");

let mainWindow = null;
let taskManager = null;
let analysisOrchestrator = null;
let analysisWorkerExecutor = null;
let workflowTaskRunner = null;
let workspaceWatcher = null;
let workspaceWriteUntil = 0;
const autoApplyingTaskIds = new Set();
const chapterAnalysisQueue = new ChapterAnalysisQueue({
  isBlocked: async (root) => Boolean(activeTaskAtWorkspace(root) || analysisOrchestrator?.getActiveStatus(root)),
  start: async (root, paths) => {
    const loaded = await loadWorkspace(root);
    return startWorkspaceAnalysis(root, loaded.data, { workflowId: "WF02", input: { changedPaths: paths } });
  }
});

function queueChapterAnalysis(root, paths) {
  return chapterAnalysisQueue.enqueue(root, paths);
}

function activeTaskAtWorkspace(root) {
  const active = taskManager?.activeTaskId ? taskManager.get(taskManager.activeTaskId) : null;
  return active?.workspaceRoot && path.resolve(active.workspaceRoot) === path.resolve(String(root || "")) ? active : null;
}

async function drainChapterAnalysis(root) {
  return chapterAnalysisQueue.drain(root);
}

function analysisChapters(project) {
  return (project.chapters || []).map((chapter) => ({
    id: chapter.id,
    index: chapter.index,
    title: chapter.title,
    path: `chapters/${String(chapter.index).padStart(4, "0")}.md`,
    content: chapter.content
  }));
}

async function startWorkspaceAnalysis(root, project, { workflowId = "WF01", input = {}, maxConcurrency } = {}) {
  if (!analysisOrchestrator) throw new Error("分析后台尚未准备完成。");
  const settings = await readSettings();
  if (settings.capabilityStatus !== "ready") {
    throw new Error("请先配置并检查模型，再开始小说分析。");
  }
  const allChapters = analysisChapters(project);
  let chapters = allChapters;
  let workflowInput = input && typeof input === "object" ? { ...input } : {};
  if (workflowId === "WF02" && Array.isArray(input.changedPaths) && input.changedPaths.length) {
    const changed = new Set(input.changedPaths.map((item) => String(item).replace(/\\/g, "/")));
    chapters = chapters.filter((chapter) => changed.has(chapter.path) || changed.has(chapter.id));
    const existingPaths = new Set(allChapters.map((chapter) => chapter.path));
    let deletedChapters = [];
    try {
      const current = await readCurrentGeneration(root);
      deletedChapters = (current?.manifest?.coveredChapters || []).filter((chapter) =>
        changed.has(String(chapter.sourcePath || "").replace(/\\/g, "/")) && !existingPaths.has(chapter.sourcePath)
      );
    } catch {
      // A damaged current generation is reported by the workflow itself.
    }
    workflowInput = {
      ...workflowInput,
      changedPaths: Array.from(changed),
      deletedChapters,
      allChapters: allChapters.map(({ content, ...chapter }) => chapter)
    };
  }
  return analysisOrchestrator.start({
    workspaceRoot: root,
    projectId: project.id,
    workflowId,
    settings,
    maxConcurrency: maxConcurrency || settings.analysisMaxConcurrency || project.analysisSettings?.maxConcurrency || 4,
    chapters,
    input: workflowInput
  });
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function autoApplyCandidateTask(task) {
  if (!taskManager || autoApplyingTaskIds.has(task.id)) return;
  autoApplyingTaskIds.add(task.id);
  try {
    const current = taskManager.get(task.id);
    if (
      !current ||
      current.status !== "awaiting_confirmation" ||
      current.result?.kind !== "candidate" ||
      !current.workspaceRoot
    ) return;

    const rawChanges = Array.isArray(current.result.changes) ? current.result.changes : [];
    const changes = await Promise.all(rawChanges.map(async (change) => {
      let beforeContent = "";
      try {
        const previous = await readWorkspaceFile(current.workspaceRoot, change.path);
        beforeContent = String(previous.content || "");
      } catch {
        beforeContent = "";
      }
      return { ...change, beforeContent };
    }));

    workspaceWriteUntil = Date.now() + 1500;
    const guardPaths = current.workflowRunId
      ? Object.keys(current.baseRevisions || {}).filter((relativePath) =>
          relativePath === "AGENTS.md" ||
          relativePath === "knowledge/CURRENT.json" ||
          relativePath.startsWith("chapters/") ||
          current.result?.contextSelection?.materialIds?.includes(relativePath)
        )
      : [];
    const saveResult = await applyWorkspaceChanges(current.workspaceRoot, changes, {
      expectedRevisions: current.baseRevisions || {},
      guardPaths,
      force: false
    });
    if (!saveResult.ok) {
      const retryWithFreshContext = shouldRetryWithFreshContext({
        conflicts: saveResult.conflicts,
        workflowRunId: current.workflowRunId,
        contextRetryCount: current.contextRetryCount,
        analysisActive: Boolean(analysisOrchestrator?.getActiveStatus(current.workspaceRoot))
      });
      if (retryWithFreshContext) {
        const loaded = await loadWorkspace(current.workspaceRoot);
        const retrySettings = await readSettings();
        const retryContext = await buildTaskContext(
          loaded.data,
          current.workspaceRoot,
          current.target,
          retrySettings,
          [],
          { taskType: current.taskType, instruction: current.instruction }
        );
        await taskManager.start({
          taskType: current.taskType,
          instruction: current.instruction,
          target: current.target,
          context: retryContext,
          settings: retrySettings,
          baseRevisions: loaded.revisions || {},
          workspaceRoot: current.workspaceRoot,
          projectId: current.projectId,
          conversationId: current.conversationId,
          conversationTitle: current.conversationTitle,
          contextRetryCount: 1
        });
        await taskManager.decide(current.id, "reject", {
          ...current.result,
          changes,
          contextChanged: true,
          retriedWithFreshContext: true
        });
        return;
      }
      await taskManager.updateTask(
        current.id,
        {
          status: "awaiting_confirmation",
          error: "项目文件在生成期间发生了变化，本次修改没有自动写入。",
          result: { ...current.result, changes, conflicts: saveResult.conflicts || [], autoApplyBlocked: true },
          finishedAt: ""
        },
        { type: "error", status: "failed", text: "文件变化导致自动写入暂停" }
      );
      return;
    }

    if (current.taskType === "import_novel" && saveResult.data) {
      workspaceWriteUntil = Date.now() + 1500;
      const confirmedProject = { ...saveResult.data, importStatus: "confirmed" };
      const confirmationResult = await saveWorkspace(current.workspaceRoot, confirmedProject, {
        expectedRevisions: saveResult.revisions || {},
        force: false
      });
      if (!confirmationResult.ok) {
        throw new Error("作品档案已经生成，但确认状态保存失败，请重新打开项目后再试。");
      }
    }

    const changedChapterPaths = changes
      .map((change) => String(change.path || "").replace(/\\/g, "/"))
      .filter((relativePath) => /^chapters\/[^/]+\.md$/i.test(relativePath));
    if (changedChapterPaths.length) {
      queueChapterAnalysis(current.workspaceRoot, changedChapterPaths);
      await drainChapterAnalysis(current.workspaceRoot);
    }

    await taskManager.decide(current.id, "accept", {
      ...current.result,
      changes,
      autoAppliedAt: new Date().toISOString()
    });
  } catch (error) {
    const current = taskManager?.get(task.id);
    if (current?.status === "awaiting_confirmation") {
      await taskManager.updateTask(
        current.id,
        {
          status: "failed",
          error: `本次修改没有自动写入：${safeErrorMessage(error)}`,
          finishedAt: new Date().toISOString()
        },
        { type: "error", status: "failed", text: safeErrorMessage(error) }
      );
    }
  } finally {
    autoApplyingTaskIds.delete(task.id);
    if (task.workspaceRoot) void drainChapterAnalysis(task.workspaceRoot);
  }
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
      /(^|[/\\])\.noval[/\\]analysis[/\\]/,
      /(^|[/\\])knowledge[/\\]generations[/\\]/,
      /(^|[/\\])knowledge[/\\]\.CURRENT-.*\.json$/,
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

async function buildTaskContext(project, workspaceRoot, target, settings, conversationHistory = [], request = {}) {
  const documents = workspaceRoot
    ? await listDocuments(workspaceRoot)
    : virtualDocuments(project);
  let contextSelection = null;
  if (workspaceRoot) {
    try {
      const generation = await readCurrentGeneration(workspaceRoot);
      if (generation) {
        const readMaterial = async (relativePath) => {
          try { return await fs.readFile(path.join(generation.materialsRoot, relativePath), "utf8"); }
          catch { return ""; }
        };
        contextSelection = selectWritingContext({
          goal: request.instruction || "",
          targetCharacterIds: target?.characterIds || target?.participantCharacterIds || [],
          targetChapterIndex: target?.chapterIndex || ((project.chapters?.at(-1)?.index || 0) + 1),
          contextWindow: settings?.contextWindow,
          currentStage: await readMaterial("outline/stages/current.md"),
          style: await readMaterial("STYLE.md"),
          entities: generation.entities,
          events: generation.events,
          assertions: generation.assertions,
          relations: generation.relations,
          overrides: generation.overrides,
          storylines: generation.entities.filter((item) => ["storyline", "故事线"].includes(item.type)),
          hooks: generation.entities.filter((item) => ["hook", "伏笔"].includes(item.type)),
          chapters: project.chapters
        });
        documents.unshift({
          id: "analysis:writing-context",
          title: "本次创作的图谱材料包",
          content: JSON.stringify(contextSelection.sections, null, 2)
        });
      }
    } catch {
      // A missing graph is handled by task gating; ordinary legacy projects keep their old context path.
    }
  }
  return fitTaskContext({
    agents: String(project.agents || "尚未建立创作章程。"),
    materials: {
      project: { id: project.id, title: project.title },
      target
    },
    memory: contextSelection?.sections || {},
    recentChapters: contextSelection?.sections?.adjacentChapters || [],
    conversationHistory: Array.isArray(conversationHistory) ? conversationHistory.slice(-40) : [],
    documents,
    contextSelection: contextSelection ? {
      tokenBudget: contextSelection.tokenBudget,
      estimatedTokens: contextSelection.estimatedTokens,
      selectedEntityIds: contextSelection.selectedEntityIds,
      materialIds: ["analysis:writing-context"]
    } : null
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

ipcMain.handle("workspace:importNovel", async (event, { project }) => {
  const source = await dialog.showOpenDialog({
    title: "选择已有小说正文",
    properties: ["openFile"],
    filters: [{ name: "小说文件", extensions: ["txt", "md", "markdown", "pdf"] }]
  });
  if (source.canceled || !source.filePaths[0]) return { canceled: true };
  const destination = await dialog.showOpenDialog({
    title: "选择新创作空间的保存位置",
    properties: ["openDirectory", "createDirectory"]
  });
  if (destination.canceled || !destination.filePaths[0]) return { canceled: true };
  try {
    workspaceWriteUntil = Date.now() + 1500;
    const result = await importNovel(destination.filePaths[0], source.filePaths[0], project, {
      onProgress: (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send("workspace:importProgress", progress);
      }
    });
    await startWorkspaceWatcher(result.root);
    let analysis = null;
    const modelSettings = await readSettings();
    if (modelSettings.capabilityStatus === "ready") {
      analysis = await startWorkspaceAnalysis(result.root, result.data, { workflowId: "WF01" });
    }
    return {
      canceled: false,
      filePath: result.root,
      ...result,
      import: {
        sourcePath: source.filePaths[0],
        requiresArchiveConfirmation: false,
        ...(result.sourceInfo || {})
      },
      analysis
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

ipcMain.handle("analysis:start", async (_event, payload) => {
  try {
    const workflowId = payload.workflowId || "WF01";
    const activeTask = activeTaskAtWorkspace(payload.root);
    const activeAnalysis = analysisOrchestrator?.getActiveStatus(payload.root);
    if (activeTask || activeAnalysis) {
      if (workflowId === "WF02") {
        const queuedPaths = queueChapterAnalysis(payload.root, payload.input?.changedPaths || []);
        return { ok: true, data: null, queued: true, queuedPaths };
      }
      return { ok: false, error: "当前项目正在创作或更新图谱，请等待完成后再开始新的分析。" };
    }
    const loaded = await loadWorkspace(payload.root);
    const run = await startWorkspaceAnalysis(payload.root, loaded.data, {
      workflowId,
      input: payload.input || {},
      maxConcurrency: payload.maxConcurrency
    });
    return { ok: true, data: run };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle("analysis:status", async (_event, { root, runId } = {}) => {
  try {
    let current = runId
      ? analysisOrchestrator?.getStatus(runId)
      : analysisOrchestrator?.getActiveStatus(root);
    const latest = current ? null : await analysisOrchestrator?.readLatestStatus(root);
    let stalePaths = [];
    if (!current && root && (!latest || ["ready", "degraded"].includes(latest.status))) {
      try {
        const [generation, loaded] = await Promise.all([readCurrentGeneration(root), loadWorkspace(root)]);
        stalePaths = await detectChangedChapterPaths(root, generation, analysisChapters(loaded.data));
        if (stalePaths.length) {
          queueChapterAnalysis(root, stalePaths);
          await drainChapterAnalysis(root);
          current = analysisOrchestrator?.getActiveStatus(root);
        }
      } catch {
        // Existing status and graph errors are reported through their dedicated paths.
      }
    }
    let data = current || latest;
    if (!current && data?.status === "analyzing") {
      data = { ...data, status: "paused", stage: "应用重启后等待继续", recovered: true };
    }
    if (!current && stalePaths.length && data && ["ready", "degraded"].includes(data.status)) {
      data = {
        ...data,
        status: "raw_imported",
        runId: "",
        workflowId: "WF01",
        stage: "正文变化等待局部更新",
        blockingGaps: ["正文已经变化，关系图谱尚未更新"],
        recovered: false
      };
    }
    return { ok: true, data: data || null };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error), data: null };
  }
});

ipcMain.handle("analysis:pause", async (_event, { runId }) => {
  try {
    return { ok: true, data: await analysisOrchestrator.pause(runId) };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle("analysis:resume", async (_event, { root, runId }) => {
  try {
    const active = analysisOrchestrator.getStatus(runId);
    if (active) return { ok: true, data: await analysisOrchestrator.resume(runId) };
    const loaded = await loadWorkspace(root);
    const settings = await readSettings();
    const run = await analysisOrchestrator.resumeLatest({
      workspaceRoot: root,
      settings,
      chapters: analysisChapters(loaded.data)
    });
    return { ok: true, data: run };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle("analysis:cancel", async (_event, { runId }) => {
  try {
    const run = await analysisOrchestrator.cancel(runId);
    return run ? { ok: true, data: run } : { ok: false, error: "分析运行不存在。" };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle("analysis:retryFailed", async (_event, { root, workflowId, input } = {}) => {
  try {
    const previous = await analysisOrchestrator.readLatestStatus(root);
    const previousRequest = await analysisOrchestrator.readLatestRequest(root);
    const loaded = await loadWorkspace(root);
    const suppliedInput = input && typeof input === "object" && Object.keys(input).length ? input : null;
    const run = await startWorkspaceAnalysis(root, loaded.data, {
      workflowId: workflowId || previousRequest?.workflowId || previous?.workflowId || "WF01",
      input: suppliedInput || previousRequest?.input || {},
      maxConcurrency: previousRequest?.maxConcurrency
    });
    return { ok: true, data: run };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle("analysis:setConcurrency", async (_event, { runId, maxConcurrency }) => {
  try {
    const data = analysisOrchestrator.setConcurrency(runId, maxConcurrency);
    const settings = await readSettings();
    await ensureParentDir(SETTINGS_PATH());
    await fs.writeFile(SETTINGS_PATH(), JSON.stringify({ ...settings, analysisMaxConcurrency: data.maxConcurrency }, null, 2), "utf8");
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle("graph:get", async (_event, { root }) => {
  try {
    return { ok: true, data: await readGraph(root) };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error), data: null };
  }
});

ipcMain.handle("graph:resolveEvidence", async (_event, { root, ref }) => {
  try {
    return { ok: true, data: await resolveEvidence(root, ref) };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error), data: null };
  }
});

ipcMain.handle("task:start", async (_event, payload) => {
  if (!taskManager) return { ok: false, error: "Pi 后台尚未准备完成。" };
  try {
    const project = normalizeProject(payload.project).project;
    project.agents = String(payload.project?.agents || "");
    project.creationMode = String(payload.project?.creationMode || "平衡型");
    const taskType = payload.taskType || classifyTask(payload.instruction, payload.target?.docType);
    if (payload.workspaceRoot) {
      const activeAnalysis = analysisOrchestrator?.getActiveStatus(payload.workspaceRoot);
      const latestAnalysis = activeAnalysis || await analysisOrchestrator?.readLatestStatus(payload.workspaceRoot);
      const blocksCreation = activeAnalysis && ["analyzing", "paused"].includes(activeAnalysis.status);
      const projectAnalysisBlocks = ["raw_imported", "analyzing", "paused", "failed", "cancelled"]
        .includes(String(project.analysis?.status || project.importStatus || "")) &&
        !["ready", "degraded"].includes(latestAnalysis?.status);
      if (blocksCreation || projectAnalysisBlocks) {
        return { ok: false, error: "小说分析完成前只能查看文件和图谱，暂时不能开始新的创作任务。" };
      }
    }
    const taskSettings = await readSettings();
    if (taskSettings.capabilityStatus !== "ready") {
      return { ok: false, error: "当前模型尚未通过完整创作能力检查。" };
    }
    const context = await buildTaskContext(project, payload.workspaceRoot || "", payload.target, taskSettings, payload.conversationHistory, {
      taskType,
      instruction: payload.instruction
    });
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
    const context = await buildTaskContext(project, payload.workspaceRoot || "", payload.target, settings, payload.conversationHistory, {
      taskType: payload.taskType,
      instruction: payload.answer
    });
    const task = await taskManager.answer(payload.taskId, payload.answer, { context, settings });
    return { ok: true, task };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
});

ipcMain.handle("task:list", async (_event, { projectId, workspaceRoot }) => {
  try {
    if (workspaceRoot) await taskManager?.loadWorkspaceTasks(workspaceRoot);
    const tasks = taskManager?.list(projectId) || [];
    tasks
      .filter((task) => task.status === "awaiting_confirmation" && task.result?.kind === "candidate" && !task.result?.autoApplyBlocked)
      .forEach((task) => void autoApplyCandidateTask(task));
    return { ok: true, data: tasks };
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
  analysisWorkerExecutor = new UtilityAnalysisExecutor({
    utilityProcess,
    workerPath: path.join(__dirname, "services", "pi-analysis-worker.mjs")
  });
  analysisOrchestrator = new AnalysisOrchestrator({
    executeJob: (job, execution) => analysisWorkerExecutor.execute(job, execution),
    onEvent: (payload) => {
      if (payload?.category !== "creative_task" && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("analysis:event", payload);
      }
      if (["ready", "degraded", "failed", "cancelled"].includes(payload?.status)) {
        const run = analysisOrchestrator?.runs?.get(payload.runId);
        if (run?.workspaceRoot) setTimeout(() => { void drainChapterAnalysis(run.workspaceRoot); }, 0);
      }
    }
  });
  workflowTaskRunner = new WorkflowTaskRunner({ orchestrator: analysisOrchestrator });
  taskManager = new TaskManager({
    utilityProcess,
    workerPath: path.join(__dirname, "services", "pi-worker.mjs"),
    userDataDir: app.getPath("userData"),
    workflowRunner: workflowTaskRunner,
    onEvent: (payload) => {
      if (
        payload?.task?.status === "awaiting_confirmation" &&
        payload?.task?.result?.kind === "candidate" &&
        !payload?.task?.result?.autoApplyBlocked
      ) {
        void autoApplyCandidateTask(payload.task);
        return;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("task:event", payload);
      }
      if (payload?.task?.workspaceRoot && ["completed", "stopped", "failed", "interrupted", "rejected", "abandoned"].includes(payload.task.status)) {
        setTimeout(() => { void drainChapterAnalysis(payload.task.workspaceRoot); }, 0);
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
  if (analysisWorkerExecutor) void analysisWorkerExecutor.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
