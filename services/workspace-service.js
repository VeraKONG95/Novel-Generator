const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { normalizeProject } = require("./project-schema");
const { readCurrentGeneration } = require("./analysis/graph-store");

const WORKSPACE_SCHEMA_VERSION = 2;
const MANAGED_DIRS = ["outline/stages", "outline/chapters", "characters", "chapters", "memory", ".noval/tasks"];
const AGENTS_INDEX_START = "<!-- NOVAL:PROJECT_INDEX:START -->";
const AGENTS_INDEX_END = "<!-- NOVAL:PROJECT_INDEX:END -->";
const VISIBLE_TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".json", ".jsonl"]);
const IMPORTABLE_NOVEL_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".pdf"]);
let pdfLibraryPromise = null;

function safeName(value, fallback = "noval-project") {
  const normalized = String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || fallback;
}

function assertInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("拒绝访问创作空间之外的文件。");
  }
  return resolved;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function fileRevision(filePath) {
  try {
    const [content, stat] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)]);
    return {
      hash: await hashContent(content),
      size: stat.size,
      mtimeMs: stat.mtimeMs
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function agentsMarkdown(project) {
  if (String(project.agents || "").trim()) return withProjectIndex(String(project.agents));
  const setup = project.setup || {};
  const bible = project.blueprint?.storyBible || {};
  return withProjectIndex(`# 创作章程

## 故事方向

- 题材：${setup.genre || "待补充"}
- 目标读者：${setup.audience || "待补充"}
- 核心故事：${setup.premise || "待补充"}
- 核心冲突：${setup.conflict || "待补充"}
- 主题：${bible.theme || "待补充"}
- 计划篇幅：${setup.targetWords || "待补充"} 字
- 创作模式：${project.creationMode || "平衡型"}

## 叙事与语言

- 文风：${bible.narrativeStyle || setup.tone || "待补充"}
- 时间线规则：${bible.timelineRules || "待补充"}

## 禁止内容

${(bible.taboos || []).map((item) => `- ${item}`).join("\n") || "- 待补充"}

## 连贯性规则

${(bible.continuityRules || []).map((item) => `- ${item}`).join("\n") || "- 正式正文是事实的最终依据"}

## 作者决定

- 故事核心和核心人物
- 全书蓝图和结局方向
- 当前阶段的关键转折
- 每一章正式正文
- 人物核心设定与已确认事实的重大变化

系统从正文整理人物、关系、时间和伏笔时不要求逐项确认。发现理解错误时，作者通过聊天直接修正，修正优先于自动分析。
`);
}

function withProjectIndex(content) {
  const source = String(content || "").trimEnd();
  const withoutManaged = source
    .replace(new RegExp(`${AGENTS_INDEX_START}[\\s\\S]*?${AGENTS_INDEX_END}`, "g"), "")
    .trimEnd();
  const index = [
    AGENTS_INDEX_START,
    "## 项目资料索引",
    "",
    "- 当前分析代次：先读取 `knowledge/CURRENT.json`，再读取它指向的代次；单次任务不得混用不同代次",
    "- 全书蓝图：`outline/book.md`",
    "- 当前阶段：`outline/stages/current.md`",
    "- 近期章节计划：`outline/chapters/`",
    "- 人物档案：`characters/`",
    "- 正式章节：`chapters/`",
    "- 文风说明：`STYLE.md`",
    "- 故事记忆：`memory/`",
    "",
    "正式程度：作者修正与正式设定 > 正式正文 > 当前代次结构化图谱 > 可读材料 > 页面图谱。",
    "使用资料时先读取本文件，再锁定当前代次，并按上述路径读取当前任务真正需要的内容。",
    AGENTS_INDEX_END
  ].join("\n");
  return `${withoutManaged ? `${withoutManaged}\n\n` : ""}${index}\n`;
}

function outlineMarkdown(project) {
  const blueprint = project.blueprint || {};
  const confirmedOutline = String(blueprint.mainPlot || "").trim();
  if (/^#\s+/m.test(confirmedOutline) || /\n##\s+/.test(confirmedOutline)) {
    return confirmedOutline.trimEnd() + "\n";
  }
  const lines = [
    `# ${project.title || "未命名小说"} · 全书蓝图`,
    "",
    "## 故事钩子",
    "",
    blueprint.hook || "待补充",
    "",
    "## 故事简介",
    "",
    blueprint.synopsis || project.setup?.premise || "待补充",
    "",
    "## 主线",
    "",
    confirmedOutline || "待补充",
    "",
    "## 结局与阶段方向",
    ""
  ];
  (blueprint.volumes || []).forEach((volume, index) => {
    lines.push(`### 阶段 ${index + 1}：${volume.title}`, "", volume.summary || "待补充", "");
  });
  if (blueprint.subPlots?.length) {
    lines.push("## 支线", "", ...blueprint.subPlots.map((item) => `- ${item}`), "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

function stageMarkdown(project) {
  if (String(project.documents?.stagePlan || "").trim()) {
    return String(project.documents.stagePlan).trimEnd() + "\n";
  }
  const current = project.blueprint?.volumes?.[0];
  return `# 当前阶段计划

## 阶段名称

${current?.title || "待规划"}

## 阶段目标与关键转折

${current?.summary || "待规划"}

## 当前时间线

${project.storyState?.currentTimeline || "待整理"}

## 尚未解决的冲突

${(project.storyState?.unresolvedConflicts || []).map((item) => `- ${item.name}：${item.content}`).join("\n") || "- 暂无记录"}
`;
}

function chapterPlanMarkdown(plan) {
  const lines = [
    `# 第 ${plan.index} 章计划：${plan.title || "未命名"}`,
    "",
    `- 本章目标：${plan.goal || "待补充"}`,
    `- 关键转折：${plan.turningPoint || "待补充"}`,
    `- 张力变化：${plan.tensionCurve || "待补充"}`,
    "",
    "## 场景",
    ""
  ];
  (plan.sections || []).forEach((section, index) => {
    lines.push(
      `### 场景 ${index + 1}：${section.title || "未命名"}`,
      "",
      `- 视角：${section.pov || "待补充"}`,
      `- 地点：${section.location || "待补充"}`,
      `- 人物：${(section.participants || []).join("、") || "待补充"}`,
      `- 目标：${section.sceneGoal || "待补充"}`,
      `- 冲突：${section.conflict || "待补充"}`,
      `- 结果：${section.outcome || "待补充"}`,
      ""
    );
  });
  return lines.join("\n").trimEnd() + "\n";
}

function characterMarkdown(character) {
  return `# ${character.name || "未命名人物"}

- 角色：${character.role || "待补充"}
- 身份与经历：${character.identity || "待补充"}
- 性格与声音：${character.personality || "待补充"}
- 核心欲望：${character.desire || character.goal || "待补充"}
- 恐惧：${character.fear || "待补充"}
- 创伤：${character.wound || "待补充"}
- 秘密：${character.secret || "待补充"}
- 能力：${character.ability || "待补充"}
- 限制：${character.limitation || character.conflict || "待补充"}
- 行为底线：${character.bottomLine || "待补充"}

## 关系

${(character.relationEdges || []).map((item) => `- ${item.targetCharacterName || item.targetCharacterId}｜${item.type}：${item.dynamic}`).join("\n") || (character.relationships || []).map((item) => `- ${item}`).join("\n") || "- 待补充"}

## 阶段变化

${(character.arc || []).map((item) => `- ${item.stage}：${item.change}；触发：${item.trigger}；结果：${item.payoff}`).join("\n") || "- 待补充"}
`;
}

function chapterMarkdown(chapter) {
  return `# 第 ${chapter.index} 章 ${chapter.title || "未命名"}\n\n${String(chapter.content || "").trim()}\n`;
}

function memoryFiles(project) {
  const memory = project.memory || {};
  const state = project.storyState || {};
  return {
    "memory/facts.json": JSON.stringify(
      {
        characters: memory.characters || [],
        locations: memory.locations || [],
        factions: memory.factions || [],
        rules: memory.rules || [],
        events: memory.events || [],
        knownFacts: state.knownFacts || [],
        hiddenFacts: state.hiddenFacts || [],
        unresolvedConflicts: state.unresolvedConflicts || []
      },
      null,
      2
    ) + "\n",
    "memory/timeline.json": JSON.stringify(
      { currentTimeline: state.currentTimeline || "", events: memory.events || [] },
      null,
      2
    ) + "\n",
    "memory/character-states.json": JSON.stringify(state.characterStates || [], null, 2) + "\n",
    "memory/foreshadowing.json": JSON.stringify(
      { memory: memory.foreshadowing || [], registry: state.foreshadowingRegistry || [] },
      null,
      2
    ) + "\n"
  };
}

function projectFileMap(project) {
  const files = {
    "AGENTS.md": agentsMarkdown(project),
    "outline/book.md": outlineMarkdown(project),
    "outline/stages/current.md": stageMarkdown(project),
    ".noval/project.json": JSON.stringify({
      workspaceSchemaVersion: WORKSPACE_SCHEMA_VERSION,
      id: project.id,
      title: project.title,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      creationMode: project.creationMode || "平衡型",
      constitutionStatus: project.constitutionStatus || "draft",
      importStatus: project.importStatus || "",
      importSource: project.importSource || {},
      analysis: project.analysis || {},
      analysisSettings: project.analysisSettings || { maxConcurrency: 4 },
      chapters: (project.chapters || []).map((chapter) => ({
        id: chapter.id,
        index: chapter.index,
        path: `chapters/${String(chapter.index).padStart(4, "0")}.md`
      })),
      exportOptions: project.exportOptions || {}
    }, null, 2) + "\n",
    ...memoryFiles(project)
  };

  if (String(project.documents?.chapterPlan || "").trim()) {
    files["outline/chapters/next.md"] = String(project.documents.chapterPlan).trimEnd() + "\n";
  }
  if (String(project.documents?.characterArchive || "").trim()) {
    files["characters/README.md"] = String(project.documents.characterArchive).trimEnd() + "\n";
  }
  if (String(project.documents?.styleGuide || "").trim()) {
    files["STYLE.md"] = String(project.documents.styleGuide).trimEnd() + "\n";
  }
  if (String(project.documents?.importArchive || "").trim()) {
    files["IMPORT-ARCHIVE.md"] = String(project.documents.importArchive).trimEnd() + "\n";
  }

  (project.blueprint?.characters || []).forEach((character, index) => {
    const name = safeName(character.name, `character-${index + 1}`);
    files[`characters/${String(index + 1).padStart(3, "0")}-${name}.md`] = characterMarkdown(character);
  });
  (project.blueprint?.chapterPlans || []).forEach((plan) => {
    files[`outline/chapters/${String(plan.index).padStart(4, "0")}.md`] = chapterPlanMarkdown(plan);
  });
  (project.chapters || []).forEach((chapter) => {
    files[`chapters/${String(chapter.index).padStart(4, "0")}.md`] = chapterMarkdown(chapter);
  });
  return files;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function markdownSection(content, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(content || "").match(new RegExp(`## ${escaped}\\s+([\\s\\S]*?)(?=\\n## |$)`));
  return match?.[1]?.trim() || "";
}

function lineValue(content, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(content || "").match(new RegExp(`^- ${escaped}：(.+)$`, "m"))?.[1]?.trim() || "";
}

function parseCharacterMarkdown(content, existing, fallbackIndex) {
  const source = String(content || "");
  const name = source.match(/^#\s+(.+)$/m)?.[1]?.trim() || existing?.name || `人物 ${fallbackIndex}`;
  const relationshipSection = markdownSection(source, "关系");
  const relationEdges = relationshipSection.split("\n").filter((line) => /^-\s+/.test(line)).map((line, index) => {
    const value = line.replace(/^-\s+/, "");
    const match = value.match(/^(.+?)｜(.+?)[：:](.*)$/);
    return {
      id: existing?.relationEdges?.[index]?.id || `relation-${fallbackIndex}-${index + 1}`,
      targetCharacterId: existing?.relationEdges?.[index]?.targetCharacterId || "",
      targetCharacterName: match?.[1]?.trim() || value,
      type: match?.[2]?.trim() || "未定义关系",
      dynamic: match?.[3]?.trim() || value
    };
  });
  const arcSection = markdownSection(source, "阶段变化");
  const arc = arcSection.split("\n").filter((line) => /^-\s+/.test(line)).map((line, index) => {
    const value = line.replace(/^-\s+/, "");
    const match = value.match(/^(.+?)[：:](.*?)(?:；触发[：:](.*?))?(?:；结果[：:](.*))?$/);
    return {
      id: existing?.arc?.[index]?.id || `arc-${fallbackIndex}-${index + 1}`,
      stage: match?.[1]?.trim() || `阶段 ${index + 1}`,
      change: match?.[2]?.trim() || value,
      trigger: match?.[3]?.trim() || "",
      payoff: match?.[4]?.trim() || ""
    };
  });
  const voice = lineValue(source, "性格与声音") || existing?.personality || "";
  return {
    ...(existing || {}),
    id: existing?.id || `character-${fallbackIndex}`,
    name,
    role: lineValue(source, "角色") || existing?.role || "角色",
    identity: lineValue(source, "身份与经历") || existing?.identity || "",
    personality: voice,
    voice,
    desire: lineValue(source, "核心欲望") || existing?.desire || "",
    goal: lineValue(source, "核心欲望") || existing?.goal || "",
    fear: lineValue(source, "恐惧") || existing?.fear || "",
    wound: lineValue(source, "创伤") || existing?.wound || "",
    secret: lineValue(source, "秘密") || existing?.secret || "",
    ability: lineValue(source, "能力") || existing?.ability || "",
    limitation: lineValue(source, "限制") || existing?.limitation || "",
    bottomLine: lineValue(source, "行为底线") || existing?.bottomLine || "",
    relationEdges,
    relationships: relationEdges.map((item) => `${item.targetCharacterName}：${item.dynamic}`),
    arc
  };
}

function parseChapterPlanMarkdown(content, existing, fallbackIndex) {
  const source = String(content || "");
  const heading = source.match(/^#\s*第\s*(\d+)\s*章计划[：:]?\s*(.*)$/m);
  const scenes = Array.from(source.matchAll(/###\s*场景\s*(\d+)[：:]\s*(.+)\n+([\s\S]*?)(?=\n### |$)/g));
  return {
    ...(existing || {}),
    index: Number(heading?.[1]) || existing?.index || fallbackIndex,
    title: heading?.[2]?.trim() || existing?.title || `第 ${fallbackIndex} 章`,
    goal: lineValue(source, "本章目标") || existing?.goal || "",
    turningPoint: lineValue(source, "关键转折") || existing?.turningPoint || "",
    tensionCurve: lineValue(source, "张力变化") || existing?.tensionCurve || "",
    sections: scenes.length ? scenes.map((match, index) => ({
      ...(existing?.sections?.[index] || {}),
      id: existing?.sections?.[index]?.id || `section-${fallbackIndex}-${index + 1}`,
      index: Number(match[1]) || index + 1,
      title: match[2].trim(),
      pov: lineValue(match[3], "视角"),
      location: lineValue(match[3], "地点"),
      participants: lineValue(match[3], "人物").split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
      sceneGoal: lineValue(match[3], "目标"),
      conflict: lineValue(match[3], "冲突"),
      outcome: lineValue(match[3], "结果")
    })) : existing?.sections || []
  };
}

function memoryLogEntries(previousProject, nextProject) {
  if (!previousProject) return [];
  const previous = new Map();
  Object.entries(previousProject.memory || {}).forEach(([section, items]) => {
    (items || []).forEach((item) => previous.set(`${section}:${item.id}`, item));
  });
  const at = new Date().toISOString();
  const entries = [];
  Object.entries(nextProject.memory || {}).forEach(([section, items]) => {
    (items || []).forEach((item) => {
      const before = previous.get(`${section}:${item.id}`);
      if (JSON.stringify(before || null) === JSON.stringify(item)) return;
      entries.push({
        at,
        section,
        action: before ? "update" : "add",
        id: item.id,
        name: item.name,
        sourceChapter: item.sourceChapter,
        sourceExcerpt: item.sourceExcerpt
      });
    });
  });
  return entries;
}

async function recoverTransaction(root) {
  const journalPath = path.join(root, ".noval", "transaction.json");
  if (!(await exists(journalPath))) return;
  let journal;
  try {
    journal = JSON.parse(await fs.readFile(journalPath, "utf8"));
  } catch {
    await fs.rm(journalPath, { force: true });
    return;
  }
  const completed = Array.isArray(journal.completed) ? journal.completed : [];
  for (const relPath of completed.reverse()) {
    const target = assertInside(root, path.join(root, relPath));
    const backup = assertInside(root, path.join(root, journal.backupDir, relPath));
    if (await exists(backup)) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(backup, target);
    } else {
      await fs.rm(target, { force: true });
    }
  }
  await fs.rm(path.join(root, journal.stageDir), { recursive: true, force: true });
  await fs.rm(path.join(root, journal.backupDir), { recursive: true, force: true });
  await fs.rm(journalPath, { force: true });
}

async function managedRevisions(root, fileMap) {
  const revisions = {};
  for (const relPath of Object.keys(fileMap)) {
    revisions[relPath] = await fileRevision(path.join(root, relPath));
  }
  return revisions;
}

async function workspaceRevisions(root) {
  const revisions = {};
  for (const item of await collectVisibleFiles(root)) revisions[item.path] = item.revision;
  revisions[".noval/project.json"] = await fileRevision(path.join(root, ".noval", "project.json"));
  revisions[".noval/index.json"] = await fileRevision(path.join(root, ".noval", "index.json"));
  return revisions;
}

async function detectConflicts(root, fileMap, expectedRevisions = {}) {
  const conflicts = [];
  for (const relPath of Object.keys(fileMap)) {
    if (!(relPath in expectedRevisions)) continue;
    const current = await fileRevision(path.join(root, relPath));
    const expected = expectedRevisions[relPath];
    if ((current?.hash || null) !== (expected?.hash || null)) {
      let externalContent = "";
      try {
        externalContent = await fs.readFile(path.join(root, relPath), "utf8");
      } catch {
        externalContent = "";
      }
      conflicts.push({
        path: relPath,
        expected,
        current,
        externalContent,
        proposedContent: fileMap[relPath]
      });
    }
  }
  return conflicts;
}

async function transactionalWrite(root, fileMap, deletions = []) {
  const transactionId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const stageDir = `.noval/.stage-${transactionId}`;
  const backupDir = `.noval/.backup-${transactionId}`;
  const journalPath = path.join(root, ".noval", "transaction.json");
  const stageRoot = path.join(root, stageDir);
  const backupRoot = path.join(root, backupDir);
  const targets = Array.from(new Set([...Object.keys(fileMap), ...deletions])).sort((a, b) => (a === ".noval/project.json" ? 1 : b === ".noval/project.json" ? -1 : a.localeCompare(b)));

  await fs.mkdir(stageRoot, { recursive: true });
  await fs.mkdir(backupRoot, { recursive: true });
  for (const relPath of targets) {
    if (relPath in fileMap) {
      const stagePath = assertInside(stageRoot, path.join(stageRoot, relPath));
      await fs.mkdir(path.dirname(stagePath), { recursive: true });
      await fs.writeFile(stagePath, fileMap[relPath], "utf8");
    }
    const target = assertInside(root, path.join(root, relPath));
    if (await exists(target)) {
      const backup = assertInside(backupRoot, path.join(backupRoot, relPath));
      await fs.mkdir(path.dirname(backup), { recursive: true });
      await fs.copyFile(target, backup);
    }
  }

  const journal = { transactionId, stageDir, backupDir, targets, deletions, completed: [] };
  await fs.writeFile(journalPath, JSON.stringify(journal, null, 2), "utf8");
  try {
    for (const relPath of targets) {
      const target = assertInside(root, path.join(root, relPath));
      if (deletions.includes(relPath)) {
        await fs.rm(target, { force: true });
      } else {
        const stagePath = assertInside(stageRoot, path.join(stageRoot, relPath));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.rename(stagePath, target);
      }
      journal.completed.push(relPath);
      await fs.writeFile(journalPath, JSON.stringify(journal, null, 2), "utf8");
    }
  } catch (error) {
    await recoverTransaction(root);
    throw error;
  }

  await fs.rm(stageRoot, { recursive: true, force: true });
  await fs.rm(backupRoot, { recursive: true, force: true });
  await fs.rm(journalPath, { force: true });
}

function normalizeVisibleRelativePath(relativePath) {
  const normalized = String(relativePath || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized === ".noval" || normalized.startsWith(".noval/") || normalized.split("/").includes("..")) {
    throw new Error("只能访问项目中可见的普通文件。");
  }
  if (!VISIBLE_TEXT_EXTENSIONS.has(path.extname(normalized).toLowerCase())) {
    throw new Error("当前只支持 Markdown、文本和 JSON 项目文件。");
  }
  return normalized;
}

async function collectVisibleFiles(root) {
  const files = [];
  async function walk(current, prefix = "") {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, "zh-CN"));
    for (const entry of entries) {
      if (entry.name === ".noval" || entry.name === ".git" || entry.name === "node_modules") continue;
      if (prefix === "knowledge" && entry.name === "generations") continue;
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = assertInside(root, path.join(root, relPath));
      if (entry.isDirectory()) {
        await walk(fullPath, relPath);
        continue;
      }
      if (!entry.isFile() || !VISIBLE_TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const stat = await fs.stat(fullPath);
      files.push({
        path: relPath,
        name: entry.name,
        directory: prefix,
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        revision: await fileRevision(fullPath)
      });
    }
  }
  await walk(root);
  try {
    const current = await readCurrentGeneration(root);
    if (current) {
      for (const relativePath of Object.keys(current.manifest.files || {})) {
        if (!VISIBLE_TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) continue;
        const fullPath = path.join(current.materialsRoot, ...relativePath.split("/"));
        const stat = await fs.stat(fullPath);
        files.push({
          path: `knowledge/current/${relativePath}`,
          name: path.basename(relativePath),
          directory: `knowledge/current/${path.posix.dirname(relativePath)}`.replace(/\/$/, ""),
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
          revision: await fileRevision(fullPath)
        });
      }
    }
  } catch {
    // A damaged generation is reported by graph APIs; ordinary project files remain viewable.
  }
  return files.sort((a, b) => a.path.localeCompare(b.path, "zh-CN"));
}

async function listWorkspaceFiles(root) {
  return collectVisibleFiles(root);
}

async function readWorkspaceFile(root, relativePath) {
  const normalized = normalizeVisibleRelativePath(relativePath);
  if (normalized.startsWith("knowledge/current/")) {
    const current = await readCurrentGeneration(root);
    if (!current) throw new Error("项目还没有当前分析结果。");
    const generationPath = normalized.slice("knowledge/current/".length);
    if (!current.manifest.files?.[generationPath]) throw new Error("当前代次中不存在这个文件。");
    const filePath = assertInside(current.materialsRoot, path.join(current.materialsRoot, generationPath));
    return {
      path: normalized,
      content: await fs.readFile(filePath, "utf8"),
      revision: await fileRevision(filePath)
    };
  }
  const filePath = assertInside(root, path.join(root, normalized));
  return {
    path: normalized,
    content: await fs.readFile(filePath, "utf8"),
    revision: await fileRevision(filePath)
  };
}

async function applyWorkspaceChanges(root, rawChanges, options = {}) {
  const changes = Array.isArray(rawChanges) ? rawChanges : [];
  if (!changes.length) throw new Error("候选结果没有包含文件改动。");
  const seen = new Set();
  const normalizedChanges = changes.map((item) => {
    const relativePath = normalizeVisibleRelativePath(item?.path);
    if (
      relativePath === "knowledge/CURRENT.json" ||
      relativePath.startsWith("knowledge/generations/") ||
      relativePath.startsWith("knowledge/current/")
    ) {
      throw new Error("正式分析结果只能由分析流程发布，普通任务不能直接修改。");
    }
    if (seen.has(relativePath)) throw new Error(`同一文件不能在一次候选中重复出现：${relativePath}`);
    seen.add(relativePath);
    const action = item?.action === "delete" ? "delete" : item?.action === "create" ? "create" : "update";
    return { path: relativePath, action, content: action === "delete" ? "" : String(item?.content || "") };
  });
  const expected = options.expectedRevisions || {};
  const conflicts = [];
  const checks = new Map(normalizedChanges.map((change) => [change.path, change]));
  for (const rawPath of Array.isArray(options.guardPaths) ? options.guardPaths : []) {
    const guardPath = normalizeVisibleRelativePath(rawPath);
    if (!checks.has(guardPath)) checks.set(guardPath, { path: guardPath, action: "guard", content: "" });
  }
  for (const change of checks.values()) {
    if (options.force) continue;
    let current = null;
    try {
      current = change.path.startsWith("knowledge/current/")
        ? (await readWorkspaceFile(root, change.path)).revision
        : await fileRevision(path.join(root, change.path));
    } catch {
      current = null;
    }
    const base = Object.prototype.hasOwnProperty.call(expected, change.path) ? expected[change.path] : null;
    if ((current?.hash || null) !== (base?.hash || null)) {
      let externalContent = "";
      try {
        externalContent = change.path.startsWith("knowledge/current/")
          ? (await readWorkspaceFile(root, change.path)).content
          : await fs.readFile(path.join(root, change.path), "utf8");
      } catch { externalContent = ""; }
      conflicts.push({
        path: change.path,
        expected: base,
        current,
        externalContent,
        proposedContent: change.action === "guard" ? "" : change.content,
        contextChanged: change.action === "guard"
      });
    }
  }
  if (conflicts.length) return { ok: false, conflicts };

  const fileMap = {};
  const deletions = [];
  for (const change of normalizedChanges) {
    if (change.action === "delete") deletions.push(change.path);
    else fileMap[change.path] = change.path === "AGENTS.md" ? withProjectIndex(change.content) : change.content;
  }
  if (!("AGENTS.md" in fileMap) && !deletions.includes("AGENTS.md") && await exists(path.join(root, "AGENTS.md"))) {
    fileMap["AGENTS.md"] = withProjectIndex(await fs.readFile(path.join(root, "AGENTS.md"), "utf8"));
  }
  await transactionalWrite(root, fileMap, deletions);
  const loaded = await loadWorkspace(root);
  return { ok: true, ...loaded };
}

function searchTerms(text) {
  const normalized = String(text || "").toLowerCase();
  const terms = new Set(normalized.match(/[a-z0-9_]{2,}|[\u3400-\u9fff]{2}/g) || []);
  return Array.from(terms).slice(0, 400);
}

async function buildIndex(root, fileMap = null) {
  const documents = [];
  const sourceFiles = fileMap
    ? Object.entries(fileMap).filter(([relPath]) => !relPath.startsWith(".noval/"))
    : await Promise.all((await collectVisibleFiles(root)).map(async (item) => [
        item.path,
        (await readWorkspaceFile(root, item.path)).content
      ]));
  for (const [relPath, content] of sourceFiles) {
    if (!VISIBLE_TEXT_EXTENSIONS.has(path.extname(relPath).toLowerCase())) continue;
    documents.push({
      id: relPath,
      path: relPath,
      title: content.split("\n")[0].replace(/^#+\s*/, "") || relPath,
      hash: await hashContent(content),
      terms: searchTerms(content)
    });
  }
  const index = { version: 1, builtAt: new Date().toISOString(), documents };
  await transactionalWrite(root, { ".noval/index.json": JSON.stringify(index, null, 2) + "\n" });
  return index;
}

async function saveWorkspace(root, inputProject, options = {}) {
  const normalized = normalizeProject(inputProject).project;
  normalized.agents = String(inputProject.agents || normalized.agents || agentsMarkdown(normalized));
  normalized.creationMode = String(inputProject.creationMode || normalized.creationMode || "平衡型");
  const fileMap = projectFileMap(normalized);
  const manifest = await readJson(path.join(root, ".noval", "project.json"), null);
  const logPath = path.join(root, "memory", "change-log.jsonl");
  let existingLog = "";
  try {
    existingLog = await fs.readFile(logPath, "utf8");
  } catch {
    existingLog = "";
  }
  let previousProject = manifest?.project || null;
  if (!previousProject) {
    const [facts, foreshadowing] = await Promise.all([
      readJson(path.join(root, "memory", "facts.json"), {}),
      readJson(path.join(root, "memory", "foreshadowing.json"), {})
    ]);
    previousProject = {
      memory: {
        characters: facts.characters || [],
        locations: facts.locations || [],
        factions: facts.factions || [],
        rules: facts.rules || [],
        events: facts.events || [],
        foreshadowing: foreshadowing.memory || []
      }
    };
  }
  const logEntries = memoryLogEntries(previousProject, normalized);
  fileMap["memory/change-log.jsonl"] = existingLog + logEntries.map((item) => JSON.stringify(item)).join("\n") + (logEntries.length ? "\n" : "");
  const conflicts = options.force ? [] : await detectConflicts(root, fileMap, options.expectedRevisions || {});
  if (conflicts.length) return { ok: false, conflicts };
  await transactionalWrite(root, fileMap);
  const index = await buildIndex(root);
  const revisions = await workspaceRevisions(root);
  return { ok: true, data: normalized, revisions };
}

function stripMarkdownHeading(content) {
  return String(content || "").replace(/^#.*\n+/, "").trim();
}

function parseChapterMarkdown(content, fallbackIndex) {
  const source = String(content || "");
  const firstLine = source.split("\n")[0] || "";
  const match = firstLine.match(/^#\s*第\s*(\d+)\s*章\s*(.*)$/);
  return {
    index: Number(match?.[1]) || fallbackIndex,
    title: String(match?.[2] || `第 ${fallbackIndex} 章`).trim(),
    content: source.replace(/^#.*\n+/, "").trim()
  };
}

async function loadWorkspace(root) {
  await recoverTransaction(root);
  const manifestPath = path.join(root, ".noval", "project.json");
  if (!(await exists(manifestPath))) throw new Error("所选文件夹不是有效的 Noval 创作空间。");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const needsMigration = Boolean(manifest.project) || Number(manifest.workspaceSchemaVersion || 0) < WORKSPACE_SCHEMA_VERSION;
  const normalized = normalizeProject(manifest.project || manifest).project;

  const agentsPath = path.join(root, "AGENTS.md");
  if (await exists(agentsPath)) {
    normalized.agents = withProjectIndex(await fs.readFile(agentsPath, "utf8"));
    normalized.setup.genre = lineValue(normalized.agents, "题材") || normalized.setup.genre;
    normalized.setup.audience = lineValue(normalized.agents, "目标读者") || normalized.setup.audience;
    normalized.setup.premise = lineValue(normalized.agents, "核心故事") || normalized.setup.premise;
    normalized.setup.conflict = lineValue(normalized.agents, "核心冲突") || normalized.setup.conflict;
    normalized.blueprint.storyBible.theme = lineValue(normalized.agents, "主题") || normalized.blueprint.storyBible.theme;
    normalized.setup.tone = lineValue(normalized.agents, "文风") || normalized.setup.tone;
    normalized.blueprint.storyBible.narrativeStyle = lineValue(normalized.agents, "文风") || normalized.blueprint.storyBible.narrativeStyle;
    normalized.creationMode = lineValue(normalized.agents, "创作模式") || normalized.creationMode;
  }
  const outlinePath = path.join(root, "outline", "book.md");
  if (await exists(outlinePath)) {
    const outline = await fs.readFile(outlinePath, "utf8");
    normalized.blueprint.hook = markdownSection(outline, "故事钩子") || normalized.blueprint.hook;
    normalized.blueprint.synopsis = markdownSection(outline, "故事简介") || normalized.blueprint.synopsis;
    const mainMatch = outline.match(/## 主线\s+([\s\S]*?)(?=\n## |$)/);
    if (mainMatch && !/^(待补充|待规划)[。.]?$/.test(mainMatch[1].trim())) {
      normalized.blueprint.mainPlot = mainMatch[1].trim();
    } else if (mainMatch) {
      normalized.blueprint.mainPlot = "";
    }
    const direction = markdownSection(outline, "结局与阶段方向");
    const volumeMatches = Array.from(direction.matchAll(/###\s*阶段\s*\d+[：:]\s*(.+)\n+([\s\S]*?)(?=\n### |$)/g));
    if (volumeMatches.length) {
      normalized.blueprint.volumes = volumeMatches.map((match) => ({ title: match[1].trim(), summary: match[2].trim() }));
    }
    const subPlots = markdownSection(outline, "支线").split("\n").filter((line) => /^-\s+/.test(line)).map((line) => line.replace(/^-\s+/, "").trim());
    if (subPlots.length) normalized.blueprint.subPlots = subPlots;
  }

  const stagePath = path.join(root, "outline", "stages", "current.md");
  if (await exists(stagePath)) normalized.documents.stagePlan = await fs.readFile(stagePath, "utf8");
  const nextPlanPath = path.join(root, "outline", "chapters", "next.md");
  normalized.documents.chapterPlan = await exists(nextPlanPath) ? await fs.readFile(nextPlanPath, "utf8") : "";
  const stylePath = path.join(root, "STYLE.md");
  normalized.documents.styleGuide = await exists(stylePath) ? await fs.readFile(stylePath, "utf8") : "";
  const importPath = path.join(root, "IMPORT-ARCHIVE.md");
  normalized.documents.importArchive = await exists(importPath) ? await fs.readFile(importPath, "utf8") : "";

  const charactersDir = path.join(root, "characters");
  if (await exists(charactersDir)) {
    const names = (await fs.readdir(charactersDir)).filter((name) => name.endsWith(".md") && name !== "README.md").sort();
    normalized.blueprint.characters = await Promise.all(names.map(async (name, index) => {
      const content = await fs.readFile(path.join(charactersDir, name), "utf8");
      const headingName = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
      const existing = normalized.blueprint.characters.find((item) => item.name === headingName) || normalized.blueprint.characters[index];
      return parseCharacterMarkdown(content, existing, index + 1);
    }));
    const archivePath = path.join(charactersDir, "README.md");
    normalized.documents.characterArchive = await exists(archivePath) ? await fs.readFile(archivePath, "utf8") : "";
  }

  const chapterPlansDir = path.join(root, "outline", "chapters");
  if (await exists(chapterPlansDir)) {
    const names = (await fs.readdir(chapterPlansDir)).filter((name) => /^\d+\.md$/.test(name)).sort();
    if (names.length) {
      normalized.blueprint.chapterPlans = await Promise.all(names.map(async (name, index) => {
        const content = await fs.readFile(path.join(chapterPlansDir, name), "utf8");
        return parseChapterPlanMarkdown(content, normalized.blueprint.chapterPlans[index], index + 1);
      }));
    }
  }

  const chaptersDir = path.join(root, "chapters");
  if (await exists(chaptersDir)) {
    const names = (await fs.readdir(chaptersDir)).filter((name) => name.endsWith(".md")).sort();
    const chapters = [];
    for (let i = 0; i < names.length; i += 1) {
      const parsed = parseChapterMarkdown(await fs.readFile(path.join(chaptersDir, names[i]), "utf8"), i + 1);
      const relativePath = `chapters/${names[i]}`;
      const chapterMeta = Array.isArray(manifest.chapters)
        ? manifest.chapters.find((item) => item.path === relativePath || Number(item.index) === parsed.index)
        : null;
      const existing = normalized.chapters.find((item) =>
        (chapterMeta?.id && item.id === chapterMeta.id) || item.index === parsed.index
      );
      chapters.push({
        ...(existing || {}),
        id: chapterMeta?.id || existing?.id || `chapter-${crypto.randomUUID()}`,
        index: parsed.index,
        title: parsed.title,
        content: parsed.content,
        goal: existing?.goal || "",
        summary: existing?.summary || "",
        instruction: existing?.instruction || "",
        status: "confirmed",
        sections: existing?.sections || [],
        updatedAt: new Date().toISOString()
      });
    }
    normalized.chapters = chapters;
  }

  const facts = await readJson(path.join(root, "memory", "facts.json"), null);
  if (facts) {
    normalized.memory.characters = facts.characters || [];
    normalized.memory.locations = facts.locations || [];
    normalized.memory.factions = facts.factions || [];
    normalized.memory.rules = facts.rules || [];
    normalized.memory.events = facts.events || [];
    normalized.storyState.knownFacts = facts.knownFacts || [];
    normalized.storyState.hiddenFacts = facts.hiddenFacts || [];
    normalized.storyState.unresolvedConflicts = facts.unresolvedConflicts || [];
  }
  const timeline = await readJson(path.join(root, "memory", "timeline.json"), null);
  if (timeline) {
    normalized.storyState.currentTimeline = timeline.currentTimeline || "";
    if (Array.isArray(timeline.events)) normalized.memory.events = timeline.events;
  }
  const characterStates = await readJson(path.join(root, "memory", "character-states.json"), null);
  if (Array.isArray(characterStates)) normalized.storyState.characterStates = characterStates;
  const foreshadowing = await readJson(path.join(root, "memory", "foreshadowing.json"), null);
  if (foreshadowing) {
    normalized.memory.foreshadowing = foreshadowing.memory || [];
    normalized.storyState.foreshadowingRegistry = foreshadowing.registry || [];
  }

  try {
    const currentGeneration = await readCurrentGeneration(root);
    if (currentGeneration) {
      const criticalGaps = currentGeneration.manifest.gaps?.critical || [];
      const nonCriticalGaps = currentGeneration.manifest.gaps?.nonCritical || [];
      const status = criticalGaps.length ? "failed" : nonCriticalGaps.length ? "degraded" : "ready";
      normalized.analysis = {
        status,
        runId: normalized.analysis.runId || "",
        generationId: currentGeneration.generationId,
        workflowId: currentGeneration.manifest.workflow?.id || currentGeneration.manifest.workflowId || "",
        blockingGaps: criticalGaps,
        nonBlockingGaps: nonCriticalGaps,
        updatedAt: currentGeneration.manifest.createdAt || ""
      };
      normalized.importStatus = status;
      const currentStyle = path.join(currentGeneration.materialsRoot, "STYLE.md");
      const currentStage = path.join(currentGeneration.materialsRoot, "outline", "stages", "current.md");
      if (await exists(currentStyle)) normalized.documents.styleGuide = await fs.readFile(currentStyle, "utf8");
      if (await exists(currentStage)) normalized.documents.stagePlan = await fs.readFile(currentStage, "utf8");

      const characterPaths = Object.keys(currentGeneration.manifest.files || {})
        .filter((relativePath) => /^characters\/[^/]+\.md$/.test(relativePath))
        .sort((a, b) => a.localeCompare(b, "zh-CN"));
      if (characterPaths.length) {
        normalized.blueprint.characters = await Promise.all(characterPaths.map(async (relativePath, index) => {
          const content = await fs.readFile(path.join(currentGeneration.materialsRoot, relativePath), "utf8");
          const parsed = parseCharacterMarkdown(content, null, index + 1);
          const entity = currentGeneration.entities.find((item) =>
            item.canonicalName === parsed.name && ["character", "人物"].includes(item.type)
          );
          return { ...parsed, id: entity?.id || parsed.id };
        }));
      }
      normalized.memory.characters = currentGeneration.entities
        .filter((item) => ["character", "人物"].includes(item.type))
        .map((item) => ({
          id: item.id,
          name: item.canonicalName,
          content: `${item.status || "active"}${item.aliases?.length ? `；别名：${item.aliases.join("、")}` : ""}`,
          updatedAt: currentGeneration.manifest.createdAt || new Date().toISOString(),
          status: item.status || "active"
        }));
      normalized.memory.events = currentGeneration.events.map((item) => ({
        id: item.id || item.eventId,
        name: item.summary || item.action || item.type,
        content: item.result || item.summary || item.action || "",
        updatedAt: currentGeneration.manifest.createdAt || new Date().toISOString(),
        status: item.status || "active"
      }));
      normalized.storyState.knownFacts = currentGeneration.assertions
        .filter((item) => item.scope === "WORLD")
        .map((item) => ({
          id: item.id,
          name: item.proposition || item.content || "世界事实",
          content: item.proposition || item.content || "",
          status: item.truthStatus || "true",
          updatedAt: currentGeneration.manifest.createdAt || new Date().toISOString()
        }));
    }
  } catch (error) {
    normalized.analysis = {
      ...normalized.analysis,
      status: "failed",
      blockingGaps: [`当前分析结果损坏：${error instanceof Error ? error.message : String(error)}`],
      updatedAt: new Date().toISOString()
    };
  }

  const fileMap = projectFileMap(normalized);
  if (needsMigration) {
    const migrationMap = { ".noval/project.json": fileMap[".noval/project.json"], "AGENTS.md": normalized.agents };
    for (const [relativePath, content] of Object.entries(fileMap)) {
      if (relativePath.startsWith(".noval/") || relativePath === "AGENTS.md") continue;
      if (!(await exists(path.join(root, relativePath)))) migrationMap[relativePath] = content;
    }
    await transactionalWrite(root, migrationMap);
  } else if (!(await exists(agentsPath)) || (await fs.readFile(agentsPath, "utf8")) !== normalized.agents) {
    await transactionalWrite(root, { "AGENTS.md": normalized.agents });
  }
  const index = await buildIndex(root);
  const revisions = await workspaceRevisions(root);
  return { data: normalized, revisions, root };
}

async function createWorkspaceAtPath(workspacePath, inputProject) {
  const requestedPath = String(workspacePath || "").trim();
  if (!requestedPath) throw new Error("请填写项目文件地址。");
  if (!path.isAbsolute(requestedPath)) throw new Error("项目文件地址必须是完整路径。");

  const project = normalizeProject(inputProject).project;
  project.agents = String(inputProject.agents || agentsMarkdown(project));
  project.creationMode = String(inputProject.creationMode || "平衡型");
  const root = path.resolve(requestedPath);
  if (await exists(root)) {
    const files = await fs.readdir(root);
    if (files.length) throw new Error("目标文件夹已存在且不为空，请换一个位置或名称。");
  }
  const parentDir = path.dirname(root);
  await fs.mkdir(parentDir, { recursive: true });
  const temporaryRoot = path.join(parentDir, `.noval-create-${crypto.randomUUID()}`);
  try {
    await fs.mkdir(temporaryRoot, { recursive: true });
    for (const dir of MANAGED_DIRS) await fs.mkdir(path.join(temporaryRoot, dir), { recursive: true });
    const result = await saveWorkspace(temporaryRoot, project, { force: true });
    await loadWorkspace(temporaryRoot);
    if (await exists(root)) await fs.rm(root, { recursive: true, force: true });
    await fs.rename(temporaryRoot, root);
    return { ...result, root };
  } catch (error) {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

async function createWorkspace(parentDir, inputProject) {
  const project = normalizeProject(inputProject).project;
  return createWorkspaceAtPath(path.join(parentDir, safeName(project.title)), inputProject);
}

function splitImportedNovel(content) {
  const lines = String(content || "").split(/\r?\n/);
  const chapters = [];
  let current = null;
  const heading = /^(?:#{1,3}\s*)?(第[零一二三四五六七八九十百千万0-9]+章(?:\s+[^\n]*|[：:、.-][^\n]*|))$/;
  for (const line of lines) {
    const match = line.trim().match(heading);
    if (match) {
      if (current) chapters.push(current);
      current = { title: match[1], lines: [] };
    } else {
      if (!current) current = { title: "导入正文", lines: [] };
      current.lines.push(line);
    }
  }
  if (current) chapters.push(current);
  return chapters.filter((item) => item.lines.join("\n").trim());
}

function reportImportProgress(onProgress, progress) {
  if (typeof onProgress !== "function") return;
  onProgress({
    percent: Math.max(0, Math.min(100, Math.round(Number(progress.percent) || 0))),
    message: String(progress.message || "正在导入小说"),
    currentPage: Number(progress.currentPage) || 0,
    totalPages: Number(progress.totalPages) || 0
  });
}

function pdfItemsToText(items) {
  const lines = [];
  let current = [];
  let lastY = null;
  let lastEndX = null;

  const flush = () => {
    const line = current.join("").replace(/[ \t]+/g, " ").trimEnd();
    if (line.trim()) lines.push(line);
    current = [];
    lastEndX = null;
  };

  for (const item of items || []) {
    if (!item || typeof item.str !== "string") continue;
    const transform = Array.isArray(item.transform) ? item.transform : [];
    const x = Number(transform[4]);
    const y = Number(transform[5]);
    const height = Math.max(1, Math.abs(Number(item.height) || Number(transform[3]) || 1));
    const movedLine = lastY !== null && Number.isFinite(y) && Math.abs(y - lastY) > Math.max(2, height * 0.55);
    if (movedLine) flush();

    if (
      current.length &&
      Number.isFinite(x) &&
      Number.isFinite(lastEndX) &&
      x - lastEndX > Math.max(2, height * 0.22)
    ) {
      current.push(" ");
    }
    current.push(item.str);
    if (Number.isFinite(x)) lastEndX = x + Math.max(0, Number(item.width) || 0);
    if (Number.isFinite(y)) lastY = y;
    if (item.hasEOL) flush();
  }
  flush();
  return lines.join("\n");
}

function normalizePdfPages(rawPages) {
  const pages = (Array.isArray(rawPages) ? rawPages : []).map((content, index) => ({
    pageNumber: index + 1,
    lines: String(content || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  }));
  const threshold = Math.max(2, Math.ceil(pages.length * 0.6));
  const edgeCounts = new Map();
  for (const page of pages) {
    const edgeLines = [...page.lines.slice(0, 2), ...page.lines.slice(-2)];
    for (const line of new Set(edgeLines)) {
      if (line.length <= 100) edgeCounts.set(line, (edgeCounts.get(line) || 0) + 1);
    }
  }
  const furniture = new Set(
    Array.from(edgeCounts.entries()).filter(([, count]) => count >= threshold).map(([line]) => line)
  );
  const pageNumberPattern = /^(?:第\s*)?\d+(?:\s*页)?$/;
  const cleaned = pages.map((page) => ({
    pageNumber: page.pageNumber,
    lines: page.lines.filter((line, index) => {
      const isEdge = index < 2 || index >= page.lines.length - 2;
      return !furniture.has(line) && !(isEdge && pageNumberPattern.test(line));
    })
  }));

  const paragraphs = [];
  const pageMap = [];
  const headingPattern = /^(?:#{1,3}\s*)?第[零一二三四五六七八九十百千万0-9]+章/;
  for (const page of cleaned) {
    for (let lineIndex = 0; lineIndex < page.lines.length; lineIndex += 1) {
      const line = page.lines[lineIndex];
      const previous = paragraphs.at(-1);
      const isFirstLine = lineIndex === 0;
      const crossesPage = isFirstLine && previous && previous.pageNumber !== page.pageNumber;
      const continuesPrevious = crossesPage &&
        !headingPattern.test(line) &&
        (/[，、；：—…]$/.test(previous.text) || !/[。！？!?；;：:]$/.test(previous.text));
      if (continuesPrevious) {
        previous.text += line;
        pageMap.push({ pageNumber: page.pageNumber, paragraphIndex: paragraphs.length - 1, text: line });
        continue;
      }
      paragraphs.push({ pageNumber: page.pageNumber, text: line });
      pageMap.push({ pageNumber: page.pageNumber, paragraphIndex: paragraphs.length - 1, text: line });
    }
  }
  return {
    content: paragraphs.map((item) => item.text).join("\n\n").trim(),
    pageMap
  };
}

async function loadPdfLibrary() {
  if (!pdfLibraryPromise) {
    pdfLibraryPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfLibraryPromise;
}

async function extractPdfNovel(sourcePath, onProgress) {
  reportImportProgress(onProgress, { percent: 5, message: "正在打开 PDF" });
  const pdfjs = await loadPdfLibrary();
  const data = new Uint8Array(await fs.readFile(sourcePath));
  const pdfAssetsDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
  const standardFontDataUrl = `${path.join(pdfAssetsDir, "standard_fonts")}${path.sep}`;
  const cMapUrl = `${path.join(pdfAssetsDir, "cmaps")}${path.sep}`;
  let loadingTask;
  let document;
  try {
    loadingTask = pdfjs.getDocument({ data, standardFontDataUrl, cMapUrl, cMapPacked: true });
    document = await loadingTask.promise;
  } catch (error) {
    if (error?.name === "PasswordException") {
      throw new Error("这个 PDF 受密码保护，请先解除密码后再导入。");
    }
    throw new Error(`无法读取这个 PDF：${error instanceof Error ? error.message : String(error)}`);
  }

  const pages = [];
  const pagesWithoutText = [];
  const pageCount = document.numPages;
  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent({ disableNormalization: false });
      const text = pdfItemsToText(textContent.items).trim();
      if (text.replace(/\s+/g, "").length < 8) pagesWithoutText.push(pageNumber);
      pages.push(text);
      page.cleanup();
      reportImportProgress(onProgress, {
        percent: 8 + (pageNumber / pageCount) * 72,
        message: `正在读取 PDF 第 ${pageNumber}/${pageCount} 页`,
        currentPage: pageNumber,
        totalPages: pageCount
      });
    }
  } finally {
    if (loadingTask) await loadingTask.destroy();
  }

  const normalizedPages = normalizePdfPages(pages);
  const content = normalizedPages.content;
  const meaningfulLength = content.replace(/\s+/g, "").length;
  if (meaningfulLength < 20 || pagesWithoutText.length === pageCount) {
    const pageHint = pagesWithoutText.length
      ? `没有识别到文字的页码：${pagesWithoutText.slice(0, 20).join("、")}${pagesWithoutText.length > 20 ? "等" : ""}。`
      : "";
    throw new Error(`这个 PDF 可能是扫描图片，无法直接读取正文。${pageHint}请先将它转换为可选择文字的 PDF，或导出为 TXT 后再导入。`);
  }
  if ((content.match(/\uFFFD/g) || []).length > meaningfulLength * 0.01) {
    throw new Error("这个 PDF 提取出的文字存在大量乱码，请先转换为可选择文字的 PDF 或 TXT 后再导入。");
  }

  const warnings = [];
  if (pagesWithoutText.length) {
    warnings.push(`第 ${pagesWithoutText.slice(0, 20).join("、")} 页没有检测到足够文字，请在建档前核对是否为封面、插图或扫描页。`);
  }
  return {
    content,
    sourceInfo: {
      format: "pdf",
      pageCount,
      pagesWithoutText,
      pageMap: normalizedPages.pageMap,
      warnings
    }
  };
}

async function readImportedNovel(sourcePath, onProgress) {
  const extension = path.extname(sourcePath).toLowerCase();
  if (!IMPORTABLE_NOVEL_EXTENSIONS.has(extension)) {
    throw new Error("目前只支持 TXT、Markdown 和 PDF 小说文件。");
  }
  if (extension === ".pdf") return extractPdfNovel(sourcePath, onProgress);
  reportImportProgress(onProgress, { percent: 15, message: "正在读取小说正文" });
  return {
    content: await fs.readFile(sourcePath, "utf8"),
    sourceInfo: { format: extension.slice(1), pageCount: 0, pagesWithoutText: [], warnings: [] }
  };
}

async function importNovel(parentDir, sourcePath, seedProject, options = {}) {
  const { content, sourceInfo } = await readImportedNovel(sourcePath, options.onProgress);
  reportImportProgress(options.onProgress, { percent: 84, message: "正在识别章节" });
  const parts = splitImportedNovel(content);
  if (!parts.length) throw new Error("没有在文件中读取到可以导入的小说正文。");
  const project = normalizeProject(seedProject).project;
  if (!project.title || project.title === "未命名小说" || /^导入小说(?:-|$)/.test(project.title)) {
    project.title = path.basename(sourcePath, path.extname(sourcePath));
  }
  project.importStatus = "raw_imported";
  project.importSource = {
    fileName: path.basename(sourcePath),
    ...sourceInfo
  };
  project.analysis = {
    ...project.analysis,
    status: "raw_imported",
    runId: "",
    generationId: "",
    workflowId: "WF01",
    blockingGaps: ["小说尚未完成分析"],
    nonBlockingGaps: [],
    updatedAt: new Date().toISOString()
  };
  project.chapters = parts.map((part, index) => ({
    id: `chapter-${crypto.randomUUID()}`,
    index: index + 1,
    title: part.title.replace(/^第.*?章\s*/, "") || part.title,
    goal: "",
    summary: "",
    content: part.lines.join("\n").trim(),
    instruction: "",
    status: "confirmed",
    sections: [],
    updatedAt: new Date().toISOString()
  }));
  if (Array.isArray(project.importSource.pageMap)) {
    let currentChapter = project.chapters[0] || null;
    project.importSource.pageMap = project.importSource.pageMap.map((item) => {
      const text = String(item.text || "").trim();
      const titleMatch = project.chapters.find((chapter) =>
        text.includes(chapter.title) || chapter.title.includes(text.replace(/^#+\s*/, ""))
      );
      const contentMatch = project.chapters.find((chapter) => String(chapter.content || "").includes(text));
      currentChapter = titleMatch || contentMatch || currentChapter;
      const paragraphs = String(currentChapter?.content || "")
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);
      const paragraphIndex = paragraphs.findIndex((paragraph) => paragraph.includes(text) || text.includes(paragraph));
      return {
        ...item,
        chapterId: currentChapter?.id || "",
        chapterParagraph: paragraphIndex >= 0 ? paragraphIndex + 1 : 0
      };
    });
  }
  reportImportProgress(options.onProgress, { percent: 92, message: "正在建立创作空间" });
  const result = await createWorkspace(parentDir, project);
  reportImportProgress(options.onProgress, { percent: 100, message: "正文导入完成" });
  return { ...result, sourceInfo };
}

async function listDocuments(root) {
  const indexPath = path.join(root, ".noval", "index.json");
  let entries = [];
  try {
    const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
    entries = index.documents || [];
  } catch {
    const loaded = await loadWorkspace(root);
    const fileMap = projectFileMap(loaded.data);
    const index = await buildIndex(root);
    entries = index.documents || [];
  }
  const docs = [];
  for (const item of entries) {
    const filePath = assertInside(root, path.join(root, item.path));
    try {
      const opened = await readWorkspaceFile(root, item.path);
      docs.push({ id: item.id, title: item.title, content: opened.content });
    } catch {
      // Rebuildable index may briefly reference a deleted external file.
    }
  }
  return docs;
}

async function searchWorkspace(root, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return [];
  const indexPath = path.join(root, ".noval", "index.json");
  let index = await readJson(indexPath, null);
  if (!index?.documents) {
    const loaded = await loadWorkspace(root);
    index = await buildIndex(root);
  }
  const terms = searchTerms(normalizedQuery);
  const candidates = index.documents.filter((item) =>
    terms.every((term) => item.terms?.includes(term)) || item.title?.toLowerCase().includes(normalizedQuery)
  );
  const results = [];
  for (const item of candidates.slice(0, 50)) {
    const filePath = assertInside(root, path.join(root, item.path));
    try {
      const content = (await readWorkspaceFile(root, item.path)).content;
      const lower = content.toLowerCase();
      const at = lower.indexOf(normalizedQuery);
      const start = Math.max(0, at >= 0 ? at - 160 : 0);
      results.push({
        id: item.id,
        title: item.title,
        path: item.path,
        excerpt: content.slice(start, start + 480)
      });
    } catch {
      // The index is rebuildable and may briefly lag behind an external deletion.
    }
  }
  return results;
}

module.exports = {
  WORKSPACE_SCHEMA_VERSION,
  agentsMarkdown,
  applyWorkspaceChanges,
  assertInside,
  buildIndex,
  createWorkspace,
  createWorkspaceAtPath,
  detectConflicts,
  extractPdfNovel,
  importNovel,
  listDocuments,
  listWorkspaceFiles,
  loadWorkspace,
  normalizePdfPages,
  projectFileMap,
  readWorkspaceFile,
  recoverTransaction,
  safeName,
  searchWorkspace,
  saveWorkspace,
  splitImportedNovel,
  withProjectIndex
};
