import { createContext, useContext, useEffect, useState } from 'react';
import { createDefaultProject, loadRecentProjects, removeRecentProject, renameRecentProject, upsertRecentProject } from '../lib/projectBridge';
import { ModelSettings, NovalProject, RecentProjectSummary, RecoveryNotice } from '../types';

interface OpenProjectResult {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  filePath?: string;
  data?: NovalProject;
  meta?: {
    migrated?: boolean;
  };
}

interface SaveProjectResult extends OpenProjectResult {}

interface ProjectContextValue {
  currentProject: NovalProject | null;
  currentPath: string;
  currentChapterId: string;
  recentProjects: RecentProjectSummary[];
  recoveryNotice: RecoveryNotice | null;
  settings: ModelSettings;
  isReady: boolean;
  createProject: (seed?: { title?: string; genre?: string; description?: string }) => NovalProject;
  discardCurrentProject: () => void;
  updateCurrentProject: (
    updater: NovalProject | ((current: NovalProject) => NovalProject)
  ) => void;
  setCurrentChapterId: (chapterId: string) => void;
  dismissRecoveryNotice: () => void;
  openProject: () => Promise<OpenProjectResult>;
  openProjectFromPath: (filePath: string) => Promise<OpenProjectResult>;
  saveCurrentProject: () => Promise<SaveProjectResult>;
  saveSettings: (settings: ModelSettings) => Promise<void>;
  removeProjectEntry: (filePath: string) => void;
  renameProjectEntry: (filePath: string, title: string) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const DEFAULT_SETTINGS: ModelSettings = {
  provider: 'openai-compatible',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4.1-mini'
};

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [currentProject, setCurrentProject] = useState<NovalProject | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const [currentChapterId, setCurrentChapterId] = useState('');
  const [recentProjects, setRecentProjects] = useState<RecentProjectSummary[]>(() =>
    loadRecentProjects()
  );
  const [recoveryNotice, setRecoveryNotice] = useState<RecoveryNotice | null>(null);
  const [settings, setSettings] = useState<ModelSettings>(DEFAULT_SETTINGS);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!window.novalAPI?.loadAutosave) {
        setIsReady(true);
        return;
      }

      const [autosaveResult, settingsResult] = await Promise.all([
        window.novalAPI.loadAutosave(),
        window.novalAPI.loadSettings ? window.novalAPI.loadSettings() : Promise.resolve(DEFAULT_SETTINGS)
      ]);
      if (cancelled) return;

      setSettings({
        ...DEFAULT_SETTINGS,
        ...(settingsResult || {})
      });

      if (autosaveResult?.ok && autosaveResult.data?.project) {
        setCurrentProject(autosaveResult.data.project);
        setCurrentPath(autosaveResult.data.currentPath || '');
        setCurrentChapterId(
          autosaveResult.data.currentChapterId ||
            autosaveResult.data.project.chapters[0]?.id ||
            ''
        );
        setRecoveryNotice({
          kind: autosaveResult.meta?.migrated ? 'warning' : 'info',
          title: autosaveResult.meta?.migrated ? '已恢复并迁移草稿' : '已恢复自动保存草稿',
          text: autosaveResult.meta?.migrated
            ? '检测到旧版自动保存草稿，已按当前项目格式迁移并恢复。'
            : '已恢复上次未手动保存的草稿，你可以继续当前工作。'
        });

        if (autosaveResult.data.currentPath) {
          setRecentProjects((current) =>
            upsertRecentProject(
              current,
              autosaveResult.data.project,
              autosaveResult.data.currentPath
            )
          );
        }
      }

      setIsReady(true);
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isReady || !currentProject || !window.novalAPI?.saveAutosave) {
      return;
    }

    const timer = window.setTimeout(() => {
      void window.novalAPI.saveAutosave({
        currentPath,
        currentChapterId,
        route: 'project',
        project: currentProject
      });
    }, 800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [currentProject, currentPath, currentChapterId, isReady]);

  const applyOpenedProject = (result: OpenProjectResult) => {
    if (!result.data) {
      return result;
    }

    setCurrentProject(result.data);
    setCurrentPath(result.filePath || '');
    setCurrentChapterId(result.data.chapters[0]?.id || '');
    setRecoveryNotice(null);

    if (result.filePath) {
      setRecentProjects((current) => upsertRecentProject(current, result.data!, result.filePath!));
    }

    return result;
  };

  const createProject = (seed?: { title?: string; genre?: string; description?: string }) => {
    const project = createDefaultProject(seed);
    setCurrentProject(project);
    setCurrentPath('');
    setCurrentChapterId('');
    setRecoveryNotice(null);
    return project;
  };

  const updateCurrentProject = (
    updater: NovalProject | ((current: NovalProject) => NovalProject)
  ) => {
    setCurrentProject((current) => {
      if (!current) return current;
      const next =
        typeof updater === 'function'
          ? (updater as (project: NovalProject) => NovalProject)(current)
          : updater;

      if (currentPath) {
        setRecentProjects((recent) => upsertRecentProject(recent, next, currentPath));
      }

      return next;
    });
  };

  const saveCurrentProject = async (): Promise<SaveProjectResult> => {
    if (!currentProject) {
      return { ok: false, error: '当前没有可保存的项目。' };
    }

    const result = currentPath
      ? await window.novalAPI.saveProjectToPath(currentPath, currentProject)
      : await window.novalAPI.saveProject(currentProject);

    if (result?.error || result?.canceled) {
      return {
        ok: false,
        canceled: result?.canceled,
        error: result?.error
      };
    }

    if (result?.data) {
      setCurrentProject(result.data);
    }

    if (result?.filePath) {
      setCurrentPath(result.filePath);
      setRecentProjects((current) => upsertRecentProject(current, result.data, result.filePath));
    }

    setRecoveryNotice(null);
    if (window.novalAPI?.clearAutosave) {
      await window.novalAPI.clearAutosave();
    }

    return {
      ok: true,
      filePath: result.filePath,
      data: result.data,
      meta: result.meta
    };
  };

  const openProject = async (): Promise<OpenProjectResult> => {
    const result = await window.novalAPI.openProject();
    if (result?.canceled || result?.error) {
      return {
        ok: false,
        canceled: result?.canceled,
        error: result?.error
      };
    }
    return {
      ok: true,
      ...applyOpenedProject(result)
    };
  };

  const openProjectFromPath = async (filePath: string): Promise<OpenProjectResult> => {
    const result = await window.novalAPI.openProjectFromPath(filePath);
    if (result?.error) {
      return {
        ok: false,
        error: result.error
      };
    }
    return {
      ok: true,
      ...applyOpenedProject(result)
    };
  };

  const value: ProjectContextValue = {
    currentProject,
    currentPath,
    currentChapterId,
    recentProjects,
    recoveryNotice,
    settings,
    isReady,
    createProject,
    discardCurrentProject: () => {
      setCurrentProject(null);
      setCurrentPath('');
      setCurrentChapterId('');
      setRecoveryNotice(null);
    },
    updateCurrentProject,
    setCurrentChapterId,
    dismissRecoveryNotice: () => setRecoveryNotice(null),
    openProject,
    openProjectFromPath,
    saveCurrentProject,
    saveSettings: async (nextSettings: ModelSettings) => {
      await window.novalAPI.saveSettings({
        ...DEFAULT_SETTINGS,
        ...nextSettings
      });
      setSettings({
        ...DEFAULT_SETTINGS,
        ...nextSettings
      });
    },
    removeProjectEntry: (filePath: string) => {
      setRecentProjects((current) => removeRecentProject(current, filePath));
    },
    renameProjectEntry: (filePath: string, title: string) => {
      setRecentProjects((current) => renameRecentProject(current, filePath, title));
    }
  };

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjectContext() {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error('useProjectContext 必须在 ProjectProvider 内使用。');
  }
  return context;
}
