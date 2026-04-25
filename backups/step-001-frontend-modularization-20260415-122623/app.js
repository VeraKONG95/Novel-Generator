const defaultProject = () => ({
  id: `noval-${Date.now()}`,
  title: "未命名小说",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  setup: {
    genre: "东方玄幻",
    audience: "男频成长向读者",
    tone: "热血、悬疑、升级感强",
    targetWords: 1200000,
    premise: "一个被宗门放逐的少年，在边城遗迹中得到能看见因果裂痕的能力。",
    worldBackground: "大离王朝末世将临，宗门割据，旧神遗迹不断苏醒。",
    protagonist: "陆惊川，16岁，冷静克制但内里偏执，目标是找出家族灭门真相。",
    conflict: "主角必须在强敌追杀和自身能力反噬之间求生，并逐步揭开更高层阴谋。",
    extraConstraints: "开篇三章必须有钩子；每章结尾留下推进点；避免纯解释性旁白。"
  },
  blueprint: {
    titleOptions: [],
    hook: "",
    synopsis: "",
    worldSetting: "",
    characters: [],
    mainPlot: "",
    subPlots: [],
    volumes: [],
    chapterPlans: []
  },
  chapters: [],
  memory: {
    characters: [],
    locations: [],
    factions: [],
    rules: [],
    events: [],
    foreshadowing: []
  }
});

const state = {
  route: "home",
  project: defaultProject(),
  currentChapterId: null,
  status: "准备开始创作。",
  settings: {
    provider: "openai-compatible",
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini"
  },
  currentPath: "",
  recentProjects: loadRecentProjects()
};

function loadRecentProjects() {
  try {
    return JSON.parse(localStorage.getItem("noval.recentProjects") || "[]");
  } catch {
    return [];
  }
}

function persistRecentProjects() {
  localStorage.setItem("noval.recentProjects", JSON.stringify(state.recentProjects.slice(0, 6)));
}

function setStatus(message) {
  state.status = message;
  render();
}

function markUpdated() {
  state.project.updatedAt = new Date().toISOString();
}

function getCurrentChapter() {
  return state.project.chapters.find((chapter) => chapter.id === state.currentChapterId) || null;
}

function saveRecentProject(filePath) {
  if (!filePath) return;
  const item = {
    filePath,
    title: state.project.title,
    updatedAt: new Date().toISOString()
  };
  state.recentProjects = [item, ...state.recentProjects.filter((entry) => entry.filePath !== filePath)];
  persistRecentProjects();
}

function projectStats() {
  const totalWords = state.project.chapters.reduce(
    (sum, chapter) => sum + countWords(chapter.content || ""),
    0
  );

  return {
    chapters: state.project.chapters.length,
    words: totalWords,
    characters: state.project.blueprint.characters.length,
    memories:
      state.project.memory.characters.length +
      state.project.memory.locations.length +
      state.project.memory.factions.length +
      state.project.memory.rules.length +
      state.project.memory.events.length +
      state.project.memory.foreshadowing.length
  };
}

function countWords(text) {
  if (!text.trim()) return 0;
  return text.trim().replace(/\s+/g, "").length;
}

function chapterPlanFor(index) {
  return state.project.blueprint.chapterPlans[index - 1] || null;
}

function render() {
  const app = document.getElementById("app");
  const stats = projectStats();

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <h1>Noval</h1>
          <p>面向长篇创作的小说生成器。先搭蓝图，再连续生成章节，不把主界面做成聊天框。</p>
        </div>

        <nav class="nav">
          ${navButton("home", "首页")}
          ${navButton("setup", "项目设定")}
          ${navButton("blueprint", "蓝图")}
          ${navButton("writing", "写作")}
          ${navButton("memory", "记忆库")}
          ${navButton("settings", "模型设置")}
        </nav>

        <div class="sidebar-footer">
          <button class="accent" data-action="new-project">新建项目</button>
          <button class="secondary" data-action="save-project">保存项目</button>
          <button class="secondary" data-action="open-project">打开项目</button>
          <button class="ghost" data-action="export-markdown">导出 Markdown</button>
        </div>
      </aside>

      <main class="workspace">
        <section class="hero">
          <div class="hero-top">
            <div>
              <h2>${escapeHtml(state.project.title || "未命名小说")}</h2>
              <p>${escapeHtml(heroDescription())}</p>
            </div>
            <div class="hero-actions">
              <button class="accent" data-route="setup">完善设定</button>
              <button class="secondary" data-action="generate-blueprint">生成蓝图</button>
              <button class="secondary" data-route="writing">进入写作台</button>
            </div>
          </div>
          <div class="metrics">
            ${metric("章节", `${stats.chapters}`)}
            ${metric("正文总字数", `${stats.words}`)}
            ${metric("角色卡", `${stats.characters}`)}
            ${metric("记忆项", `${stats.memories}`)}
          </div>
        </section>

        ${renderRoute()}

        <section class="status-bar">
          <div class="status-text">${escapeHtml(state.status)}</div>
          <div class="badge">${escapeHtml(state.currentPath || "未保存项目")}</div>
        </section>
      </main>
    </div>
  `;

  bindEvents();
}

function navButton(route, label) {
  const active = state.route === route ? "active" : "";
  return `<button class="${active}" data-route="${route}">${label}</button>`;
}

function metric(label, value) {
  return `
    <div class="metric">
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value}</div>
    </div>
  `;
}

function heroDescription() {
  const blueprintReady = state.project.blueprint.synopsis
    ? "蓝图已生成，可直接进入章节创作。"
    : "先补全题材、角色和冲突，再生成整本书的蓝图。";
  return `${state.project.setup.genre} / ${state.project.setup.tone}。${blueprintReady}`;
}

function renderRoute() {
  switch (state.route) {
    case "setup":
      return renderSetup();
    case "blueprint":
      return renderBlueprint();
    case "writing":
      return renderWriting();
    case "memory":
      return renderMemory();
    case "settings":
      return renderSettings();
    case "home":
    default:
      return renderHome();
  }
}

function renderHome() {
  return `
    <section class="content-grid">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3>创作流程</h3>
            <div class="subtle">MVP 先把主路径打通：设定 -> 蓝图 -> 章节 -> 记忆 -> 导出。</div>
          </div>
        </div>
        <div class="card-list">
          ${workflowCard("1. 项目设定", "定义题材、主角、世界背景和核心冲突。")}
          ${workflowCard("2. 蓝图生成", "得到书名候选、简介、人物卡、卷纲和章节规划。")}
          ${workflowCard("3. 章节写作", "逐章生成正文，支持续写、人工修改和继续推进。")}
          ${workflowCard("4. 记忆维护", "提取人物、事件、设定，减少后文崩坏。")}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3>最近项目</h3>
            <div class="subtle">这里记录最近打开或保存过的项目路径。</div>
          </div>
        </div>
        ${
          state.recentProjects.length
            ? `<div class="recent-list">
                ${state.recentProjects
                  .map(
                    (item) => `
                      <div class="recent-item">
                        <h4>${escapeHtml(item.title || "未命名项目")}</h4>
                        <div class="subtle mono">${escapeHtml(item.filePath)}</div>
                        <div class="subtle">最近更新 ${formatDate(item.updatedAt)}</div>
                      </div>
                    `
                  )
                  .join("")}
              </div>`
            : `<div class="empty-state">还没有最近项目记录。先保存一次，就会出现在这里。</div>`
        }
      </div>
    </section>
  `;
}

function renderSetup() {
  const setup = state.project.setup;
  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h3>项目设定</h3>
          <div class="subtle">这个页面决定蓝图质量。不要让模型从空白开始猜故事。</div>
        </div>
        <div class="toolbar">
          <button class="secondary" data-action="prefill-demo">填入示例</button>
          <button class="accent" data-action="generate-blueprint">生成蓝图</button>
        </div>
      </div>

      <div class="stack">
        <div class="grid-2">
          ${inputField("bookTitle", "项目标题", state.project.title)}
          ${inputField("genre", "题材", setup.genre)}
          ${inputField("audience", "目标读者", setup.audience)}
          ${inputField("tone", "文风", setup.tone)}
          ${inputField("targetWords", "目标字数", String(setup.targetWords), "number")}
        </div>
        ${textAreaField("premise", "核心 premise", setup.premise, 4)}
        ${textAreaField("worldBackground", "世界背景", setup.worldBackground, 4)}
        ${textAreaField("protagonist", "主角设定", setup.protagonist, 4)}
        ${textAreaField("conflict", "核心冲突", setup.conflict, 4)}
        ${textAreaField("extraConstraints", "额外约束", setup.extraConstraints, 4)}
      </div>
    </section>
  `;
}

function renderBlueprint() {
  const blueprint = state.project.blueprint;
  if (!blueprint.synopsis) {
    return `
      <section class="panel">
        <div class="empty-state">
          蓝图还没生成。先去项目设定页补全信息，然后点击“生成蓝图”。
        </div>
      </section>
    `;
  }

  return `
    <section class="panel stack">
      <div class="panel-head">
        <div>
          <h3>小说蓝图</h3>
          <div class="subtle">蓝图不是一次性结果，后续应该允许你持续人工修正。</div>
        </div>
        <div class="toolbar">
          <button class="secondary" data-action="generate-blueprint">重新生成</button>
          <button class="accent" data-route="writing">进入写作</button>
        </div>
      </div>

      <div class="blueprint-grid">
        <div class="blueprint-block">
          <h4>书名候选</h4>
          <div class="chip-row">${blueprint.titleOptions.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}</div>
        </div>
        <div class="blueprint-block">
          <h4>一句话卖点</h4>
          <div class="subtle">${escapeHtml(blueprint.hook)}</div>
        </div>
        <div class="blueprint-block">
          <h4>简介</h4>
          <div class="subtle">${escapeHtml(blueprint.synopsis)}</div>
        </div>
        <div class="blueprint-block">
          <h4>世界观</h4>
          <div class="subtle">${escapeHtml(blueprint.worldSetting)}</div>
        </div>
        <div class="blueprint-block">
          <h4>主线</h4>
          <div class="subtle">${escapeHtml(blueprint.mainPlot)}</div>
        </div>
        <div class="blueprint-block">
          <h4>副线</h4>
          <div class="card-list">${blueprint.subPlots.map((plot) => `<div class="note">${escapeHtml(plot)}</div>`).join("")}</div>
        </div>
      </div>

      <div class="blueprint-grid">
        <div class="blueprint-block">
          <h4>角色卡</h4>
          <div class="card-list">
            ${blueprint.characters
              .map(
                (character) => `
                  <div class="mini-card">
                    <h4>${escapeHtml(character.name)} <span class="subtle">/ ${escapeHtml(character.role)}</span></h4>
                    <div class="subtle">${escapeHtml(character.personality)}</div>
                    <div class="subtle">目标：${escapeHtml(character.goal)}</div>
                    <div class="subtle">冲突：${escapeHtml(character.conflict)}</div>
                  </div>
                `
              )
              .join("")}
          </div>
        </div>
        <div class="blueprint-block">
          <h4>卷纲与章节规划</h4>
          <div class="card-list">
            ${blueprint.volumes
              .map(
                (volume, index) => `
                  <div class="mini-card">
                    <h4>第 ${index + 1} 卷：${escapeHtml(volume.title)}</h4>
                    <div class="subtle">${escapeHtml(volume.summary)}</div>
                  </div>
                `
              )
              .join("")}
            ${blueprint.chapterPlans
              .slice(0, 8)
              .map(
                (plan) => `
                  <div class="mini-card">
                    <h4>第 ${plan.index} 章：${escapeHtml(plan.title)}</h4>
                    <div class="subtle">${escapeHtml(plan.goal)}</div>
                  </div>
                `
              )
              .join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderWriting() {
  const currentChapter = getCurrentChapter();
  return `
    <section class="writing-layout">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h3>章节列表</h3>
            <div class="subtle">先按蓝图推进，再允许人工偏航。</div>
          </div>
          <button class="secondary" data-action="new-chapter">新建章节</button>
        </div>
        ${
          state.project.chapters.length
            ? `<div class="chapter-list">
                ${state.project.chapters
                  .map(
                    (chapter) => `
                      <button class="chapter-item ${chapter.id === state.currentChapterId ? "active" : ""}" data-action="select-chapter" data-chapter-id="${chapter.id}">
                        <h4>第 ${chapter.index} 章：${escapeHtml(chapter.title || "未命名章节")}</h4>
                        <div class="subtle">${escapeHtml(chapter.summary || "暂无摘要")}</div>
                        <div class="subtle">字数 ${countWords(chapter.content || "")}</div>
                      </button>
                    `
                  )
                  .join("")}
              </div>`
            : `<div class="empty-state">还没有章节。可以先根据蓝图自动创建第 1 章。</div>`
        }
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <h3>正文编辑器</h3>
            <div class="subtle">把 AI 当成草稿机和推进器，不是最终作者。</div>
          </div>
          <div class="toolbar">
            <button class="secondary" data-action="generate-chapter">生成本章</button>
            <button class="secondary" data-action="continue-chapter">续写</button>
            <button class="accent" data-action="save-project">保存</button>
          </div>
        </div>

        ${
          currentChapter
            ? `
              <div class="stack">
                ${inputField("chapterTitle", "章节标题", currentChapter.title, "text", "chapter")}
                ${textAreaField("chapterSummary", "本章目标 / 摘要", currentChapter.summary, 3, "chapter")}
                <div class="field">
                  <label>正文</label>
                  <textarea class="editor" data-field="chapterContent" data-scope="chapter">${escapeHtml(currentChapter.content || "")}</textarea>
                </div>
              </div>
            `
            : `<div class="empty-state">先选择一个章节，或者新建章节后开始写作。</div>`
        }
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <h3>右侧上下文</h3>
            <div class="subtle">生成时会优先参考这些信息。</div>
          </div>
        </div>
        <div class="stack">
          <div class="note">
            <h4>本章指令</h4>
            <textarea data-field="chapterInstruction" placeholder="例如：加强压迫感；让反派更早露面；结尾加反转。">${escapeHtml(
              currentChapter?.instruction || ""
            )}</textarea>
          </div>
          <div class="note">
            <h4>角色卡</h4>
            <div class="memory-list">
              ${state.project.blueprint.characters
                .slice(0, 3)
                .map(
                  (character) => `
                    <div class="memory-item">
                      <h4>${escapeHtml(character.name)}</h4>
                      <div class="subtle">${escapeHtml(character.personality)}</div>
                    </div>
                  `
                )
                .join("") || '<div class="subtle">还没有角色卡。</div>'}
            </div>
          </div>
          <div class="note">
            <h4>章节规划</h4>
            <div class="subtle">${escapeHtml(currentChapter ? chapterPlanFor(currentChapter.index)?.goal || "当前章节暂无规划。" : "先创建章节。")}</div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderMemory() {
  const memory = state.project.memory;
  return `
    <section class="content-grid">
      <div class="panel stack">
        <div class="panel-head">
          <div>
            <h3>核心记忆</h3>
            <div class="subtle">MVP 先做到可见、可编辑、可注入生成上下文。</div>
          </div>
          <button class="secondary" data-action="refresh-memory">刷新记忆</button>
        </div>
        ${memorySection("人物", memory.characters)}
        ${memorySection("地点", memory.locations)}
        ${memorySection("势力", memory.factions)}
      </div>
      <div class="panel stack">
        <div class="panel-head">
          <div>
            <h3>剧情记忆</h3>
            <div class="subtle">这一块用于控制长期连载时的稳定性。</div>
          </div>
        </div>
        ${memorySection("规则", memory.rules)}
        ${memorySection("事件", memory.events)}
        ${memorySection("伏笔", memory.foreshadowing)}
      </div>
    </section>
  `;
}

function renderSettings() {
  const settings = state.settings;
  return `
    <section class="content-grid">
      <div class="panel stack">
        <div class="panel-head">
          <div>
            <h3>模型设置</h3>
            <div class="subtle">先做 OpenAI 兼容配置。没有 API Key 时，应用会退回本地模板生成。</div>
          </div>
          <button class="accent" data-action="save-settings">保存设置</button>
        </div>
        ${inputField("provider", "Provider", settings.provider, "text", "settings")}
        ${inputField("baseUrl", "Base URL", settings.baseUrl, "text", "settings")}
        ${inputField("model", "Model", settings.model, "text", "settings")}
        ${inputField("apiKey", "API Key", settings.apiKey, "password", "settings")}
      </div>
      <div class="panel stack">
        <div class="panel-head">
          <div>
            <h3>当前方案</h3>
            <div class="subtle">这一版先把桌面产品形态跑通，真实模型接入留在下一步。</div>
          </div>
        </div>
        <div class="note">
          <h4>MVP 包含</h4>
          <div class="chip-row">
            <span class="chip">项目保存</span>
            <span class="chip">蓝图生成</span>
            <span class="chip">章节生成</span>
            <span class="chip">记忆库</span>
            <span class="chip">导出</span>
          </div>
        </div>
        <div class="note">
          <h4>下一步建议</h4>
          <div class="subtle">把 generation service 切到真实 API，要求模型输出 JSON；然后补自动摘要和局部重写。</div>
        </div>
      </div>
    </section>
  `;
}

function workflowCard(title, text) {
  return `
    <div class="mini-card">
      <h4>${title}</h4>
      <div class="subtle">${text}</div>
    </div>
  `;
}

function inputField(name, label, value, type = "text", scope = "setup") {
  return `
    <div class="field">
      <label>${label}</label>
      <input type="${type}" data-scope="${scope}" data-field="${name}" value="${escapeHtml(value || "")}" />
    </div>
  `;
}

function textAreaField(name, label, value, rows = 5, scope = "setup") {
  return `
    <div class="field">
      <label>${label}</label>
      <textarea rows="${rows}" data-scope="${scope}" data-field="${name}">${escapeHtml(value || "")}</textarea>
    </div>
  `;
}

function memorySection(title, list) {
  return `
    <div class="note">
      <h4>${title}</h4>
      ${
        list.length
          ? `<div class="memory-list">
              ${list
                .map(
                  (item) => `
                    <div class="memory-item">
                      <h4>${escapeHtml(item.name)}</h4>
                      <div class="subtle">${escapeHtml(item.content)}</div>
                    </div>
                  `
                )
                .join("")}
            </div>`
          : `<div class="subtle">暂无 ${title} 记忆。</div>`
      }
    </div>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-route]").forEach((element) => {
    element.addEventListener("click", () => {
      state.route = element.dataset.route;
      render();
    });
  });

  document.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", () => handleAction(element.dataset.action, element.dataset.chapterId));
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
    const chapter = getCurrentChapter();
    if (!chapter) return;
    if (field === "chapterTitle") chapter.title = value;
    if (field === "chapterSummary") chapter.summary = value;
    if (field === "chapterContent") chapter.content = value;
  }

  if (!scope && field === "chapterInstruction") {
    const chapter = getCurrentChapter();
    if (chapter) chapter.instruction = value;
  }

  markUpdated();
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
    createChapter();
    render();
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
    refreshMemory();
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
  markUpdated();
  const payload = state.project;
  let result;

  if (state.currentPath) {
    result = await window.novalAPI.saveProjectToPath(state.currentPath, payload);
  } else {
    result = await window.novalAPI.saveProject(payload);
  }

  if (!result.canceled) {
    state.currentPath = result.filePath;
    saveRecentProject(result.filePath);
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
  saveRecentProject(result.filePath);
  setStatus(`已打开项目 ${result.filePath}`);
}

async function exportDocument(format) {
  const title = state.project.title || "noval-export";
  const content = buildExportContent(format);
  const result = await window.novalAPI.exportDocument(format, title, content);
  if (!result.canceled) {
    setStatus(`已导出到 ${result.filePath}`);
  }
}

function buildExportContent(format) {
  const lines = [];
  lines.push(format === "markdown" ? `# ${state.project.title}` : state.project.title);
  lines.push("");
  lines.push(`题材：${state.project.setup.genre}`);
  lines.push(`文风：${state.project.setup.tone}`);
  lines.push(`简介：${state.project.blueprint.synopsis || state.project.setup.premise}`);
  lines.push("");

  state.project.chapters.forEach((chapter) => {
    lines.push(format === "markdown" ? `## 第 ${chapter.index} 章 ${chapter.title}` : `第 ${chapter.index} 章 ${chapter.title}`);
    lines.push(chapter.content || "");
    lines.push("");
  });

  return lines.join("\n");
}

async function generateBlueprint() {
  setStatus("正在生成蓝图...");
  await wait(220);

  const setup = state.project.setup;
  const protagonistName = extractName(setup.protagonist) || "主角";
  const genreSeed = setup.genre || "长篇网文";
  const conflict = setup.conflict || setup.premise || "在危险世界中挣扎求生";
  const titleBase = protagonistName.replace(/\s+/g, "") || "无名者";

  state.project.blueprint = {
    titleOptions: [
      `${titleBase}裂痕录`,
      `边城因果师`,
      `${genreSeed}：${titleBase}逆命`
    ],
    hook: `${protagonistName}得到禁忌能力后，被迫在更大的阴谋苏醒前抢先成长。`,
    synopsis: `${setup.premise}。故事从一次失控事件开始，主角被推入更残酷的秩序边缘，并在追查真相的过程中不断抬升冲突规模。`,
    worldSetting: `${setup.worldBackground}。力量体系围绕“代价换取能力”展开，每次提升都必须付出实际后果。`,
    characters: [
      {
        id: "char-1",
        name: protagonistName,
        role: "主角",
        personality: "冷静、能忍、对真相有病态执念",
        goal: "查清家族旧案并活下来",
        conflict: "能力越强，反噬越重",
        traits: ["高压下判断快", "对盟友不轻易信任"],
        relationships: ["与引路人互相利用", "与宿敌彼此映照"]
      },
      {
        id: "char-2",
        name: "沈照微",
        role: "引路人",
        personality: "温和外表下极度现实",
        goal: "借主角进入遗迹核心",
        conflict: "必须在利用和保护主角之间做选择",
        traits: ["善于布局", "有隐藏身份"],
        relationships: [`对${protagonistName}半真半假地提供帮助`]
      },
      {
        id: "char-3",
        name: "顾沉霄",
        role: "宿敌",
        personality: "傲慢、强大、极端相信秩序",
        goal: "在旧神复苏前清除一切不稳定因素",
        conflict: "越想镇压乱局，越把主角推向自己的对立面",
        traits: ["强控制欲", "执行力极高"],
        relationships: [`与${protagonistName}注定长期对抗`]
      }
    ],
    mainPlot: `${protagonistName}从边城遗迹中获得能力后，一边逃亡，一边追查灭门案和旧神复苏之间的联系，最终撕开权力结构最上层的真相。`,
    subPlots: [
      "主角与引路人之间从互相利用到建立脆弱同盟。",
      "宿敌视角不断推进，形成压迫式追捕线。",
      "主角的能力反噬让每次胜利都带有代价。"
    ],
    volumes: [
      { title: "边城裂痕", summary: "主角得到能力，被迫逃离旧秩序，并第一次触碰真相入口。" },
      { title: "王朝暗流", summary: "主角进入更大舞台，发现宗门、朝廷和旧神遗迹的连接。" },
      { title: "逆命之战", summary: "主角主动反攻，把个人复仇升级为秩序重写。" }
    ],
    chapterPlans: Array.from({ length: 10 }, (_, index) => ({
      index: index + 1,
      title: chapterTitle(index + 1, protagonistName),
      goal: chapterGoal(index + 1, protagonistName, conflict),
      turningPoint: chapterTwist(index + 1)
    }))
  };

  state.project.title = state.project.blueprint.titleOptions[0];
  refreshMemory();
  markUpdated();
  state.route = "blueprint";
  setStatus("蓝图已生成。下一步可以直接创建第 1 章。");
}

function createChapter() {
  const nextIndex = state.project.chapters.length + 1;
  const plan = chapterPlanFor(nextIndex);
  const chapter = {
    id: `chapter-${Date.now()}`,
    index: nextIndex,
    title: plan?.title || `第 ${nextIndex} 章`,
    goal: plan?.goal || "",
    summary: plan?.goal || "",
    content: "",
    instruction: "",
    status: "draft",
    updatedAt: new Date().toISOString()
  };

  state.project.chapters.push(chapter);
  state.currentChapterId = chapter.id;
  markUpdated();
  setStatus(`已创建第 ${nextIndex} 章。`);
}

async function generateChapter(isContinuation) {
  if (!state.project.blueprint.synopsis) {
    setStatus("请先生成蓝图。");
    state.route = "setup";
    render();
    return;
  }

  let chapter = getCurrentChapter();
  if (!chapter) {
    createChapter();
    chapter = getCurrentChapter();
  }

  setStatus(isContinuation ? "正在续写当前章节..." : "正在生成章节草稿...");
  await wait(180);

  const plan = chapterPlanFor(chapter.index);
  const protagonist = state.project.blueprint.characters[0]?.name || "主角";
  const instruction = chapter.instruction ? `本章额外要求：${chapter.instruction}` : "";
  const memoryHint = state.project.memory.events.slice(-2).map((item) => item.content).join("；");

  const paragraphs = isContinuation
    ? [
        `夜色压到城墙残砖上，${protagonist}没有立刻离开。他知道自己刚刚赢下的，不过是一点喘息的时间，而不是安全。`,
        `沿着风声里残留的血腥气，他在黑巷尽头发现了新的痕迹。那不像寻常追兵留下的脚印，更像某种被强行唤醒的禁制在地面上拖出的灼痕。`,
        `这意味着局势已经变了。追杀他的人不再只想抓住他，而是准备借他把更深的东西逼出来。${instruction}`,
        `当他抬头看向城外遗迹时，远处忽然亮起一线冷白色光芒，像有人提前替他推开了下一道门。`
      ]
    : [
        `${protagonist}站在边城废井旁，指尖还残留着裂痕般的寒意。今夜之前，他只是被逐出的无名少年；今夜之后，所有看见那道光的人都会记住他。`,
        `按照蓝图推进，这一章的核心任务是：${plan?.goal || chapter.summary || "建立冲突并抛出主线入口"}。所以开场必须直接让危险落在主角头顶，而不是先解释世界。`,
        `追兵来得比预想更快。巷口的铜铃没有风却自行作响，意味着有人用秘法锁定了他的气息。${protagonist}强压住胸口翻涌的反噬，逼自己在三息之内做出判断。`,
        `他没有逃向人群，而是反向闯进封禁多年的旧宅。因为只有在那里，他才能确认一件事：当年灭门案留下的东西，到底是证据，还是故意给他看的陷阱。`,
        `门开的一瞬间，积尘之下传来低沉呢喃，像有什么存在正借他的到来重新苏醒。${instruction} ${memoryHint ? `前文记忆提示：${memoryHint}。` : ""}`
      ];

  chapter.content = isContinuation
    ? [chapter.content.trim(), paragraphs.join("\n\n")].filter(Boolean).join("\n\n")
    : paragraphs.join("\n\n");
  chapter.summary = plan?.goal || chapter.summary;
  chapter.updatedAt = new Date().toISOString();
  markUpdated();
  refreshMemory();
  state.route = "writing";
  setStatus(`第 ${chapter.index} 章${isContinuation ? "已续写" : "已生成"}。`);
  render();
}

function refreshMemory() {
  const blueprint = state.project.blueprint;
  const chapters = state.project.chapters;

  state.project.memory = {
    characters: blueprint.characters.map((character, index) => ({
      id: `memory-char-${index + 1}`,
      name: character.name,
      content: `${character.role}；目标：${character.goal}；冲突：${character.conflict}`,
      updatedAt: new Date().toISOString()
    })),
    locations: [
      {
        id: "loc-1",
        name: "边城遗迹",
        content: blueprint.worldSetting || state.project.setup.worldBackground,
        updatedAt: new Date().toISOString()
      }
    ],
    factions: [
      {
        id: "fac-1",
        name: "宗门与王朝势力",
        content: "表面维持秩序，实则围绕旧神遗迹争夺控制权。",
        updatedAt: new Date().toISOString()
      }
    ],
    rules: [
      {
        id: "rule-1",
        name: "能力代价",
        content: "每次动用核心能力都必须承受可见的反噬和后果。",
        updatedAt: new Date().toISOString()
      }
    ],
    events: chapters.slice(-4).map((chapter) => ({
      id: `event-${chapter.index}`,
      name: `第 ${chapter.index} 章`,
      content: chapter.summary || summarizeChapter(chapter.content),
      sourceChapter: chapter.index,
      updatedAt: chapter.updatedAt
    })),
    foreshadowing: blueprint.chapterPlans.slice(0, 3).map((plan) => ({
      id: `f-${plan.index}`,
      name: `第 ${plan.index} 章伏笔`,
      content: plan.turningPoint,
      sourceChapter: plan.index,
      updatedAt: new Date().toISOString()
    }))
  };
}

function summarizeChapter(content) {
  if (!content) return "暂无内容";
  return content.split("。").slice(0, 2).join("。").trim();
}

function extractName(text) {
  return (text || "").split(/[，,。；\s]/)[0];
}

function chapterTitle(index, protagonistName) {
  const titles = [
    `${protagonistName}入局`,
    "旧宅异响",
    "追兵压城",
    "第一次反杀",
    "遗迹开启",
    "假盟友",
    "线索浮出",
    "代价显现",
    "身份暴露",
    "更大的局"
  ];
  return titles[index - 1] || `推进 ${index}`;
}

function chapterGoal(index, protagonistName, conflict) {
  const goals = [
    `让${protagonNameOrDefault(protagonistName)}在最短时间内陷入不可逆的危险，并抛出主线入口。`,
    "通过探索旧宅或遗迹，揭露过去事件的第一层异常。",
    "让追捕者正式登场，建立持续压迫感。",
    "安排一次付出代价的胜利，证明主角不能只靠运气。",
    "展示世界观的一角，同时让线索规模升级。",
    "引入不可信盟友，让局势更复杂。",
    "给出能推动长线剧情的关键信息。",
    `把“${conflict}”具体化成主角无法回避的问题。`,
    "让主角的身份或能力被更大范围注意到。",
    "在小高潮后抛出更大的目标。"
  ];
  return goals[index - 1] || "推进主线并制造新的悬念。";
}

function protagonNameOrDefault(name) {
  return name || "主角";
}

function chapterTwist(index) {
  const twists = [
    "主角以为自己找到线索，实则是有人故意留下的引路标记。",
    "旧宅中的异响并不是敌人，而是被封存的记忆回应。",
    "追兵里混入了本该已经死去的人。",
    "主角赢了眼前战斗，却因此暴露能力特征。",
    "遗迹真正开启的条件不是血脉，而是牺牲。",
    "盟友的帮助自带账单，而且价格很高。",
    "线索指向的真凶只是更大结构的一环。",
    "反噬开始侵蚀主角最重要的判断力。",
    "宿敌早就知道主角会走到这一步。",
    "当前阶段的目标，本身就是别人设计好的轨道。"
  ];
  return twists[index - 1] || "下一章将出现更大的外部压力。";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDate(value) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function bootstrap() {
  state.settings = await window.novalAPI.loadSettings();
  render();
}

bootstrap();
