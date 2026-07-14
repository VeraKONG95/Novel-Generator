import { useEffect, useRef, useState } from 'react';
import {
  CheckIcon,
  FileTextIcon,
  PaperclipIcon,
  SendIcon,
  SparklesIcon,
  SquareIcon,
  UserIcon,
  XIcon
} from 'lucide-react';
import { ActiveDoc, Conversation, Message } from '../../types';

interface MiddlePanelProps {
  selectedConversation: Conversation | null;
  activeDoc: ActiveDoc | null;
  isGenerating: boolean;
  onSendMessage: (text: string) => void;
  onPinProposal: (messageId: string) => void | Promise<void>;
  onContinueProposal: (messageId: string) => void | Promise<void>;
  onRejectProposal: (messageId: string) => void | Promise<void>;
  onResolveConflict: (choice: 'keep' | 'accept' | 'cancel') => void | Promise<void>;
  onCreateRevisionFromReview: () => void | Promise<void>;
  onStopTask: () => void | Promise<void>;
  onRetryTask: () => void | Promise<void>;
  onAbandonTask: () => void | Promise<void>;
  onCloseDoc: () => void;
}

function statusText(status?: string) {
  const labels: Record<string, string> = {
    awaiting_confirmation: '等待确认', completed: '已完成', failed: '失败', stopped: '已停止',
    interrupted: '意外中断', rejected: '已拒绝', abandoned: '已放弃', queued: '准备中',
    reading: '读取资料', planning: '正在规划', executing: '正在生成'
  };
  return status ? labels[status] || '处理中' : '';
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 mb-4">
      <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center" style={{ background: '#1A1A2E' }}>
        <SparklesIcon size={13} color="#FFFFFF" />
      </div>
      <div className="px-3.5 py-2.5 rounded-2xl rounded-tl-sm flex gap-1" style={{ background: '#F3F3F7' }}>
        {[0, 150, 300].map((delay) => <span key={delay} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#8B8B9E', animationDelay: `${delay}ms` }} />)}
      </div>
    </div>
  );
}

function MessageBubble({ msg, onPinProposal, onContinueProposal, onRejectProposal }: {
  msg: Message;
  onPinProposal: (messageId: string) => void | Promise<void>;
  onContinueProposal: (messageId: string) => void | Promise<void>;
  onRejectProposal: (messageId: string) => void | Promise<void>;
}) {
  const isUser = msg.role === 'user';
  const changes = msg.proposal?.changes || [];
  return (
    <div className={`flex items-start gap-3 mb-4 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center" style={{ background: isUser ? '#4A7CF7' : '#1A1A2E' }}>
        {isUser ? <UserIcon size={13} color="#FFFFFF" /> : <SparklesIcon size={13} color="#FFFFFF" />}
      </div>
      <div className="max-w-[82%] min-w-0">
        <div className="px-3.5 py-2.5 rounded-2xl text-sm" style={{
          background: isUser ? '#4A7CF7' : '#F3F3F7', color: isUser ? '#FFFFFF' : '#2A2A3E',
          borderTopRightRadius: isUser ? '4px' : '16px', borderTopLeftRadius: isUser ? '16px' : '4px',
          lineHeight: 1.65, whiteSpace: 'pre-wrap'
        }}>{msg.content}</div>
        {msg.role === 'ai' && msg.proposal && (
          <div className="mt-2 rounded-xl p-3" style={{ border: '1px solid #E0E0EA', background: '#FFFFFF' }}>
            <p className="text-xs" style={{ color: '#4A4A6A' }}>{msg.proposal.summary || msg.proposal.docTitle}</p>
            {changes.length > 0 && (
              <div className="mt-2 space-y-1">
                {changes.map((change) => (
                  <div key={`${change.action}-${change.path}`} className="flex items-center gap-2 text-xs" style={{ color: '#6E6E8A' }}>
                    <span className="px-1.5 py-0.5 rounded" style={{ background: change.action === 'delete' ? '#FFF1F0' : change.action === 'create' ? '#EAF8F1' : '#EEF3FF', color: change.action === 'delete' ? '#B42318' : change.action === 'create' ? '#176B43' : '#2E5BD1' }}>
                      {change.action === 'delete' ? '删除' : change.action === 'create' ? '新建' : '修改'}
                    </span>
                    <span className="truncate">{change.path}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => void onPinProposal(msg.id)}
                disabled={msg.proposal.status !== 'pending'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
                style={{ background: msg.proposal.status === 'pinned' ? '#E8F7EE' : msg.proposal.status === 'rejected' ? '#F0F0F5' : '#1A1A2E', color: msg.proposal.status === 'pinned' ? '#1C7C47' : msg.proposal.status === 'rejected' ? '#8B8B9E' : '#FFFFFF' }}
              >
                <CheckIcon size={12} />
                {msg.proposal.status === 'pinned' ? '已写入文件' : msg.proposal.status === 'rejected' ? '已拒绝' : '确认写入'}
              </button>
              {msg.proposal.status === 'pending' && <button onClick={() => void onContinueProposal(msg.id)} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: '1px solid #B8C7F5', color: '#2E5BD1' }}>继续修改</button>}
              {msg.proposal.status === 'pending' && <button onClick={() => void onRejectProposal(msg.id)} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: '1px solid #D8D8E8', color: '#6E6E8A' }}>拒绝</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function MiddlePanel(props: MiddlePanelProps) {
  const { selectedConversation, activeDoc, isGenerating, onSendMessage, onPinProposal, onContinueProposal,
    onRejectProposal, onResolveConflict, onCreateRevisionFromReview, onStopTask, onRetryTask, onAbandonTask, onCloseDoc } = props;
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [selectedConversation?.messages, isGenerating]);

  const send = () => {
    if (!inputText.trim() || isGenerating) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  return (
    <div className="flex flex-col h-full" style={{ background: '#FFFFFF' }}>
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid #EAEAEA', background: '#FAFAFA' }}>
        <div className="min-w-0">
          <p className="text-sm truncate" style={{ color: '#1A1A2E' }}>{selectedConversation?.title || '新对话'}</p>
          <p className="text-xs mt-0.5" style={{ color: '#9999B3' }}>{selectedConversation ? statusText(selectedConversation.status) || '继续和 AI 讨论这个项目' : '说说你接下来想创作或修改什么'}</p>
        </div>
        {activeDoc && <span className="text-xs px-2 py-1 rounded-lg truncate max-w-[44%]" style={{ background: '#EEF3FF', color: '#2E5BD1' }}>已关联 {activeDoc.path || activeDoc.title}</span>}
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto min-w-0">
          {!selectedConversation ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 px-8">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#F0F0F5' }}><SparklesIcon size={24} color="#9999B3" /></div>
              <div className="text-center">
                <p className="text-base" style={{ color: '#3A3A5A' }}>开始一段新对话</p>
                <p className="text-sm mt-1.5 max-w-sm leading-relaxed" style={{ color: '#9999B3' }}>直接告诉 AI 你想写什么、改什么或检查什么。需要的信息，它会在对话里继续问你。</p>
              </div>
            </div>
          ) : (
            <div className="p-5" aria-live="polite" aria-busy={isGenerating}>
              {selectedConversation.messages.map((msg) => <MessageBubble key={msg.id} msg={msg} onPinProposal={onPinProposal} onContinueProposal={onContinueProposal} onRejectProposal={onRejectProposal} />)}
              {selectedConversation.status === 'awaiting_confirmation' && selectedConversation.resultKind === 'conflict' && (
                <div className="ml-10 mt-2 flex flex-wrap gap-2">
                  <button onClick={() => void onResolveConflict('keep')} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: '#1A1A2E', color: '#FFFFFF' }}>保持原方向</button>
                  <button onClick={() => void onResolveConflict('accept')} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: '1px solid #B8C7F5', color: '#2E5BD1' }}>接受新方向</button>
                  <button onClick={() => void onResolveConflict('cancel')} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: '1px solid #D8D8E8', color: '#6E6E8A' }}>取消</button>
                </div>
              )}
              {selectedConversation.type === 'review' && selectedConversation.status === 'completed' && <div className="ml-10 mt-2"><button onClick={() => void onCreateRevisionFromReview()} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: '#1A1A2E', color: '#FFFFFF' }}>按问题继续修改</button></div>}
              {['failed', 'stopped', 'interrupted'].includes(selectedConversation.status || '') && <div className="ml-10 mt-2 flex gap-2"><button onClick={() => void onRetryTask()} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: '#1A1A2E', color: '#FFFFFF' }}>重新执行</button><button onClick={() => void onAbandonTask()} className="px-3 py-1.5 rounded-lg text-xs" style={{ border: '1px solid #D8D8E8', color: '#6E6E8A' }}>放弃</button></div>}
              {isGenerating && <TypingIndicator />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {activeDoc && (
          <aside className="w-[42%] min-w-[300px] max-w-[520px] flex flex-col" style={{ borderLeft: '1px solid #EAEAEA', background: '#FCFCFD' }}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #EAEAEA' }}>
              <div className="min-w-0"><p className="text-xs truncate" style={{ color: '#3A3A5A' }}>{activeDoc.path || activeDoc.title}</p><p className="text-xs mt-0.5" style={{ color: '#9999B3' }}>只读预览</p></div>
              <button onClick={onCloseDoc} aria-label="关闭文件预览" className="p-1.5 rounded-lg" style={{ color: '#8B8B9E' }}><XIcon size={14} /></button>
            </div>
            <pre className="flex-1 overflow-auto p-5 text-sm whitespace-pre-wrap" style={{ color: '#2A2A3E', lineHeight: 1.8, fontFamily: activeDoc.path?.endsWith('.json') || activeDoc.path?.endsWith('.jsonl') ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : "'Noto Serif SC', 'STSong', serif" }}>{activeDoc.content || '文件为空'}</pre>
          </aside>
        )}
      </div>

      <div className="flex-shrink-0 p-4" style={{ borderTop: '1px solid #EAEAEA' }}>
        {isGenerating && <div className="mb-3 flex items-center justify-between rounded-lg px-3 py-2" style={{ background: '#EEF3FF', color: '#2E5BD1' }}><span className="text-xs">AI 正在处理，暂时不能追加要求。</span><button onClick={() => void onStopTask()} className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs" style={{ background: '#FFFFFF', color: '#B42318', border: '1px solid #F0B7B2' }}><SquareIcon size={10} fill="currentColor" />停止</button></div>}
        {activeDoc && <div className="mb-2 flex items-center gap-2"><span className="inline-flex max-w-full items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs" style={{ background: '#EEF3FF', color: '#2E5BD1' }}><PaperclipIcon size={11} /><span className="truncate">{activeDoc.path || activeDoc.title}</span><button onClick={onCloseDoc} aria-label="移除关联文件"><XIcon size={11} /></button></span></div>}
        <div className="flex items-end gap-2.5 rounded-xl px-4 py-3" style={{ border: '1.5px solid #E0E0EA', background: '#FAFAFA' }}>
          <textarea aria-label="创作要求" disabled={isGenerating} value={inputText} onChange={(event) => setInputText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder={activeDoc ? `针对「${activeDoc.path || activeDoc.title}」提出要求…` : '输入创作要求或问题（Enter 发送，Shift+Enter 换行）'} rows={2} className="flex-1 outline-none resize-none text-sm" style={{ background: 'transparent', color: '#2A2A3E', lineHeight: 1.6, maxHeight: '120px' }} />
          <button onClick={send} disabled={!inputText.trim() || isGenerating} aria-label="发送" className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: inputText.trim() && !isGenerating ? '#1A1A2E' : '#E0E0EA', cursor: inputText.trim() && !isGenerating ? 'pointer' : 'not-allowed' }}><SendIcon size={14} color={inputText.trim() && !isGenerating ? '#FFFFFF' : '#9999B3'} /></button>
        </div>
        <p className="text-xs mt-2" style={{ color: '#C0C0CC' }}>创作成果确认后才会写入项目文件</p>
      </div>
    </div>
  );
}
