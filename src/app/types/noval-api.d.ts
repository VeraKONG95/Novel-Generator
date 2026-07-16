import { AnalysisRunStatus, GraphEvidenceRef, NovalGraph, NovalProject } from './index';

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
      onNovelImportProgress: (listener: (payload: {
        percent: number;
        message: string;
        currentPage?: number;
        totalPages?: number;
      }) => void) => () => void;
      startAnalysis: (payload: {
        root: string;
        workflowId?: string;
        input?: Record<string, unknown>;
        maxConcurrency?: number;
      }) => Promise<{ ok: boolean; data?: AnalysisRunStatus; error?: string }>;
      getAnalysisStatus: (root: string, runId?: string) => Promise<{ ok: boolean; data: AnalysisRunStatus | null; error?: string }>;
      pauseAnalysis: (runId: string) => Promise<{ ok: boolean; data?: AnalysisRunStatus; error?: string }>;
      resumeAnalysis: (root: string, runId: string) => Promise<{ ok: boolean; data?: AnalysisRunStatus; error?: string }>;
      cancelAnalysis: (runId: string) => Promise<{ ok: boolean; data?: AnalysisRunStatus; error?: string }>;
      retryAnalysis: (root: string, workflowId?: string, input?: Record<string, unknown>) => Promise<{ ok: boolean; data?: AnalysisRunStatus; error?: string }>;
      setAnalysisConcurrency: (runId: string, maxConcurrency: number) => Promise<{ ok: boolean; data?: AnalysisRunStatus; error?: string }>;
      getGraph: (root: string) => Promise<{ ok: boolean; data: NovelGraph | null; error?: string }>;
      resolveGraphEvidence: (root: string, ref: string | GraphEvidenceRef) => Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }>;
      onAnalysisEvent: (listener: (payload: AnalysisRunStatus & { event?: Record<string, unknown> }) => void) => () => void;
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
