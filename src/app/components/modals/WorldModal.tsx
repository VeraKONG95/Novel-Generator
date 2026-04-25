import { useState } from 'react';
import { XIcon, CheckIcon } from 'lucide-react';
import { WorldSetting } from '../../types';

const PRESET_TAGS = [
  { group: '时代背景', tags: ['现代都市', '古代历史', '近代民国', '未来科幻', '架空历史', '当代农村'] },
  { group: '世界类型', tags: ['写实世界', '奇幻世界', '科幻世界', '武侠江湖', '仙侠修真', '末世废土'] },
  { group: '核心元素', tags: ['超自然', '悬疑推理', '平行维度', '时间旅行', '魔法体系', '机甲科技'] },
  { group: '情感基调', tags: ['宿命', '轮回', '救赎', '孤独', '反乌托邦', '成长蜕变'] },
];

interface WorldModalProps {
  worldSetting: WorldSetting;
  onSave: (setting: WorldSetting) => void;
  onClose: () => void;
}

export function WorldModal({ worldSetting, onSave, onClose }: WorldModalProps) {
  const [tags, setTags] = useState<string[]>(worldSetting.tags);
  const [customText, setCustomText] = useState(worldSetting.customText);

  const toggleTag = (tag: string) => {
    if (tags.includes(tag)) {
      setTags(tags.filter((t) => t !== tag));
    } else {
      setTags([...tags, tag]);
    }
  };

  const handleSave = () => {
    onSave({ tags, customText });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: '#FFFFFF',
          boxShadow: '0 32px 80px rgba(0,0,0,0.15)',
          width: '600px',
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 64px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid #EAEAEA' }}>
          <div>
            <h2 style={{ color: '#1A1A2E', letterSpacing: '-0.3px' }} className="text-lg">世界观设定</h2>
            <p style={{ color: '#8B8B9E' }} className="text-xs mt-0.5">选择预设标签，或自由撰写详细的世界观规则</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors"
            style={{ color: '#8B8B9E' }}
            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#F0F0F5'}
            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Selected tags */}
          {tags.length > 0 && (
            <div>
              <p style={{ color: '#4A4A6A' }} className="text-xs mb-2">已选标签</p>
              <div className="flex flex-wrap gap-2">
                {tags.map((t) => (
                  <button
                    key={t}
                    onClick={() => toggleTag(t)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
                    style={{ background: '#EEF3FF', color: '#4A7CF7', border: '1.5px solid #C5D3F7' }}
                  >
                    <CheckIcon size={10} />
                    {t}
                    <XIcon size={9} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Preset tag groups */}
          {PRESET_TAGS.map(({ group, tags: groupTags }) => (
            <div key={group}>
              <p style={{ color: '#8B8B9E' }} className="text-xs mb-2.5">{group}</p>
              <div className="flex flex-wrap gap-2">
                {groupTags.map((tag) => {
                  const isSelected = tags.includes(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className="px-3 py-1.5 rounded-lg text-xs transition-all"
                      style={{
                        border: `1.5px solid ${isSelected ? '#4A7CF7' : '#E0E0EA'}`,
                        background: isSelected ? '#EEF3FF' : '#FAFAFA',
                        color: isSelected ? '#4A7CF7' : '#6E6E8A',
                      }}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Custom text */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p style={{ color: '#4A4A6A' }} className="text-xs">自定义世界观描述</p>
              <p style={{ color: '#C0C0CC' }} className="text-xs">{customText.length} 字</p>
            </div>
            <textarea
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="详细描述您的世界观规则、地理环境、历史背景、特殊规则等。无字数限制，越详细 AI 生成的内容越符合您的预期..."
              rows={8}
              className="w-full px-4 py-3 rounded-xl outline-none resize-none text-sm"
              style={{
                border: '1.5px solid #E0E0EA',
                background: '#FAFAFA',
                color: '#2A2A3E',
                lineHeight: '1.8',
              }}
              onFocus={(e) => (e.target.style.borderColor = '#4A7CF7')}
              onBlur={(e) => (e.target.style.borderColor = '#E0E0EA')}
            />
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex-shrink-0 flex items-center justify-between px-6 py-4"
          style={{ borderTop: '1px solid #EAEAEA' }}
        >
          <p style={{ color: '#C0C0CC' }} className="text-xs">设定将在下次 AI 生成时自动应用</p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm transition-colors"
              style={{ border: '1.5px solid #E0E0EA', color: '#6E6E8A', background: 'transparent' }}
              onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#F7F7F8'}
              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-2 rounded-lg text-sm transition-colors"
              style={{ background: '#1A1A2E', color: '#FFFFFF' }}
              onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#2E2E4E'}
              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = '#1A1A2E'}
            >
              保存设定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
