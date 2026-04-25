import { createInitialState, defaultProject } from "./app/state.mjs";
import {
  buildExportContent,
  chapterPlanFor,
  createChapter,
  getCurrentChapter,
  markUpdated,
  refreshMemory,
  saveRecentProject
} from "./app/project-helpers.mjs";
import { wait } from "./app/utils.mjs";
import { renderApp } from "./app/views.mjs";

const state = createInitialState();

function render() {
  const app = document.getElementById("app");
  app.innerHTML = renderApp(state);
  bindEvents();
}

function setStatus(message) {
  state.status = message;
  render();
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
}

async function handleAction(action, chapterId) {
  if (action === "new-project") {
    state.project = defaultProject();
    state.currentChapterId = null;
    state.currentPath = "";
    state.route = "setup";
    setStatus("已创建新项目。");
    return;
  }

  if (action === "prefill-demo") {
    state.project = defaultProject();
    state.currentChapterId = null;
    state.route = "setup";
    setStatus("已填入示例设定。");
    return;
  }

  if (action === "generate-blueprint") {
    await generateBlueprint();
    return;
  }

  if (action === "new-chapter") {
    const chapter = createChapter(state);
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

  if (action === "refresh-memory") {
    refreshMemory(state);
    setStatus("已根据蓝图和章节内容刷新记忆库。");
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

  if (!result.canceled) {
    state.currentPath = result.filePath;
    saveRecentProject(state, result.filePath);
    setStatus(`项目已保存到 ${result.filePath}`);
  }
}

async function openProject() {
  const result = await window.novalAPI.openProject();
  if (result.canceled) return;

  state.project = result.data;
  state.currentPath = result.filePath;
  state.currentChapterId = state.project.chapters[0]?.id || null;
  state.route = "home";
  saveRecentProject(state, result.filePath);
  setStatus(`已打开项目 ${result.filePath}`);
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
  refreshMemory(state);
  state.route = "writing";

  const verb = isContinuation ? "已续写" : "已生成";
  if (result.mode === "api") {
    setStatus(`第 ${chapter.index} 章${verb}（模型输出）。`);
    return;
  }

  if (result.reason === "missing_api_key") {
    setStatus(`未配置 API Key，第 ${chapter.index} 章已使用本地模板${isContinuation ? "续写" : "生成"}。`);
    return;
  }

  setStatus(`模型调用失败，已回退到本地模板完成第 ${chapter.index} 章${isContinuation ? "续写" : "生成"}。${result.warning ? `原因：${result.warning}` : ""}`);
}

async function bootstrap() {
  state.settings = await window.novalAPI.loadSettings();
  render();
}

bootstrap();
