import { useEffect, useState } from 'react';
import { EyeIcon, EyeOffIcon, XIcon } from 'lucide-react';
import { ModelSettings } from '../../types';
import { useDialogAccessibility } from '../../hooks/useDialogAccessibility';

interface SettingsModalProps {
  settings: ModelSettings;
  onSave: (settings: ModelSettings) => Promise<void> | void;
  onClose: () => void;
}

export function SettingsModal({ settings, onSave, onClose }: SettingsModalProps) {
  const dialogRef = useDialogAccessibility(onClose);
  const [draft, setDraft] = useState<ModelSettings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [checkMessage, setCheckMessage] = useState('');
  const [checkOk, setCheckOk] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const handleSave = async () => {
    if (!draft.apiKey.trim() || !draft.baseUrl.trim() || !draft.model.trim()) {
      setCheckOk(false);
      setCheckMessage('请先完整填写 Base URL、模型名和 API Key。');
      return;
    }
    if ((draft.maxOutputTokens || 16384) + 8000 >= (draft.contextWindow || 128000)) {
      setCheckOk(false);
      setCheckMessage('单次输出上限过大，请至少为创作资料预留 8000 个容量。');
      return;
    }
    setIsSaving(true);
    setCheckMessage('正在检查连接、中文输出、连续输出和受控动作...');
    try {
      const result = await window.novalAPI.probeModel(draft);
      const nextDraft: ModelSettings = {
        ...draft,
        capabilityStatus: result?.ok ? 'ready' : 'failed',
        capabilityCheckedAt: new Date().toISOString(),
        capabilityMessage: result?.ok ? '模型已通过完整创作能力检查' : result?.error || '模型检查失败'
      };
      setDraft(nextDraft);
      setCheckOk(Boolean(result?.ok));
      setCheckMessage(nextDraft.capabilityMessage || '');
      await onSave(nextDraft);
      if (result?.ok) onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : '模型检查意外中断';
      const failedDraft: ModelSettings = {
        ...draft,
        capabilityStatus: 'failed',
        capabilityCheckedAt: new Date().toISOString(),
        capabilityMessage: message
      };
      setDraft(failedDraft);
      setCheckOk(false);
      setCheckMessage(message);
      await onSave(failedDraft);
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
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-settings-title"
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
            <h2 id="model-settings-title" style={{ color: '#1A1A2E', letterSpacing: '-0.3px' }} className="text-lg">
              模型设置
            </h2>
            <p style={{ color: '#8B8B9E' }} className="text-xs mt-0.5">
              配置后会先检查模型是否能安全完成连续创作任务。检查失败时不会生成模板内容。
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭模型设置"
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
            <label htmlFor="model-provider" style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }} className="text-xs">
              Provider
            </label>
            <input
              id="model-provider"
              value={draft.provider}
              onChange={(e) => setDraft({ ...draft, provider: e.target.value, capabilityStatus: 'unchecked' })}
              placeholder="如：openrouter"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ border: '1.5px solid #E0E0EA', background: '#FAFAFA', color: '#1A1A2E' }}
              onFocus={(e) => (e.target.style.borderColor = '#4A7CF7')}
              onBlur={(e) => (e.target.style.borderColor = '#E0E0EA')}
            />
          </div>

          <div>
            <label htmlFor="model-base-url" style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }} className="text-xs">
              Base URL
            </label>
            <input
              id="model-base-url"
              value={draft.baseUrl}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value, capabilityStatus: 'unchecked' })}
              placeholder="https://openrouter.ai/api/v1"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ border: '1.5px solid #E0E0EA', background: '#FAFAFA', color: '#1A1A2E' }}
              onFocus={(e) => (e.target.style.borderColor = '#4A7CF7')}
              onBlur={(e) => (e.target.style.borderColor = '#E0E0EA')}
            />
          </div>

          <div>
            <label htmlFor="model-name" style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }} className="text-xs">
              Model
            </label>
            <input
              id="model-name"
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value, capabilityStatus: 'unchecked' })}
              placeholder="如：deepseek/deepseek-v4-flash"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ border: '1.5px solid #E0E0EA', background: '#FAFAFA', color: '#1A1A2E' }}
              onFocus={(e) => (e.target.style.borderColor = '#4A7CF7')}
              onBlur={(e) => (e.target.style.borderColor = '#E0E0EA')}
            />
          </div>

          <div>
            <label htmlFor="model-api-key" style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }} className="text-xs">
              API Key
            </label>
            <div className="relative">
              <input
                id="model-api-key"
                type={showKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value, capabilityStatus: 'unchecked' })}
                placeholder="输入可用的 API Key"
                className="w-full px-3 py-2.5 pr-10 rounded-lg text-sm outline-none"
                style={{ border: '1.5px solid #E0E0EA', background: '#FAFAFA', color: '#1A1A2E' }}
                onFocus={(e) => (e.target.style.borderColor = '#4A7CF7')}
                onBlur={(e) => (e.target.style.borderColor = '#E0E0EA')}
              />
              <button
                type="button"
                onClick={() => setShowKey((current) => !current)}
                aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg"
                style={{ color: '#8B8B9E' }}
              >
                {showKey ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
              </button>
            </div>
            <p style={{ color: '#9999B3' }} className="text-xs mt-1.5">
              当前 Key 会以明文保存在本机设置文件中，不会写入项目文件。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="model-context-window" style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }} className="text-xs">
                上下文容量
              </label>
              <input
                id="model-context-window"
                type="number"
                min={8192}
                value={draft.contextWindow || 128000}
                onChange={(e) => setDraft({ ...draft, contextWindow: Number(e.target.value) || 128000, capabilityStatus: 'unchecked' })}
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                style={{ border: '1.5px solid #E0E0EA', background: '#FAFAFA', color: '#1A1A2E' }}
              />
            </div>
            <div>
              <label htmlFor="model-max-output" style={{ color: '#4A4A6A', display: 'block', marginBottom: '6px' }} className="text-xs">
                单次最长输出
              </label>
              <input
                id="model-max-output"
                type="number"
                min={1024}
                value={draft.maxOutputTokens || 16384}
                onChange={(e) => setDraft({ ...draft, maxOutputTokens: Number(e.target.value) || 16384, capabilityStatus: 'unchecked' })}
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                style={{ border: '1.5px solid #E0E0EA', background: '#FAFAFA', color: '#1A1A2E' }}
              />
            </div>
          </div>
          {checkMessage && (
            <div
              role="status"
              className="rounded-lg px-3 py-2.5 text-xs"
              style={{ background: checkOk ? '#E8F7EE' : '#FFF5E8', color: checkOk ? '#1C7C47' : '#8A5A00' }}
            >
              {checkMessage}
            </div>
          )}
        </div>

        <div
          className="flex-shrink-0 flex items-center justify-between px-6 py-4"
          style={{ borderTop: '1px solid #EAEAEA' }}
        >
          <div className="text-xs" style={{ color: '#9999B3' }}>
            {draft.capabilityStatus === 'ready'
              ? '模型已通过检查'
              : draft.apiKey
                ? '保存前需要完成能力检查'
                : '未填写 API Key，创作任务将保持关闭'}
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
              {isSaving ? '检查中...' : '检查并保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
