import { useEffect, useState } from 'react';
import { EyeIcon, EyeOffIcon, XIcon } from 'lucide-react';
import { ModelSettings } from '../../types';

interface SettingsModalProps {
  settings: ModelSettings;
  onSave: (settings: ModelSettings) => Promise<void> | void;
  onClose: () => void;
}

export function SettingsModal({ settings, onSave, onClose }: SettingsModalProps) {
  const [draft, setDraft] = useState<ModelSettings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setIsSaving(false);
    }
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
          width: '560px',
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 64px)'
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid #EAEAEA' }}
        >
          <div>
            <h2 style={{ color: '#1A1A2E', letterSpacing: '-0.3px' }} className="text-lg">
              模型设置
            </h2>
            <p style={{ color: '#8B8B9E' }} className="text-xs mt-0.5">
              配置 API Key、Base URL 和模型名。未配置时会自动回退到本地模板。
            </p>
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

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }} className="text-xs">
              Provider
            </label>
            <input
              value={draft.provider}
              onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
              placeholder="如：openai-compatible"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ border: '1.5px solid #E0E0EA', background: '#FAFAFA', color: '#1A1A2E' }}
              onFocus={(e) => (e.target.style.borderColor = '#4A7CF7')}
              onBlur={(e) => (e.target.style.borderColor = '#E0E0EA')}
            />
          </div>

          <div>
            <label style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }} className="text-xs">
              Base URL
            </label>
            <input
              value={draft.baseUrl}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ border: '1.5px solid #E0E0EA', background: '#FAFAFA', color: '#1A1A2E' }}
              onFocus={(e) => (e.target.style.borderColor = '#4A7CF7')}
              onBlur={(e) => (e.target.style.borderColor = '#E0E0EA')}
            />
          </div>

          <div>
            <label style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }} className="text-xs">
              Model
            </label>
            <input
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              placeholder="如：gpt-4.1-mini"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ border: '1.5px solid #E0E0EA', background: '#FAFAFA', color: '#1A1A2E' }}
              onFocus={(e) => (e.target.style.borderColor = '#4A7CF7')}
              onBlur={(e) => (e.target.style.borderColor = '#E0E0EA')}
            />
          </div>

          <div>
            <label style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }} className="text-xs">
              API Key
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                placeholder="输入可用的 API Key"
                className="w-full px-3 py-2.5 pr-10 rounded-lg text-sm outline-none"
                style={{ border: '1.5px solid #E0E0EA', background: '#FAFAFA', color: '#1A1A2E' }}
                onFocus={(e) => (e.target.style.borderColor = '#4A7CF7')}
                onBlur={(e) => (e.target.style.borderColor = '#E0E0EA')}
              />
              <button
                type="button"
                onClick={() => setShowKey((current) => !current)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg"
                style={{ color: '#8B8B9E' }}
              >
                {showKey ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
              </button>
            </div>
            <p style={{ color: '#9999B3' }} className="text-xs mt-1.5">
              当前 Key 仅保存在本机设置文件中，不会写入项目文件。
            </p>
          </div>
        </div>

        <div
          className="flex-shrink-0 flex items-center justify-between px-6 py-4"
          style={{ borderTop: '1px solid #EAEAEA' }}
        >
          <div className="text-xs" style={{ color: '#9999B3' }}>
            {draft.apiKey ? '已填写 API Key' : '未填写 API Key，将走本地模板回退'}
          </div>
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
              onClick={() => void handleSave()}
              className="px-5 py-2 rounded-lg text-sm transition-colors"
              style={{ background: '#1A1A2E', color: '#FFFFFF' }}
              onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#2E2E4E'}
              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = '#1A1A2E'}
              disabled={isSaving}
            >
              {isSaving ? '保存中...' : '保存设置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
