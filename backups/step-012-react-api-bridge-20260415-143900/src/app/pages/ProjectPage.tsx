import { useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeftIcon, BookOpenIcon, DownloadIcon, SparklesIcon } from 'lucide-react';
import { LeftPanel } from '../components/project/LeftPanel';
import { MiddlePanel } from '../components/project/MiddlePanel';
import { RightPanel } from '../components/project/RightPanel';
import { CharacterModal } from '../components/modals/CharacterModal';
import { WorldModal } from '../components/modals/WorldModal';
import {
  MOCK_CONVERSATIONS,
  MOCK_CHARACTERS,
  MOCK_WORLD_SETTING,
  MOCK_OUTLINE,
  MOCK_CHAPTERS,
  MOCK_CHARACTER_DOC,
  MOCK_PROJECTS,
} from '../data/mockData';
import { Conversation, Character, WorldSetting, Chapter, ActiveDoc, Message } from '../types';

const MOCK_AI_RESPONSES: Record<string, string[]> = {
  general: [
    '收到您的创作指令。根据您当前的角色设定和世界观，我来为您提供分析与建议。\n\n在《黑暗之城》的创作框架中，这个问题涉及到叙事节奏和人物动机的平衡。建议您考虑以下几个维度：\n\n**叙事层面**：保持主线推进的同时，适当加入支线情节作为缓冲与铺垫。\n\n**人物层面**：陆寒的侦探视角是天然的叙事过滤器，建议通过他的观察视角来控制信息的释放节奏。\n\n如果您需要具体到某一章节的深化，请告诉我章节编号，我可以给出更有针对性的建议。',
    '这是一个很有意思的创作问题。从文学结构的角度来看，您提到的这个矛盾实际上是中长篇小说中最典型的"信息节奏"问题。\n\n建议采取"悬念递进"的处理方式：每一章结尾制造一个小悬念，不必要每次都是情节高潮，也可以是人物情感或认知上的转折点。这样既能保持读者的阅读动力，又不会因为过度密集的戏剧冲突而显得疲惫。\n\n您目前的大纲结构已经有这个方向的雏形，特别是第二幕的展开部分处理得很好。',
  ],
  modification: [
    '收到修改指令。以下是修改后的版本，供您参考：\n\n---\n\n修改版在保留原有情节节点的基础上，对叙事语调做了以下调整：\n1. 将过于直白的情绪描写替换为更具观察性的外部动作描述\n2. 对话节奏做了压缩，去掉了冗余的解释性句子\n3. 在关键转折处增加了环境细节的铺垫\n\n---\n\n您可以直接使用这个版本，或告诉我需要进一步调整的方向。如果满意，可以点击"固定替换（Pin）"将修改内容同步到文档中。',
    '好的，我理解您的修改意图。以下是调整方案：\n\n主要改动集中在三个部分：\n\n**节奏调整**：删除了原文中两处过渡性描述，使情节推进更加紧凑。\n\n**对话优化**：将部分信息性对话改为动作/行为暗示，减少"说教感"，让人物性格通过行为而非语言传递。\n\n**氛围强化**：在关键场景加入了感官细节（声音、气味、温度），增强沉浸感。\n\n如有需要，可以针对某一具体段落做进一步的精细化调整。',
  ],
};

function getMockResponse(type: 'general' | 'modification'): string {
  const pool = MOCK_AI_RESPONSES[type];
  return pool[Math.floor(Math.random() * pool.length)];
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  // Find project info
  const projectInfo = MOCK_PROJECTS.find((p) => p.id === projectId);

  // Core state
  const [conversations, setConversations] = useState<Conversation[]>(
    projectId === 'proj-1' ? MOCK_CONVERSATIONS : []
  );
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<ActiveDoc | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Settings state
  const [characters, setCharacters] = useState<Character[]>(
    projectId === 'proj-1' ? MOCK_CHARACTERS : []
  );
  const [worldSetting, setWorldSetting] = useState<WorldSetting>(
    projectId === 'proj-1' ? MOCK_WORLD_SETTING : { tags: [], customText: '' }
  );
  const [writingStyle, setWritingStyle] = useState(projectId === 'proj-1' ? '细腻' : '');

  // Content state
  const [outline, setOutline] = useState(projectId === 'proj-1' ? MOCK_OUTLINE : '');
  const [characterDoc, setCharacterDoc] = useState(projectId === 'proj-1' ? MOCK_CHARACTER_DOC : '');
  const [chapters, setChapters] = useState<Chapter[]>(
    projectId === 'proj-1' ? MOCK_CHAPTERS : []
  );

  // Modal state
  const [isCharModalOpen, setIsCharModalOpen] = useState(false);
  const [isWorldModalOpen, setIsWorldModalOpen] = useState(false);

  // Notification state
  const [notification, setNotification] = useState<{ msg: string; type: 'success' | 'info' } | null>(null);

  const showNotification = (msg: string, type: 'success' | 'info' = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 2500);
  };

  const handleSelectConversation = (id: string) => {
    setSelectedConvId(id);
    setActiveDoc(null);
  };

  const handleLoadDoc = (doc: ActiveDoc) => {
    setActiveDoc(doc);
    setSelectedConvId(null);
  };

  const handleCloseDoc = () => {
    setActiveDoc(null);
  };

  const handleSendMessage = useCallback(
    (text: string) => {
      if (isGenerating) return;

      const isModContext = activeDoc && activeDoc.type !== 'characterDoc';
      const convType = isModContext ? 'modification' : 'general';

      const userMsg: Message = {
        id: generateId(),
        role: 'user',
        content: text,
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      };

      // If there's a selected conversation, add to it
      if (selectedConvId && !isModContext) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedConvId
              ? { ...c, messages: [...c.messages, userMsg] }
              : c
          )
        );
        setIsGenerating(true);
        setTimeout(() => {
          const aiMsg: Message = {
            id: generateId(),
            role: 'ai',
            content: getMockResponse('general'),
            timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          };
          setConversations((prev) =>
            prev.map((c) =>
              c.id === selectedConvId
                ? { ...c, messages: [...c.messages, aiMsg] }
                : c
            )
          );
          setIsGenerating(false);
        }, 1500 + Math.random() * 1000);
        return;
      }

      // Create new conversation
      const newConvId = generateId();
      const shortTitle =
        text.length > 16 ? text.slice(0, 16) + '...' : text;
      const newConv: Conversation = {
        id: newConvId,
        type: convType,
        title: isModContext ? `${activeDoc.title} 修改` : shortTitle,
        preview: text.slice(0, 40),
        timestamp: new Date().toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
        messages: [userMsg],
        relatedDocId: isModContext ? activeDoc.id : undefined,
        relatedDocType: isModContext ? activeDoc.type : undefined,
      };

      setConversations((prev) => [newConv, ...prev]);
      setSelectedConvId(newConvId);
      setIsGenerating(true);

      setTimeout(() => {
        const aiMsg: Message = {
          id: generateId(),
          role: 'ai',
          content: getMockResponse(convType),
          timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        };
        setConversations((prev) =>
          prev.map((c) =>
            c.id === newConvId
              ? { ...c, messages: [...c.messages, aiMsg] }
              : c
          )
        );
        setIsGenerating(false);
      }, 1500 + Math.random() * 1000);
    },
    [isGenerating, activeDoc, selectedConvId]
  );

  const handlePinDocument = (content: string) => {
    if (!activeDoc) return;
    if (activeDoc.type === 'outline') {
      setOutline(content);
      showNotification('✓ 大纲已固定替换');
    } else if (activeDoc.type === 'chapter') {
      setChapters((prev) =>
        prev.map((ch) =>
          ch.id === activeDoc.id
            ? { ...ch, content, wordCount: content.length }
            : ch
        )
      );
      showNotification('✓ 章节内容已固定替换');
    }
  };

  const handleGenerateChapter = () => {
    if (isGenerating) return;
    const nextNum = chapters.length + 1;
    const mockTitles = ['风起', '深渊', '归途', '黎明', '镜像', '裂缝', '彼岸', '涟漪'];
    const title = mockTitles[nextNum - 1] || `第${nextNum}章`;

    setIsGenerating(true);
    setTimeout(() => {
      const newChapter: Chapter = {
        id: `chapter-${nextNum}`,
        number: nextNum,
        title,
        wordCount: 0,
        content: `第${nextNum}章　${title}\n\n[AI 正在根据大纲和前文内容生成本章节……]\n\n本章将承接前文情节，严格遵循故事大纲走向，主角性格与人物设定保持全程统一。具体内容生成中，请稍候。`,
      };
      setChapters((prev) => [...prev, newChapter]);
      setIsGenerating(false);
      showNotification(`✓ 第${nextNum}章已生成`);
    }, 2000);
  };

  const handleExportAll = () => {
    const content = [
      `《${projectInfo?.title || '未命名'}》\n`,
      characterDoc ? `\n━━━ 角色世界观文档 ━━━\n\n${characterDoc}` : '',
      outline ? `\n\n━━━ 故事大纲 ━━━\n\n${outline}` : '',
      ...chapters.map((ch) => `\n\n━━━ 第${ch.number}章：${ch.title} ━━━\n\n${ch.content}`),
    ].join('');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectInfo?.title || '小说'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('✓ 全文已导出');
  };

  const selectedConversation = conversations.find((c) => c.id === selectedConvId) || null;
  const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ fontFamily: "'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif", background: '#F7F7F8' }}
    >
      {/* ─── Top bar ─── */}
      <header
        className="flex-shrink-0 flex items-center justify-between px-5 h-14"
        style={{ background: '#FFFFFF', borderBottom: '1px solid #EAEAEA', zIndex: 10 }}
      >
        {/* Left: back + title */}
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
          </div>
        </div>

        {/* Right: stats + export */}
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
            onClick={handleExportAll}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs transition-colors"
            style={{ border: '1px solid #E0E0EA', color: '#6E6E8A', background: 'transparent' }}
            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#F0F0F5'}
            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
          >
            <DownloadIcon size={12} />
            导出全文
          </button>
        </div>
      </header>

      {/* ─── Three-column layout ─── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="flex-shrink-0 overflow-hidden" style={{ width: '264px' }}>
          <LeftPanel
            conversations={conversations}
            selectedConvId={selectedConvId}
            onSelectConversation={handleSelectConversation}
          />
        </div>

        {/* Middle panel */}
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

        {/* Right panel */}
        <div className="flex-shrink-0 overflow-hidden" style={{ width: '304px' }}>
          <RightPanel
            characters={characters}
            worldSetting={worldSetting}
            writingStyle={writingStyle}
            outline={outline}
            characterDoc={characterDoc}
            chapters={chapters}
            onOpenCharModal={() => setIsCharModalOpen(true)}
            onOpenWorldModal={() => setIsWorldModalOpen(true)}
            onSetWritingStyle={setWritingStyle}
            onLoadDoc={handleLoadDoc}
            onGenerateChapter={handleGenerateChapter}
            onExportAll={handleExportAll}
          />
        </div>
      </div>

      {/* ─── Modals ─── */}
      {isCharModalOpen && (
        <CharacterModal
          characters={characters}
          onSave={(chars) => {
            setCharacters(chars);
            showNotification('✓ 角色设定已保存');
          }}
          onClose={() => setIsCharModalOpen(false)}
        />
      )}

      {isWorldModalOpen && (
        <WorldModal
          worldSetting={worldSetting}
          onSave={(setting) => {
            setWorldSetting(setting);
            showNotification('✓ 世界观设定已保存');
          }}
          onClose={() => setIsWorldModalOpen(false)}
        />
      )}

      {/* ─── Toast notification ─── */}
      {notification && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl text-sm z-50"
          style={{
            background: notification.type === 'success' ? '#1A1A2E' : '#4A7CF7',
            color: '#FFFFFF',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            animation: 'fadeInUp 0.25s ease',
          }}
        >
          {notification.msg}
        </div>
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
