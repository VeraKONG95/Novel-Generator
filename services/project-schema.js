const PROJECT_SCHEMA_VERSION = 5;

function timestamp(value) {
  return String(value || new Date().toISOString());
}

function stringValue(value, fallback = "") {
  return value == null ? fallback : String(value);
}

function numberValue(value, fallback) {
  const fallbackValue = arguments.length > 1 ? fallback : 0;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallbackValue;
}

function stringList(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  return source.map((item) => stringValue(item).trim()).filter(Boolean);
}

function booleanValue(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

function defaultStoryBible() {
  return {
    theme: "",
    narrativeStyle: "",
    timelineRules: "",
    taboos: [],
    continuityRules: []
  };
}

function defaultStoryState() {
  return {
    currentTimeline: "",
    activePlotlineIds: [],
    unresolvedConflicts: [],
    knownFacts: [],
    hiddenFacts: [],
    characterStates: [],
    foreshadowingRegistry: [],
    continuityConstraints: []
  };
}

function defaultDocuments() {
  return {
    characterArchive: "",
    stagePlan: "",
    chapterPlan: "",
    styleGuide: "",
    importArchive: ""
  };
}

function defaultAnalysis() {
  return {
    status: "uninitialized",
    runId: "",
    generationId: "",
    workflowId: "",
    blockingGaps: [],
    nonBlockingGaps: [],
    updatedAt: ""
  };
}

function defaultAnalysisSettings() {
  return { maxConcurrency: 4 };
}

function defaultBlueprint() {
  return {
    titleOptions: [],
    hook: "",
    synopsis: "",
    worldSetting: "",
    storyBible: defaultStoryBible(),
    characters: [],
    mainPlot: "",
    subPlots: [],
    plotlines: [],
    volumes: [],
    chapterPlans: []
  };
}

function defaultExportOptions() {
  return {
    includeSynopsis: true,
    includeVolumes: true,
    includeChapterSummaries: true,
    includeAppendix: true
  };
}

function defaultSetup() {
  return {
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
  };
}

function createDefaultProject() {
  const now = new Date().toISOString();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: `noval-${Date.now()}`,
    title: "未命名小说",
    agents: "",
    creationMode: "平衡型",
    importStatus: "",
    importSource: {
      fileName: "",
      format: "",
      pageCount: 0,
      pagesWithoutText: [],
      pageMap: [],
      warnings: []
    },
    constitutionStatus: "draft",
    createdAt: now,
    updatedAt: now,
    setup: defaultSetup(),
    blueprint: defaultBlueprint(),
    chapters: [],
    exportOptions: defaultExportOptions(),
    memory: defaultMemory(),
    storyState: defaultStoryState(),
    documents: defaultDocuments(),
    analysis: defaultAnalysis(),
    analysisSettings: defaultAnalysisSettings()
  };
}

function normalizeRelationEdge(item, index) {
  const source = objectValue(item);
  return {
    id: stringValue(source.id, `rel-${index + 1}`),
    targetCharacterId: stringValue(source.targetCharacterId),
    targetCharacterName: stringValue(source.targetCharacterName || source.name),
    type: stringValue(source.type || source.relationship, "未定义关系"),
    dynamic: stringValue(source.dynamic || source.content)
  };
}

function normalizeCharacterArc(item, index) {
  const source = objectValue(item);
  return {
    id: stringValue(source.id, `arc-${index + 1}`),
    stage: stringValue(source.stage || source.name, `阶段 ${index + 1}`),
    change: stringValue(source.change || source.content),
    trigger: stringValue(source.trigger),
    payoff: stringValue(source.payoff)
  };
}

function normalizeCharacter(item, index) {
  const source = objectValue(item);
  const goal = stringValue(source.goal);
  const conflict = stringValue(source.conflict);
  const relationships = stringList(source.relationships);
  return {
    id: stringValue(source.id, `char-${index + 1}`),
    name: stringValue(source.name, `角色${index + 1}`),
    role: stringValue(source.role),
    identity: stringValue(source.identity || source.role),
    personality: stringValue(source.personality),
    goal,
    conflict,
    traits: stringList(source.traits),
    relationships,
    desire: stringValue(source.desire || goal),
    fear: stringValue(source.fear),
    wound: stringValue(source.wound),
    secret: stringValue(source.secret),
    ability: stringValue(source.ability),
    limitation: stringValue(source.limitation || conflict),
    bottomLine: stringValue(source.bottomLine),
    voice: stringValue(source.voice),
    finalDirection: stringValue(source.finalDirection),
    relationEdges: Array.isArray(source.relationEdges)
      ? source.relationEdges.map(normalizeRelationEdge)
      : relationships.map((relationship, relationIndex) =>
          normalizeRelationEdge({ dynamic: relationship }, relationIndex)
        ),
    arc: Array.isArray(source.arc) ? source.arc.map(normalizeCharacterArc) : []
  };
}

function normalizeVolume(item, index) {
  const source = objectValue(item);
  return {
    title: stringValue(source.title, `第 ${index + 1} 卷`),
    summary: stringValue(source.summary)
  };
}

function normalizePlotBeat(item, index) {
  const source = objectValue(item);
  return {
    id: stringValue(source.id, `beat-${index + 1}`),
    title: stringValue(source.title || source.name, `剧情节点 ${index + 1}`),
    summary: stringValue(source.summary || source.content),
    type: stringValue(source.type, "event"),
    chapterIndex: numberValue(source.chapterIndex, undefined),
    sectionId: stringValue(source.sectionId),
    ownerCharacterIds: stringList(source.ownerCharacterIds),
    participantCharacterIds: stringList(source.participantCharacterIds),
    dependencyBeatIds: stringList(source.dependencyBeatIds || source.dependencies),
    reveals: stringList(source.reveals),
    foreshadows: stringList(source.foreshadows),
    payoff: stringValue(source.payoff),
    status: stringValue(source.status, "planned")
  };
}

function normalizePlotline(item, index) {
  const source = objectValue(item);
  return {
    id: stringValue(source.id, `plotline-${index + 1}`),
    type: stringValue(source.type, index === 0 ? "main" : "subplot"),
    title: stringValue(source.title || source.name, index === 0 ? "主线" : `支线 ${index}`),
    goal: stringValue(source.goal || source.summary || source.content),
    ownerCharacterIds: stringList(source.ownerCharacterIds || source.owners),
    dependencies: stringList(source.dependencies),
    reveals: stringList(source.reveals),
    foreshadows: stringList(source.foreshadows),
    payoff: stringValue(source.payoff),
    status: stringValue(source.status, "planned"),
    beats: Array.isArray(source.beats) ? source.beats.map(normalizePlotBeat) : []
  };
}

function legacyPlotlines(sourceBlueprint) {
  const plotlines = [];
  if (sourceBlueprint.mainPlot) {
    plotlines.push({
      id: "plot-main",
      type: "main",
      title: "主线",
      goal: sourceBlueprint.mainPlot,
      status: "planned"
    });
  }
  stringList(sourceBlueprint.subPlots).forEach((content, index) => {
    plotlines.push({
      id: `plot-sub-${index + 1}`,
      type: "subplot",
      title: `支线 ${index + 1}`,
      goal: content,
      status: "planned"
    });
  });
  return plotlines;
}

function normalizeStoryBible(value, fallback = defaultStoryBible()) {
  const source = objectValue(value);
  return {
    theme: stringValue(source.theme, fallback.theme),
    narrativeStyle: stringValue(source.narrativeStyle, fallback.narrativeStyle),
    timelineRules: stringValue(source.timelineRules, fallback.timelineRules),
    taboos: stringList(source.taboos, fallback.taboos),
    continuityRules: stringList(source.continuityRules, fallback.continuityRules)
  };
}

function normalizeChapterSectionPlan(item, index) {
  const source = objectValue(item);
  return {
    id: stringValue(source.id, `section-plan-${index + 1}`),
    index: numberValue(source.index, index + 1),
    title: stringValue(source.title, `第 ${index + 1} 节`),
    sceneGoal: stringValue(source.sceneGoal || source.goal),
    pov: stringValue(source.pov),
    location: stringValue(source.location),
    participants: stringList(source.participants),
    conflict: stringValue(source.conflict),
    outcome: stringValue(source.outcome),
    hooks: stringList(source.hooks),
    plotBeatIds: stringList(source.plotBeatIds),
    characterArcIds: stringList(source.characterArcIds),
    status: stringValue(source.status, "planned")
  };
}

function normalizeChapterPlan(item, index) {
  const source = objectValue(item);
  return {
    index: numberValue(source.index, index + 1),
    title: stringValue(source.title, `第 ${index + 1} 章`),
    goal: stringValue(source.goal),
    turningPoint: stringValue(source.turningPoint),
    plotBeatIds: stringList(source.plotBeatIds),
    characterArcIds: stringList(source.characterArcIds),
    tensionCurve: stringValue(source.tensionCurve),
    sections: Array.isArray(source.sections)
      ? source.sections.map(normalizeChapterSectionPlan)
      : []
  };
}

function normalizeChapterSection(item, index) {
  const source = objectValue(item);
  return {
    id: stringValue(source.id, `section-${index + 1}`),
    index: numberValue(source.index, index + 1),
    title: stringValue(source.title, `第 ${index + 1} 节`),
    sceneGoal: stringValue(source.sceneGoal || source.goal),
    pov: stringValue(source.pov),
    location: stringValue(source.location),
    participants: stringList(source.participants),
    conflict: stringValue(source.conflict),
    outcome: stringValue(source.outcome),
    hooks: stringList(source.hooks),
    plotBeatIds: stringList(source.plotBeatIds),
    characterArcIds: stringList(source.characterArcIds),
    summary: stringValue(source.summary),
    content: stringValue(source.content),
    status: stringValue(source.status, "draft"),
    updatedAt: timestamp(source.updatedAt)
  };
}

function normalizeMemoryItem(type, item, index) {
  const source = objectValue(item);
  const normalized = {
    id: stringValue(source.id, `${type}-${index + 1}`),
    name: stringValue(source.name, `${type}-${index + 1}`),
    content: stringValue(source.content || source.summary),
    updatedAt: timestamp(source.updatedAt)
  };

  if (source.sourceChapter != null && source.sourceChapter !== "") {
    normalized.sourceChapter = numberValue(source.sourceChapter, undefined);
  }
  if (source.sourceExcerpt) {
    normalized.sourceExcerpt = stringValue(source.sourceExcerpt);
  }
  if (source.status) {
    normalized.status = stringValue(source.status);
  }

  return normalized;
}

function normalizeMemorySection(type, value) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => normalizeMemoryItem(type, item, index));
}

function normalizeStoryFact(type, item, index) {
  const source = objectValue(item);
  const normalized = {
    id: stringValue(source.id, `${type}-${index + 1}`),
    name: stringValue(source.name || source.title, `${type}-${index + 1}`),
    content: stringValue(source.content || source.summary),
    status: stringValue(source.status, "active"),
    updatedAt: timestamp(source.updatedAt)
  };

  if (source.sourceChapter != null && source.sourceChapter !== "") {
    normalized.sourceChapter = numberValue(source.sourceChapter, undefined);
  }

  return normalized;
}

function normalizeStoryFactSection(type, value) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => normalizeStoryFact(type, item, index));
}

function normalizeCharacterState(item, index) {
  const source = objectValue(item);
  return {
    characterId: stringValue(source.characterId, `char-${index + 1}`),
    name: stringValue(source.name),
    currentGoal: stringValue(source.currentGoal),
    emotionalState: stringValue(source.emotionalState),
    physicalState: stringValue(source.physicalState),
    location: stringValue(source.location),
    knowledge: stringList(source.knowledge),
    lastUpdatedChapter: numberValue(source.lastUpdatedChapter, undefined)
  };
}

function normalizeForeshadowingRecord(item, index) {
  const source = objectValue(item);
  const normalized = {
    id: stringValue(source.id, `foreshadow-${index + 1}`),
    name: stringValue(source.name || source.title, `伏笔 ${index + 1}`),
    setup: stringValue(source.setup || source.content),
    expectedPayoff: stringValue(source.expectedPayoff || source.payoff),
    status: stringValue(source.status, "open"),
    linkedPlotlineId: stringValue(source.linkedPlotlineId)
  };

  if (source.sourceChapter != null && source.sourceChapter !== "") {
    normalized.sourceChapter = numberValue(source.sourceChapter, undefined);
  }
  if (source.payoffChapter != null && source.payoffChapter !== "") {
    normalized.payoffChapter = numberValue(source.payoffChapter, undefined);
  }

  return normalized;
}

function normalizeStoryState(value) {
  const source = objectValue(value);
  return {
    currentTimeline: stringValue(source.currentTimeline),
    activePlotlineIds: stringList(source.activePlotlineIds),
    unresolvedConflicts: normalizeStoryFactSection(
      "conflict",
      source.unresolvedConflicts
    ),
    knownFacts: normalizeStoryFactSection("known", source.knownFacts),
    hiddenFacts: normalizeStoryFactSection("hidden", source.hiddenFacts),
    characterStates: Array.isArray(source.characterStates)
      ? source.characterStates.map(normalizeCharacterState)
      : [],
    foreshadowingRegistry: Array.isArray(source.foreshadowingRegistry)
      ? source.foreshadowingRegistry.map(normalizeForeshadowingRecord)
      : [],
    continuityConstraints: normalizeStoryFactSection(
      "constraint",
      source.continuityConstraints
    )
  };
}

function normalizeProject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("项目文件格式无效：顶层必须是对象。");
  }

  const defaults = createDefaultProject();
  const sourceSetup = objectValue(input.setup);
  const sourceBlueprint = objectValue(input.blueprint);
  const sourceExportOptions = objectValue(input.exportOptions);
  const sourceMemory = objectValue(input.memory);
  const sourceAnalysis = objectValue(input.analysis);
  const sourceAnalysisSettings = objectValue(input.analysisSettings);
  const rawVersion = input.schemaVersion;
  const sourceVersion = Number.isFinite(Number(rawVersion)) ? Number(rawVersion) : null;

  const setup = {
    genre: stringValue(sourceSetup.genre, defaults.setup.genre),
    audience: stringValue(sourceSetup.audience, defaults.setup.audience),
    tone: stringValue(sourceSetup.tone, defaults.setup.tone),
    narrativePerspective: stringValue(
      sourceSetup.narrativePerspective,
      defaults.setup.narrativePerspective
    ),
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
  };

  const characters = Array.isArray(sourceBlueprint.characters)
    ? sourceBlueprint.characters.map(normalizeCharacter)
    : [];
  const legacyDerivedPlotlines = legacyPlotlines(sourceBlueprint);
  const plotlines = Array.isArray(sourceBlueprint.plotlines)
    ? sourceBlueprint.plotlines.map(normalizePlotline)
    : legacyDerivedPlotlines.map(normalizePlotline);

  const project = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: stringValue(input.id, defaults.id),
    title: stringValue(input.title, defaults.title),
    agents: stringValue(input.agents),
    creationMode: stringValue(input.creationMode, "平衡型"),
    importStatus: stringValue(input.importStatus),
    importSource: {
      fileName: stringValue(input.importSource?.fileName),
      format: stringValue(input.importSource?.format),
      pageCount: numberValue(input.importSource?.pageCount, 0),
      pagesWithoutText: Array.isArray(input.importSource?.pagesWithoutText)
        ? input.importSource.pagesWithoutText.map((item) => numberValue(item)).filter((item) => item > 0)
        : [],
      pageMap: Array.isArray(input.importSource?.pageMap)
        ? input.importSource.pageMap.map((item) => ({
            pageNumber: numberValue(item?.pageNumber),
            paragraphIndex: numberValue(item?.paragraphIndex),
            chapterId: stringValue(item?.chapterId),
            chapterParagraph: numberValue(item?.chapterParagraph),
            text: stringValue(item?.text)
          })).filter((item) => item.pageNumber > 0 && item.text)
        : [],
      warnings: stringList(input.importSource?.warnings)
    },
    constitutionStatus: stringValue(input.constitutionStatus, "draft"),
    createdAt: timestamp(input.createdAt || defaults.createdAt),
    updatedAt: timestamp(input.updatedAt || defaults.updatedAt),
    setup,
    blueprint: {
      titleOptions: stringList(sourceBlueprint.titleOptions),
      hook: stringValue(sourceBlueprint.hook),
      synopsis: stringValue(sourceBlueprint.synopsis),
      worldSetting: stringValue(sourceBlueprint.worldSetting),
      storyBible: normalizeStoryBible(sourceBlueprint.storyBible, {
        theme: stringValue(sourceBlueprint.theme),
        narrativeStyle: setup.tone,
        timelineRules: "",
        taboos: [],
        continuityRules: stringList(setup.extraConstraints.split(/[；;]/))
      }),
      characters,
      mainPlot: stringValue(sourceBlueprint.mainPlot),
      subPlots: stringList(sourceBlueprint.subPlots),
      plotlines,
      volumes: Array.isArray(sourceBlueprint.volumes)
        ? sourceBlueprint.volumes.map(normalizeVolume)
        : [],
      chapterPlans: Array.isArray(sourceBlueprint.chapterPlans)
        ? sourceBlueprint.chapterPlans.map(normalizeChapterPlan)
        : []
    },
    exportOptions: {
      includeSynopsis: booleanValue(
        sourceExportOptions.includeSynopsis,
        defaults.exportOptions.includeSynopsis
      ),
      includeVolumes: booleanValue(
        sourceExportOptions.includeVolumes,
        defaults.exportOptions.includeVolumes
      ),
      includeChapterSummaries: booleanValue(
        sourceExportOptions.includeChapterSummaries,
        defaults.exportOptions.includeChapterSummaries
      ),
      includeAppendix: booleanValue(
        sourceExportOptions.includeAppendix,
        defaults.exportOptions.includeAppendix
      )
    },
    chapters: Array.isArray(input.chapters)
      ? input.chapters.map((item, index) => {
          const source = objectValue(item);
          return {
            id: stringValue(source.id, `chapter-${index + 1}`),
            index: numberValue(source.index, index + 1),
            title: stringValue(source.title, `第 ${index + 1} 章`),
            goal: stringValue(source.goal),
            summary: stringValue(source.summary || source.goal),
            content: stringValue(source.content),
            instruction: stringValue(source.instruction),
            status: stringValue(source.status, "draft"),
            sections: Array.isArray(source.sections)
              ? source.sections.map(normalizeChapterSection)
              : [],
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
    },
    storyState: normalizeStoryState(input.storyState),
    analysis: {
      status: stringValue(sourceAnalysis.status, defaults.analysis.status),
      runId: stringValue(sourceAnalysis.runId),
      generationId: stringValue(sourceAnalysis.generationId),
      workflowId: stringValue(sourceAnalysis.workflowId),
      blockingGaps: stringList(sourceAnalysis.blockingGaps),
      nonBlockingGaps: stringList(sourceAnalysis.nonBlockingGaps),
      updatedAt: stringValue(sourceAnalysis.updatedAt)
    },
    analysisSettings: {
      maxConcurrency: Math.max(
        1,
        Math.min(8, Math.round(numberValue(sourceAnalysisSettings.maxConcurrency, 4)))
      )
    },
    documents: {
      characterArchive: stringValue(input.documents?.characterArchive),
      stagePlan: stringValue(input.documents?.stagePlan),
      chapterPlan: stringValue(input.documents?.chapterPlan),
      styleGuide: stringValue(input.documents?.styleGuide),
      importArchive: stringValue(input.documents?.importArchive)
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
