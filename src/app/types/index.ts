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

export type ConversationType = 'general' | 'modification';

export interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
  timestamp: string;
  proposal?: {
    docId: string;
    docType: 'outline' | 'chapter';
    docTitle: string;
    content: string;
    operation?: string;
    status?: 'pending' | 'pinned';
    pinnedAt?: string;
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

export type ActiveDocType = 'outline' | 'chapter' | 'characterDoc';

export interface ActiveDoc {
  id: string;
  type: ActiveDocType;
  title: string;
  content: string;
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
}

export interface NovalBlueprintCharacter {
  id: string;
  name: string;
  role: string;
  personality: string;
  goal: string;
  conflict: string;
  traits: string[];
  relationships: string[];
}

export interface NovalVolume {
  title: string;
  summary: string;
}

export interface NovalChapterPlan {
  index: number;
  title: string;
  goal: string;
  turningPoint: string;
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
  updatedAt: string;
}

export interface NovalMemoryItem {
  id: string;
  name: string;
  content: string;
  updatedAt: string;
  sourceChapter?: number;
}

export interface NovalMemory {
  characters: NovalMemoryItem[];
  locations: NovalMemoryItem[];
  factions: NovalMemoryItem[];
  rules: NovalMemoryItem[];
  events: NovalMemoryItem[];
  foreshadowing: NovalMemoryItem[];
}

export interface NovalProject {
  schemaVersion: number;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  setup: {
    genre: string;
    audience: string;
    tone: string;
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
    characters: NovalBlueprintCharacter[];
    mainPlot: string;
    subPlots: string[];
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
}
