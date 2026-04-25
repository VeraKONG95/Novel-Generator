import { persistRecentProjects } from "./state.mjs";
import { countWords, summarizeChapter } from "./utils.mjs";

const MEMORY_TYPES = [
  "characters",
  "locations",
  "factions",
  "rules",
  "events",
  "foreshadowing"
];

function emptyMemoryBundle() {
  return {
    characters: [],
    locations: [],
    factions: [],
    rules: [],
    events: [],
    foreshadowing: []
  };
}

function normalizeMemoryItem(type, item, index) {
  const source = item && typeof item === "object" ? item : {};
  const fallbackNames = {
    characters: `人物${index + 1}`,
    locations: `地点${index + 1}`,
    factions: `势力${index + 1}`,
    rules: `规则${index + 1}`,
    events: `事件${index + 1}`,
    foreshadowing: `伏笔${index + 1}`
  };
  const normalized = {
    id: String(source.id || `${type}-${index + 1}`),
    name: String(source.name || fallbackNames[type] || `条目${index + 1}`),
    content: String(source.content || source.summary || "待补充"),
    updatedAt: String(source.updatedAt || new Date().toISOString())
  };

  if (source.sourceChapter) {
    normalized.sourceChapter = Number(source.sourceChapter) || undefined;
  }

  return normalized;
}

function memoryIdentity(type, item) {
  const sourceChapter = item?.sourceChapter ? `:${item.sourceChapter}` : "";
  return `${type}:${String(item?.name || "").trim().toLowerCase()}${sourceChapter}`;
}

export function markUpdated(state) {
  state.project.updatedAt = new Date().toISOString();
}

export function getCurrentChapter(state) {
  return (
    state.project.chapters.find((chapter) => chapter.id === state.currentChapterId) ||
    null
  );
}

export function saveRecentProject(state, filePath) {
  if (!filePath) return;

  const item = {
    filePath,
    title: state.project.title,
    updatedAt: new Date().toISOString()
  };

  state.recentProjects = [
    item,
    ...state.recentProjects.filter((entry) => entry.filePath !== filePath)
  ];
  persistRecentProjects(state.recentProjects);
}

export function projectStats(state) {
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

export function chapterPlanFor(state, index) {
  return state.project.blueprint.chapterPlans[index - 1] || null;
}

export function normalizeMemoryBundle(memory) {
  const source = memory && typeof memory === "object" ? memory : {};
  const normalized = emptyMemoryBundle();

  MEMORY_TYPES.forEach((type) => {
    const list = Array.isArray(source[type]) ? source[type] : [];
    normalized[type] = list.map((item, index) => normalizeMemoryItem(type, item, index));
  });

  return normalized;
}

export function setProjectMemory(state, memory) {
  state.project.memory = normalizeMemoryBundle(memory);
}

export function mergeProjectMemory(state, memory) {
  const current = normalizeMemoryBundle(state.project.memory);
  const incoming = normalizeMemoryBundle(memory);
  const merged = emptyMemoryBundle();

  MEMORY_TYPES.forEach((type) => {
    const map = new Map();
    [...current[type], ...incoming[type]].forEach((item, index) => {
      const normalized = normalizeMemoryItem(type, item, index);
      map.set(memoryIdentity(type, normalized), normalized);
    });
    merged[type] = Array.from(map.values());
  });

  state.project.memory = merged;
}

export function buildLocalMemoryFromProject(project) {
  const blueprint = project.blueprint;
  const chapters = project.chapters;
  const now = new Date().toISOString();

  return {
    characters: blueprint.characters.map((character, index) => ({
      id: `memory-char-${index + 1}`,
      name: character.name,
      content: `${character.role}；目标：${character.goal}；冲突：${character.conflict}`,
      updatedAt: now
    })),
    locations: [
      {
        id: "loc-1",
        name: "边城遗迹",
        content: blueprint.worldSetting || project.setup.worldBackground,
        updatedAt: now
      }
    ],
    factions: [
      {
        id: "fac-1",
        name: "宗门与王朝势力",
        content: "表面维持秩序，实则围绕旧神遗迹争夺控制权。",
        updatedAt: now
      }
    ],
    rules: [
      {
        id: "rule-1",
        name: "能力代价",
        content: "每次动用核心能力都必须承受可见的反噬和后果。",
        updatedAt: now
      }
    ],
    events: chapters.slice(-6).map((chapter) => ({
      id: `event-${chapter.index}`,
      name: `第 ${chapter.index} 章`,
      content: chapter.summary || summarizeChapter(chapter.content),
      sourceChapter: chapter.index,
      updatedAt: chapter.updatedAt || now
    })),
    foreshadowing: blueprint.chapterPlans.slice(0, 6).map((plan) => ({
      id: `f-${plan.index}`,
      name: `第 ${plan.index} 章伏笔`,
      content: plan.turningPoint,
      sourceChapter: plan.index,
      updatedAt: now
    }))
  };
}

export function createChapter(state) {
  const nextIndex = state.project.chapters.length + 1;
  const plan = chapterPlanFor(state, nextIndex);
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
  markUpdated(state);
  return chapter;
}

export function refreshMemory(state) {
  setProjectMemory(state, buildLocalMemoryFromProject(state.project));
}

export function buildExportContent(state, format) {
  const lines = [];
  lines.push(format === "markdown" ? `# ${state.project.title}` : state.project.title);
  lines.push("");
  lines.push(`题材：${state.project.setup.genre}`);
  lines.push(`文风：${state.project.setup.tone}`);
  lines.push(`简介：${state.project.blueprint.synopsis || state.project.setup.premise}`);
  lines.push("");

  state.project.chapters.forEach((chapter) => {
    lines.push(
      format === "markdown"
        ? `## 第 ${chapter.index} 章 ${chapter.title}`
        : `第 ${chapter.index} 章 ${chapter.title}`
    );
    lines.push(chapter.content || "");
    lines.push("");
  });

  return lines.join("\n");
}
