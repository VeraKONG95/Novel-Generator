import { useState } from 'react';
import { PlusIcon, Trash2Icon, XIcon, UserIcon, CheckIcon } from 'lucide-react';
import { Character } from '../../types';

const PERSONALITY_OPTIONS = [
  '冷静', '热情', '孤僻', '开朗', '敏锐', '迟钝', '执着', '随性',
  '温柔', '强势', '善良', '腹黑', '理性', '感性', '坚韧', '脆弱',
  '神秘', '坦率', '内敛', '外向',
];

const OCCUPATION_OPTIONS = [
  '侦探', '医生', '教师', '律师', '记者', '作家', '艺术家', '商人',
  '学生', '警察', '军人', '厨师', '程序员', '设计师', '自由职业',
];

interface CharacterModalProps {
  characters: Character[];
  onSave: (chars: Character[]) => void;
  onClose: () => void;
}

function generateId() {
  return `char-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createEmpty(): Character {
  return { id: generateId(), name: '', gender: 'male', age: '', occupation: '', personality: [], customNote: '' };
}

export function CharacterModal({ characters, onSave, onClose }: CharacterModalProps) {
  const [chars, setChars] = useState<Character[]>(characters.length > 0 ? characters : [createEmpty()]);
  const [selectedId, setSelectedId] = useState<string>(chars[0]?.id || '');

  const selected = chars.find((c) => c.id === selectedId) || chars[0];

  const updateChar = (field: keyof Character, value: unknown) => {
    setChars(chars.map((c) => c.id === selectedId ? { ...c, [field]: value } : c));
  };

  const togglePersonality = (p: string) => {
    if (!selected) return;
    const current = selected.personality;
    if (current.includes(p)) {
      updateChar('personality', current.filter((x) => x !== p));
    } else {
      updateChar('personality', [...current, p]);
    }
  };

  const addChar = () => {
    const newChar = createEmpty();
    setChars([...chars, newChar]);
    setSelectedId(newChar.id);
  };

  const deleteChar = (id: string) => {
    const remaining = chars.filter((c) => c.id !== id);
    setChars(remaining);
    if (selectedId === id) {
      setSelectedId(remaining[0]?.id || '');
    }
  };

  const handleSave = () => {
    onSave(chars.filter((c) => c.name.trim() !== ''));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(6px)' }}>
      <div
        className="rounded-2xl overflow-hidden flex"
        style={{
          background: '#FFFFFF',
          boxShadow: '0 32px 80px rgba(0,0,0,0.15)',
          width: '760px',
          maxWidth: 'calc(100vw - 32px)',
          height: '560px',
          maxHeight: 'calc(100vh - 64px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: character list */}
        <div className="flex flex-col" style={{ width: '220px', borderRight: '1px solid #EAEAEA', background: '#FAFAFA', flexShrink: 0 }}>
          <div className="px-4 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #EAEAEA' }}>
            <span style={{ color: '#1A1A2E' }} className="text-sm">角色设定</span>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: '#8B8B9E' }}
              onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#EAEAEA'}
              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              <XIcon size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {chars.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-colors text-left group"
                style={{
                  background: selectedId === c.id ? '#EEF3FF' : 'transparent',
                  border: selectedId === c.id ? '1px solid #C5D3F7' : '1px solid transparent',
                }}
                onMouseEnter={(e) => {
                  if (selectedId !== c.id) (e.currentTarget as HTMLElement).style.background = '#F0F0F5';
                }}
                onMouseLeave={(e) => {
                  if (selectedId !== c.id) (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: selectedId === c.id ? '#4A7CF7' : '#E0E0EA' }}
                >
                  <UserIcon size={14} color={selectedId === c.id ? '#FFFFFF' : '#9999B3'} />
                </div>
                <div className="flex-1 min-w-0">
                  <p style={{ color: '#2A2A3E' }} className="text-xs truncate">{c.name || '未命名角色'}</p>
                  <p style={{ color: '#9999B3' }} className="text-xs">{c.occupation || '职业未设定'}</p>
                </div>
                {chars.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteChar(c.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded transition-opacity"
                    onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#FFE4E4'}
                    onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <Trash2Icon size={11} color="#E53E3E" />
                  </button>
                )}
              </button>
            ))}
          </div>
          <div className="p-3" style={{ borderTop: '1px solid #EAEAEA' }}>
            <button
              onClick={addChar}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs transition-colors"
              style={{ border: '1px dashed #C8D4F8', color: '#4A7CF7', background: 'transparent' }}
              onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#EEF3FF'}
              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              <PlusIcon size={12} />
              新建角色
            </button>
          </div>
        </div>

        {/* Right: character details */}
        {selected ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-2 gap-4 mb-5">
                {/* Name */}
                <div className="col-span-2">
                  <label style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }} className="text-xs">姓名</label>
                  <input
                    value={selected.name}
                    onChange={(e) => updateChar('name', e.target.value)}
                    placeholder="角色姓名"
                    className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                    style={{ border: '1.5px solid #E0E0EA', background: '#FAFAFA', color: '#1A1A2E' }}
                    onFocus={(e) => (e.target.style.borderColor = '#4A7CF7')}
                    onBlur={(e) => (e.target.style.borderColor = '#E0E0EA')}
                  />
                </div>

                {/* Gender */}
                <div>
                  <label style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }} className="text-xs">性别</label>
                  <div className="flex gap-2">
                    {(['male', 'female', 'other'] as const).map((g) => {
                      const label = g === 'male' ? '男' : g === 'female' ? '女' : '其他';
                      return (
                        <button
                          key={g}
                          onClick={() => updateChar('gender', g)}
                          className="flex-1 py-2 rounded-lg text-xs transition-colors"
                          style={{
                            border: `1.5px solid ${selected.gender === g ? '#4A7CF7' : '#E0E0EA'}`,
                            background: selected.gender === g ? '#EEF3FF' : '#FAFAFA',
                            color: selected.gender === g ? '#4A7CF7' : '#6E6E8A',
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Age */}
                <div>
                  <label style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }} className="text-xs">年龄</label>
                  <input
                    value={selected.age}
                    onChange={(e) => updateChar('age', e.target.value)}
                    placeholder="如：28"
                    className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                    style={{ border: '1.5px solid #E0E0EA', background: '#FAFAFA', color: '#1A1A2E' }}
                    onFocus={(e) => (e.target.style.borderColor = '#4A7CF7')}
                    onBlur={(e) => (e.target.style.borderColor = '#E0E0EA')}
                  />
                </div>

                {/* Occupation */}
                <div className="col-span-2">
                  <label style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }} className="text-xs">职业</label>
                  <input
                    value={selected.occupation}
                    onChange={(e) => updateChar('occupation', e.target.value)}
                    placeholder="输入职业或从下方选择"
                    list="occ-list"
                    className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                    style={{ border: '1.5px solid #E0E0EA', background: '#FAFAFA', color: '#1A1A2E' }}
                    onFocus={(e) => (e.target.style.borderColor = '#4A7CF7')}
                    onBlur={(e) => (e.target.style.borderColor = '#E0E0EA')}
                  />
                  <datalist id="occ-list">
                    {OCCUPATION_OPTIONS.map((o) => <option key={o} value={o} />)}
                  </datalist>
                </div>
              </div>

              {/* Personality */}
              <div className="mb-5">
                <label style={{ color: '#4A4A6A', display: 'block', marginBottom: '8px' }} className="text-xs">
                  性格特征
                  <span style={{ color: '#9999B3' }} className="ml-1.5 text-xs">（可多选）</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {PERSONALITY_OPTIONS.map((p) => {
                    const isSelected = selected.personality.includes(p);
                    return (
                      <button
                        key={p}
                        onClick={() => togglePersonality(p)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs transition-all"
                        style={{
                          border: `1.5px solid ${isSelected ? '#4A7CF7' : '#E0E0EA'}`,
                          background: isSelected ? '#EEF3FF' : '#FAFAFA',
                          color: isSelected ? '#4A7CF7' : '#6E6E8A',
                        }}
                      >
                        {isSelected && <CheckIcon size={10} />}
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }} className="text-xs">人物备注</label>
                <textarea
                  value={selected.customNote || ''}
                  onChange={(e) => updateChar('customNote', e.target.value)}
                  placeholder="角色背景故事、特殊设定、形象描述等..."
                  rows={4}
                  className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-none"
                  style={{ border: '1.5px solid #E0E0EA', background: '#FAFAFA', color: '#1A1A2E', lineHeight: '1.7' }}
                  onFocus={(e) => (e.target.style.borderColor = '#4A7CF7')}
                  onBlur={(e) => (e.target.style.borderColor = '#E0E0EA')}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 flex items-center justify-end gap-3 px-6 py-4" style={{ borderTop: '1px solid #EAEAEA' }}>
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
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p style={{ color: '#9999B3' }} className="text-sm">请先添加角色</p>
          </div>
        )}
      </div>
    </div>
  );
}
