import { Chapter, Character, DraftProjectSummary, NovalMemory, NovalProject, Project, RecentProjectSummary, WorldSetting } from '../types';

const RECENT_PROJECTS_KEY = 'noval.recentProjects';
const PROJECT_SCHEMA_VERSION = 5;

function nowIso() {
  return new Date().toISOString();
}

function formatDateOnly(value: string) {
  if (!value) return '';
  const normalized = new Date(value);
  if (Number.isNaN(normalized.getTime())) {
    return value.slice(0, 10);
  }
  return normalized.toISOString().slice(0, 10);
}

export function countWords(content: string) {
  return String(content || '').replace(/\s+/g, '').length;
}

export function createDefaultProject(seed?: {
  title?: string;
  genre?: string;
  description?: string;
  audience?: string;
  tone?: string;
  narrativePerspective?: string;
  creationMode?: string;
  taboos?: string;
  targetWords?: number;
}): NovalProject {
  const timestamp = nowIso();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: `noval-${Date.now()}`,
    title: seed?.title?.trim() || '未命名小说',
    agents: '',
    creationMode: seed?.creationMode || '平衡型',
    importStatus: '',
    importSource: { fileName: '', format: '', pageCount: 0, pagesWithoutText: [], pageMap: [], warnings: [] },
    constitutionStatus: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp,
    setup: {
      genre: seed?.genre?.trim() || '未分类',
      audience: seed?.audience?.trim() || '面向长篇网文读者',
      tone: seed?.tone?.trim() || '细腻',
      narrativePerspective: seed?.narrativePerspective?.trim() || '第三人称限知',
      targetWords: seed?.targetWords || 120000,
      premise: seed?.description?.trim() || '从一个强冲突开场，逐步展开角色命运与主线谜团。',
      worldBackground: '',
      protagonist: '',
      conflict: '',
      extraConstraints: '章节结尾保留推进点，避免纯解释性旁白。'
    },
    blueprint: {
      titleOptions: [],
      hook: '',
      synopsis: seed?.description?.trim() || '',
      worldSetting: '',
      storyBible: {
        theme: '',
        narrativeStyle: seed?.tone?.trim() || '细腻',
        timelineRules: '',
        taboos: seed?.taboos?.split(/[；;\n]/).map((item) => item.trim()).filter(Boolean) || [],
        continuityRules: ['章节结尾保留推进点', '避免纯解释性旁白']
      },
      characters: [],
      mainPlot: '',
      subPlots: [],
      plotlines: [],
      volumes: [],
      chapterPlans: []
    },
    chapters: [],
    exportOptions: {
      includeSynopsis: true,
      includeVolumes: true,
      includeChapterSummaries: true,
      includeAppendix: true
    },
    memory: emptyMemory(),
    storyState: emptyStoryState(),
    analysis: {
      status: 'uninitialized',
      runId: '',
      generationId: '',
      workflowId: '',
      blockingGaps: [],
      nonBlockingGaps: [],
      updatedAt: ''
    },
    analysisSettings: { maxConcurrency: 4 },
    documents: {
      characterArchive: '',
      stagePlan: '',
      chapterPlan: '',
      styleGuide: '',
      importArchive: ''
    }
  };
}

function emptyStoryState() {
  return {
    currentTimeline: '',
    activePlotlineIds: [],
    unresolvedConflicts: [],
    knownFacts: [],
    hiddenFacts: [],
    characterStates: [],
    foreshadowingRegistry: [],
    continuityConstraints: []
  };
}

export function emptyMemory(): NovalMemory {
  return {
    characters: [],
    locations: [],
    factions: [],
    rules: [],
    events: [],
    foreshadowing: []
  };
}

export function loadRecentProjects(): RecentProjectSummary[] {
  try {
    const raw = localStorage.getItem(RECENT_PROJECTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        id: String(item?.id || ''),
        filePath: String(item?.filePath || ''),
        title: String(item?.title || '未命名项目'),
        genre: String(item?.genre || '未分类'),
        description: String(item?.description || ''),
        updatedAt: String(item?.updatedAt || ''),
        chaptersCompleted: Number(item?.chaptersCompleted || 0),
        totalChapters: Number(item?.totalChapters || 0),
        wordCount: Number(item?.wordCount || 0)
      }))
      .filter((item) => item.filePath);
  } catch {
    return [];
  }
}

export function persistRecentProjects(projects: RecentProjectSummary[]) {
  localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(projects.slice(0, 12)));
}

export function projectToRecentSummary(
  project: NovalProject,
  filePath: string
): RecentProjectSummary {
  const chaptersCompleted = project.chapters.filter((chapter) =>
    Boolean(String(chapter.content || '').trim())
  ).length;

  return {
    id: project.id,
    filePath,
    title: project.title,
    genre: project.setup.genre || '未分类',
    description: project.blueprint.synopsis || project.setup.premise || '',
    updatedAt: project.updatedAt || nowIso(),
    chaptersCompleted,
    totalChapters: project.blueprint.chapterPlans.length || project.chapters.length,
    wordCount: project.chapters.reduce((sum, chapter) => sum + countWords(chapter.content), 0)
  };
}

export function upsertRecentProject(
  current: RecentProjectSummary[],
  project: NovalProject,
  filePath: string
) {
  const next = [
    projectToRecentSummary(project, filePath),
    ...current.filter((item) => item.filePath !== filePath)
  ];
  persistRecentProjects(next);
  return next;
}

export function renameRecentProject(
  current: RecentProjectSummary[],
  filePath: string,
  title: string
) {
  const next = current.map((item) =>
    item.filePath === filePath
      ? {
          ...item,
          title,
          updatedAt: nowIso()
        }
      : item
  );
  persistRecentProjects(next);
  return next;
}

export function removeRecentProject(current: RecentProjectSummary[], filePath: string) {
  const next = current.filter((item) => item.filePath !== filePath);
  persistRecentProjects(next);
  return next;
}

export function projectToCard(project: NovalProject, filePath = ''): Project {
  const chaptersCompleted = project.chapters.filter((chapter) =>
    Boolean(String(chapter.content || '').trim())
  ).length;

  return {
    id: project.id,
    title: project.title,
    genre: project.setup.genre || '未分类',
    description: project.blueprint.synopsis || project.setup.premise || '暂无简介',
    createdAt: formatDateOnly(project.createdAt),
    updatedAt: formatDateOnly(project.updatedAt),
    chaptersCompleted,
    totalChapters: project.blueprint.chapterPlans.length || project.chapters.length,
    wordCount: project.chapters.reduce((sum, chapter) => sum + countWords(chapter.content), 0),
    filePath,
    source: filePath ? 'recent' : 'current'
  };
}

export function recentSummaryToCard(item: RecentProjectSummary): Project {
  return {
    id: item.id || item.filePath,
    title: item.title,
    genre: item.genre || '未分类',
    description: item.description || '暂无简介',
    createdAt: '',
    updatedAt: formatDateOnly(item.updatedAt),
    chaptersCompleted: item.chaptersCompleted || 0,
    totalChapters: item.totalChapters || 0,
    wordCount: item.wordCount || 0,
    filePath: item.filePath,
    source: 'recent'
  };
}

export function draftSummaryToCard(item: DraftProjectSummary): Project {
  return {
    id: item.id,
    title: item.title,
    genre: item.genre || '未分类',
    description: item.description || '暂无简介',
    createdAt: '',
    updatedAt: formatDateOnly(item.updatedAt),
    chaptersCompleted: item.chaptersCompleted || 0,
    totalChapters: item.totalChapters || 0,
    wordCount: item.wordCount || 0,
    draftId: item.id,
    source: 'draft'
  };
}

export function upsertDraftProject(
  current: DraftProjectSummary[],
  draft: DraftProjectSummary
) {
  return [draft, ...current.filter((item) => item.id !== draft.id)].slice(0, 12);
}

export function renameDraftProject(
  current: DraftProjectSummary[],
  draftId: string,
  title: string
) {
  return current.map((item) =>
    item.id === draftId
      ? {
          ...item,
          title,
          updatedAt: nowIso()
        }
      : item
  );
}

export function removeDraftProject(current: DraftProjectSummary[], draftId: string) {
  return current.filter((item) => item.id !== draftId);
}

export function buildHomeProjects(
  currentProject: NovalProject | null,
  currentPath: string,
  recentProjects: RecentProjectSummary[],
  draftProjects: DraftProjectSummary[]
) {
  const recentCards = recentProjects.map(recentSummaryToCard);
  const draftCards = draftProjects.map(draftSummaryToCard);

  if (!currentProject) {
    return [...draftCards, ...recentCards];
  }

  const currentCard = projectToCard(currentProject, currentPath);
  if (!currentPath) {
    return [
      currentCard,
      ...draftCards.filter((item) => item.id !== currentProject.id),
      ...recentCards
    ];
  }

  return [
    currentCard,
    ...draftCards,
    ...recentCards.filter((item) => item.filePath !== currentPath)
  ];
}

function splitTokens(text: string) {
  return String(text || '')
    .split(/[、，,·/｜|\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function projectToCharacters(project: NovalProject): Character[] {
  return project.blueprint.characters.map((character) => ({
    id: character.id,
    name: character.name,
    gender: 'other',
    age: '',
    occupation: character.role || '',
    personality: splitTokens(character.personality),
    customNote: [character.goal, character.conflict, ...(character.relationships || [])]
      .filter(Boolean)
      .join('\n')
  }));
}

export function applyCharactersToProject(project: NovalProject, characters: Character[]) {
  return {
    ...project,
    updatedAt: nowIso(),
    blueprint: {
      ...project.blueprint,
      characters: characters.map((character, index) => ({
        id: character.id || `char-${index + 1}`,
        name: character.name || `角色${index + 1}`,
        role: character.occupation || '角色',
        identity: character.occupation || '角色',
        personality: character.personality.join('、'),
        goal: character.customNote || '',
        conflict: character.customNote ? `补充设定：${character.customNote}` : '',
        traits: character.personality.slice(0, 4),
        relationships: [],
        desire: character.customNote || '',
        fear: '',
        wound: '',
        secret: '',
        ability: '',
        limitation: character.customNote ? `补充设定：${character.customNote}` : '',
        bottomLine: '',
        voice: '',
        finalDirection: '',
        relationEdges: [],
        arc: []
      }))
    }
  };
}

export function projectToWorldSetting(project: NovalProject): WorldSetting {
  return {
    tags: splitTokens(project.setup.genre),
    customText: project.blueprint.worldSetting || project.setup.worldBackground || ''
  };
}

export function applyWorldSettingToProject(project: NovalProject, worldSetting: WorldSetting) {
  return {
    ...project,
    updatedAt: nowIso(),
    setup: {
      ...project.setup,
      genre: worldSetting.tags.length
        ? worldSetting.tags.join(' · ')
        : project.setup.genre,
      worldBackground: worldSetting.customText
    },
    blueprint: {
      ...project.blueprint,
      worldSetting: worldSetting.customText
    }
  };
}

export function projectToWritingStyle(project: NovalProject) {
  return project.setup.tone || '';
}

export function applyWritingStyleToProject(project: NovalProject, writingStyle: string) {
  return {
    ...project,
    updatedAt: nowIso(),
    setup: {
      ...project.setup,
      tone: writingStyle
    }
  };
}

export function buildOutlineContent(project: NovalProject) {
  const mainPlot = String(project.blueprint.mainPlot || '').trim();
  if (mainPlot && !/^(待补充|待规划|暂无记录)[。.]?$/.test(mainPlot)) {
    return mainPlot;
  }

  if (project.blueprint.chapterPlans.length) {
    return project.blueprint.chapterPlans
      .map(
        (plan) =>
          `第 ${plan.index} 章 ${plan.title}\n目标：${plan.goal || '待补充'}\n转折：${plan.turningPoint || '待补充'}`
      )
      .join('\n\n');
  }

  return '';
}

export function buildCharacterDocument(project: NovalProject) {
  const lines: string[] = [];

  if (project.blueprint.characters.length) {
    lines.push('主要角色');
    lines.push('');
    project.blueprint.characters.forEach((character) => {
      lines.push(`${character.name}${character.role ? ` / ${character.role}` : ''}`);
      if (character.personality) lines.push(`性格：${character.personality}`);
      if (character.goal) lines.push(`目标：${character.goal}`);
      if (character.conflict) lines.push(`冲突：${character.conflict}`);
      lines.push('');
    });
  }

  if (project.blueprint.worldSetting || project.setup.worldBackground) {
    lines.push('世界设定');
    lines.push('');
    lines.push(project.blueprint.worldSetting || project.setup.worldBackground);
  }

  return lines.join('\n').trim();
}

export function projectToChapters(project: NovalProject): Chapter[] {
  return project.chapters.map((chapter) => ({
    id: chapter.id,
    number: chapter.index,
    title: chapter.title,
    content: chapter.content,
    wordCount: countWords(chapter.content)
  }));
}

export function updateOutline(project: NovalProject, outline: string) {
  return {
    ...project,
    updatedAt: nowIso(),
    blueprint: {
      ...project.blueprint,
      mainPlot: outline
    }
  };
}

export function updateChapterContent(
  project: NovalProject,
  chapterId: string,
  content: string
) {
  return {
    ...project,
    updatedAt: nowIso(),
    chapters: project.chapters.map((chapter) =>
      chapter.id === chapterId
        ? {
            ...chapter,
            content,
            updatedAt: nowIso()
          }
        : chapter
    )
  };
}

export function mergeProjectMemory(current: NovalMemory, incoming?: Partial<NovalMemory>) {
  const base = current || emptyMemory();
  const source = incoming || {};
  const sections: (keyof NovalMemory)[] = [
    'characters',
    'locations',
    'factions',
    'rules',
    'events',
    'foreshadowing'
  ];

  const next = emptyMemory();

  sections.forEach((section) => {
    const merged = new Map<string, NovalMemory[keyof NovalMemory][number]>();
    [...base[section], ...(source[section] || [])].forEach((item, index) => {
      const normalized = {
        id: String(item?.id || `${section}-${index + 1}`),
        name: String(item?.name || `${section}-${index + 1}`),
        content: String(item?.content || ''),
        updatedAt: String(item?.updatedAt || nowIso()),
        sourceChapter: item?.sourceChapter,
        sourceExcerpt: item?.sourceExcerpt,
        status: item?.status
      };
      const identity = `${section}:${normalized.name.toLowerCase()}:${normalized.sourceChapter || ''}`;
      merged.set(identity, normalized);
    });
    next[section] = Array.from(merged.values());
  });

  return next;
}

export function buildExportContent(project: NovalProject) {
  const lines: string[] = [];
  lines.push(`《${project.title}》`);
  lines.push('');
  lines.push(`题材：${project.setup.genre || '未分类'}`);
  lines.push(`文风：${project.setup.tone || '未设定'}`);
  lines.push('');

  if (project.blueprint.synopsis || project.setup.premise) {
    lines.push('作品简介');
    lines.push('');
    lines.push(project.blueprint.synopsis || project.setup.premise);
    lines.push('');
  }

  if (project.blueprint.mainPlot) {
    lines.push('故事大纲');
    lines.push('');
    lines.push(project.blueprint.mainPlot);
    lines.push('');
  }

  project.chapters.forEach((chapter) => {
    lines.push(`第 ${chapter.index} 章 ${chapter.title}`);
    lines.push('');
    if (chapter.summary) {
      lines.push(`摘要：${chapter.summary}`);
      lines.push('');
    }
    lines.push(chapter.content || '');
    lines.push('');
  });

  const characterDoc = buildCharacterDocument(project);
  if (characterDoc) {
    lines.push('附录');
    lines.push('');
    lines.push(characterDoc);
    lines.push('');
  }

  return lines.join('\n').trim();
}

export function buildSelectedExportContent(
  project: NovalProject,
  selection: {
    includeOutline: boolean;
    chapterIds: string[];
  }
) {
  const lines: string[] = [];
  const selectedChapterSet = new Set(selection.chapterIds);
  const selectedChapters = project.chapters
    .filter((chapter) => selectedChapterSet.has(chapter.id))
    .sort((left, right) => left.index - right.index);

  lines.push(`《${project.title}》`);
  lines.push('');
  lines.push(`题材：${project.setup.genre || '未分类'}`);
  lines.push(`文风：${project.setup.tone || '未设定'}`);
  lines.push('');

  if (selection.includeOutline) {
    const outlineContent = buildOutlineContent(project);
    if (outlineContent) {
      lines.push('故事大纲');
      lines.push('');
      lines.push(outlineContent);
      lines.push('');
    }
  }

  selectedChapters.forEach((chapter) => {
    lines.push(`第 ${chapter.index} 章 ${chapter.title}`);
    lines.push('');
    if (chapter.summary) {
      lines.push(`摘要：${chapter.summary}`);
      lines.push('');
    }
    lines.push(chapter.content || '');
    lines.push('');
  });

  return lines.join('\n').trim();
}
