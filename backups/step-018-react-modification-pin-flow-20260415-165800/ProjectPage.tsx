import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  ArrowLeftIcon,
  BookOpenIcon,
  DownloadIcon,
  RefreshCwIcon,
  SaveIcon,
  Settings2Icon,
  SparklesIcon
} from 'lucide-react';
import { LeftPanel } from '../components/project/LeftPanel';
import { MiddlePanel } from '../components/project/MiddlePanel';
import { RightPanel } from '../components/project/RightPanel';
import { CharacterModal } from '../components/modals/CharacterModal';
import { ExportModal } from '../components/modals/ExportModal';
import { SettingsModal } from '../components/modals/SettingsModal';
import { WorldModal } from '../components/modals/WorldModal';
import { useProjectContext } from '../context/ProjectContext';
import {
  applyCharactersToProject,
  applyWritingStyleToProject,
  applyWorldSettingToProject,
  buildCharacterDocument,
  buildExportContent,
  buildSelectedExportContent,
  buildOutlineContent,
  mergeProjectMemory,
  projectToCard,
  projectToCharacters,
  projectToChapters,
  projectToWorldSetting,
  projectToWritingStyle,
  updateChapterContent,
  updateOutline
} from '../lib/projectBridge';
import { ActiveDoc, Conversation, Message, NovalProject } from '../types';

const MOCK_AI_RESPONSES: Record<string, string[]> = {
  general: [
    '我已经接入当前项目数据。现在可以直接维护章节、角色、世界设定，并保存到本地项目文件里。\n\n如果你想继续自动化能力，下一步最值得接的是蓝图生成和改写链路。',
    '当前这版 React 页面已经不再依赖 mock 项目卡片，后续我们会继续把 AI 生成和记忆链路逐步接进来。'
  ],
  modification: [
    '当前文档已经绑定到真实项目。你可以先在中间区域编辑，再用 Pin 写回项目内容。',
    '这条对话还保持为前端示意，但文档读写、项目保存、章节生成已经接上了真实数据流。'
  ]
};

function getMockResponse(type: 'general' | 'modification') {
  const pool = MOCK_AI_RESPONSES[type];
  return pool[Math.floor(Math.random() * pool.length)];
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const {
    currentProject,
    currentPath,
    currentChapterId,
    recoveryNotice,
    settings,
    isReady,
    dismissRecoveryNotice,
    updateCurrentProject,
    setCurrentChapterId,
    saveCurrentProject,
    saveSettings
  } = useProjectContext();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<ActiveDoc | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCharModalOpen, setIsCharModalOpen] = useState(false);
  const [isWorldModalOpen, setIsWorldModalOpen] = useState(false);
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
  const characters = currentProject ? projectToCharacters(currentProject) : [];
  const worldSetting = currentProject ? projectToWorldSetting(currentProject) : { tags: [], customText: '' };
  const writingStyle = currentProject ? projectToWritingStyle(currentProject) : '';
  const outline = currentProject ? buildOutlineContent(currentProject) : '';
  const characterDoc = currentProject ? buildCharacterDocument(currentProject) : '';
  const chapters = currentProject ? projectToChapters(currentProject) : [];

  const selectedConversation = conversations.find((item) => item.id === selectedConvId) || null;
  const totalWords = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const currentChapter = currentProject
    ? currentProject.chapters.find((chapter) => chapter.id === currentChapterId) ||
      currentProject.chapters[currentProject.chapters.length - 1] ||
      null
    : null;

  useEffect(() => {
    if (!currentProject || !currentChapterId) return;
    const chapter = chapters.find((item) => item.id === currentChapterId);
    if (!chapter) return;
    setActiveDoc({
      id: chapter.id,
      type: 'chapter',
      title: `第${chapter.number}章：${chapter.title}`,
      content: chapter.content
    });
  }, [currentChapterId]);

  useEffect(() => {
    if (!activeDoc) return;

    if (activeDoc.type === 'outline') {
      if (activeDoc.content !== outline) {
        setActiveDoc({ ...activeDoc, content: outline });
      }
      return;
    }

    if (activeDoc.type === 'characterDoc') {
      if (activeDoc.content !== characterDoc) {
        setActiveDoc({ ...activeDoc, content: characterDoc });
      }
      return;
    }

    const chapter = chapters.find((item) => item.id === activeDoc.id);
    if (!chapter) return;
    const nextTitle = `第${chapter.number}章：${chapter.title}`;
    if (activeDoc.content !== chapter.content || activeDoc.title !== nextTitle) {
      setActiveDoc({
        ...activeDoc,
        title: nextTitle,
        content: chapter.content
      });
    }
  }, [activeDoc, outline, characterDoc, chapters]);

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
    setActiveDoc(null);
  };

  const handleLoadDoc = (doc: ActiveDoc) => {
    setActiveDoc(doc);
    setSelectedConvId(null);
    if (doc.type === 'chapter') {
      setCurrentChapterId(doc.id);
    }
  };

  const handleCloseDoc = () => {
    setActiveDoc(null);
  };

  const handleSendMessage = (text: string) => {
    if (isGenerating) return;

    const isModContext = activeDoc && activeDoc.type !== 'characterDoc';
    const convType = isModContext ? 'modification' : 'general';

    const userMsg: Message = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    };

    if (selectedConvId && !isModContext) {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === selectedConvId
            ? { ...conversation, messages: [...conversation.messages, userMsg] }
            : conversation
        )
      );
      setIsGenerating(true);
      window.setTimeout(() => {
        const aiMsg: Message = {
          id: generateId(),
          role: 'ai',
          content: getMockResponse('general'),
          timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        };
        setConversations((current) =>
          current.map((conversation) =>
            conversation.id === selectedConvId
              ? { ...conversation, messages: [...conversation.messages, aiMsg] }
              : conversation
          )
        );
        setIsGenerating(false);
      }, 900);
      return;
    }

    const newConvId = generateId();
    const shortTitle = text.length > 16 ? `${text.slice(0, 16)}...` : text;
    const newConversation: Conversation = {
      id: newConvId,
      type: convType,
      title: isModContext ? `${activeDoc.title} 修改` : shortTitle,
      preview: text.slice(0, 40),
      timestamp: new Date().toISOString(),
      messages: [userMsg],
      relatedDocId: isModContext ? activeDoc.id : undefined,
      relatedDocType: isModContext ? activeDoc.type : undefined
    };

    setConversations((current) => [newConversation, ...current]);
    setSelectedConvId(newConvId);
    setIsGenerating(true);

    window.setTimeout(() => {
      const aiMsg: Message = {
        id: generateId(),
        role: 'ai',
        content: getMockResponse(convType),
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      };
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === newConvId
            ? { ...conversation, messages: [...conversation.messages, aiMsg] }
            : conversation
        )
      );
      setIsGenerating(false);
    }, 900);
  };

  const analyzeChapterInProject = async (projectSnapshot: NovalProject, chapterId: string) => {
    const chapter = projectSnapshot.chapters.find((item) => item.id === chapterId);
    if (!chapter) {
      return projectSnapshot;
    }

    const analysisResult = await window.novalAPI.analyzeChapter({
      project: projectSnapshot,
      chapter
    });

    if (!analysisResult?.ok) {
      return projectSnapshot;
    }

    return {
      ...projectSnapshot,
      memory: mergeProjectMemory(projectSnapshot.memory, analysisResult.data?.memory),
      chapters: projectSnapshot.chapters.map((item) =>
        item.id === chapterId
          ? {
              ...item,
              summary: analysisResult.data?.summary || item.summary,
              updatedAt: new Date().toISOString()
            }
          : item
      )
    };
  };

  const handlePinDocument = async (content: string) => {
    if (!activeDoc || !currentProject) return;

    if (activeDoc.type === 'outline') {
      const nextProject = updateOutline(currentProject, content);
      updateCurrentProject(nextProject);
      setActiveDoc({ ...activeDoc, content });
      showNotification('✓ 大纲已写回项目');
      return;
    }

    if (activeDoc.type === 'chapter') {
      const nextProject = updateChapterContent(currentProject, activeDoc.id, content);
      const analyzedProject = await analyzeChapterInProject(nextProject, activeDoc.id);
      updateCurrentProject(analyzedProject);
      const refreshedChapter = analyzedProject.chapters.find((chapter) => chapter.id === activeDoc.id);
      setActiveDoc({
        ...activeDoc,
        content: refreshedChapter?.content || content,
        title: refreshedChapter ? `第${refreshedChapter.index}章：${refreshedChapter.title}` : activeDoc.title
      });
      showNotification('✓ 章节内容已写回项目，并已更新摘要与记忆');
    }
  };

  const handleGenerateChapter = async (isContinuation = false) => {
    if (!currentProject || isGenerating) return;

    const baseChapter =
      isContinuation && currentChapter
        ? currentChapter
        : {
            id: `chapter-${Date.now()}`,
            index: currentProject.chapters.length + 1,
            title: `第 ${currentProject.chapters.length + 1} 章`,
            goal: currentProject.blueprint.chapterPlans[currentProject.chapters.length]?.goal || '',
            summary: currentProject.blueprint.chapterPlans[currentProject.chapters.length]?.goal || '',
            content: '',
            instruction: '',
            status: 'draft',
            updatedAt: new Date().toISOString()
          };

    if (isContinuation && !currentChapter) {
      showNotification('当前还没有章节可续写，请先生成一章', 'info');
      return;
    }

    setIsGenerating(true);

    try {
      const generationResult = await window.novalAPI.generateChapter({
        project: currentProject,
        chapter: baseChapter,
        isContinuation
      });

      if (!generationResult?.ok) {
        showNotification('章节生成失败，请检查模型配置', 'error');
        return;
      }

      const generatedChapter = {
        ...baseChapter,
        title: generationResult.data?.title || baseChapter.title,
        summary: generationResult.data?.summary || baseChapter.summary,
        content: generationResult.data?.content || baseChapter.content,
        updatedAt: new Date().toISOString()
      };

      let nextProject = {
        ...currentProject,
        updatedAt: new Date().toISOString(),
        chapters: isContinuation
          ? currentProject.chapters.map((chapter) =>
              chapter.id === generatedChapter.id ? generatedChapter : chapter
            )
          : [...currentProject.chapters, generatedChapter]
      };

      nextProject = await analyzeChapterInProject(nextProject, generatedChapter.id);

      const refreshedChapter =
        nextProject.chapters.find((chapter) => chapter.id === generatedChapter.id) || generatedChapter;

      updateCurrentProject(nextProject);
      setCurrentChapterId(refreshedChapter.id);
      setActiveDoc({
        id: refreshedChapter.id,
        type: 'chapter',
        title: `第${refreshedChapter.index}章：${refreshedChapter.title}`,
        content: refreshedChapter.content
      });

      const modeLabel =
        generationResult.mode === 'api'
          ? '模型生成'
          : generationResult.reason === 'missing_api_key'
            ? '本地模板生成'
            : '回退模板生成';
      showNotification(
        `✓ 第${refreshedChapter.index}章${isContinuation ? '已续写' : '已生成'}（${modeLabel}）`
      );
    } catch (error) {
      showNotification(
        `章节生成失败：${error instanceof Error ? error.message : '未知错误'}`,
        'error'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRefreshMemory = async () => {
    if (!currentProject || isGenerating) return;

    setIsGenerating(true);
    try {
      const result = await window.novalAPI.refreshMemory({
        project: currentProject
      });

      if (!result?.ok) {
        showNotification('记忆刷新失败，请稍后再试', 'error');
        return;
      }

      const nextProject = {
        ...currentProject,
        updatedAt: new Date().toISOString(),
        memory: result.data || currentProject.memory
      };
      updateCurrentProject(nextProject);
      const modeLabel =
        result.mode === 'api'
          ? '模型整理'
          : result.reason === 'missing_api_key'
            ? '本地规则整理'
            : '回退规则整理';
      showNotification(`✓ 记忆已刷新（${modeLabel}）`);
    } catch (error) {
      showNotification(
        `记忆刷新失败：${error instanceof Error ? error.message : '未知错误'}`,
        'error'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateBlueprint = async () => {
    if (!currentProject || isGenerating) return;

    setIsGenerating(true);
    try {
      const result = await window.novalAPI.generateBlueprint({
        title: currentProject.title,
        setup: currentProject.setup
      });

      if (!result?.ok) {
        showNotification('蓝图生成失败，请检查模型配置', 'error');
        return;
      }

      const nextProject = {
        ...currentProject,
        title:
          result.data?.titleOptions?.[0] && currentProject.title === '未命名小说'
            ? result.data.titleOptions[0]
            : currentProject.title,
        updatedAt: new Date().toISOString(),
        blueprint: result.data || currentProject.blueprint
      };

      updateCurrentProject(nextProject);
      setActiveDoc({
        id: 'outline',
        type: 'outline',
        title: '故事大纲',
        content: buildOutlineContent(nextProject)
      });

      const modeLabel =
        result.mode === 'api'
          ? '模型生成'
          : result.reason === 'missing_api_key'
            ? '本地模板生成'
            : '回退模板生成';
      showNotification(`✓ 蓝图已生成（${modeLabel}）`);
    } catch (error) {
      showNotification(
        `蓝图生成失败：${error instanceof Error ? error.message : '未知错误'}`,
        'error'
      );
    } finally {
      setIsGenerating(false);
    }
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

  const handleSaveProject = async () => {
    setIsSaving(true);
    const result = await saveCurrentProject();
    setIsSaving(false);

    if (!result.ok) {
      if (!result.canceled) {
        showNotification(`保存失败：${result.error || '未知错误'}`, 'error');
      }
      return;
    }

    showNotification(result.filePath ? `✓ 已保存到 ${result.filePath}` : '✓ 项目已保存');
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
            <div className="flex items-center gap-1.5">
              <SparklesIcon size={12} color="#9999B3" />
              <span style={{ color: '#9999B3' }} className="text-xs">
                {(totalWords / 10000).toFixed(1)}万字 · {chapters.length} 章
              </span>
            </div>
          )}
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
            onClick={() => void handleRefreshMemory()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs transition-colors"
            style={{ border: '1px solid #E0E0EA', color: '#6E6E8A', background: 'transparent' }}
            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#F0F0F5'}
            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
          >
            <RefreshCwIcon size={12} />
            刷新记忆
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
          <button
            onClick={() => void handleSaveProject()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs transition-colors"
            style={{ border: '1px solid #E0E0EA', color: '#6E6E8A', background: 'transparent' }}
            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#F0F0F5'}
            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
          >
            <SaveIcon size={12} />
            {isSaving ? '保存中...' : '保存项目'}
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
          />
        </div>

        <div className="flex-1 overflow-hidden">
          <MiddlePanel
            selectedConversation={selectedConversation}
            activeDoc={activeDoc}
            isGenerating={isGenerating}
            onSendMessage={handleSendMessage}
            onPinDocument={handlePinDocument}
            onCloseDoc={handleCloseDoc}
          />
        </div>

        <div className="flex-shrink-0 overflow-hidden" style={{ width: '304px' }}>
          <RightPanel
            characters={characters}
            worldSetting={worldSetting}
            writingStyle={writingStyle}
            outline={outline}
            characterDoc={characterDoc}
            chapters={chapters}
            currentChapterNumber={currentChapter?.index}
            onOpenCharModal={() => setIsCharModalOpen(true)}
            onOpenWorldModal={() => setIsWorldModalOpen(true)}
            onSetWritingStyle={(style) => {
              updateCurrentProject(applyWritingStyleToProject(currentProject, style));
              showNotification('✓ 文风设定已更新');
            }}
            onLoadDoc={handleLoadDoc}
            onGenerateBlueprint={() => void handleGenerateBlueprint()}
            onGenerateChapter={() => void handleGenerateChapter(false)}
            onContinueChapter={() => void handleGenerateChapter(true)}
            onRefreshMemory={() => void handleRefreshMemory()}
          />
        </div>
      </div>

      {isCharModalOpen && (
        <CharacterModal
          characters={characters}
          onSave={(nextCharacters) => {
            updateCurrentProject(applyCharactersToProject(currentProject, nextCharacters));
            showNotification('✓ 角色设定已保存');
          }}
          onClose={() => setIsCharModalOpen(false)}
        />
      )}

      {isWorldModalOpen && (
        <WorldModal
          worldSetting={worldSetting}
          onSave={(nextWorldSetting) => {
            updateCurrentProject(applyWorldSettingToProject(currentProject, nextWorldSetting));
            showNotification('✓ 世界观设定已保存');
          }}
          onClose={() => setIsWorldModalOpen(false)}
        />
      )}

      {notification && (
        <div
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

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translate(-50%, 12px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  );
}
