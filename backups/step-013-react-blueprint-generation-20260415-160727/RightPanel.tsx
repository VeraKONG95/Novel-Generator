import { useState } from 'react';
import { UsersIcon, GlobeIcon, FeatherIcon, ChevronDownIcon, ChevronRightIcon, FileTextIcon, BookIcon, PlusIcon, DownloadIcon, ExternalLinkIcon } from 'lucide-react';
import { Character, WorldSetting, Chapter, ActiveDoc } from '../../types';

const WRITING_STYLES = ['抒情', '理智', '欢快', '冷峻', '细腻', '复古'];

interface RightPanelProps {
  characters: Character[];
  worldSetting: WorldSetting;
  writingStyle: string;
  outline: string;
  characterDoc: string;
  chapters: Chapter[];
  onOpenCharModal: () => void;
  onOpenWorldModal: () => void;
  onSetWritingStyle: (style: string) => void;
  onLoadDoc: (doc: ActiveDoc) => void;
  onGenerateChapter: () => void;
  onExportAll: () => void;
}

export function RightPanel({
  characters,
  worldSetting,
  writingStyle,
  outline,
  characterDoc,
  chapters,
  onOpenCharModal,
  onOpenWorldModal,
  onSetWritingStyle,
  onLoadDoc,
  onGenerateChapter,
  onExportAll,
}: RightPanelProps) {
  const [showStyleDropdown, setShowStyleDropdown] = useState(false);
  const [contentExpanded, setContentExpanded] = useState(true);
  const [outlineExpanded, setOutlineExpanded] = useState(true);
  const [chaptersExpanded, setChaptersExpanded] = useState(true);

  return (
    <div
      className="flex flex-col h-full overflow-y-auto"
      style={{ borderLeft: '1px solid #EAEAEA', background: '#FAFAFA' }}
    >
      {/* ─── Settings Section ─── */}
      <div className="flex-shrink-0" style={{ borderBottom: '1px solid #EAEAEA' }}>
        <div className="px-4 py-3.5" style={{ borderBottom: '1px solid #F0F0F5' }}>
          <span style={{ color: '#1A1A2E' }} className="text-sm">创作设定</span>
        </div>

        <div className="px-3 py-3 space-y-2">
          {/* Character settings button */}
          <button
            onClick={onOpenCharModal}
            className="w-full flex items-center justify-between px-3.5 py-3 rounded-xl transition-colors group"
            style={{ background: '#FFFFFF', border: '1px solid #EAEAEA' }}
            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.borderColor = '#C8D4F8'}
            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.borderColor = '#EAEAEA'}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#EEF3FF' }}>
                <UsersIcon size={14} color="#4A7CF7" />
              </div>
              <div className="text-left">
                <p style={{ color: '#2A2A3E' }} className="text-xs">角色设定</p>
                <p style={{ color: '#9999B3' }} className="text-xs">
                  {characters.length > 0 ? `${characters.length} 个角色` : '点击配置'}
                </p>
              </div>
            </div>
            <ExternalLinkIcon size={12} color="#C8C8D8" />
          </button>

          {/* World settings button */}
          <button
            onClick={onOpenWorldModal}
            className="w-full flex items-center justify-between px-3.5 py-3 rounded-xl transition-colors"
            style={{ background: '#FFFFFF', border: '1px solid #EAEAEA' }}
            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.borderColor = '#C8D4F8'}
            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.borderColor = '#EAEAEA'}
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#F0FFF4' }}>
                <GlobeIcon size={14} color="#38A169" />
              </div>
              <div className="text-left">
                <p style={{ color: '#2A2A3E' }} className="text-xs">世界观设定</p>
                <p style={{ color: '#9999B3' }} className="text-xs">
                  {worldSetting.tags.length > 0
                    ? worldSetting.tags.slice(0, 2).join(' · ') + (worldSetting.tags.length > 2 ? '...' : '')
                    : '点击配置'}
                </p>
              </div>
            </div>
            <ExternalLinkIcon size={12} color="#C8C8D8" />
          </button>

          {/* Writing style */}
          <div className="relative">
            <button
              onClick={() => setShowStyleDropdown(!showStyleDropdown)}
              className="w-full flex items-center justify-between px-3.5 py-3 rounded-xl transition-colors"
              style={{ background: '#FFFFFF', border: '1px solid #EAEAEA' }}
              onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.borderColor = '#C8D4F8'}
              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.borderColor = '#EAEAEA'}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#FFF8F0' }}>
                  <FeatherIcon size={14} color="#DD8A3A" />
                </div>
                <div className="text-left">
                  <p style={{ color: '#2A2A3E' }} className="text-xs">文风设定</p>
                  <p style={{ color: '#9999B3' }} className="text-xs">{writingStyle || '未选择'}</p>
                </div>
              </div>
              <ChevronDownIcon size={12} color="#C8C8D8" style={{ transform: showStyleDropdown ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
            </button>

            {showStyleDropdown && (
              <div
                className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl overflow-hidden"
                style={{ background: '#FFFFFF', border: '1px solid #EAEAEA', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}
              >
                {WRITING_STYLES.map((style) => (
                  <button
                    key={style}
                    onClick={() => { onSetWritingStyle(style); setShowStyleDropdown(false); }}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-xs transition-colors"
                    style={{
                      color: style === writingStyle ? '#4A7CF7' : '#3A3A5A',
                      background: style === writingStyle ? '#EEF3FF' : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (style !== writingStyle) (e.currentTarget as HTMLElement).style.background = '#F7F7F8';
                    }}
                    onMouseLeave={(e) => {
                      if (style !== writingStyle) (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }}
                  >
                    <span>{style}</span>
                    {style === writingStyle && (
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#4A7CF7' }} />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Novel Content Section ─── */}
      <div className="flex-1">
        <button
          onClick={() => setContentExpanded(!contentExpanded)}
          className="w-full flex items-center justify-between px-4 py-3.5"
          style={{ borderBottom: '1px solid #F0F0F5' }}
        >
          <span style={{ color: '#1A1A2E' }} className="text-sm">小说成品</span>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onExportAll(); }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors"
              style={{ border: '1px solid #E0E0EA', color: '#6E6E8A', background: 'transparent' }}
              onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#F0F0F5'}
              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              <DownloadIcon size={11} />
              导出
            </button>
            {contentExpanded ? <ChevronDownIcon size={14} color="#9999B3" /> : <ChevronRightIcon size={14} color="#9999B3" />}
          </div>
        </button>

        {contentExpanded && (
          <div className="px-3 py-2 space-y-1">
            {/* Character doc */}
            <button
              onClick={() =>
                onLoadDoc({
                  id: 'characterDoc',
                  type: 'characterDoc',
                  title: '角色世界观文档',
                  content: characterDoc,
                })
              }
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-colors"
              style={{ background: 'transparent' }}
              onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#F0F0F5'}
              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              <FileTextIcon size={14} color="#9999B3" />
              <span style={{ color: '#3A3A5A' }} className="text-xs flex-1 text-left">角色世界观文档</span>
              <span style={{ color: '#C0C0CC' }} className="text-xs">{characterDoc ? '已生成' : '查看'}</span>
            </button>

            {/* Outline */}
            <div>
              <button
                onClick={() => setOutlineExpanded(!outlineExpanded)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-colors"
                style={{ background: 'transparent' }}
                onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#F0F0F5'}
                onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              >
                {outlineExpanded ? (
                  <ChevronDownIcon size={14} color="#9999B3" />
                ) : (
                  <ChevronRightIcon size={14} color="#9999B3" />
                )}
                <BookIcon size={13} color="#9999B3" />
                <span style={{ color: '#3A3A5A' }} className="text-xs flex-1 text-left">故事大纲</span>
                <span style={{ color: '#C0C0CC' }} className="text-xs">{outline ? '已生成' : '未生成'}</span>
              </button>

              {outlineExpanded && (
                <button
                  onClick={() =>
                    onLoadDoc({
                      id: 'outline',
                      type: 'outline',
                      title: '故事大纲',
                      content: outline,
                    })
                  }
                  className="ml-7 w-[calc(100%-1.75rem)] flex items-center gap-2 px-3 py-2 rounded-lg transition-colors"
                  style={{ background: 'transparent' }}
                  onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#EEF3FF'}
                  onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                >
                  <FileTextIcon size={12} color="#4A7CF7" />
                  <span style={{ color: '#4A7CF7' }} className="text-xs">{outline ? '查看 / 编辑大纲' : '新建 / 编辑大纲'}</span>
                </button>
              )}
            </div>

            {/* Chapters */}
            <div>
              <button
                onClick={() => setChaptersExpanded(!chaptersExpanded)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-colors"
                style={{ background: 'transparent' }}
                onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#F0F0F5'}
                onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
              >
                {chaptersExpanded ? (
                  <ChevronDownIcon size={14} color="#9999B3" />
                ) : (
                  <ChevronRightIcon size={14} color="#9999B3" />
                )}
                <BookIcon size={13} color="#9999B3" />
                <span style={{ color: '#3A3A5A' }} className="text-xs flex-1 text-left">小说章节</span>
                <span style={{ color: '#C0C0CC' }} className="text-xs">{chapters.length} 章</span>
              </button>

              {chaptersExpanded && (
                <div className="ml-7 space-y-0.5">
                  {chapters.map((chapter) => (
                    <button
                      key={chapter.id}
                      onClick={() =>
                        onLoadDoc({
                          id: chapter.id,
                          type: 'chapter',
                          title: `第${chapter.number}章：${chapter.title}`,
                          content: chapter.content,
                        })
                      }
                      className="w-[calc(100%-0)] flex items-start gap-2 px-3 py-2.5 rounded-lg transition-colors text-left"
                      style={{ background: 'transparent' }}
                      onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#F5F5F8'}
                      onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                    >
                      <span
                        className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded mt-0.5"
                        style={{ background: '#F0F0F5', color: '#8B8B9E', minWidth: '28px', textAlign: 'center' }}
                      >
                        {chapter.number}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p style={{ color: '#3A3A5A' }} className="text-xs truncate">{chapter.title}</p>
                        <p style={{ color: '#C0C0CC' }} className="text-xs mt-0.5">
                          {(chapter.wordCount / 1000).toFixed(1)}k字
                        </p>
                      </div>
                    </button>
                  ))}

                  {/* Generate next chapter button */}
                  <button
                    onClick={onGenerateChapter}
                    className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg transition-colors"
                    style={{ border: '1px dashed #D0D0DC', color: '#8B8B9E', background: 'transparent', marginTop: '4px' }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = '#F7F7FB';
                      (e.currentTarget as HTMLElement).style.borderColor = '#4A7CF7';
                      (e.currentTarget as HTMLElement).style.color = '#4A7CF7';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                      (e.currentTarget as HTMLElement).style.borderColor = '#D0D0DC';
                      (e.currentTarget as HTMLElement).style.color = '#8B8B9E';
                    }}
                  >
                    <PlusIcon size={13} />
                    <span className="text-xs">生成第 {chapters.length + 1} 章</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Click outside to close style dropdown */}
      {showStyleDropdown && (
        <div className="fixed inset-0 z-10" onClick={() => setShowStyleDropdown(false)} />
      )}
    </div>
  );
}
