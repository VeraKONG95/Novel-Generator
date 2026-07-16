import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  ArrowLeftIcon,
  BookOpenIcon,
  DownloadIcon,
  Settings2Icon,
  CheckCircle2Icon,
  NetworkIcon
} from 'lucide-react';
import { LeftPanel } from '../components/project/LeftPanel';
import { MiddlePanel } from '../components/project/MiddlePanel';
import { RightPanel } from '../components/project/RightPanel';
import { DocumentWorkspace } from '../components/project/DocumentWorkspace';
import { ExportModal } from '../components/modals/ExportModal';
import { SettingsModal } from '../components/modals/SettingsModal';
import { WorkspaceConflictModal } from '../components/modals/WorkspaceConflictModal';
import { AnalysisStatusBar, AnalysisStatusRun } from '../components/analysis/AnalysisStatusBar';
import { AnalysisEvidenceRef, AnalysisGraph, shouldLockCreation } from '../lib/analysis';
import { useProjectContext } from '../context/ProjectContext';
import {
  buildExportContent,
  buildSelectedExportContent,
  buildOutlineContent,
  projectToCard,
  projectToChapters,
  updateChapterContent,
  updateOutline
} from '../lib/projectBridge';
import { ActiveDoc, AnalysisRunStatus, Conversation, FileChange, Message, NovalProject, PiTask, PiTaskResult, WorkspaceConflict, WorkspaceFile } from '../types';

const RUNNING_TASK_STATUSES = new Set(['queued', 'reading', 'planning', 'executing']);

function hasMeaningfulPlan(content: string) {
  return content
    .replace(/^#+.*$/gm, '')
    .replace(/待规划|待整理|暂无记录/g, '')
    .replace(/[-\s]/g, '')
    .trim().length > 0;
}

const TASK_TYPE_LABELS: Record<string, string> = {
  create_project: '创作章程',
  import_novel: '导入建档',
  generate_characters: '人物设计',
  generate_blueprint: '全书蓝图',
  plan_stage: '阶段规划',
  plan_chapters: '近期章节',
  write_chapter: '章节生成',
  rewrite: '内容修改',
  learn_style: '文风学习',
  refresh_memory: '记忆整理',
  review: '独立评审',
  query: '项目问答'
};

function taskResultText(task: PiTask) {
  const result = task.result;
  if (!result) return task.assistantText || task.error || '任务正在准备中。';
  if (result.kind === 'answer') {
    const sources = Array.isArray(result.sources) ? result.sources : [];
    const sourceText = sources.map((source, index) => {
      if (typeof source === 'string') return `${index + 1}. ${source}`;
      return `${index + 1}. ${String(source.sourcePath || source.chapterId || source.materialId || '项目材料')}${source.excerpt ? `：${String(source.excerpt)}` : ''}`;
    }).join('\n');
    return `${String(result.answer || '')}${sourceText ? `\n\n依据：\n${sourceText}` : ''}`;
  }
  if (result.kind === 'review') {
    const issues = Array.isArray(result.issues) ? result.issues : [];
    return [
      String(result.summary || '评审完成。'),
      ...issues.map((issue, index) =>
        `${index + 1}. [${issue.severity}] ${issue.location}\n问题：${issue.reason}\n依据：${issue.rule}\n建议：${issue.suggestion}${issue.downstreamImpact ? `\n后续影响：${issue.downstreamImpact}` : ''}`
      )
    ].join('\n\n');
  }
  if (result.kind === 'memory' || result.kind === 'memory_confirmation') {
    const changes = Array.isArray(result.changes) ? result.changes : [];
    return `${result.summary || '记忆整理完成。'}\n\n${changes.map((item) => `- ${String(item.name || '')}：${String(item.content || '')}`).join('\n')}`;
  }
  if (result.kind === 'question') {
    const questions = Array.isArray(result.questions) ? result.questions : [];
    return [
      String(result.reason || '还需要你补充一些信息。'),
      ...questions.map((item, index) => `${index + 1}. ${item.question}${item.canSkip ? '（可以跳过）' : ''}`)
    ].join('\n\n');
  }
  if (result.kind === 'conflict') {
    const options = Array.isArray(result.options) ? result.options.map((item, index) => `${index + 1}. ${String(item)}`).join('\n') : '';
    return `${String(result.title || '发现创作冲突')}\n\n${String(result.conflict || '')}${options ? `\n\n可选处理：\n${options}` : ''}\n\n你可以保持现状，或按建议重新执行。`;
  }
  if (result.kind === 'candidate') {
    const changes = Array.isArray(result.changes) ? result.changes : [];
    return [
      String(result.summary || result.title || '文件改动已准备好。'),
      ...changes.map((item) => `- ${item.action === 'delete' ? '删除' : item.action === 'create' ? '新建' : '修改'} ${String(item.path || '')}`)
    ].join('\n');
  }
  return String(result.content || task.assistantText || '候选稿已生成。');
}

function taskConversation(task: PiTask): Conversation {
  const targetType = String(task.result?.targetType || task.target?.docType || '');
  const proposalDocType =
    targetType === 'blueprint'
      ? 'outline'
      : targetType === 'rewrite'
        ? String(task.target?.docType || 'chapter')
        : targetType;
  const canConfirm = ['candidate', 'memory_confirmation'].includes(task.result?.kind || '') && task.status === 'awaiting_confirmation';
  const fileChanges: FileChange[] = task.result?.kind === 'candidate' && Array.isArray(task.result.changes)
    ? task.result.changes.map((item) => ({
        path: String(item.path || ''),
        action: item.action === 'delete' ? 'delete' : item.action === 'create' ? 'create' : 'update',
        content: item.content == null ? undefined : String(item.content),
        beforeContent: item.beforeContent == null ? undefined : String(item.beforeContent),
        reason: item.reason == null ? undefined : String(item.reason)
      }))
    : [];
  const aiMessage: Message = {
    id: `${task.id}-assistant`,
    role: 'ai',
    content: taskResultText(task),
    timestamp: task.updatedAt,
    proposal: canConfirm || (task.result?.kind === 'candidate' && ['completed', 'rejected'].includes(task.status))
      ? {
          docId: String(task.result?.targetId || task.target?.docId || task.target?.chapterId || proposalDocType || 'candidate'),
          docType: (task.result?.kind === 'memory_confirmation' ? 'memory' : proposalDocType) as
            | 'outline'
            | 'chapter'
            | 'agents'
            | 'characters'
            | 'stage'
            | 'chapter_plan'
            | 'style'
            | 'import_archive'
            | 'memory',
          docTitle: String(task.result?.title || task.target?.docTitle || TASK_TYPE_LABELS[task.taskType] || '候选稿'),
          content: task.result?.kind === 'memory_confirmation' ? taskResultText(task) : String(task.result?.content || ''),
          operation: TASK_TYPE_LABELS[task.taskType] || '候选稿',
          status: task.status === 'completed' ? 'pinned' : task.status === 'rejected' ? 'rejected' : 'pending',
          taskId: task.id,
          summary: String(task.result?.summary || task.result?.title || ''),
          changes: fileChanges
        }
      : undefined
  };
  const interviewMessages: Message[] = (task.questionHistory || []).flatMap((item, index) => [
    {
      id: `${task.id}-question-${index}`,
      role: 'ai' as const,
      content: [
        String(item.result?.reason || '还需要补充信息。'),
        ...(item.result?.questions || []).map(
          (question, questionIndex) => `${questionIndex + 1}. ${question.question}${question.canSkip ? '（可以跳过）' : ''}`
        )
      ].join('\n\n'),
      timestamp: item.askedAt
    },
    {
      id: `${task.id}-answer-${index}`,
      role: 'user' as const,
      content: item.answer,
      timestamp: item.at
    }
  ]);
  return {
    id: task.conversationId || `conversation-${task.id}`,
    taskId: task.id,
    taskIds: [task.id],
    type: task.taskType === 'review' ? 'review' : task.taskType === 'rewrite' ? 'modification' : 'task',
    title: task.conversationTitle || TASK_TYPE_LABELS[task.taskType] || '新对话',
    preview: task.error || taskResultText(task).slice(0, 48) || task.instruction.slice(0, 48),
    timestamp: task.updatedAt,
    status: task.status,
    resultKind: task.result?.kind,
    relatedDocId: String(task.target?.docId || task.target?.chapterId || ''),
    relatedDocType:
      task.target?.docType === 'chapter' || task.target?.docType === 'outline'
        ? task.target.docType
        : undefined,
    relatedDocTitle: String(task.target?.docTitle || ''),
    messages: [
      {
        id: `${task.id}-user`,
        role: 'user',
        content: task.instruction,
        timestamp: task.createdAt
      },
      ...interviewMessages,
      aiMessage
    ]
  };
}

function tasksToConversations(tasks: PiTask[]) {
  const groups = new Map<string, Conversation>();
  [...tasks].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).forEach((task) => {
    const next = taskConversation(task);
    const current = groups.get(next.id);
    if (!current) {
      groups.set(next.id, next);
      return;
    }
    groups.set(next.id, {
      ...current,
      type: next.type,
      title: next.title || current.title,
      preview: next.preview,
      timestamp: next.timestamp,
      status: next.status,
      resultKind: next.resultKind,
      relatedDocId: next.relatedDocId || current.relatedDocId,
      relatedDocType: next.relatedDocType || current.relatedDocType,
      relatedDocTitle: next.relatedDocTitle || current.relatedDocTitle,
      taskId: next.taskId,
      taskIds: [...(current.taskIds || []), ...(next.taskIds || [])],
      messages: [...current.messages, ...next.messages]
    });
  });
  return Array.from(groups.values()).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}

function applyMemoryResult(project: NovalProject, result: PiTaskResult) {
  const memory: NovalProject['memory'] = {
    characters: [...project.memory.characters],
    locations: [...project.memory.locations],
    factions: [...project.memory.factions],
    rules: [...project.memory.rules],
    events: [...project.memory.events],
    foreshadowing: [...project.memory.foreshadowing]
  };
  const storyState = {
    ...project.storyState,
    knownFacts: [...project.storyState.knownFacts],
    unresolvedConflicts: [...project.storyState.unresolvedConflicts],
    characterStates: [...project.storyState.characterStates],
    foreshadowingRegistry: [...project.storyState.foreshadowingRegistry]
  };
  (result.changes || []).forEach((raw, index) => {
    const item = raw as Record<string, unknown>;
    const category = String(item.category || 'fact');
    const section: keyof NovalProject['memory'] =
      category === 'character' || category === 'relationship'
        ? 'characters'
        : category === 'foreshadowing'
          ? 'foreshadowing'
          : category === 'timeline' || category === 'plot' || category === 'conflict' || category === 'fact'
            ? 'events'
            : 'rules';
    const existingIndex = memory[section].findIndex((entry) =>
      (item.targetId && entry.id === item.targetId) || entry.name === String(item.name || '')
    );
    const existing = existingIndex >= 0 ? memory[section][existingIndex] : null;
    const normalized = {
      id: existing?.id || String(item.targetId || `memory-${Date.now()}-${index}`),
      name: String(item.name || '未命名记忆'),
      content: String(item.content || ''),
      updatedAt: new Date().toISOString(),
      sourceChapter: item.sourceChapter ? Number(item.sourceChapter) : undefined,
      sourceExcerpt: item.sourceExcerpt ? String(item.sourceExcerpt) : undefined,
      status: item.action === 'close' ? 'closed' : 'active'
    };
    if (existingIndex >= 0) memory[section][existingIndex] = normalized;
    else memory[section].push(normalized);

    if (category === 'timeline') storyState.currentTimeline = normalized.content;
    if (category === 'fact') {
      const factIndex = storyState.knownFacts.findIndex((entry) => entry.name === normalized.name);
      const fact = { ...normalized, status: normalized.status || 'active' };
      if (factIndex >= 0) storyState.knownFacts[factIndex] = fact;
      else storyState.knownFacts.push(fact);
    }
    if (category === 'conflict') {
      const conflictIndex = storyState.unresolvedConflicts.findIndex((entry) => entry.name === normalized.name);
      const conflict = { ...normalized, status: normalized.status || 'active' };
      if (conflictIndex >= 0) storyState.unresolvedConflicts[conflictIndex] = conflict;
      else storyState.unresolvedConflicts.push(conflict);
    }
    if (category === 'character' && (item.currentGoal || item.emotionalState || item.physicalState || item.location || item.knowledge)) {
      const stateIndex = storyState.characterStates.findIndex((entry) => entry.name === normalized.name);
      const previous = stateIndex >= 0 ? storyState.characterStates[stateIndex] : null;
      const nextState = {
        characterId: previous?.characterId || String(item.targetId || normalized.id),
        name: normalized.name,
        currentGoal: String(item.currentGoal || previous?.currentGoal || ''),
        emotionalState: String(item.emotionalState || previous?.emotionalState || ''),
        physicalState: String(item.physicalState || previous?.physicalState || ''),
        location: String(item.location || previous?.location || ''),
        knowledge: Array.isArray(item.knowledge) ? item.knowledge.map(String) : previous?.knowledge || [],
        lastUpdatedChapter: normalized.sourceChapter
      };
      if (stateIndex >= 0) storyState.characterStates[stateIndex] = nextState;
      else storyState.characterStates.push(nextState);
    }
    if (category === 'foreshadowing') {
      const registryIndex = storyState.foreshadowingRegistry.findIndex((entry) => entry.name === normalized.name);
      const previous = registryIndex >= 0 ? storyState.foreshadowingRegistry[registryIndex] : null;
      const record = {
        id: previous?.id || normalized.id,
        name: normalized.name,
        setup: normalized.content,
        expectedPayoff: previous?.expectedPayoff || '',
        status: normalized.status || 'active',
        linkedPlotlineId: previous?.linkedPlotlineId || '',
        sourceChapter: normalized.sourceChapter,
        payoffChapter: item.action === 'close' ? normalized.sourceChapter : previous?.payoffChapter
      };
      if (registryIndex >= 0) storyState.foreshadowingRegistry[registryIndex] = record;
      else storyState.foreshadowingRegistry.push(record);
    }
  });
  return {
    ...project,
    updatedAt: new Date().toISOString(),
    memory,
    storyState
  };
}

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const {
    currentProject,
    currentPath,
    currentChapterId,
    currentSource,
    workspaceRevisions,
    workspaceConflicts,
    externalChangePaths,
    recoveryNotice,
    settings,
    isReady,
    dismissRecoveryNotice,
    updateCurrentProject,
    setCurrentChapterId,
    saveCurrentProject,
    reloadWorkspace,
    forceSaveWorkspace,
    clearWorkspaceConflicts,
    registerWorkspaceConflicts,
    saveSettings
  } = useProjectContext();

  const [tasks, setTasks] = useState<PiTask[]>([]);
  const conversations = useMemo(() => tasksToConversations(tasks), [tasks]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string>('');
  const [pendingConflictCommit, setPendingConflictCommit] = useState<{
    taskId: string;
    project: NovalProject;
    proposal: NonNullable<Message['proposal']>;
  } | null>(null);
  const handledMemoryTasks = useRef(new Set<string>());
  const handledCandidateTasks = useRef(new Set<string>());
  const autoStartedProject = useRef('');
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [openDocs, setOpenDocs] = useState<ActiveDoc[]>([]);
  const [activeTabId, setActiveTabId] = useState('');
  const [diffTaskId, setDiffTaskId] = useState('');
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [rightCollapsed, setRightCollapsed] = useState(() => localStorage.getItem('noval.files.collapsed') === 'true');
  const [isGenerating, setIsGenerating] = useState(false);
  const isGeneratingRef = useRef(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [analysisRun, setAnalysisRun] = useState<AnalysisRunStatus | null>(null);
  const [analysisGraph, setAnalysisGraph] = useState<AnalysisGraph | null>(null);
  const analysisAutoStarted = useRef('');
  const refreshedGeneration = useRef('');
  const [notification, setNotification] = useState<{
    msg: string;
    type: 'success' | 'info' | 'error';
  } | null>(null);

  const showNotification = (msg: string, type: 'success' | 'info' | 'error' = 'success') => {
    setNotification({ msg, type });
    window.setTimeout(() => setNotification(null), 2500);
  };
  const updateGenerating = (value: boolean) => {
    isGeneratingRef.current = value;
    setIsGenerating(value);
  };

  const projectInfo = currentProject ? projectToCard(currentProject, currentPath) : null;
  const outline = currentProject ? buildOutlineContent(currentProject) : '';
  const chapters = currentProject ? projectToChapters(currentProject) : [];

  const selectedConversation = conversations.find((item) => item.id === selectedConvId) || null;
  const diffTask = tasks.find((task) => task.id === diffTaskId && task.result?.kind === 'candidate') || null;
  const activeDoc = activeTabId.startsWith('file:')
    ? openDocs.find((document) => `file:${document.id}` === activeTabId) || null
    : null;
  const totalWords = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const currentChapter = currentProject
    ? currentProject.chapters.find((chapter) => chapter.id === currentChapterId) ||
      currentProject.chapters[currentProject.chapters.length - 1] ||
      null
    : null;
  const projectAnalysisStatus = currentProject?.analysis?.status ||
    (currentProject?.importStatus === 'raw_imported' ? 'raw_imported' : 'uninitialized');
  const analysisLocked = shouldLockCreation({
    status: analysisRun?.status || projectAnalysisStatus,
    blockingGaps: analysisRun?.blockingGaps || currentProject?.analysis?.blockingGaps || []
  });
  const analysisBarRun: AnalysisStatusRun | null = analysisRun
    ? {
        ...analysisRun,
        totalJobs: analysisRun.counts.total,
        completedJobs: analysisRun.counts.completed,
        runningJobs: analysisRun.counts.running,
        failedJobs: analysisRun.counts.failed,
        waitingJobs: analysisRun.counts.waiting
      }
    : currentProject
      ? {
          status: projectAnalysisStatus,
          runId: currentProject.analysis?.runId,
          workflowId: currentProject.analysis?.workflowId || 'WF01',
          generationId: currentProject.analysis?.generationId,
          blockingGaps: currentProject.analysis?.blockingGaps || [],
          nonBlockingGaps: currentProject.analysis?.nonBlockingGaps || [],
          maxConcurrency: currentProject.analysisSettings?.maxConcurrency || 4,
          totalJobs: 0,
          completedJobs: projectAnalysisStatus === 'ready' ? 1 : 0
        }
      : null;

  const refreshFileTree = async () => {
    if (!currentPath || !window.novalAPI?.listWorkspaceFiles) return;
    const result = await window.novalAPI.listWorkspaceFiles(currentPath);
    if (result?.ok) setWorkspaceFiles(Array.isArray(result.data) ? result.data : []);
  };

  useEffect(() => { void refreshFileTree(); }, [currentPath, currentProject?.updatedAt, externalChangePaths.join('|')]);

  const refreshGraph = async () => {
    if (!currentPath || !window.novalAPI?.getGraph) return;
    const result = await window.novalAPI.getGraph(currentPath);
    if (result?.ok) setAnalysisGraph((result.data || null) as AnalysisGraph | null);
  };

  useEffect(() => {
    if (!currentProject || currentSource !== 'workspace' || !currentPath) {
      setAnalysisRun(null);
      setAnalysisGraph(null);
      return;
    }
    let cancelled = false;
    void Promise.all([
      window.novalAPI.getAnalysisStatus(currentPath),
      window.novalAPI.getGraph(currentPath)
    ]).then(async ([statusResult, graphResult]) => {
      if (cancelled) return;
      const status = statusResult?.data as AnalysisRunStatus | null;
      if (status) setAnalysisRun(status);
      if (graphResult?.ok) setAnalysisGraph((graphResult.data || null) as AnalysisGraph | null);
      if (
        status?.recovered &&
        status.runId &&
        settings.capabilityStatus === 'ready' &&
        analysisAutoStarted.current !== `recover:${status.runId}`
      ) {
        analysisAutoStarted.current = `recover:${status.runId}`;
        const resumed = await window.novalAPI.resumeAnalysis(currentPath, status.runId);
        if (!cancelled && resumed?.ok && resumed.data) setAnalysisRun(resumed.data);
        if (!cancelled && !resumed?.ok) showNotification(`恢复分析失败：${resumed?.error || '未知错误'}`, 'error');
        return;
      }
      const rawImported = !status && (currentProject.analysis?.status === 'raw_imported' || currentProject.importStatus === 'raw_imported');
      if (
        rawImported &&
        settings.capabilityStatus === 'ready' &&
        analysisAutoStarted.current !== currentProject.id
      ) {
        analysisAutoStarted.current = currentProject.id;
        const started = await window.novalAPI.startAnalysis({
          root: currentPath,
          workflowId: 'WF01',
          maxConcurrency: currentProject.analysisSettings?.maxConcurrency || 4
        });
        if (!cancelled && started?.ok && started.data) setAnalysisRun(started.data);
        if (!cancelled && !started?.ok) showNotification(`分析启动失败：${started?.error || '未知错误'}`, 'error');
      }
    });
    return () => { cancelled = true; };
  }, [currentProject?.id, currentPath, currentSource, settings.capabilityStatus]);

  useEffect(() => {
    if (!window.novalAPI?.onAnalysisEvent) return;
    return window.novalAPI.onAnalysisEvent((payload) => {
      if (!payload || payload.projectId !== currentProject?.id) return;
      const next = payload as AnalysisRunStatus;
      setAnalysisRun(next);
      if (
        ['ready', 'degraded'].includes(next.status) &&
        next.generationId &&
        refreshedGeneration.current !== next.generationId
      ) {
        refreshedGeneration.current = next.generationId;
        void Promise.all([reloadWorkspace(), refreshGraph(), refreshFileTree()]).then(() => {
          showNotification(next.status === 'ready' ? '小说分析完成，关系图谱已经可用' : '主要分析已完成，仍有少量内容可补跑');
        });
      }
      if (next.status === 'failed') showNotification(`分析未完成：${next.error || '请补跑失败项'}`, 'error');
    });
  }, [currentProject?.id, currentPath]);

  useEffect(() => {
    if (!currentProject || !window.novalAPI?.listTasks) return;
    setTasksLoaded(false);
    let cancelled = false;
    void window.novalAPI.listTasks(currentProject.id, currentSource === 'workspace' ? currentPath : '').then((result) => {
      if (cancelled || !result?.ok) return;
      const loadedTasks = Array.isArray(result.data) ? result.data : [];
      setTasks(loadedTasks);
      setTasksLoaded(true);
      const open = loadedTasks.find((task: PiTask) => RUNNING_TASK_STATUSES.has(task.status));
      setActiveTaskId(open?.id || '');
      updateGenerating(Boolean(open && RUNNING_TASK_STATUSES.has(open.status)));
      if (!selectedConvId && loadedTasks[0]) setSelectedConvId(loadedTasks[0].conversationId || `conversation-${loadedTasks[0].id}`);
      const latestChange = loadedTasks.find((task: PiTask) => task.status === 'completed' && task.result?.kind === 'candidate');
      if (latestChange) {
        setDiffTaskId(latestChange.id);
        setActiveTabId((current) => current || `diff:${latestChange.id}`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currentProject?.id, currentPath, currentSource]);

  useEffect(() => {
    if (!window.novalAPI?.onTaskEvent) return;
    return window.novalAPI.onTaskEvent((payload) => {
      const task = payload?.task as PiTask | undefined;
      if (!task || task.projectId !== currentProject?.id) return;
      setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
      const running = RUNNING_TASK_STATUSES.has(task.status);
      updateGenerating(running);
      setActiveTaskId(running ? task.id : '');
      if (task.taskType === 'refresh_memory' && ['failed', 'stopped', 'interrupted'].includes(task.status)) {
        showNotification('故事记忆待重试，正式正文不受影响', 'error');
      }
      if (
        task.status === 'awaiting_confirmation' &&
        task.result?.kind === 'candidate' &&
        task.result.autoApplyBlocked &&
        Array.isArray(task.result.conflicts) &&
        currentProject
      ) {
        const changes = Array.isArray(task.result.changes) ? task.result.changes.map((item) => ({
          path: String(item.path || ''),
          action: item.action === 'create' ? 'create' as const : item.action === 'delete' ? 'delete' as const : 'update' as const,
          content: item.content == null ? '' : String(item.content),
          beforeContent: item.beforeContent == null ? '' : String(item.beforeContent),
          reason: item.reason == null ? '' : String(item.reason)
        })) : [];
        registerWorkspaceConflicts(task.result.conflicts as WorkspaceConflict[]);
        setPendingConflictCommit({
          taskId: task.id,
          project: currentProject,
          proposal: {
            docId: String(task.target?.docId || 'candidate'),
            docType: 'chapter',
            docTitle: String(task.result.title || '本次修改'),
            content: '',
            taskId: task.id,
            summary: String(task.result.summary || ''),
            changes
          }
        });
        setDiffTaskId(task.id);
        setActiveTabId(`diff:${task.id}`);
        showNotification('文件已在其他地方改变，自动写入已暂停', 'error');
      }
      if (
        task.status === 'completed' &&
        task.result?.kind === 'candidate' &&
        !handledCandidateTasks.current.has(task.id)
      ) {
        handledCandidateTasks.current.add(task.id);
        setDiffTaskId(task.id);
        setActiveTabId(`diff:${task.id}`);
        void reloadWorkspace().then(async () => {
          await refreshFileTree();
          showNotification('修改已自动写入，可在“本次修改”中查看');
        });
      }
      if (
        task.status === 'completed' &&
        (task.result?.kind === 'memory' || task.result?.kind === 'memory_confirmation') &&
        currentProject &&
        !handledMemoryTasks.current.has(task.id)
      ) {
        handledMemoryTasks.current.add(task.id);
        const nextProject = applyMemoryResult(currentProject, task.result);
        if (currentSource === 'workspace' && currentPath) {
          void window.novalAPI.saveWorkspace({
            root: currentPath,
            project: nextProject,
            expectedRevisions: workspaceRevisions,
            force: false
          }).then(async (saveResult) => {
            if (!saveResult?.ok) {
              if (Array.isArray(saveResult?.conflicts)) registerWorkspaceConflicts(saveResult.conflicts);
              showNotification('正文已写入，但记忆因外部修改暂未更新', 'error');
              return;
            }
            updateCurrentProject(saveResult.data || nextProject);
            await reloadWorkspace();
            showNotification('故事记忆已更新，并保留了来源记录');
          });
        } else {
          updateCurrentProject(nextProject);
          showNotification('故事记忆已更新，并保留了来源记录');
        }
      }
    });
  }, [currentProject, currentPath, currentSource, workspaceRevisions]);

  useEffect(() => {
    if (!tasksLoaded || !currentProject || tasks.length > 0 || autoStartedProject.current === currentProject.id) return;
    autoStartedProject.current = currentProject.id;
    if (settings.capabilityStatus !== 'ready') {
      handleNewConversation();
      return;
    }
    if (['raw_imported', 'analyzing', 'paused'].includes(currentProject.analysis?.status || currentProject.importStatus)) {
      handleNewConversation();
      return;
    }
    if (currentProject.constitutionStatus !== 'confirmed') {
      void startPiTask('create_project', '请检查现有信息，只补问真正影响创作的问题，然后提交 AGENTS.md 候选改动。');
      return;
    }
    handleNewConversation();
  }, [tasksLoaded, currentProject?.id, tasks.length, settings.capabilityStatus]);

  if (!isReady) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: '#F7F7F8', fontFamily: "'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif" }}
      >
        <p style={{ color: '#6E6E8A' }} className="text-sm">
          正在恢复项目...
        </p>
      </div>
    );
  }

  if (!currentProject) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4"
        style={{ background: '#F7F7F8', fontFamily: "'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif" }}
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: '#EAEAF0' }}
        >
          <BookOpenIcon size={28} color="#9999B3" />
        </div>
        <div className="text-center">
          <p style={{ color: '#3A3A5A' }} className="text-base">
            当前没有加载项目
          </p>
          <p style={{ color: '#9999B3' }} className="text-sm mt-1">
            回到首页新建或打开一个项目，再继续这套 React 工作台
          </p>
        </div>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 rounded-lg text-sm"
          style={{ background: '#1A1A2E', color: '#FFFFFF' }}
        >
          返回首页
        </button>
      </div>
    );
  }

  if (projectId && currentProject.id !== projectId) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4"
        style={{ background: '#F7F7F8', fontFamily: "'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif" }}
      >
        <p style={{ color: '#3A3A5A' }} className="text-base">
          当前路由和已加载项目不一致
        </p>
        <button
          onClick={() => navigate(`/project/${currentProject.id}`)}
          className="px-4 py-2 rounded-lg text-sm"
          style={{ background: '#1A1A2E', color: '#FFFFFF' }}
        >
          打开当前项目
        </button>
      </div>
    );
  }

  const handleSelectConversation = (id: string) => {
    setSelectedConvId(id);
  };

  const handleNewConversation = () => {
    if (analysisLocked) {
      showNotification('小说分析完成前只能查看文件和图谱', 'info');
      return;
    }
    setSelectedConvId(`conversation-${Date.now()}`);
  };

  const handleStartAnalysis = async () => {
    if (!currentPath) return;
    if (settings.capabilityStatus !== 'ready') {
      showNotification('请先在模型设置中完成能力检查', 'error');
      setIsSettingsModalOpen(true);
      return;
    }
    const result = await window.novalAPI.startAnalysis({
      root: currentPath,
      workflowId: 'WF01',
      maxConcurrency: currentProject?.analysisSettings?.maxConcurrency || 4
    });
    if (!result?.ok || !result.data) {
      showNotification(`分析启动失败：${result?.error || '未知错误'}`, 'error');
      return;
    }
    setAnalysisRun(result.data);
  };

  const handlePauseAnalysis = async () => {
    if (!analysisRun?.runId) return;
    const result = await window.novalAPI.pauseAnalysis(analysisRun.runId);
    if (result?.ok && result.data) setAnalysisRun(result.data);
    else showNotification(`暂停失败：${result?.error || '未知错误'}`, 'error');
  };

  const handleResumeAnalysis = async () => {
    if (!currentPath || !analysisBarRun?.runId) return;
    const result = await window.novalAPI.resumeAnalysis(currentPath, analysisBarRun.runId);
    if (result?.ok && result.data) setAnalysisRun(result.data);
    else showNotification(`继续失败：${result?.error || '未知错误'}`, 'error');
  };

  const handleCancelAnalysis = async () => {
    if (!analysisRun?.runId) return;
    const result = await window.novalAPI.cancelAnalysis(analysisRun.runId);
    if (result?.ok && result.data) setAnalysisRun(result.data);
    else showNotification(`取消失败：${result?.error || '未知错误'}`, 'error');
  };

  const handleRetryAnalysis = async () => {
    if (!currentPath) return;
    const result = await window.novalAPI.retryAnalysis(currentPath, analysisBarRun?.workflowId || 'WF01');
    if (result?.ok && result.data) setAnalysisRun(result.data);
    else showNotification(`补跑失败：${result?.error || '未知错误'}`, 'error');
  };

  const handleAnalysisConcurrency = async (value: number) => {
    if (!analysisRun?.runId) return;
    const result = await window.novalAPI.setAnalysisConcurrency(analysisRun.runId, value);
    if (result?.ok && result.data) {
      setAnalysisRun(result.data);
      updateCurrentProject((project) => ({ ...project, analysisSettings: { maxConcurrency: value } }));
    }
    else showNotification(`并发设置失败：${result?.error || '未知错误'}`, 'error');
  };

  const openDocument = (document: ActiveDoc) => {
    setOpenDocs((current) => [...current.filter((item) => item.id !== document.id), document]);
    setActiveTabId(`file:${document.id}`);
  };

  const handleOpenFile = async (file: WorkspaceFile) => {
    if (!currentPath) return;
    const result = await window.novalAPI.readWorkspaceFile(currentPath, file.path);
    if (!result?.ok) {
      showNotification(`文件打开失败：${result?.error || '未知错误'}`, 'error');
      return;
    }
    openDocument({ id: file.path, type: 'file', title: file.name, path: file.path, content: String(result.data?.content || '') });
  };

  const handleOpenEvidence = async (reference: AnalysisEvidenceRef) => {
    if (!currentPath) return;
    const resolved = await window.novalAPI.resolveGraphEvidence(currentPath, reference.refId || reference);
    if (!resolved?.ok || !resolved.data) {
      showNotification(`证据定位失败：${resolved?.error || '未知错误'}`, 'error');
      return;
    }
    const evidence = resolved.data as {
      status?: string;
      sourcePath?: string;
      paragraphStart?: number;
      paragraphEnd?: number;
      content?: string;
      ref?: AnalysisEvidenceRef;
    };
    const rawPath = String(evidence.sourcePath || reference.sourcePath || '');
    const visiblePath = rawPath.startsWith('memory/graph/') ? `knowledge/current/${rawPath}` : rawPath;
    const opened = await window.novalAPI.readWorkspaceFile(currentPath, visiblePath);
    if (!opened?.ok) {
      showNotification(`原文打开失败：${opened?.error || '未知错误'}`, 'error');
      return;
    }
    openDocument({
      id: visiblePath,
      type: 'file',
      title: visiblePath.split('/').pop() || '原文证据',
      path: visiblePath,
      content: String(opened.data?.content || ''),
      evidence: {
        status: String(evidence.status || 'current'),
        paragraphStart: evidence.paragraphStart,
        paragraphEnd: evidence.paragraphEnd,
        excerpt: String(evidence.content || evidence.ref?.excerpt || reference.excerpt || '')
      }
    });
    showNotification(evidence.status === 'stale' ? '原文已改动，已打开相关章节供核对' : '已打开对应原文位置', evidence.status === 'stale' ? 'info' : 'success');
  };

  const handleCloseDoc = (documentId = activeDoc?.id || '') => {
    if (!documentId) return;
    setOpenDocs((current) => {
      const next = current.filter((document) => document.id !== documentId);
      if (activeTabId === `file:${documentId}`) {
        setActiveTabId(diffTask ? `diff:${diffTask.id}` : next[0] ? `file:${next[0].id}` : '');
      }
      return next;
    });
  };

  const startPiTask = async (
    taskType: string | undefined,
    instruction: string,
    target: Record<string, unknown> | null = null,
    projectOverride?: NovalProject
  ) => {
    const taskProject = projectOverride || currentProject;
    if (!taskProject || isGeneratingRef.current) return null;
    if (analysisLocked) {
      showNotification('小说分析完成前只能查看文件和图谱', 'info');
      return null;
    }
    if (currentSource !== 'workspace' || !currentPath) {
      showNotification('请先把项目迁移或保存为文件夹创作空间，再开始 AI 创作', 'error');
      return null;
    }
    if (settings.capabilityStatus !== 'ready') {
      showNotification('请先在模型设置中完成能力检查', 'error');
      setIsSettingsModalOpen(true);
      return null;
    }
    const conversationId = selectedConvId || `conversation-${Date.now()}`;
    const conversationTitle = selectedConversation?.title || instruction.trim().slice(0, 24) || '新对话';
    updateGenerating(true);
    try {
      const result = await window.novalAPI.startTask({
        project: taskProject,
        workspaceRoot: currentSource === 'workspace' ? currentPath : '',
        taskType,
        instruction,
        target,
        expectedRevisions: workspaceRevisions,
        conversationId,
        conversationTitle,
        conversationHistory: selectedConversation?.messages.map((message) => ({ role: message.role, content: message.content })) || []
      });
      if (!result?.ok || !result.task) {
        showNotification(`任务启动失败：${result?.error || '未知错误'}`, 'error');
        updateGenerating(false);
        return null;
      }
      const task = result.task as PiTask;
      setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
      setSelectedConvId(task.conversationId || conversationId);
      setActiveTaskId(task.id);
      return task;
    } catch (error) {
      showNotification(`任务启动失败：${error instanceof Error ? error.message : '未知错误'}`, 'error');
      updateGenerating(false);
      return null;
    }
  };

  const handleStopTask = async () => {
    if (!activeTaskId) return;
    const result = await window.novalAPI.stopTask(activeTaskId);
    if (!result?.ok) {
      showNotification(`停止失败：${result?.error || '未知错误'}`, 'error');
      return;
    }
    updateGenerating(false);
    setActiveTaskId('');
    showNotification('任务已停止，正式内容没有被修改', 'info');
  };

  const handleRetryTask = async () => {
    const task = tasks.find((item) => item.id === selectedConversation?.taskId);
    if (!task) return;
    await startPiTask(task.taskType, task.instruction, task.target || null);
  };

  const handleAbandonTask = async () => {
    const taskId = selectedConversation?.taskId;
    if (!taskId) return;
    const result = await window.novalAPI.abandonTask(taskId);
    if (!result?.ok) {
      showNotification(`放弃任务失败：${result?.error || '未知错误'}`, 'error');
      return;
    }
    if (result?.task) setTasks((current) => [result.task, ...current.filter((item) => item.id !== taskId)]);
    showNotification('任务已放弃，正式文件没有改变', 'info');
  };

  const handleSendMessage = async (text: string) => {
    if (isGeneratingRef.current) return;
    if (analysisLocked) {
      showNotification('小说分析完成前只能查看文件和图谱', 'info');
      return;
    }
    if (
      currentPath &&
      analysisGraph &&
      /(?:设定不对|关系不对|认知不对|时间不对|其实.+(?:是|知道|没有|不是)|请修正|纠正设定|撤销修正)/.test(text)
    ) {
      const result = await window.novalAPI.startAnalysis({
        root: currentPath,
        workflowId: 'WF03',
        input: { correction: text }
      });
      if (result?.ok && result.data) {
        setAnalysisRun(result.data);
        showNotification('作者修正已记录，正在更新受影响的材料');
      } else {
        showNotification(`修正失败：${result?.error || '未知错误'}`, 'error');
      }
      return;
    }

    const selectedTask = tasks.find((item) => item.id === selectedConversation?.taskId);
    if (selectedTask?.status === 'awaiting_confirmation' && selectedTask.result?.kind === 'question') {
      updateGenerating(true);
      const result = await window.novalAPI.answerTask({
        taskId: selectedTask.id,
        answer: text,
        project: currentProject,
        workspaceRoot: currentSource === 'workspace' ? currentPath : '',
        target: selectedTask.target,
        conversationHistory: selectedConversation?.messages.map((message) => ({ role: message.role, content: message.content })) || []
      });
      if (!result?.ok) {
        updateGenerating(false);
        showNotification(`提交回答失败：${result?.error || '未知错误'}`, 'error');
      }
      return;
    }

    const fileTarget = activeDoc?.path ? {
      filePath: activeDoc.path,
      docType: 'file',
      docId: activeDoc.path,
      docTitle: activeDoc.title,
      draftContent: activeDoc.content
    } : null;
    await startPiTask(undefined, text, fileTarget);
  };

  const handleOpenChanges = (messageId: string) => {
    if (!selectedConversation) return;
    const message = selectedConversation.messages.find((item) => item.id === messageId);
    const taskId = message?.proposal?.taskId;
    if (!taskId) return;
    setDiffTaskId(taskId);
    setActiveTabId(`diff:${taskId}`);
  };

  const handleContinueProposal = async (messageId: string) => {
    if (!selectedConversation) return;
    const message = selectedConversation.messages.find((item) => item.id === messageId);
    const taskId = message?.proposal?.taskId;
    if (!taskId) return;
    const firstChange = message?.proposal?.changes?.find((change) => change.action !== 'delete');
    if (firstChange) {
      openDocument({
        id: firstChange.path,
        type: 'file',
        title: firstChange.path.split('/').pop() || firstChange.path,
        path: firstChange.path,
        content: firstChange.content || ''
      });
    }
    showNotification('请在输入框说明下一版要怎么改', 'info');
  };

  const handleResolveStoryConflict = async (choice: 'keep' | 'accept' | 'cancel') => {
    const task = tasks.find((item) => item.id === selectedConversation?.taskId);
    if (!task) return;
    const result = await window.novalAPI.rejectTask(task.id);
    if (!result?.ok) {
      showNotification(`处理冲突失败：${result?.error || '未知错误'}`, 'error');
      return;
    }
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'rejected' } : item));
    setActiveTaskId('');
    if (choice === 'accept') {
      await startPiTask(
        task.taskType,
        `请根据以下冲突和可选处理重新执行本任务，不得绕过原有检查：${String(task.result?.conflict || '')}\n${Array.isArray(task.result?.options) ? task.result.options.join('；') : ''}`,
        task.target || null
      );
      return;
    }
    showNotification(choice === 'keep' ? '已保持现状，正式作品没有变化' : '已取消本次要求', 'info');
  };

  const handleCreateRevisionFromReview = async () => {
    const task = tasks.find((item) => item.id === selectedConversation?.taskId);
    if (!task?.result) return;
    await startPiTask(
      'rewrite',
      `请根据这份评审中作者选定的问题生成修改候选稿：\n${taskResultText(task)}`,
      task.target || null
    );
  };

  const handleExportSelection = async (selection: {
    includeOutline: boolean;
    chapterIds: string[];
  }) => {
    if (!currentProject) return;

    const exportingFullText =
      selection.chapterIds.length === currentProject.chapters.length &&
      (!!buildOutlineContent(currentProject) ? selection.includeOutline : true);
    const content = exportingFullText
      ? buildExportContent(currentProject)
      : buildSelectedExportContent(currentProject, selection);

    const result = await window.novalAPI.exportDocument(
      'txt',
      currentProject.title || '小说',
      content
    );

    if (!result?.canceled) {
      setIsExportModalOpen(false);
      showNotification(exportingFullText ? '✓ 全文已导出' : '✓ 所选内容已导出');
    }
  };

  const handleUseExternalVersion = async () => {
    const pendingTaskId = pendingConflictCommit?.taskId;
    const result = await reloadWorkspace();
    if (!result.ok) {
      showNotification(`载入失败：${result.error || '未知错误'}`, 'error');
      return;
    }
    if (pendingTaskId) await window.novalAPI.rejectTask(pendingTaskId);
    setPendingConflictCommit(null);
    setActiveTaskId('');
    clearWorkspaceConflicts();
    showNotification('已采用外部文件版本', 'info');
  };

  const handleMergeVersion = async (relativePath: string, content: string) => {
    if (!pendingConflictCommit) return;
    const changes = (pendingConflictCommit.proposal.changes || []).map((change) =>
      change.path === relativePath ? { ...change, action: 'update', content } : change
    );
    const confirmed = await window.novalAPI.confirmTask({
      taskId: pendingConflictCommit.taskId,
      project: pendingConflictCommit.project,
      workspaceRoot: currentPath,
      expectedRevisions: workspaceRevisions,
      changes,
      force: true
    });
    if (!confirmed?.ok) {
      showNotification(`合并失败：${confirmed?.error || '未知错误'}`, 'error');
      return;
    }
    if (confirmed.data) updateCurrentProject(confirmed.data);
    await reloadWorkspace();
    await refreshFileTree();
    setPendingConflictCommit(null);
    setActiveTaskId('');
    clearWorkspaceConflicts();
    showNotification('合并版本已写入正式作品');
  };

  const handleKeepCurrentVersion = async () => {
    if (pendingConflictCommit) {
      const result = await window.novalAPI.confirmTask({
        taskId: pendingConflictCommit.taskId,
        project: pendingConflictCommit.project,
        workspaceRoot: currentPath,
        expectedRevisions: workspaceRevisions,
        force: true
      });
      if (!result?.ok) {
        showNotification(`保存失败：${result?.error || '未知错误'}`, 'error');
        return;
      }
      updateCurrentProject(result.data || pendingConflictCommit.project);
      await reloadWorkspace();
      await refreshFileTree();
      setPendingConflictCommit(null);
      clearWorkspaceConflicts();
      showNotification('已按你的选择保存应用内版本');
      return;
    }
    const result = await forceSaveWorkspace();
    if (!result.ok) {
      showNotification(`保存失败：${result.error || '未知错误'}`, 'error');
      return;
    }
    clearWorkspaceConflicts();
    showNotification('已按你的选择保存应用内版本');
  };

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{
        fontFamily: "'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif",
        background: '#F7F7F8'
      }}
    >
      <header
        className="flex-shrink-0 flex items-center justify-between px-5 h-14"
        style={{ background: '#FFFFFF', borderBottom: '1px solid #EAEAEA', zIndex: 10 }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors text-sm"
            style={{ color: '#6E6E8A' }}
            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#F0F0F5'}
            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
          >
            <ArrowLeftIcon size={14} />
            <span className="text-xs">我的创作</span>
          </button>
          <div style={{ width: '1px', height: '16px', background: '#EAEAEA' }} />
          <div className="flex items-center gap-2">
            <div
              className="w-6 h-6 rounded flex items-center justify-center"
              style={{ background: '#1A1A2E' }}
            >
              <BookOpenIcon size={12} color="#FFFFFF" />
            </div>
            <span style={{ color: '#1A1A2E' }} className="text-sm">
              {projectInfo?.title || '未命名项目'}
            </span>
            {projectInfo?.genre && (
              <span
                className="px-2 py-0.5 rounded text-xs"
                style={{ background: '#F0F0F5', color: '#8B8B9E' }}
              >
                {projectInfo.genre}
              </span>
            )}
            {!currentPath && (
              <span
                className="px-2 py-0.5 rounded text-xs"
                style={{ background: '#FFF5E8', color: '#C67A1B' }}
              >
                未保存
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setActiveTabId('graph')}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs transition-colors"
            style={{ border: '1px solid #D7D7E0', background: activeTabId === 'graph' ? '#E9EEFA' : '#FFFFFF', color: activeTabId === 'graph' ? '#3159A8' : '#6E6E8A' }}
          >
            <NetworkIcon size={12} /> 关系图谱
          </button>
          {totalWords > 0 && (
            <div className="flex items-center gap-1.5" style={{ color: '#9999B3' }}>
              <span style={{ color: '#9999B3' }} className="text-xs">
                {(totalWords / 10000).toFixed(1)}万字 · {chapters.length} 章
              </span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs" style={{ color: '#5E7B69' }}>
            <CheckCircle2Icon size={13} />
            <span>{isGenerating ? 'AI 正在处理' : '已保存到文件'}</span>
          </div>
          <button
            onClick={() => setIsSettingsModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs transition-colors"
            style={{
              border: '1px solid #E0E0EA',
              color: settings.apiKey ? '#6E6E8A' : '#C67A1B',
              background: 'transparent'
            }}
            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#F0F0F5'}
            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
          >
            <Settings2Icon size={12} />
            {settings.apiKey ? '模型设置' : '配置 API'}
          </button>
          <button
            onClick={() => setIsExportModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs transition-colors"
            style={{ border: '1px solid #E0E0EA', color: '#6E6E8A', background: 'transparent' }}
            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#F0F0F5'}
            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
          >
            <DownloadIcon size={12} />
            导出
          </button>
        </div>
      </header>

      {recoveryNotice && (
        <div
          className="flex-shrink-0 px-5 py-3 flex items-start justify-between gap-4"
          style={{
            background: recoveryNotice.kind === 'warning' ? '#FFF8E8' : '#EEF3FF',
            borderBottom: '1px solid #EAEAEA'
          }}
        >
          <div>
            <p
              className="text-sm"
              style={{ color: recoveryNotice.kind === 'warning' ? '#8A5A00' : '#2E5BD1' }}
            >
              {recoveryNotice.title}
            </p>
            <p style={{ color: '#6E6E8A' }} className="text-xs mt-0.5">
              {recoveryNotice.text}
            </p>
          </div>
          <button
            onClick={dismissRecoveryNotice}
            className="px-2 py-1 rounded text-xs"
            style={{ color: '#6E6E8A' }}
          >
            关闭
          </button>
        </div>
      )}

      {analysisBarRun && currentSource === 'workspace' && (
        <AnalysisStatusBar
          run={analysisBarRun}
          onStart={handleStartAnalysis}
          onPause={handlePauseAnalysis}
          onResume={handleResumeAnalysis}
          onCancel={handleCancelAnalysis}
          onRetry={handleRetryAnalysis}
          onSetConcurrency={handleAnalysisConcurrency}
        />
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-shrink-0 overflow-hidden" style={{ width: '264px' }}>
          <LeftPanel
            conversations={conversations}
            selectedConvId={selectedConvId}
            onSelectConversation={handleSelectConversation}
            onNewConversation={handleNewConversation}
          />
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="min-w-[300px] flex-1 overflow-hidden">
            <MiddlePanel
              selectedConversation={selectedConversation}
              activeDoc={activeDoc}
              isGenerating={isGenerating || analysisLocked}
              onSendMessage={handleSendMessage}
              onOpenChanges={handleOpenChanges}
              onContinueProposal={handleContinueProposal}
              onResolveConflict={handleResolveStoryConflict}
              onCreateRevisionFromReview={handleCreateRevisionFromReview}
              onStopTask={handleStopTask}
              onRetryTask={handleRetryTask}
              onAbandonTask={handleAbandonTask}
              onCloseDoc={() => handleCloseDoc()}
            />
          </div>

          {(diffTask || openDocs.length > 0 || activeTabId === 'graph') && (
            <div className={`${activeTabId === 'graph' ? 'w-[72%] min-w-[620px]' : 'w-[56%] min-w-[420px] max-w-[820px]'} flex-shrink-0 overflow-hidden`}>
              <DocumentWorkspace
                documents={openDocs}
                activeTabId={activeTabId}
                diffTask={diffTask}
                graph={analysisGraph}
                onOpenEvidence={handleOpenEvidence}
                onSelectTab={setActiveTabId}
                onCloseDocument={handleCloseDoc}
              />
            </div>
          )}
        </div>

        <div className="flex-shrink-0 overflow-hidden transition-[width] duration-200" style={{ width: rightCollapsed ? '44px' : '304px' }}>
          <RightPanel
            files={workspaceFiles}
            collapsed={rightCollapsed}
            selectedPath={activeDoc?.path}
            onToggle={() => {
              setRightCollapsed((current) => {
                const next = !current;
                localStorage.setItem('noval.files.collapsed', String(next));
                return next;
              });
            }}
            onOpenFile={(file) => void handleOpenFile(file)}
          />
        </div>
      </div>

      {notification && (
        <div
          role={notification.type === 'error' ? 'alert' : 'status'}
          aria-live={notification.type === 'error' ? 'assertive' : 'polite'}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl text-sm z-50"
          style={{
            background:
              notification.type === 'success'
                ? '#1A1A2E'
                : notification.type === 'error'
                  ? '#B42318'
                  : '#4A7CF7',
            color: '#FFFFFF',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            animation: 'fadeInUp 0.25s ease'
          }}
        >
          {notification.msg}
        </div>
      )}

      {isSettingsModalOpen && (
        <SettingsModal
          settings={settings}
          onSave={async (nextSettings) => {
            await saveSettings(nextSettings);
            showNotification('模型设置已保存');
          }}
          onClose={() => setIsSettingsModalOpen(false)}
        />
      )}

      {isExportModalOpen && (
        <ExportModal
          outlineAvailable={Boolean(outline)}
          chapters={chapters}
          onExport={handleExportSelection}
          onClose={() => setIsExportModalOpen(false)}
        />
      )}

      {workspaceConflicts.length > 0 && (
        <WorkspaceConflictModal
          conflicts={workspaceConflicts}
          onUseExternal={handleUseExternalVersion}
          onKeepCurrent={handleKeepCurrentVersion}
          onMerge={handleMergeVersion}
          onClose={clearWorkspaceConflicts}
        />
      )}

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translate(-50%, 12px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  );
}
