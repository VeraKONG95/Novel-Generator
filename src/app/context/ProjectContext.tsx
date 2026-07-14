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
import {
  DraftProjectSummary,
  ModelSettings,
  NovalProject,
  RecentProjectSummary,
  RecoveryNotice,
  WorkspaceConflict,
  WorkspaceRevision
} from '../types';

interface OpenProjectResult {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  filePath?: string;
  data?: NovalProject;
  revisions?: Record<string, WorkspaceRevision | null>;
  conflicts?: WorkspaceConflict[];
  meta?: {
    migrated?: boolean;
  };
}

interface SaveProjectResult extends OpenProjectResult {}

interface ProjectSeed {
  title?: string;
  genre?: string;
  description?: string;
  audience?: string;
  tone?: string;
  narrativePerspective?: string;
  creationMode?: string;
  taboos?: string;
  targetWords?: number;
}

interface ProjectContextValue {
  currentProject: NovalProject | null;
  currentPath: string;
  currentChapterId: string;
  currentSource: 'workspace' | 'legacy' | 'draft';
  workspaceRevisions: Record<string, WorkspaceRevision | null>;
  workspaceConflicts: WorkspaceConflict[];
  externalChangePaths: string[];
  recentProjects: RecentProjectSummary[];
  draftProjects: DraftProjectSummary[];
  recoveryNotice: RecoveryNotice | null;
  settings: ModelSettings;
  isReady: boolean;
  createProject: (workspacePath: string, seed?: ProjectSeed) => Promise<NovalProject | null>;
  discardCurrentProject: () => void;
  updateCurrentProject: (
    updater: NovalProject | ((current: NovalProject) => NovalProject)
  ) => void;
  setCurrentChapterId: (chapterId: string) => void;
  dismissRecoveryNotice: () => void;
  openProject: () => Promise<OpenProjectResult>;
  openWorkspace: () => Promise<OpenProjectResult>;
  importLegacyProject: () => Promise<OpenProjectResult>;
  importNovel: (seed?: ProjectSeed) => Promise<OpenProjectResult>;
  openProjectFromPath: (filePath: string) => Promise<OpenProjectResult>;
  openDraftProject: (draftId: string) => Promise<OpenProjectResult>;
  saveCurrentProject: () => Promise<SaveProjectResult>;
  reloadWorkspace: () => Promise<OpenProjectResult>;
  forceSaveWorkspace: () => Promise<SaveProjectResult>;
  clearWorkspaceConflicts: () => void;
  registerWorkspaceConflicts: (conflicts: WorkspaceConflict[]) => void;
  saveSettings: (settings: ModelSettings) => Promise<void>;
  removeProjectEntry: (filePath: string) => void;
  renameProjectEntry: (filePath: string, title: string) => void;
  removeDraftEntry: (draftId: string) => Promise<void>;
  renameDraftEntry: (draftId: string, title: string) => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const DEFAULT_SETTINGS: ModelSettings = {
  provider: 'openrouter',
  apiKey: '',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'deepseek/deepseek-v4-flash',
  contextWindow: 1048576,
  maxOutputTokens: 65536,
  capabilityStatus: 'unchecked',
  capabilityCheckedAt: '',
  capabilityMessage: ''
};

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [currentProject, setCurrentProject] = useState<NovalProject | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const [currentChapterId, setCurrentChapterId] = useState('');
  const [currentSource, setCurrentSource] = useState<'workspace' | 'legacy' | 'draft'>('draft');
  const [workspaceRevisions, setWorkspaceRevisions] = useState<Record<string, WorkspaceRevision | null>>({});
  const [workspaceConflicts, setWorkspaceConflicts] = useState<WorkspaceConflict[]>([]);
  const [externalChangePaths, setExternalChangePaths] = useState<string[]>([]);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
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
        const recoveredSource = autosaveResult.data.currentPath
          ? String(autosaveResult.data.currentPath).toLowerCase().endsWith('.json')
            ? 'legacy'
            : 'workspace'
          : 'draft';
        setCurrentSource(recoveredSource);
        setHasUnsavedChanges(true);
        if (
          recoveredSource === 'workspace' &&
          window.novalAPI?.reloadWorkspace &&
          autosaveResult.data.currentPath
        ) {
          const workspaceResult = await window.novalAPI.reloadWorkspace(
            autosaveResult.data.currentPath
          );
          if (workspaceResult?.ok) {
            setWorkspaceRevisions(workspaceResult.revisions || {});
          }
        }
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
      } else if (autosaveResult?.ok && autosaveResult.data?.currentPath && window.novalAPI?.reloadWorkspace) {
        const workspaceResult = await window.novalAPI.reloadWorkspace(autosaveResult.data.currentPath);
        if (workspaceResult?.ok && workspaceResult.data) {
          setCurrentProject(workspaceResult.data);
          setCurrentPath(autosaveResult.data.currentPath);
          setCurrentSource('workspace');
          setWorkspaceRevisions(workspaceResult.revisions || {});
          setCurrentChapterId(autosaveResult.data.currentChapterId || workspaceResult.data.chapters[0]?.id || '');
          setHasUnsavedChanges(false);
          setRecentProjects((current) => upsertRecentProject(current, workspaceResult.data, autosaveResult.data.currentPath));
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
    if (!window.novalAPI?.onWorkspaceExternalChange) return;
    return window.novalAPI.onWorkspaceExternalChange((payload) => {
      if (!payload?.root || payload.root !== currentPath) return;
      const paths = Array.isArray(payload.paths) ? payload.paths : [];
      setExternalChangePaths(paths);
      if (hasUnsavedChanges) {
        setRecoveryNotice({
          kind: 'warning',
          title: '检测到外部修改',
          text: '创作空间中的文件已被其他程序修改。保存前需要选择保留哪一版。'
        });
        return;
      }
      if (window.novalAPI?.reloadWorkspace) {
        void window.novalAPI.reloadWorkspace(payload.root).then((result) => {
          if (!result?.ok || !result.data) return;
          setCurrentProject(result.data);
          setWorkspaceRevisions(result.revisions || {});
          setExternalChangePaths([]);
          setRecoveryNotice({
            kind: 'info',
            title: '已载入外部修改',
            text: `已刷新 ${paths.length} 个发生变化的文件。`
          });
        });
      }
    });
  }, [currentPath, hasUnsavedChanges]);

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

  const applyOpenedProject = (
    result: OpenProjectResult,
    source: 'workspace' | 'legacy' | 'draft' = 'legacy'
  ) => {
    if (!result.data) {
      return result;
    }

    setCurrentProject(result.data);
    setCurrentPath(result.filePath || '');
    setCurrentSource(source);
    setWorkspaceRevisions(result.revisions || {});
    setWorkspaceConflicts([]);
    setExternalChangePaths([]);
    setHasUnsavedChanges(false);
    setCurrentChapterId(result.data.chapters[0]?.id || '');
    setRecoveryNotice(null);

    if (result.filePath) {
      setRecentProjects((current) => upsertRecentProject(current, result.data!, result.filePath!));
    }

    return result;
  };

  const createProject = async (workspacePath: string, seed?: ProjectSeed) => {
    await stashUnsavedProject();
    const project = createDefaultProject(seed);
    if (window.novalAPI?.createWorkspace) {
      const result = await window.novalAPI.createWorkspace(workspacePath, project);
      if (result?.canceled) return null;
      if (result?.error || !result?.data) {
        throw new Error(result?.error || '创建创作空间失败。');
      }
      applyOpenedProject(result, 'workspace');
      return result.data as NovalProject;
    }
    setCurrentProject(project);
    setCurrentPath('');
    setCurrentSource('draft');
    setWorkspaceRevisions({});
    setHasUnsavedChanges(true);
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

      setHasUnsavedChanges(true);

      return next;
    });
  };

  const saveWorkspaceProject = async (force: boolean): Promise<SaveProjectResult> => {
    if (!currentProject || !currentPath) {
      return { ok: false, error: '当前没有可保存的创作空间。' };
    }
    const result = await window.novalAPI.saveWorkspace({
      root: currentPath,
      project: currentProject,
      expectedRevisions: workspaceRevisions,
      force
    });
    if (!result?.ok) {
      if (Array.isArray(result?.conflicts)) setWorkspaceConflicts(result.conflicts);
      return { ok: false, error: result?.error || (result?.conflicts ? '检测到外部修改，保存已停止。' : '保存失败。'), conflicts: result?.conflicts };
    }
    setCurrentProject(result.data || currentProject);
    setWorkspaceRevisions(result.revisions || {});
    setWorkspaceConflicts([]);
    setExternalChangePaths([]);
    setHasUnsavedChanges(false);
    setRecoveryNotice(null);
    setRecentProjects((current) => upsertRecentProject(current, result.data || currentProject, currentPath));
    if (window.novalAPI?.clearAutosave) await window.novalAPI.clearAutosave();
    return { ok: true, filePath: currentPath, data: result.data || currentProject };
  };

  const saveCurrentProject = async (): Promise<SaveProjectResult> => {
    if (!currentProject) {
      return { ok: false, error: '当前没有可保存的项目。' };
    }

    if (currentSource === 'workspace' && currentPath) {
      return saveWorkspaceProject(false);
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
      setHasUnsavedChanges(false);
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
      ...applyOpenedProject(result, 'legacy'),
      ok: true
    };
  };

  const openWorkspace = async (): Promise<OpenProjectResult> => {
    await stashUnsavedProject();
    const result = await window.novalAPI.openWorkspace();
    if (result?.canceled || result?.error) {
      return { ok: false, canceled: result?.canceled, error: result?.error };
    }
    return { ...applyOpenedProject(result, 'workspace'), ok: true };
  };

  const importLegacyProject = async (): Promise<OpenProjectResult> => {
    await stashUnsavedProject();
    const result = await window.novalAPI.importLegacyProject();
    if (result?.canceled || result?.error) {
      return { ok: false, canceled: result?.canceled, error: result?.error };
    }
    return { ...applyOpenedProject(result, 'workspace'), ok: true };
  };

  const importNovel = async (seed?: ProjectSeed): Promise<OpenProjectResult> => {
    await stashUnsavedProject();
    const result = await window.novalAPI.importNovel(createDefaultProject(seed));
    if (result?.canceled || result?.error) {
      return { ok: false, canceled: result?.canceled, error: result?.error };
    }
    return { ...applyOpenedProject(result, 'workspace'), ok: true };
  };

  const openProjectFromPath = async (filePath: string): Promise<OpenProjectResult> => {
    await stashUnsavedProject();
    const isLegacy = filePath.toLowerCase().endsWith('.json');
    const result = isLegacy
      ? await window.novalAPI.openProjectFromPath(filePath)
      : await window.novalAPI.openWorkspaceFromPath(filePath);
    if (result?.error) {
      return {
        ok: false,
        error: result.error
      };
    }
    return {
      ...applyOpenedProject(result, isLegacy ? 'legacy' : 'workspace'),
      ok: true
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
    setCurrentSource('draft');
    setWorkspaceRevisions({});
    setWorkspaceConflicts([]);
    setHasUnsavedChanges(false);
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
            chaptersCompleted: result.data.chapters.filter((chapter: NovalProject['chapters'][number]) =>
              Boolean(String(chapter.content || '').trim())
            ).length,
            totalChapters: result.data.blueprint.chapterPlans.length || result.data.chapters.length,
            wordCount: result.data.chapters.reduce(
              (sum: number, chapter: NovalProject['chapters'][number]) =>
                sum + String(chapter.content || '').replace(/\s+/g, '').length,
              0
            )
          })
    );

    return {
      ok: true,
      data: result.data
    };
  };

  const reloadCurrentWorkspace = async (): Promise<OpenProjectResult> => {
    if (!currentPath || currentSource !== 'workspace') {
      return { ok: false, error: '当前项目不是文件夹创作空间。' };
    }
    const result = await window.novalAPI.reloadWorkspace(currentPath);
    if (!result?.ok || !result?.data) {
      return { ok: false, error: result?.error || '重新读取创作空间失败。' };
    }
    applyOpenedProject({ ...result, filePath: currentPath }, 'workspace');
    return { ok: true, ...result };
  };

  const value: ProjectContextValue = {
    currentProject,
    currentPath,
    currentChapterId,
    currentSource,
    workspaceRevisions,
    workspaceConflicts,
    externalChangePaths,
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
      setCurrentSource('draft');
      setWorkspaceRevisions({});
      setWorkspaceConflicts([]);
      setExternalChangePaths([]);
      setHasUnsavedChanges(false);
      setCurrentChapterId('');
      setRecoveryNotice(null);
    },
    updateCurrentProject,
    setCurrentChapterId,
    dismissRecoveryNotice: () => setRecoveryNotice(null),
    openProject,
    openWorkspace,
    importLegacyProject,
    importNovel,
    openProjectFromPath,
    openDraftProject,
    saveCurrentProject,
    reloadWorkspace: reloadCurrentWorkspace,
    forceSaveWorkspace: () => saveWorkspaceProject(true),
    clearWorkspaceConflicts: () => setWorkspaceConflicts([]),
    registerWorkspaceConflicts: (conflicts) => setWorkspaceConflicts(conflicts),
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
