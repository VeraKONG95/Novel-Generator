import { createInitialState, defaultProject } from "./app/state.mjs";
import {
  buildExportContent,
  chapterPlanFor,
  createChapter,
  getCurrentChapter,
  markUpdated,
  mergeProjectMemory,
  refreshMemory,
  saveRecentProject,
  setProjectMemory
} from "./app/project-helpers.mjs";
import { wait } from "./app/utils.mjs";
import { renderApp } from "./app/views.mjs";

const state = createInitialState();
const AUTOSAVE_DELAY = 1200;
let autosaveTimer = null;
let autosaveInFlight = null;

function render() {
  const app = document.getElementById("app");
  app.innerHTML = renderApp(state);
  bindEvents();
}

function setStatus(message) {
  state.status = message;
  render();
}

function buildAutosavePayload() {
  return {
    project: state.project,
    currentPath: state.currentPath,
    currentChapterId: state.currentChapterId,
    route: state.route
  };
}

async function persistAutosaveSnapshot() {
  try {
    autosaveInFlight = window.novalAPI.saveAutosave(buildAutosavePayload());
    await autosaveInFlight;
  } catch {
    // 自动保存失败时不打断用户操作，保留下一次重试机会。
  } finally {
    autosaveInFlight = null;
  }
}

function scheduleAutosave() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
  }

  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    void persistAutosaveSnapshot();
  }, AUTOSAVE_DELAY);
}

async function clearAutosaveSnapshot() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  if (autosaveInFlight) {
    await autosaveInFlight;
  }

  await window.novalAPI.clearAutosave();
}

function bindEvents() {
  document.querySelectorAll("[data-route]").forEach((element) => {
    element.addEventListener("click", () => {
      state.route = element.dataset.route;
      render();
    });
  });

  document.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", () =>
      handleAction(element.dataset.action, element.dataset.chapterId)
    );
  });

  document.querySelectorAll("input[data-field], textarea[data-field]").forEach((element) => {
    element.addEventListener("input", handleFieldChange);
  });
}

function chapterEditorSelection() {
  const editor = document.querySelector('textarea.editor[data-field="chapterContent"]');
  if (!editor) {
    return {
      value: "",
      start: 0,
      end: 0,
      text: ""
    };
  }

  const value = editor.value || "";
  const start = Number(editor.selectionStart) || 0;
  const end = Number(editor.selectionEnd) || 0;

  return {
    value,
    start,
    end,
    text: value.slice(start, end)
  };
}

function handleFieldChange(event) {
  const field = event.target.dataset.field;
  const scope = event.target.dataset.scope;
  const value = event.target.value;

  if (scope === "setup") {
    if (field === "bookTitle") {
      state.project.title = value;
    } else if (field === "targetWords") {
      state.project.setup[field] = Number(value) || 0;
    } else {
      state.project.setup[field] = value;
    }
  }

  if (scope === "settings") {
    state.settings[field] = value;
  }

  if (scope === "chapter") {
    const chapter = getCurrentChapter(state);
    if (!chapter) return;
    if (field === "chapterTitle") chapter.title = value;
    if (field === "chapterSummary") chapter.summary = value;
    if (field === "chapterContent") chapter.content = value;
  }

  if (!scope && field === "chapterInstruction") {
    const chapter = getCurrentChapter(state);
    if (chapter) chapter.instruction = value;
  }

  markUpdated(state);
  scheduleAutosave();
}

async function handleAction(action, chapterId) {
  if (action === "new-project") {
    state.project = defaultProject();
    state.currentChapterId = null;
    state.currentPath = "";
    state.route = "setup";
    await clearAutosaveSnapshot();
    setStatus("已创建新项目。");
    return;
  }

  if (action === "prefill-demo") {
    state.project = defaultProject();
    state.currentChapterId = null;
    state.currentPath = "";
    state.route = "setup";
    await clearAutosaveSnapshot();
    setStatus("已填入示例设定。");
    return;
  }

  if (action === "generate-blueprint") {
    await generateBlueprint();
    return;
  }

  if (action === "new-chapter") {
    const chapter = createChapter(state);
    scheduleAutosave();
    setStatus(`已创建第 ${chapter.index} 章。`);
    return;
  }

  if (action === "select-chapter") {
    state.currentChapterId = chapterId;
    render();
    return;
  }

  if (action === "generate-chapter") {
    await generateChapter(false);
    return;
  }

  if (action === "continue-chapter") {
    await generateChapter(true);
    return;
  }

  if (action === "polish-text") {
    await rewriteChapterText("polish");
    return;
  }

  if (action === "expand-text") {
    await rewriteChapterText("expand");
    return;
  }

  if (action === "compress-text") {
    await rewriteChapterText("compress");
    return;
  }

  if (action === "rewrite-chapter-draft") {
    await rewriteChapterText("rewrite_chapter");
    return;
  }

  if (action === "refresh-memory") {
    await refreshProjectMemory();
    return;
  }

  if (action === "save-settings") {
    await window.novalAPI.saveSettings(state.settings);
    setStatus("模型设置已保存。");
    return;
  }

  if (action === "save-project") {
    await saveProject();
    return;
  }

  if (action === "open-project") {
    await openProject();
    return;
  }

  if (action === "export-markdown") {
    await exportDocument("markdown");
  }
}

async function saveProject() {
  markUpdated(state);
  const payload = state.project;
  let result;

  if (state.currentPath) {
    result = await window.novalAPI.saveProjectToPath(state.currentPath, payload);
  } else {
    result = await window.novalAPI.saveProject(payload);
  }

  if (result?.error) {
    setStatus(`项目保存失败：${result.error}`);
    return;
  }

  if (!result.canceled) {
    if (result.data) {
      state.project = result.data;
    }
    state.currentPath = result.filePath;
    saveRecentProject(state, result.filePath);
    await clearAutosaveSnapshot();
    setStatus(
      `项目已保存到 ${result.filePath}${
        result.meta?.migrated ? "，并已按当前版本格式重写。" : ""
      }`
    );
  }
}

async function openProject() {
  const result = await window.novalAPI.openProject();
  if (result.canceled) return;
  if (result.error) {
    setStatus(`打开项目失败：${result.error}`);
    return;
  }

  state.project = result.data;
  setProjectMemory(state, state.project.memory);
  state.currentPath = result.filePath;
  state.currentChapterId = state.project.chapters[0]?.id || null;
  state.route = "home";
  saveRecentProject(state, result.filePath);
  await clearAutosaveSnapshot();
  setStatus(
    `已打开项目 ${result.filePath}${
      result.meta?.migrated ? "，旧版项目已自动迁移到当前格式。" : ""
    }`
  );
}

async function exportDocument(format) {
  const title = state.project.title || "noval-export";
  const content = buildExportContent(state, format);
  const result = await window.novalAPI.exportDocument(format, title, content);
  if (!result.canceled) {
    setStatus(`已导出到 ${result.filePath}`);
  }
}

async function generateBlueprint() {
  setStatus("正在生成蓝图...");
  await wait(120);

  const result = await window.novalAPI.generateBlueprint({
    title: state.project.title,
    setup: state.project.setup
  });

  if (!result?.ok) {
    setStatus("蓝图生成失败，请检查模型设置。");
    return;
  }

  state.project.blueprint = result.data;
  state.project.title = result.data.titleOptions?.[0] || state.project.title;
  refreshMemory(state);
  markUpdated(state);
  scheduleAutosave();
  state.route = "blueprint";
  if (result.mode === "api") {
    setStatus("蓝图已生成（模型输出）。下一步可以直接创建第 1 章。");
    return;
  }

  if (result.reason === "missing_api_key") {
    setStatus("未配置 API Key，已使用本地模板生成蓝图。");
    return;
  }

  setStatus(`模型调用失败，已回退到本地模板生成蓝图。${result.warning ? `原因：${result.warning}` : ""}`);
}

async function refreshProjectMemory() {
  setStatus("正在刷新记忆库...");
  await wait(120);

  try {
    const result = await window.novalAPI.refreshMemory({
      project: state.project
    });

    if (!result?.ok) {
      refreshMemory(state);
      scheduleAutosave();
      setStatus("记忆刷新失败，已回退到本地规则整理。");
      return;
    }

    setProjectMemory(state, result.data);
    markUpdated(state);
    scheduleAutosave();

    if (result.mode === "api") {
      setStatus("已刷新记忆库（模型整理）。");
      return;
    }

    if (result.reason === "missing_api_key") {
      setStatus("未配置 API Key，已使用本地规则刷新记忆库。");
      return;
    }

    setStatus(
      `模型调用失败，已回退到本地规则刷新记忆库。${
        result.warning ? `原因：${result.warning}` : ""
      }`
    );
  } catch (error) {
    refreshMemory(state);
    scheduleAutosave();
    setStatus(
      `记忆刷新失败，已回退到本地规则。${
        error instanceof Error ? `原因：${error.message}` : ""
      }`
    );
  }
}

async function analyzeGeneratedChapter(chapter) {
  try {
    const result = await window.novalAPI.analyzeChapter({
      project: state.project,
      chapter
    });

    if (!result?.ok) {
      refreshMemory(state);
      return {
        ok: true,
        mode: "fallback",
        reason: "invalid_response"
      };
    }

    chapter.summary = result.data.summary || chapter.summary;
    mergeProjectMemory(state, result.data.memory);
    chapter.updatedAt = new Date().toISOString();
    markUpdated(state);
    scheduleAutosave();
    return result;
  } catch (error) {
    refreshMemory(state);
    scheduleAutosave();
    return {
      ok: true,
      mode: "fallback",
      reason: "analysis_error",
      warning: error instanceof Error ? error.message : String(error)
    };
  }
}

function generationStatusText(result, chapterIndex, verb) {
  if (result.mode === "api") {
    return `第 ${chapterIndex} 章${verb}（模型输出）`;
  }

  if (result.reason === "missing_api_key") {
    return `未配置 API Key，第 ${chapterIndex} 章已使用本地模板${verb}`;
  }

  return `模型调用失败，已回退到本地模板完成第 ${chapterIndex} 章${verb}${
    result.warning ? `。原因：${result.warning}` : ""
  }`;
}

function analysisStatusText(result) {
  if (result.mode === "api") {
    return "摘要与记忆已同步。";
  }

  if (result.reason === "missing_api_key") {
    return "摘要与记忆已按本地规则更新。";
  }

  return `摘要与记忆已回退到本地规则更新。${
    result.warning ? `原因：${result.warning}` : ""
  }`;
}

function rewriteActionLabel(mode) {
  const labels = {
    polish: "润色",
    expand: "扩写",
    compress: "压缩",
    rewrite_chapter: "重写本章"
  };
  return labels[mode] || "改写";
}

function rewriteStatusText(result, label, target, usedFallbackTarget) {
  const targetText = usedFallbackTarget ? "未检测到选中文本，已作用于整章" : target === "selected" ? "已处理选中片段" : "已处理整章";
  if (result.mode === "api") {
    return `${label}完成（模型输出，${targetText}）`;
  }

  if (result.reason === "missing_api_key") {
    return `未配置 API Key，已用本地规则完成${label}（${targetText}）`;
  }

  return `模型调用失败，已回退到本地规则完成${label}（${targetText}）${
    result.warning ? `。原因：${result.warning}` : ""
  }`;
}

async function rewriteChapterText(mode) {
  const chapter = getCurrentChapter(state);
  if (!chapter) {
    setStatus("请先选择一个章节。");
    return;
  }

  if (!String(chapter.content || "").trim()) {
    setStatus("当前章节还没有正文，先生成或写入内容再改写。");
    return;
  }

  const selection = chapterEditorSelection();
  const usedFallbackTarget =
    mode !== "rewrite_chapter" && !String(selection.text || "").trim();
  const target = mode === "rewrite_chapter" || usedFallbackTarget ? "chapter" : "selected";
  const targetText = target === "selected" ? selection.text : chapter.content;
  const label = rewriteActionLabel(mode);

  setStatus(`正在${label}...`);
  await wait(120);

  const result = await window.novalAPI.rewriteText({
    project: state.project,
    chapter,
    mode,
    target,
    targetText
  });

  if (!result?.ok) {
    setStatus(`${label}失败，请检查模型设置。`);
    return;
  }

  if (target === "selected") {
    chapter.content = `${selection.value.slice(0, selection.start)}${
      result.data.content || selection.text
    }${selection.value.slice(selection.end)}`;
  } else {
    chapter.content = result.data.content || chapter.content;
  }

  chapter.updatedAt = new Date().toISOString();
  markUpdated(state);
  scheduleAutosave();
  const analysis = await analyzeGeneratedChapter(chapter);
  state.route = "writing";
  setStatus(
    `${rewriteStatusText(result, label, target, usedFallbackTarget)}，${analysisStatusText(
      analysis
    )}`
  );
}

async function generateChapter(isContinuation) {
  if (!state.project.blueprint.synopsis) {
    setStatus("请先生成蓝图。");
    state.route = "setup";
    render();
    return;
  }

  let chapter = getCurrentChapter(state);
  if (!chapter) {
    chapter = createChapter(state);
  }

  setStatus(isContinuation ? "正在续写当前章节..." : "正在生成章节草稿...");
  await wait(120);

  const result = await window.novalAPI.generateChapter({
    project: state.project,
    chapter,
    isContinuation
  });

  if (!result?.ok) {
    setStatus("章节生成失败，请检查模型设置。");
    return;
  }

  const plan = chapterPlanFor(state, chapter.index);
  chapter.title = result.data.title || chapter.title;
  chapter.summary = result.data.summary || plan?.goal || chapter.summary;
  chapter.content = result.data.content || chapter.content;
  chapter.updatedAt = new Date().toISOString();
  markUpdated(state);
  const analysis = await analyzeGeneratedChapter(chapter);
  state.route = "writing";

  const verb = isContinuation ? "续写" : "生成";
  setStatus(`${generationStatusText(result, chapter.index, verb)}，${analysisStatusText(analysis)}`);
}

async function bootstrap() {
  const [settingsResult, autosaveResult] = await Promise.all([
    window.novalAPI.loadSettings(),
    window.novalAPI.loadAutosave()
  ]);

  state.settings = settingsResult;

  if (autosaveResult?.ok && autosaveResult.data?.project) {
    state.project = autosaveResult.data.project;
    setProjectMemory(state, state.project.memory);
    state.currentPath = autosaveResult.data.currentPath || "";
    state.currentChapterId =
      autosaveResult.data.currentChapterId || state.project.chapters[0]?.id || null;
    state.route =
      autosaveResult.data.route || (state.project.chapters.length ? "writing" : "home");
    state.status = `已恢复自动保存草稿（${autosaveResult.data.savedAt || "最近一次"}）${
      autosaveResult.meta?.migrated ? "，并已迁移到当前项目格式。" : "。"
    }`;
  } else if (autosaveResult?.warning) {
    state.status = `自动恢复文件不可用，已跳过恢复。原因：${autosaveResult.warning}`;
  }

  render();
}

if (typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
      void persistAutosaveSnapshot();
    }
  });
}

bootstrap();
