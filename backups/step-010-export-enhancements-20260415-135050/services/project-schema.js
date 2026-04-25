const PROJECT_SCHEMA_VERSION = 1;

function timestamp(value) {
  return String(value || new Date().toISOString());
}

function stringValue(value, fallback = "") {
  return value == null ? fallback : String(value);
}

function numberValue(value, fallback = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item).trim()).filter(Boolean);
}

function defaultMemory() {
  return {
    characters: [],
    locations: [],
    factions: [],
    rules: [],
    events: [],
    foreshadowing: []
  };
}

function defaultBlueprint() {
  return {
    titleOptions: [],
    hook: "",
    synopsis: "",
    worldSetting: "",
    characters: [],
    mainPlot: "",
    subPlots: [],
    volumes: [],
    chapterPlans: []
  };
}

function defaultSetup() {
  return {
    genre: "东方玄幻",
    audience: "男频成长向读者",
    tone: "热血、悬疑、升级感强",
    targetWords: 1200000,
    premise: "一个被宗门放逐的少年，在边城遗迹中得到能看见因果裂痕的能力。",
    worldBackground: "大离王朝末世将临，宗门割据，旧神遗迹不断苏醒。",
    protagonist: "陆惊川，16岁，冷静克制但内里偏执，目标是找出家族灭门真相。",
    conflict: "主角必须在强敌追杀和自身能力反噬之间求生，并逐步揭开更高层阴谋。",
    extraConstraints: "开篇三章必须有钩子；每章结尾留下推进点；避免纯解释性旁白。"
  };
}

function createDefaultProject() {
  const now = new Date().toISOString();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: `noval-${Date.now()}`,
    title: "未命名小说",
    createdAt: now,
    updatedAt: now,
    setup: defaultSetup(),
    blueprint: defaultBlueprint(),
    chapters: [],
    memory: defaultMemory()
  };
}

function normalizeCharacter(item, index) {
  const source = item && typeof item === "object" ? item : {};
  return {
    id: stringValue(source.id, `char-${index + 1}`),
    name: stringValue(source.name, `角色${index + 1}`),
    role: stringValue(source.role),
    personality: stringValue(source.personality),
    goal: stringValue(source.goal),
    conflict: stringValue(source.conflict),
    traits: stringList(source.traits),
    relationships: stringList(source.relationships)
  };
}

function normalizeVolume(item, index) {
  const source = item && typeof item === "object" ? item : {};
  return {
    title: stringValue(source.title, `第 ${index + 1} 卷`),
    summary: stringValue(source.summary)
  };
}

function normalizeChapterPlan(item, index) {
  const source = item && typeof item === "object" ? item : {};
  return {
    index: numberValue(source.index, index + 1),
    title: stringValue(source.title, `第 ${index + 1} 章`),
    goal: stringValue(source.goal),
    turningPoint: stringValue(source.turningPoint)
  };
}

function normalizeMemoryItem(type, item, index) {
  const source = item && typeof item === "object" ? item : {};
  const normalized = {
    id: stringValue(source.id, `${type}-${index + 1}`),
    name: stringValue(source.name, `${type}-${index + 1}`),
    content: stringValue(source.content || source.summary),
    updatedAt: timestamp(source.updatedAt)
  };

  if (source.sourceChapter != null && source.sourceChapter !== "") {
    normalized.sourceChapter = numberValue(source.sourceChapter, undefined);
  }

  return normalized;
}

function normalizeMemorySection(type, value) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => normalizeMemoryItem(type, item, index));
}

function normalizeProject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("项目文件格式无效：顶层必须是对象。");
  }

  const defaults = createDefaultProject();
  const sourceSetup = input.setup && typeof input.setup === "object" ? input.setup : {};
  const sourceBlueprint =
    input.blueprint && typeof input.blueprint === "object" ? input.blueprint : {};
  const sourceMemory = input.memory && typeof input.memory === "object" ? input.memory : {};
  const rawVersion = input.schemaVersion;
  const sourceVersion = Number.isFinite(Number(rawVersion)) ? Number(rawVersion) : null;

  const project = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: stringValue(input.id, defaults.id),
    title: stringValue(input.title, defaults.title),
    createdAt: timestamp(input.createdAt || defaults.createdAt),
    updatedAt: timestamp(input.updatedAt || defaults.updatedAt),
    setup: {
      genre: stringValue(sourceSetup.genre, defaults.setup.genre),
      audience: stringValue(sourceSetup.audience, defaults.setup.audience),
      tone: stringValue(sourceSetup.tone, defaults.setup.tone),
      targetWords: numberValue(sourceSetup.targetWords, defaults.setup.targetWords),
      premise: stringValue(sourceSetup.premise, defaults.setup.premise),
      worldBackground: stringValue(
        sourceSetup.worldBackground,
        defaults.setup.worldBackground
      ),
      protagonist: stringValue(sourceSetup.protagonist, defaults.setup.protagonist),
      conflict: stringValue(sourceSetup.conflict, defaults.setup.conflict),
      extraConstraints: stringValue(
        sourceSetup.extraConstraints,
        defaults.setup.extraConstraints
      )
    },
    blueprint: {
      titleOptions: stringList(sourceBlueprint.titleOptions),
      hook: stringValue(sourceBlueprint.hook),
      synopsis: stringValue(sourceBlueprint.synopsis),
      worldSetting: stringValue(sourceBlueprint.worldSetting),
      characters: Array.isArray(sourceBlueprint.characters)
        ? sourceBlueprint.characters.map(normalizeCharacter)
        : [],
      mainPlot: stringValue(sourceBlueprint.mainPlot),
      subPlots: stringList(sourceBlueprint.subPlots),
      volumes: Array.isArray(sourceBlueprint.volumes)
        ? sourceBlueprint.volumes.map(normalizeVolume)
        : [],
      chapterPlans: Array.isArray(sourceBlueprint.chapterPlans)
        ? sourceBlueprint.chapterPlans.map(normalizeChapterPlan)
        : []
    },
    chapters: Array.isArray(input.chapters)
      ? input.chapters.map((item, index) => {
          const source = item && typeof item === "object" ? item : {};
          return {
            id: stringValue(source.id, `chapter-${index + 1}`),
            index: numberValue(source.index, index + 1),
            title: stringValue(source.title, `第 ${index + 1} 章`),
            goal: stringValue(source.goal),
            summary: stringValue(source.summary || source.goal),
            content: stringValue(source.content),
            instruction: stringValue(source.instruction),
            status: stringValue(source.status, "draft"),
            updatedAt: timestamp(source.updatedAt)
          };
        })
      : [],
    memory: {
      characters: normalizeMemorySection("characters", sourceMemory.characters),
      locations: normalizeMemorySection("locations", sourceMemory.locations),
      factions: normalizeMemorySection("factions", sourceMemory.factions),
      rules: normalizeMemorySection("rules", sourceMemory.rules),
      events: normalizeMemorySection("events", sourceMemory.events),
      foreshadowing: normalizeMemorySection(
        "foreshadowing",
        sourceMemory.foreshadowing
      )
    }
  };

  return {
    project,
    meta: {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      migrated: sourceVersion !== PROJECT_SCHEMA_VERSION,
      migratedFrom: sourceVersion ?? "legacy"
    }
  };
}

function normalizeAutosaveSnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("自动保存快照格式无效。");
  }

  const normalized = normalizeProject(input.project);
  return {
    snapshot: {
      savedAt: timestamp(input.savedAt),
      currentPath: stringValue(input.currentPath),
      currentChapterId: stringValue(input.currentChapterId),
      route: stringValue(input.route, "home"),
      project: normalized.project
    },
    meta: normalized.meta
  };
}

module.exports = {
  PROJECT_SCHEMA_VERSION,
  createDefaultProject,
  normalizeAutosaveSnapshot,
  normalizeProject
};
