import { createContext, useContext, useEffect, useState } from 'react';
import {
  createDefaultProject,
  loadRecentProjects,
  removeDraftProject,
  removeRecentProject,
  renameDraftProject,
  renameRecentProject,
  upsertDraftProject,
  upsertRecentProject
} from '../lib/projectBridge';
import { DraftProjectSummary, ModelSettings, NovalProject, RecentProjectSummary, RecoveryNotice } from '../types';

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
  draftProjects: DraftProjectSummary[];
  recoveryNotice: RecoveryNotice | null;
  settings: ModelSettings;
  isReady: boolean;
  createProject: (seed?: { title?: string; genre?: string; description?: string }) => Promise<NovalProject>;
  discardCurrentProject: () => void;
  updateCurrentProject: (
    updater: NovalProject | ((current: NovalProject) => NovalProject)
  ) => void;
  setCurrentChapterId: (chapterId: string) => void;
  dismissRecoveryNotice: () => void;
  openProject: () => Promise<OpenProjectResult>;
  openProjectFromPath: (filePath: string) => Promise<OpenProjectResult>;
  openDraftProject: (draftId: string) => Promise<OpenProjectResult>;
  saveCurrentProject: () => Promise<SaveProjectResult>;
  saveSettings: (settings: ModelSettings) => Promise<void>;
  removeProjectEntry: (filePath: string) => void;
  renameProjectEntry: (filePath: string, title: string) => void;
  removeDraftEntry: (draftId: string) => Promise<void>;
  renameDraftEntry: (draftId: string, title: string) => Promise<void>;
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
  const [draftProjects, setDraftProjects] = useState<DraftProjectSummary[]>([]);
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

      const [autosaveResult, settingsResult, draftsResult] = await Promise.all([
        window.novalAPI.loadAutosave(),
        window.novalAPI.loadSettings ? window.novalAPI.loadSettings() : Promise.resolve(DEFAULT_SETTINGS),
        window.novalAPI.listDraftProjects ? window.novalAPI.listDraftProjects() : Promise.resolve({ ok: true, data: [] })
      ]);
      if (cancelled) return;

      setSettings({
        ...DEFAULT_SETTINGS,
        ...(settingsResult || {})
      });

      setDraftProjects(Array.isArray(draftsResult?.data) ? draftsResult.data : []);

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

  const stashUnsavedProject = async (project = currentProject, filePath = currentPath) => {
    if (!project || filePath || !window.novalAPI?.saveDraftProject) {
      return;
    }

    const result = await window.novalAPI.saveDraftProject(project);
    if (result?.ok && result.summary) {
      setDraftProjects((current) => upsertDraftProject(current, result.summary));
    }
  };

  const deleteDraftEntry = async (draftId: string) => {
    if (!draftId) return;

    if (window.novalAPI?.deleteDraftProject) {
      await window.novalAPI.deleteDraftProject(draftId);
    }
    setDraftProjects((current) => removeDraftProject(current, draftId));
  };

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

  const createProject = async (seed?: { title?: string; genre?: string; description?: string }) => {
    await stashUnsavedProject();
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

    await deleteDraftEntry(currentProject.id);

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
    await stashUnsavedProject();
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
    await stashUnsavedProject();
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

  const openDraftProject = async (draftId: string): Promise<OpenProjectResult> => {
    await stashUnsavedProject();
    const result = await window.novalAPI.openDraftProject(draftId);
    if (result?.error || result?.ok === false) {
      return {
        ok: false,
        error: result?.error || '打开草稿失败。'
      };
    }

    if (!result?.data) {
      return {
        ok: false,
        error: '草稿不存在或内容为空。'
      };
    }

    setCurrentProject(result.data);
    setCurrentPath('');
    setCurrentChapterId(result.data.chapters[0]?.id || '');
    setRecoveryNotice(null);
    setDraftProjects((current) =>
      current.some((item) => item.id === draftId)
        ? current
        : upsertDraftProject(current, {
            id: result.data.id,
            title: result.data.title,
            genre: result.data.setup.genre || '未分类',
            description: result.data.blueprint.synopsis || result.data.setup.premise || '',
            updatedAt: result.data.updatedAt,
            chaptersCompleted: result.data.chapters.filter((chapter) =>
              Boolean(String(chapter.content || '').trim())
            ).length,
            totalChapters: result.data.blueprint.chapterPlans.length || result.data.chapters.length,
            wordCount: result.data.chapters.reduce(
              (sum, chapter) => sum + String(chapter.content || '').replace(/\s+/g, '').length,
              0
            )
          })
    );

    return {
      ok: true,
      data: result.data
    };
  };

  const value: ProjectContextValue = {
    currentProject,
    currentPath,
    currentChapterId,
    recentProjects,
    draftProjects,
    recoveryNotice,
    settings,
    isReady,
    createProject,
    discardCurrentProject: () => {
      if (currentProject && !currentPath) {
        void deleteDraftEntry(currentProject.id);
      }
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
    openDraftProject,
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
    },
    removeDraftEntry: async (draftId: string) => {
      await deleteDraftEntry(draftId);
    },
    renameDraftEntry: async (draftId: string, title: string) => {
      if (window.novalAPI?.renameDraftProject) {
        const result = await window.novalAPI.renameDraftProject(draftId, title);
        if (result?.ok && result.summary) {
          setDraftProjects((current) => upsertDraftProject(current, result.summary));
        }
      } else {
        setDraftProjects((current) => renameDraftProject(current, draftId, title));
      }
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
