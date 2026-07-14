import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  ArrowLeftIcon,
  BookOpenIcon,
  DownloadIcon,
  Settings2Icon,
  CheckCircle2Icon
} from 'lucide-react';
import { LeftPanel } from '../components/project/LeftPanel';
import { MiddlePanel } from '../components/project/MiddlePanel';
import { RightPanel } from '../components/project/RightPanel';
import { ExportModal } from '../components/modals/ExportModal';
import { SettingsModal } from '../components/modals/SettingsModal';
import { WorkspaceConflictModal } from '../components/modals/WorkspaceConflictModal';
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
import { ActiveDoc, Conversation, FileChange, Message, NovalProject, PiTask, PiTaskResult, WorkspaceFile } from '../types';

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
  if (result.kind === 'answer') return String(result.answer || '');
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
    return `${String(result.title || '发现创作冲突')}\n\n${String(result.conflict || '')}\n\n请先选择保留原方向、接受新方向，或取消本次要求。`;
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
  const autoStartedProject = useRef('');
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<ActiveDoc | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [rightCollapsed, setRightCollapsed] = useState(() => localStorage.getItem('noval.files.collapsed') === 'true');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [notification, setNotification] = useState<{
    msg: string;
    type: 'success' | 'info' | 'error';
  } | null>(null);

  const showNotification = (msg: string, type: 'success' | 'info' | 'error' = 'success') => {
    setNotification({ msg, type });
    window.setTimeout(() => setNotification(null), 2500);
  };

  const projectInfo = currentProject ? projectToCard(currentProject, currentPath) : null;
  const outline = currentProject ? buildOutlineContent(currentProject) : '';
  const chapters = currentProject ? projectToChapters(currentProject) : [];

  const selectedConversation = conversations.find((item) => item.id === selectedConvId) || null;
  const totalWords = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const currentChapter = currentProject
    ? currentProject.chapters.find((chapter) => chapter.id === currentChapterId) ||
      currentProject.chapters[currentProject.chapters.length - 1] ||
      null
    : null;

  const refreshFileTree = async () => {
    if (!currentPath || !window.novalAPI?.listWorkspaceFiles) return;
    const result = await window.novalAPI.listWorkspaceFiles(currentPath);
    if (result?.ok) setWorkspaceFiles(Array.isArray(result.data) ? result.data : []);
  };

  useEffect(() => { void refreshFileTree(); }, [currentPath, currentProject?.updatedAt, externalChangePaths.join('|')]);

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
      setIsGenerating(Boolean(open && RUNNING_TASK_STATUSES.has(open.status)));
      if (!selectedConvId && loadedTasks[0]) setSelectedConvId(loadedTasks[0].conversationId || `conversation-${loadedTasks[0].id}`);
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
      setIsGenerating(running);
      setActiveTaskId(running ? task.id : '');
      if (task.taskType === 'refresh_memory' && ['failed', 'stopped', 'interrupted'].includes(task.status)) {
        showNotification('故事记忆待重试，正式正文不受影响', 'error');
      }
      if (
        task.status === 'completed' &&
        task.result?.kind === 'memory' &&
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
              showNotification('正文已确认，但记忆因外部修改暂未写入', 'error');
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
    setSelectedConvId(`conversation-${Date.now()}`);
    setActiveDoc(null);
  };

  const handleOpenFile = async (file: WorkspaceFile) => {
    if (!currentPath) return;
    const result = await window.novalAPI.readWorkspaceFile(currentPath, file.path);
    if (!result?.ok) {
      showNotification(`文件打开失败：${result?.error || '未知错误'}`, 'error');
      return;
    }
    setActiveDoc({ id: file.path, type: 'file', title: file.name, path: file.path, content: String(result.data?.content || '') });
  };

  const handleCloseDoc = () => {
    setActiveDoc(null);
  };

  const startPiTask = async (
    taskType: string | undefined,
    instruction: string,
    target: Record<string, unknown> | null = null,
    projectOverride?: NovalProject
  ) => {
    const taskProject = projectOverride || currentProject;
    if (!taskProject || isGenerating) return null;
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
    setIsGenerating(true);
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
        setIsGenerating(false);
        return null;
      }
      const task = result.task as PiTask;
      setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)]);
      setSelectedConvId(task.conversationId || conversationId);
      setActiveTaskId(task.id);
      return task;
    } catch (error) {
      showNotification(`任务启动失败：${error instanceof Error ? error.message : '未知错误'}`, 'error');
      setIsGenerating(false);
      return null;
    }
  };

  useEffect(() => {
    if (!tasksLoaded || !currentProject || tasks.length > 0 || autoStartedProject.current === currentProject.id) return;
    autoStartedProject.current = currentProject.id;
    if (settings.capabilityStatus !== 'ready') {
      handleNewConversation();
      return;
    }
    if (currentProject.importStatus === 'needs_archive_confirmation') {
      void startPiTask('import_novel', '请读取已导入的正式正文，先在对话中补问必要信息，再提交人物、时间线、伏笔和文风等项目文件的候选改动。');
      return;
    }
    if (currentProject.constitutionStatus !== 'confirmed') {
      void startPiTask('create_project', '请检查现有信息，只补问真正影响创作的问题，然后提交 AGENTS.md 候选改动。');
      return;
    }
    handleNewConversation();
  }, [tasksLoaded, currentProject?.id, tasks.length, settings.capabilityStatus]);

  const handleStopTask = async () => {
    if (!activeTaskId) return;
    const result = await window.novalAPI.stopTask(activeTaskId);
    if (!result?.ok) {
      showNotification(`停止失败：${result?.error || '未知错误'}`, 'error');
      return;
    }
    setIsGenerating(false);
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
    if (isGenerating) return;

    const selectedTask = tasks.find((item) => item.id === selectedConversation?.taskId);
    if (selectedTask?.status === 'awaiting_confirmation' && selectedTask.result?.kind === 'question') {
      setIsGenerating(true);
      const result = await window.novalAPI.answerTask({
        taskId: selectedTask.id,
        answer: text,
        project: currentProject,
        workspaceRoot: currentSource === 'workspace' ? currentPath : '',
        target: selectedTask.target,
        conversationHistory: selectedConversation?.messages.map((message) => ({ role: message.role, content: message.content })) || []
      });
      if (!result?.ok) {
        setIsGenerating(false);
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
    if (
      currentProject.importStatus === 'needs_archive_confirmation' &&
      /续写|下一章|写.*章|生成.*章/.test(text)
    ) {
      showNotification('导入作品需要先完成读稿建档并确认', 'info');
      await startPiTask('import_novel', '请先为导入作品完成读稿建档。', null);
      return;
    }

    await startPiTask(fileTarget ? 'rewrite' : undefined, text, fileTarget);
  };

  const handlePinProposal = async (messageId: string) => {
    if (!selectedConversation || !currentProject) return;
    const proposalMessage = selectedConversation.messages.find((message) => message.id === messageId);
    const proposal = proposalMessage?.proposal;
    if (!proposal || proposal.status === 'pinned') return;
    const confirmResult = proposal.taskId
      ? await window.novalAPI.confirmTask({
          taskId: proposal.taskId,
          project: currentProject,
          workspaceRoot: currentSource === 'workspace' ? currentPath : '',
          expectedRevisions: workspaceRevisions
        })
      : { ok: false, error: '候选结果缺少确认记录。' };
    if (!confirmResult?.ok) {
      if (Array.isArray(confirmResult?.conflicts)) {
        registerWorkspaceConflicts(confirmResult.conflicts);
        if (proposal.taskId) setPendingConflictCommit({ taskId: proposal.taskId, project: currentProject, proposal });
      }
      showNotification(confirmResult?.error || '检测到外部修改，确认已暂停', 'error');
      return;
    }
    if (confirmResult.task) setTasks((current) => [confirmResult.task, ...current.filter((item) => item.id !== confirmResult.task.id)]);
    if (confirmResult.data) updateCurrentProject(confirmResult.data);
    await reloadWorkspace();
    await refreshFileTree();
    if (activeDoc?.path && proposal.changes?.some((change) => change.path === activeDoc.path && change.action !== 'delete')) {
      const refreshed = await window.novalAPI.readWorkspaceFile(currentPath, activeDoc.path);
      if (refreshed?.ok) setActiveDoc({ ...activeDoc, content: String(refreshed.data?.content || '') });
    }
    showNotification('已确认并写入项目文件');
    const confirmedChapter = proposal.changes?.find((change) => /^chapters\/.+\.md$/.test(change.path) && change.action !== 'delete');
    if (confirmedChapter) {
      window.setTimeout(() => {
        void startPiTask('refresh_memory', '请整理刚刚确认章节带来的故事记忆变化。', {
          docType: 'file', filePath: confirmedChapter.path, docId: confirmedChapter.path, docTitle: confirmedChapter.path
        }, confirmResult.data || currentProject);
      }, 200);
    }
  };

  const handleContinueProposal = async (messageId: string) => {
    if (!selectedConversation) return;
    const message = selectedConversation.messages.find((item) => item.id === messageId);
    const taskId = message?.proposal?.taskId;
    if (!taskId) return;
    const firstChange = message?.proposal?.changes?.find((change) => change.action !== 'delete');
    if (firstChange) {
      setActiveDoc({
        id: firstChange.path,
        type: 'file',
        title: firstChange.path.split('/').pop() || firstChange.path,
        path: firstChange.path,
        content: firstChange.content || ''
      });
    }
    const result = await window.novalAPI.rejectTask(taskId);
    if (!result?.ok) {
      showNotification(`暂时不能继续修改：${result?.error || '未知错误'}`, 'error');
      return;
    }
    if (result.task) setTasks((current) => [result.task, ...current.filter((item) => item.id !== taskId)]);
    setActiveTaskId('');
    showNotification('请在输入框说明下一版要怎么改', 'info');
  };

  const handleRejectProposal = async (messageId: string) => {
    if (!selectedConversation) return;
    const message = selectedConversation.messages.find((item) => item.id === messageId);
    const taskId = message?.proposal?.taskId;
    if (!taskId) return;
    const result = await window.novalAPI.rejectTask(taskId);
    if (!result?.ok) {
      showNotification(`拒绝失败：${result?.error || '未知错误'}`, 'error');
      return;
    }
    if (result.task) setTasks((current) => [result.task, ...current.filter((item) => item.id !== taskId)]);
    setActiveTaskId('');
    showNotification('候选稿已拒绝，正式作品没有变化', 'info');
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
        'rewrite',
        `作者确认接受新方向。请统一处理以下冲突及其后续影响：${String(task.result?.conflict || '')}`,
        task.target || null
      );
      return;
    }
    showNotification(choice === 'keep' ? '已保持原方向，正式作品没有变化' : '已取消本次要求', 'info');
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

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-shrink-0 overflow-hidden" style={{ width: '264px' }}>
          <LeftPanel
            conversations={conversations}
            selectedConvId={selectedConvId}
            onSelectConversation={handleSelectConversation}
            onNewConversation={handleNewConversation}
          />
        </div>

        <div className="flex-1 overflow-hidden">
          <MiddlePanel
            selectedConversation={selectedConversation}
            activeDoc={activeDoc}
            isGenerating={isGenerating}
            onSendMessage={handleSendMessage}
            onPinProposal={handlePinProposal}
            onContinueProposal={handleContinueProposal}
            onRejectProposal={handleRejectProposal}
            onResolveConflict={handleResolveStoryConflict}
            onCreateRevisionFromReview={handleCreateRevisionFromReview}
            onStopTask={handleStopTask}
            onRetryTask={handleRetryTask}
            onAbandonTask={handleAbandonTask}
            onCloseDoc={handleCloseDoc}
          />
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
