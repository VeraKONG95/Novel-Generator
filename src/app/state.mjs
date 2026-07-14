export const PROJECT_SCHEMA_VERSION = 4;

function defaultExportOptions() {
  return {
    includeSynopsis: true,
    includeVolumes: true,
    includeChapterSummaries: true,
    includeAppendix: true
  };
}

export function defaultProject() {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: `noval-${Date.now()}`,
    title: "未命名小说",
    agents: "",
    creationMode: "平衡型",
    importStatus: "",
    constitutionStatus: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    setup: {
      genre: "东方玄幻",
      audience: "男频成长向读者",
      tone: "热血、悬疑、升级感强",
      narrativePerspective: "第三人称限知",
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
      storyBible: {
        theme: "",
        narrativeStyle: "热血、悬疑、升级感强",
        timelineRules: "",
        taboos: [],
        continuityRules: ["开篇三章必须有钩子", "每章结尾留下推进点", "避免纯解释性旁白"]
      },
      characters: [],
      mainPlot: "",
      subPlots: [],
      plotlines: [],
      volumes: [],
      chapterPlans: []
    },
    chapters: [],
    exportOptions: defaultExportOptions(),
    memory: {
      characters: [],
      locations: [],
      factions: [],
      rules: [],
      events: [],
      foreshadowing: []
    },
    storyState: {
      currentTimeline: "",
      activePlotlineIds: [],
      unresolvedConflicts: [],
      knownFacts: [],
      hiddenFacts: [],
      characterStates: [],
      foreshadowingRegistry: [],
      continuityConstraints: []
    },
    documents: {
      characterArchive: "",
      stagePlan: "",
      chapterPlan: "",
      styleGuide: "",
      importArchive: ""
    }
  };
}

function loadRecentProjects() {
  try {
    return JSON.parse(localStorage.getItem("noval.recentProjects") || "[]");
  } catch {
    return [];
  }
}

export function persistRecentProjects(recentProjects) {
  localStorage.setItem(
    "noval.recentProjects",
    JSON.stringify(recentProjects.slice(0, 6))
  );
}

export function createInitialState() {
  return {
    route: "home",
    project: defaultProject(),
    currentChapterId: null,
    status: "准备开始创作。",
    settings: {
      provider: "openrouter",
      apiKey: "",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "deepseek/deepseek-v4-flash",
      contextWindow: 1048576,
      maxOutputTokens: 65536,
      capabilityStatus: "unchecked"
    },
    currentPath: "",
    recentProjects: loadRecentProjects(),
    autosave: {
      phase: "idle",
      lastSavedAt: "",
      error: ""
    },
    recoveryNotice: null,
    lastRewriteReview: null
  };
}
