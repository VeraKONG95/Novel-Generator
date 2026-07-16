import { useState } from 'react';
import { MessageCircleIcon, PencilIcon, SearchIcon, ChevronDownIcon, ChevronRightIcon, PlusIcon } from 'lucide-react';
import { Conversation } from '../../types';

interface LeftPanelProps {
  conversations: Conversation[];
  selectedConvId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
}

function formatTime(ts: string) {
  const normalized = new Date(ts);
  if (!Number.isNaN(normalized.getTime())) {
    return normalized.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  const parts = ts.split(' ');
  if (parts.length === 2) return parts[1];
  return ts;
}

function formatDate(ts: string) {
  const parts = ts.split(' ');
  return parts[0] || ts;
}

function groupConversations(conversations: Conversation[]) {
  const today: Conversation[] = [];
  const older: Conversation[] = [];
  const now = new Date();
  conversations.forEach((c) => {
    const d = new Date(c.timestamp);
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) today.push(c);
    else older.push(c);
  });
  return { today, older };
}

export function LeftPanel({ conversations, selectedConvId, onSelectConversation, onNewConversation }: LeftPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [olderExpanded, setOlderExpanded] = useState(true);

  const filtered = searchQuery
    ? conversations.filter(
        (c) =>
          c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.preview.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : conversations;

  const { today, older } = groupConversations(filtered);

  const renderConvItem = (conv: Conversation) => {
    const isSelected = selectedConvId === conv.id;
    const isMod = conv.type === 'modification';
    const isTask = conv.type === 'task' || conv.type === 'review';
    const statusText = conv.status === 'awaiting_confirmation'
      ? conv.resultKind === 'question' || conv.resultKind === 'conflict' ? '等待回复' : '写入暂停'
      : conv.status === 'completed'
        ? '已完成'
        : conv.status === 'failed'
          ? '失败'
          : conv.status === 'stopped'
            ? '已停止'
            : conv.status === 'interrupted'
              ? '意外中断'
              : conv.status === 'rejected'
                ? '已拒绝'
                : conv.status === 'abandoned'
                  ? '已放弃'
                : conv.status
                  ? '处理中'
                  : '';

    return (
      <button
        key={conv.id}
        onClick={() => onSelectConversation(conv.id)}
        className="w-full text-left rounded-lg px-3 py-2.5 transition-all group relative"
        style={{
          background: isSelected
            ? isMod
              ? '#E8EFFF'
              : '#F0F0F5'
            : 'transparent',
          borderLeft: isMod || isTask ? `3px solid ${isSelected ? '#4A7CF7' : '#C5D3F7'}` : '3px solid transparent',
          marginLeft: '-3px',
        }}
        onMouseEnter={(e) => {
          if (!isSelected) {
            (e.currentTarget as HTMLElement).style.background = isMod ? '#EEF3FF' : '#F5F5F8';
          }
        }}
        onMouseLeave={(e) => {
          if (!isSelected) {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
          }
        }}
      >
        <div className="flex items-start gap-2">
          <div
            className="mt-0.5 flex-shrink-0 rounded-full flex items-center justify-center"
            style={{
              width: '20px',
              height: '20px',
              background: isMod || isTask ? '#4A7CF7' : '#D0D0DC',
            }}
          >
            {isMod || isTask ? (
              <PencilIcon size={10} color="#FFFFFF" />
            ) : (
              <MessageCircleIcon size={10} color="#FFFFFF" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1">
              <span
                className="text-xs truncate"
                style={{ color: isSelected ? '#1A1A2E' : '#3A3A5A', fontWeight: isSelected ? '500' : '400' }}
              >
                {conv.title}
              </span>
              <span style={{ color: '#9999B3', flexShrink: 0 }} className="text-xs">
                {formatTime(conv.timestamp)}
              </span>
            </div>
            <p className="text-xs mt-0.5 truncate" style={{ color: '#8B8B9E' }}>
              {conv.preview}
            </p>
            {(isMod || isTask) && (
              <span
                className="inline-block mt-1 px-1.5 py-0.5 rounded text-xs"
                style={{ background: '#EEF3FF', color: '#4A7CF7' }}
              >
                {isMod ? `修改任务${statusText ? ` · ${statusText}` : ''}` : conv.type === 'review' ? `独立评审${statusText ? ` · ${statusText}` : ''}` : statusText || 'AI 处理中'}
              </span>
            )}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div
      className="flex flex-col h-full"
      style={{ borderRight: '1px solid #EAEAEA', background: '#FAFAFA' }}
    >
      {/* Panel header */}
      <div className="flex-shrink-0 px-4 py-3.5" style={{ borderBottom: '1px solid #EAEAEA' }}>
        <div className="flex items-center justify-between mb-0">
          <span style={{ color: '#1A1A2E' }} className="text-sm">对话</span>
          <div className="flex items-center gap-1">
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{ background: '#F0F0F5', color: '#8B8B9E' }}
            >
              {conversations.length}
            </span>
            <button
              onClick={() => setShowSearch(!showSearch)}
              aria-label={showSearch ? '关闭对话搜索' : '搜索对话记录'}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: '#8B8B9E' }}
              onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = '#EAEAEA'}
              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
            >
              <SearchIcon size={13} />
            </button>
          </div>
        </div>

        <button
          onClick={onNewConversation}
          className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs"
          style={{ background: '#1A1A2E', color: '#FFFFFF' }}
        >
          <PlusIcon size={13} />
          新建对话
        </button>

        {/* Search input */}
        {showSearch && (
          <div className="mt-2.5">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索对话记录..."
              className="w-full px-3 py-1.5 rounded-lg text-xs outline-none"
              style={{
                border: '1.5px solid #E0E0EA',
                background: '#FFFFFF',
                color: '#1A1A2E',
              }}
              onFocus={(e) => (e.target.style.borderColor = '#4A7CF7')}
              onBlur={(e) => (e.target.style.borderColor = '#E0E0EA')}
              autoFocus
            />
          </div>
        )}
      </div>

      {/* Conversations list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <MessageCircleIcon size={24} color="#C8C8D8" />
            <p style={{ color: '#9999B3' }} className="text-xs text-center">暂无对话记录</p>
          </div>
        ) : (
          <>
            {today.length > 0 && (
              <div>
                <p style={{ color: '#9999B3' }} className="text-xs px-3 py-1.5">今天</p>
                <div className="space-y-0.5">{today.map(renderConvItem)}</div>
              </div>
            )}
            {older.length > 0 && (
              <div className="mt-2">
                <button
                  onClick={() => setOlderExpanded(!olderExpanded)}
                  className="flex items-center gap-1 px-3 py-1.5 w-full"
                  style={{ color: '#9999B3' }}
                >
                  {olderExpanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                  <span className="text-xs">早期记录</span>
                </button>
                {olderExpanded && (
                  <div className="space-y-0.5">{older.map(renderConvItem)}</div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
