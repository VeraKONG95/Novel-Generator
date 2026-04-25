import { NovalProject } from './index';

declare global {
  interface Window {
    novalAPI: {
      saveProject: (payload: NovalProject) => Promise<any>;
      saveProjectToPath: (filePath: string, payload: NovalProject) => Promise<any>;
      openProject: () => Promise<any>;
      openProjectFromPath: (filePath: string) => Promise<any>;
      listDraftProjects: () => Promise<any>;
      saveDraftProject: (payload: NovalProject) => Promise<any>;
      openDraftProject: (draftId: string) => Promise<any>;
      deleteDraftProject: (draftId: string) => Promise<any>;
      renameDraftProject: (draftId: string, title: string) => Promise<any>;
      loadSettings: () => Promise<any>;
      saveSettings: (settings: any) => Promise<any>;
      loadAutosave: () => Promise<any>;
      clearAutosave: () => Promise<any>;
      saveAutosave: (payload: {
        currentPath: string;
        currentChapterId: string;
        route: string;
        project: NovalProject;
      }) => Promise<any>;
      generateChapter: (payload: any) => Promise<any>;
      analyzeChapter: (payload: any) => Promise<any>;
      exportDocument: (format: string, defaultName: string, content: string) => Promise<any>;
    };
  }
}

export {};
