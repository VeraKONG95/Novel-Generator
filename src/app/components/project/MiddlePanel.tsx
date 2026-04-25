import { useState, useRef, useEffect } from 'react';
import { SendIcon, PinIcon, XIcon, SparklesIcon, UserIcon } from 'lucide-react';
import { Conversation, Message, ActiveDoc } from '../../types';

interface MiddlePanelProps {
  selectedConversation: Conversation | null;
  activeDoc: ActiveDoc | null;
  isGenerating: boolean;
  onSendMessage: (text: string) => void;
  onPinProposal: (messageId: string) => void | Promise<void>;
  onCloseDoc: () => void;
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center" style={{ background: '#1A1A2E' }}>
        <SparklesIcon size={13} color="#FFFFFF" />
      </div>
      <div className="px-3.5 py-2.5 rounded-2xl rounded-tl-sm" style={{ background: '#F3F3F7' }}>
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#8B8B9E', animationDelay: '0ms' }} />
          <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#8B8B9E', animationDelay: '150ms' }} />
          <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#8B8B9E', animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  msg,
  onPinProposal
}: {
  msg: Message;
  onPinProposal?: (messageId: string) => void | Promise<void>;
}) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex items-start gap-3 mb-4 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center"
        style={{ background: isUser ? '#4A7CF7' : '#1A1A2E' }}
      >
        {isUser ? <UserIcon size={13} color="#FFFFFF" /> : <SparklesIcon size={13} color="#FFFFFF" />}
      </div>
      <div
        className="max-w-[80%]"
      >
        <div
          className="px-3.5 py-2.5 rounded-2xl text-sm"
        style={{
          background: isUser ? '#4A7CF7' : '#F3F3F7',
          color: isUser ? '#FFFFFF' : '#2A2A3E',
          borderTopRightRadius: isUser ? '4px' : '16px',
          borderTopLeftRadius: isUser ? '16px' : '4px',
          lineHeight: '1.65',
          whiteSpace: 'pre-wrap',
        }}
        >
          {msg.content}
        </div>
        {msg.role === 'ai' && msg.proposal && (
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => void onPinProposal?.(msg.id)}
              disabled={msg.proposal.status === 'pinned'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
              style={{
                background: msg.proposal.status === 'pinned' ? '#E8F7EE' : '#1A1A2E',
                color: msg.proposal.status === 'pinned' ? '#1C7C47' : '#FFFFFF',
                cursor: msg.proposal.status === 'pinned' ? 'default' : 'pointer'
              }}
            >
              <PinIcon size={12} />
              {msg.proposal.status === 'pinned' ? '已 Pin 到成品区' : 'Pin 到右侧成品区'}
            </button>
            <span style={{ color: '#9999B3' }} className="text-xs">
              {msg.proposal.docTitle}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function MiddlePanel({
  selectedConversation,
  activeDoc,
  isGenerating,
  onSendMessage,
  onPinProposal,
  onCloseDoc,
}: MiddlePanelProps) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedConversation?.messages, isGenerating]);

  const handleSend = () => {
    if (!inputText.trim() || isGenerating) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const docTypeLabel = activeDoc
    ? activeDoc.type === 'outline'
      ? '故事大纲'
      : activeDoc.type === 'characterDoc'
      ? '角色文档'
      : `第${activeDoc.id.replace('chapter-', '')}章`
    : '';

  return (
    <div className="flex flex-col h-full" style={{ background: '#FFFFFF' }}>
      {/* Document toolbar */}
      {activeDoc && (
        <div
          className="flex-shrink-0 flex items-center justify-between px-5 py-3"
          style={{ borderBottom: '1px solid #EAEAEA', background: '#FAFAFA' }}
        >
          <div className="flex items-center gap-2">
            <span
              className="px-2 py-0.5 rounded text-xs"
              style={{ background: '#EEF3FF', color: '#4A7CF7' }}
            >
              {docTypeLabel}
            </span>
            <span style={{ color: '#1A1A2E' }} className="text-sm">{activeDoc.title}</span>
          </div>
          <div className="flex items-center gap-2">
            <span style={{ color: '#9999B3' }} className="text-xs">
              成品预览
            </span>
            <button
              onClick={onCloseDoc}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: '#8B8B9E' }}
              onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#F0F0F5'}
              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              <XIcon size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Conversation toolbar (when no doc) */}
      {!activeDoc && selectedConversation && (
        <div
          className="flex-shrink-0 flex items-center px-5 py-3"
          style={{ borderBottom: '1px solid #EAEAEA', background: '#FAFAFA' }}
        >
          <div className="flex items-center gap-2">
            {selectedConversation.type === 'modification' && (
              <span className="px-2 py-0.5 rounded text-xs" style={{ background: '#EEF3FF', color: '#4A7CF7' }}>
                修改类对话
              </span>
            )}
            <span style={{ color: '#3A3A5A' }} className="text-sm">{selectedConversation.title}</span>
          </div>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {/* Empty state */}
        {!activeDoc && !selectedConversation && (
          <div className="h-full flex flex-col items-center justify-center gap-4 px-8">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: '#F0F0F5' }}
            >
              <SparklesIcon size={24} color="#9999B3" />
            </div>
            <div className="text-center">
              <p style={{ color: '#3A3A5A' }} className="text-base">开始创作对话</p>
              <p style={{ color: '#9999B3' }} className="text-sm mt-1.5 max-w-xs leading-relaxed">
                在下方输入您的创作指令，或从右侧选择文档在此处查看与编辑
              </p>
            </div>
            <div className="flex flex-wrap gap-2 mt-2 justify-center">
              {['帮我生成故事大纲', '基于当前设定生成第一章', '分析角色关系'].map((hint) => (
                <button
                  key={hint}
                  onClick={() => setInputText(hint)}
                  className="px-3 py-1.5 rounded-lg text-xs transition-colors"
                  style={{ border: '1px solid #E0E0EA', color: '#6E6E8A', background: '#FAFAFA' }}
                  onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#F0F0F5'}
                  onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = '#FAFAFA'}
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Document view */}
        {activeDoc && (
          <div className="p-6">
            <div
              className="mb-4 rounded-xl px-4 py-3"
              style={{ background: '#F7F7F8', border: '1px solid #EAEAEA' }}
            >
              <p style={{ color: '#4A4A6A' }} className="text-xs">
                这里展示的是当前成品区内容。要修改它，请在下方输入修改要求，系统会生成一条“修改类对话”，确认后再用气泡下方的 `Pin` 写回右侧成品区。
              </p>
            </div>
            <div
              className="text-sm"
              style={{
                color: '#2A2A3E',
                lineHeight: '1.9',
                whiteSpace: 'pre-wrap',
                fontFamily: "'Noto Serif SC', 'STSong', 'SimSun', serif",
              }}
            >
              {activeDoc.content}
            </div>
          </div>
        )}

        {/* Conversation messages */}
        {selectedConversation && !activeDoc && (
          <div className="p-5">
            {selectedConversation.type === 'modification' && (
              <div
                className="mb-4 rounded-xl px-4 py-3"
                style={{ background: '#F7F7F8', border: '1px solid #EAEAEA' }}
              >
                <p style={{ color: '#4A4A6A' }} className="text-xs">
                  当前是修改类对话。这里保留你的修改迭代记录；当你确认某一版后，直接点对应 AI 气泡下方的 `Pin`，就会把那一版写回右侧成品区。
                </p>
              </div>
            )}
            {selectedConversation.messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} onPinProposal={onPinProposal} />
            ))}
            {isGenerating && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 p-4" style={{ borderTop: '1px solid #EAEAEA' }}>
        {activeDoc && (
          <p className="text-xs mb-2.5" style={{ color: '#9999B3' }}>
            {activeDoc.type === 'characterDoc'
              ? '您可以询问 AI 关于角色的任何问题'
              : `针对「${activeDoc.title}」的修改要求会生成到左侧“修改类对话记录”，确认后再 Pin 回成品区`}
          </p>
        )}
        {!activeDoc && selectedConversation?.type === 'modification' && (
          <p className="text-xs mb-2.5" style={{ color: '#9999B3' }}>
            继续描述你想怎么改，系统会在当前修改类对话里迭代出新版本；满意后直接在 AI 气泡下方 Pin 到右侧成品区。
          </p>
        )}
        <div
          className="flex items-end gap-2.5 rounded-xl px-4 py-3"
          style={{ border: '1.5px solid #E0E0EA', background: '#FAFAFA' }}
          onFocus={(e) => {
            const parent = e.currentTarget as HTMLElement;
            parent.style.borderColor = '#4A7CF7';
            parent.style.boxShadow = '0 0 0 3px rgba(74,124,247,0.08)';
          }}
          onBlur={(e) => {
            const parent = e.currentTarget as HTMLElement;
            parent.style.borderColor = '#E0E0EA';
            parent.style.boxShadow = 'none';
          }}
        >
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              activeDoc
                ? `对「${activeDoc.title}」提出修改建议，或直接询问...`
                : selectedConversation?.type === 'modification'
                  ? '继续描述你希望怎么修改这版内容（Enter 发送，Shift+Enter 换行）'
                  : '输入创作指令、提问或修改意见（Enter 发送，Shift+Enter 换行）'
            }
            rows={2}
            className="flex-1 outline-none resize-none text-sm"
            style={{
              background: 'transparent',
              color: '#2A2A3E',
              lineHeight: '1.6',
              maxHeight: '120px',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim() || isGenerating}
            className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all"
            style={{
              background: inputText.trim() && !isGenerating ? '#1A1A2E' : '#E0E0EA',
              cursor: inputText.trim() && !isGenerating ? 'pointer' : 'not-allowed',
            }}
          >
            <SendIcon size={14} color={inputText.trim() && !isGenerating ? '#FFFFFF' : '#9999B3'} />
          </button>
        </div>
        <p className="text-xs mt-2" style={{ color: '#C0C0CC' }}>
          AI 生成内容仅供参考，请结合自身创作判断
        </p>
      </div>
    </div>
  );
}
