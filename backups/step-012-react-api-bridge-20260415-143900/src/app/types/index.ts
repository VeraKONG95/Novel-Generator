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
}

export type ConversationType = 'general' | 'modification';

export interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
  timestamp: string;
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
