export interface Project {
  id: string;
  title: string;
  genre: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  chaptersCompleted: number;
  totalChapters: number;
  wordCount: number;
  filePath?: string;
  draftId?: string;
  source?: 'current' | 'recent' | 'draft';
}

export type ConversationType = 'general' | 'modification' | 'task' | 'review';

export type TaskStatus =
  | 'queued'
  | 'reading'
  | 'planning'
  | 'executing'
  | 'awaiting_confirmation'
  | 'completed'
  | 'stopped'
  | 'failed'
  | 'interrupted'
  | 'rejected'
  | 'abandoned';

export interface PiTaskResult {
  kind: 'candidate' | 'review' | 'memory' | 'memory_confirmation' | 'answer' | 'conflict' | 'question';
  title?: string;
  content?: string;
  targetType?: string;
  targetId?: string;
  impact?: string[];
  answer?: string;
  sources?: string[];
  summary?: string;
  issues?: Array<Record<string, string>>;
  changes?: Array<Record<string, unknown>>;
  reason?: string;
  questions?: Array<{ id: string; question: string; canSkip?: boolean }>;
  [key: string]: unknown;
}

export interface FileChange {
  path: string;
  action: 'create' | 'update' | 'delete';
  content?: string;
  reason?: string;
}

export interface WorkspaceFile {
  path: string;
  name: string;
  directory: string;
  size: number;
  updatedAt: string;
  revision?: WorkspaceRevision | null;
}

export interface PiTask {
  id: string;
  projectId: string;
  conversationId?: string;
  conversationTitle?: string;
  workspaceRoot: string;
  taskType: string;
  instruction: string;
  target?: {
    docType?: string;
    docId?: string;
    docTitle?: string;
    chapterId?: string;
    chapterIndex?: number;
    [key: string]: unknown;
  } | null;
  baseRevisions?: Record<string, WorkspaceRevision | null>;
  status: TaskStatus;
  assistantText: string;
  result: PiTaskResult | null;
  error: string;
  warnings: string[];
  answers?: Array<{ at: string; answer: string }>;
  questionHistory?: Array<{ askedAt: string; at: string; answer: string; result: PiTaskResult }>;
  streamingSeen?: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  finishedAt: string;
}

export interface WorkspaceRevision {
  hash: string;
  size: number;
  mtimeMs: number;
}

export interface WorkspaceConflict {
  path: string;
  externalContent: string;
  proposedContent: string;
}

export interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
  timestamp: string;
  proposal?: {
    docId: string;
    docType: 'outline' | 'chapter' | 'agents' | 'characters' | 'stage' | 'chapter_plan' | 'style' | 'import_archive' | 'memory';
    docTitle: string;
    content: string;
    operation?: string;
    status?: 'pending' | 'pinned' | 'rejected';
    pinnedAt?: string;
    taskId?: string;
    summary?: string;
    changes?: FileChange[];
  };
}

export interface Conversation {
  id: string;
  type: ConversationType;
  title: string;
  preview: string;
  timestamp: string;
  messages: Message[];
  relatedDocId?: string;
  relatedDocType?: 'outline' | 'chapter' | 'characterDoc';
  relatedDocTitle?: string;
  taskId?: string;
  taskIds?: string[];
  status?: TaskStatus;
  resultKind?: PiTaskResult['kind'];
}

export interface Character {
  id: string;
  name: string;
  gender: 'male' | 'female' | 'other';
  age: string;
  occupation: string;
  personality: string[];
  customNote?: string;
}

export interface WorldSetting {
  tags: string[];
  customText: string;
}

export interface Chapter {
  id: string;
  number: number;
  title: string;
  content: string;
  wordCount: number;
}

export type WritingStyle = '抒情' | '理智' | '欢快' | '冷峻' | '细腻' | '复古';

export type ActiveDocType = 'outline' | 'chapter' | 'characterDoc' | 'agents' | 'stage' | 'memory' | 'file';

export interface ActiveDoc {
  id: string;
  type: ActiveDocType;
  title: string;
  content: string;
  path?: string;
}

export interface RecentProjectSummary {
  id: string;
  filePath: string;
  title: string;
  genre: string;
  description: string;
  updatedAt: string;
  chaptersCompleted: number;
  totalChapters: number;
  wordCount: number;
}

export interface DraftProjectSummary {
  id: string;
  title: string;
  genre: string;
  description: string;
  updatedAt: string;
  chaptersCompleted: number;
  totalChapters: number;
  wordCount: number;
}

export interface RecoveryNotice {
  kind: 'info' | 'warning';
  title: string;
  text: string;
}

export interface ModelSettings {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilityStatus?: 'unchecked' | 'checking' | 'ready' | 'failed';
  capabilityCheckedAt?: string;
  capabilityMessage?: string;
}

export interface NovalRelationEdge {
  id: string;
  targetCharacterId: string;
  targetCharacterName: string;
  type: string;
  dynamic: string;
}

export interface NovalCharacterArc {
  id: string;
  stage: string;
  change: string;
  trigger: string;
  payoff: string;
}

export interface NovalBlueprintCharacter {
  id: string;
  name: string;
  role: string;
  identity: string;
  personality: string;
  goal: string;
  conflict: string;
  traits: string[];
  relationships: string[];
  desire: string;
  fear: string;
  wound: string;
  secret: string;
  ability: string;
  limitation: string;
  bottomLine: string;
  voice: string;
  finalDirection: string;
  relationEdges: NovalRelationEdge[];
  arc: NovalCharacterArc[];
}

export interface NovalVolume {
  title: string;
  summary: string;
}

export interface NovalStoryBible {
  theme: string;
  narrativeStyle: string;
  timelineRules: string;
  taboos: string[];
  continuityRules: string[];
}

export interface NovalPlotBeat {
  id: string;
  title: string;
  summary: string;
  type: string;
  chapterIndex?: number;
  sectionId: string;
  ownerCharacterIds: string[];
  participantCharacterIds: string[];
  dependencyBeatIds: string[];
  reveals: string[];
  foreshadows: string[];
  payoff: string;
  status: string;
}

export interface NovalPlotline {
  id: string;
  type: string;
  title: string;
  goal: string;
  ownerCharacterIds: string[];
  dependencies: string[];
  reveals: string[];
  foreshadows: string[];
  payoff: string;
  status: string;
  beats: NovalPlotBeat[];
}

export interface NovalSectionPlan {
  id: string;
  index: number;
  title: string;
  sceneGoal: string;
  pov: string;
  location: string;
  participants: string[];
  conflict: string;
  outcome: string;
  hooks: string[];
  plotBeatIds: string[];
  characterArcIds: string[];
  status: string;
}

export interface NovalChapterPlan {
  index: number;
  title: string;
  goal: string;
  turningPoint: string;
  plotBeatIds: string[];
  characterArcIds: string[];
  tensionCurve: string;
  sections: NovalSectionPlan[];
}

export interface NovalChapterSection extends NovalSectionPlan {
  summary: string;
  content: string;
  status: string;
  updatedAt: string;
}

export interface NovalChapter {
  id: string;
  index: number;
  title: string;
  goal: string;
  summary: string;
  content: string;
  instruction: string;
  status: string;
  sections: NovalChapterSection[];
  updatedAt: string;
}

export interface NovalMemoryItem {
  id: string;
  name: string;
  content: string;
  updatedAt: string;
  sourceChapter?: number;
  sourceExcerpt?: string;
  status?: string;
}

export interface NovalMemory {
  characters: NovalMemoryItem[];
  locations: NovalMemoryItem[];
  factions: NovalMemoryItem[];
  rules: NovalMemoryItem[];
  events: NovalMemoryItem[];
  foreshadowing: NovalMemoryItem[];
}

export interface NovalStoryFact {
  id: string;
  name: string;
  content: string;
  status: string;
  updatedAt: string;
  sourceChapter?: number;
}

export interface NovalCharacterState {
  characterId: string;
  name: string;
  currentGoal: string;
  emotionalState: string;
  physicalState: string;
  location: string;
  knowledge: string[];
  lastUpdatedChapter?: number;
}

export interface NovalForeshadowingRecord {
  id: string;
  name: string;
  setup: string;
  expectedPayoff: string;
  status: string;
  linkedPlotlineId: string;
  sourceChapter?: number;
  payoffChapter?: number;
}

export interface NovalStoryState {
  currentTimeline: string;
  activePlotlineIds: string[];
  unresolvedConflicts: NovalStoryFact[];
  knownFacts: NovalStoryFact[];
  hiddenFacts: NovalStoryFact[];
  characterStates: NovalCharacterState[];
  foreshadowingRegistry: NovalForeshadowingRecord[];
  continuityConstraints: NovalStoryFact[];
}

export interface NovalProject {
  schemaVersion: number;
  id: string;
  title: string;
  agents: string;
  creationMode: '规划型' | '平衡型' | '探索型' | string;
  importStatus: string;
  constitutionStatus: 'draft' | 'confirmed' | string;
  createdAt: string;
  updatedAt: string;
  setup: {
    genre: string;
    audience: string;
    tone: string;
    narrativePerspective: string;
    targetWords: number;
    premise: string;
    worldBackground: string;
    protagonist: string;
    conflict: string;
    extraConstraints: string;
  };
  blueprint: {
    titleOptions: string[];
    hook: string;
    synopsis: string;
    worldSetting: string;
    storyBible: NovalStoryBible;
    characters: NovalBlueprintCharacter[];
    mainPlot: string;
    subPlots: string[];
    plotlines: NovalPlotline[];
    volumes: NovalVolume[];
    chapterPlans: NovalChapterPlan[];
  };
  chapters: NovalChapter[];
  exportOptions: {
    includeSynopsis: boolean;
    includeVolumes: boolean;
    includeChapterSummaries: boolean;
    includeAppendix: boolean;
  };
  memory: NovalMemory;
  storyState: NovalStoryState;
  documents: {
    characterArchive: string;
    stagePlan: string;
    chapterPlan: string;
    styleGuide: string;
    importArchive: string;
  };
}
