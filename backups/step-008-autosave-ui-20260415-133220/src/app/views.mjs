import {
  chapterPlanFor,
  getCurrentChapter,
  projectStats
} from "./project-helpers.mjs";
import { countWords, escapeHtml, formatDate } from "./utils.mjs";

export function renderApp(state) {
  const stats = projectStats(state);

  return `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <h1>Noval</h1>
          <p>面向长篇创作的小说生成器。先搭蓝图，再连续生成章节，不把主界面做成聊天框。</p>
        </div>

        <nav class="nav">
          ${navButton(state, "home", "首页")}
          ${navButton(state, "setup", "项目设定")}
          ${navButton(state, "blueprint", "蓝图")}
          ${navButton(state, "writing", "写作")}
          ${navButton(state, "memory", "记忆库")}
          ${navButton(state, "settings", "模型设置")}
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
              <p>${escapeHtml(heroDescription(state))}</p>
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

        ${renderRoute(state)}

        <section class="status-bar">
          <div class="status-text">${escapeHtml(state.status)}</div>
          <div class="badge">${escapeHtml(state.currentPath || "未保存项目")}</div>
        </section>
      </main>
    </div>
  `;
}

function navButton(state, route, label) {
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

function heroDescription(state) {
  const blueprintReady = state.project.blueprint.synopsis
    ? "蓝图已生成，可直接进入章节创作。"
    : "先补全题材、角色和冲突，再生成整本书的蓝图。";
  return `${state.project.setup.genre} / ${state.project.setup.tone}。${blueprintReady}`;
}

function renderRoute(state) {
  switch (state.route) {
    case "setup":
      return renderSetup(state);
    case "blueprint":
      return renderBlueprint(state);
    case "writing":
      return renderWriting(state);
    case "memory":
      return renderMemory(state);
    case "settings":
      return renderSettings(state);
    case "home":
    default:
      return renderHome(state);
  }
}

function renderHome(state) {
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

function renderSetup(state) {
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

function renderBlueprint(state) {
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
          <div class="chip-row">${blueprint.titleOptions
            .map((item) => `<span class="chip">${escapeHtml(item)}</span>`)
            .join("")}</div>
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
          <div class="card-list">${blueprint.subPlots
            .map((plot) => `<div class="note">${escapeHtml(plot)}</div>`)
            .join("")}</div>
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

function renderWriting(state) {
  const currentChapter = getCurrentChapter(state);
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
                <div class="note">
                  <h4>快速改写</h4>
                  <div class="toolbar">
                    <button class="secondary" data-action="polish-text">润色</button>
                    <button class="secondary" data-action="expand-text">扩写</button>
                    <button class="secondary" data-action="compress-text">压缩</button>
                    <button class="secondary" data-action="rewrite-chapter-draft">重写本章</button>
                  </div>
                  <div class="toolbar">
                    <button class="secondary" data-action="boost-tension">加强张力</button>
                    <button class="secondary" data-action="tighten-pacing">加快节奏</button>
                    <button class="secondary" data-action="shape-voice">人物口吻</button>
                    <button class="secondary" data-action="ending-hook">结尾钩子</button>
                  </div>
                  <div class="subtle">正文里有选中内容时，默认只处理选中片段；未选中时，多数操作会作用于整章，结尾钩子会优先处理最后一段。</div>
                </div>
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
            <div class="subtle">${escapeHtml(
              currentChapter
                ? chapterPlanFor(state, currentChapter.index)?.goal || "当前章节暂无规划。"
                : "先创建章节。"
            )}</div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderMemory(state) {
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

function renderSettings(state) {
  const settings = state.settings;
  return `
    <section class="content-grid">
      <div class="panel stack">
        <div class="panel-head">
          <div>
            <h3>模型设置</h3>
            <div class="subtle">当前支持 OpenAI-compatible 配置。没有 API Key 时，蓝图、章节和记忆整理都会退回本地规则。</div>
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
            <div class="subtle">这版已经打通蓝图、章节、摘要和记忆的主链路，接下来可以补局部改写和自动保存。</div>
          </div>
        </div>
        <div class="note">
          <h4>MVP 包含</h4>
          <div class="chip-row">
            <span class="chip">项目保存</span>
            <span class="chip">自动保存</span>
            <span class="chip">蓝图生成</span>
            <span class="chip">章节生成</span>
            <span class="chip">记忆库</span>
            <span class="chip">导出</span>
          </div>
        </div>
        <div class="note">
          <h4>下一步建议</h4>
          <div class="subtle">优先补自动保存、局部改写、章节重写和项目文件版本化。</div>
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
