import { NovalProject } from './index';

declare global {
  interface Window {
    novalAPI: {
      saveProject: (payload: NovalProject) => Promise<any>;
      saveProjectToPath: (filePath: string, payload: NovalProject) => Promise<any>;
      openProject: () => Promise<any>;
      openProjectFromPath: (filePath: string) => Promise<any>;
      chooseWorkspaceCreatePath: () => Promise<any>;
      createWorkspace: (root: string, project: NovalProject) => Promise<any>;
      openWorkspace: () => Promise<any>;
      openWorkspaceFromPath: (root: string) => Promise<any>;
      saveWorkspace: (payload: any) => Promise<any>;
      reloadWorkspace: (root: string) => Promise<any>;
      listWorkspaceFiles: (root: string) => Promise<any>;
      readWorkspaceFile: (root: string, relativePath: string) => Promise<any>;
      mergeWorkspaceConflict: (root: string, relativePath: string, content: string) => Promise<any>;
      importLegacyProject: () => Promise<any>;
      importNovel: (project: NovalProject) => Promise<any>;
      listDraftProjects: () => Promise<any>;
      saveDraftProject: (payload: NovalProject) => Promise<any>;
      openDraftProject: (draftId: string) => Promise<any>;
      deleteDraftProject: (draftId: string) => Promise<any>;
      renameDraftProject: (draftId: string, title: string) => Promise<any>;
      loadSettings: () => Promise<any>;
      saveSettings: (settings: any) => Promise<any>;
      probeModel: (settings: any) => Promise<any>;
      loadAutosave: () => Promise<any>;
      clearAutosave: () => Promise<any>;
      saveAutosave: (payload: {
        currentPath: string;
        currentChapterId: string;
        route: string;
        project: NovalProject;
      }) => Promise<any>;
      startTask: (payload: any) => Promise<any>;
      stopTask: (taskId: string) => Promise<any>;
      answerTask: (payload: any) => Promise<any>;
      listTasks: (projectId: string, workspaceRoot: string) => Promise<any>;
      getTask: (taskId: string) => Promise<any>;
      confirmTask: (payload: any) => Promise<any>;
      rejectTask: (taskId: string) => Promise<any>;
      abandonTask: (taskId: string) => Promise<any>;
      onTaskEvent: (listener: (payload: any) => void) => () => void;
      onWorkspaceExternalChange: (listener: (payload: any) => void) => () => void;
      exportDocument: (format: string, defaultName: string, content: string) => Promise<any>;
    };
  }
}

export {};
