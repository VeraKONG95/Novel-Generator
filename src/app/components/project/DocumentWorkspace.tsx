import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileDiffIcon,
  FileTextIcon,
  Maximize2Icon,
  Minimize2Icon,
  NetworkIcon,
  XIcon
} from 'lucide-react';
import { ActiveDoc, FileChange, PiTask } from '../../types';
import { buildDiffHunks, countDiffChanges } from '../../lib/diff';
import { GraphWorkspace } from '../analysis/GraphWorkspace';
import { AnalysisEvidenceRef, AnalysisGraph } from '../../lib/analysis';

interface DocumentWorkspaceProps {
  documents: ActiveDoc[];
  activeTabId: string;
  diffTask: PiTask | null;
  graph?: AnalysisGraph | null;
  onOpenEvidence?: (reference: AnalysisEvidenceRef) => void | Promise<void>;
  onSelectTab: (tabId: string) => void;
  onCloseDocument: (documentId: string) => void;
}

function actionLabel(action: FileChange['action']) {
  if (action === 'create') return '新增';
  if (action === 'delete') return '删除';
  return '修改';
}

function DiffFile({ change }: { change: FileChange }) {
  const afterContent = change.action === 'delete' ? '' : change.content || '';
  const beforeContent = change.action === 'create' ? '' : change.beforeContent || '';
  const hunks = useMemo(() => buildDiffHunks(beforeContent, afterContent), [beforeContent, afterContent]);
  const counts = useMemo(() => countDiffChanges(beforeContent, afterContent), [beforeContent, afterContent]);

  return (
    <div className="min-w-0 flex-1 overflow-auto" data-testid="diff-content">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 px-5 py-3" style={{ background: '#FCFCFD', borderBottom: '1px solid #E7E7EE' }}>
        <div className="min-w-0">
          <p className="truncate text-xs" style={{ color: '#2A2A3E', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{change.path}</p>
          {change.reason && <p className="mt-1 truncate text-xs" style={{ color: '#8B8B9E' }}>{change.reason}</p>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2 text-xs" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          <span style={{ color: '#18864B' }}>+{counts.additions}</span>
          <span style={{ color: '#C23B32' }}>−{counts.deletions}</span>
        </div>
      </div>
      <div className="py-3" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', lineHeight: 1.65 }}>
        {hunks.length ? hunks.map((hunk, hunkIndex) => (
          <section key={`${hunk.header}-${hunkIndex}`} className="mb-4">
            <div className="px-4 py-1.5" style={{ background: '#EDF3FF', color: '#5770A6', borderTop: '1px solid #DCE6FA', borderBottom: '1px solid #DCE6FA' }}>
              {hunk.header}
            </div>
            {hunk.lines.map((line, lineIndex) => {
              const background = line.type === 'add' ? '#EAF7EF' : line.type === 'remove' ? '#FFF0EE' : '#FFFFFF';
              const signColor = line.type === 'add' ? '#18864B' : line.type === 'remove' ? '#C23B32' : '#A0A0B2';
              return (
                <div key={`${hunkIndex}-${lineIndex}`} className="grid min-h-6" style={{ gridTemplateColumns: '46px 46px 22px minmax(0, 1fr)', background }}>
                  <span className="select-none border-r px-2 text-right" style={{ color: '#AAAABA', borderColor: '#E6E6EC' }}>{line.oldNumber || ''}</span>
                  <span className="select-none border-r px-2 text-right" style={{ color: '#AAAABA', borderColor: '#E6E6EC' }}>{line.newNumber || ''}</span>
                  <span className="select-none text-center" style={{ color: signColor }}>{line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}</span>
                  <code className="whitespace-pre-wrap break-words pr-5" style={{ color: '#333344' }}>{line.text || ' '}</code>
                </div>
              );
            })}
          </section>
        )) : (
          <div className="flex h-48 items-center justify-center text-sm" style={{ color: '#9999B3' }}>文件内容没有发生变化</div>
        )}
      </div>
    </div>
  );
}

function DiffWorkspace({ task }: { task: PiTask }) {
  const changes = useMemo<FileChange[]>(() => {
    if (task.result?.kind !== 'candidate' || !Array.isArray(task.result.changes)) return [];
    return task.result.changes.map((item) => ({
      path: String(item.path || ''),
      action: item.action === 'create' ? 'create' : item.action === 'delete' ? 'delete' : 'update',
      content: item.content == null ? '' : String(item.content),
      beforeContent: item.beforeContent == null ? '' : String(item.beforeContent),
      reason: item.reason == null ? '' : String(item.reason)
    }));
  }, [task]);
  const [selectedPath, setSelectedPath] = useState(changes[0]?.path || '');
  useEffect(() => {
    if (!changes.some((change) => change.path === selectedPath)) setSelectedPath(changes[0]?.path || '');
  }, [changes, selectedPath]);
  const selected = changes.find((change) => change.path === selectedPath) || changes[0];

  if (!selected) return <div className="flex h-full items-center justify-center text-sm" style={{ color: '#9999B3' }}>这次任务没有文件改动</div>;

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-[220px] flex-shrink-0 overflow-y-auto p-2" style={{ background: '#F8F8FA', borderRight: '1px solid #E7E7EE' }}>
        <div className="px-2 pb-2 pt-1">
          <p className="text-xs" style={{ color: '#4A4A6A' }}>修改了 {changes.length} 个文件</p>
          <p className="mt-1 text-xs" style={{ color: '#9999B3' }}>已自动保存</p>
        </div>
        {changes.map((change) => {
          const selectedFile = change.path === selected.path;
          return (
            <button
              key={change.path}
              onClick={() => setSelectedPath(change.path)}
              className="mb-1 w-full rounded-lg px-2.5 py-2 text-left"
              style={{ background: selectedFile ? '#E9EEFA' : 'transparent', color: selectedFile ? '#284F9E' : '#55556F' }}
            >
              <div className="flex items-center gap-2">
                <span className="rounded px-1.5 py-0.5 text-xs" style={{ background: change.action === 'create' ? '#DDF3E6' : change.action === 'delete' ? '#FCE2DF' : '#E2EAFB', color: change.action === 'create' ? '#176B43' : change.action === 'delete' ? '#B42318' : '#2E5BD1' }}>{actionLabel(change.action)}</span>
                <span className="min-w-0 flex-1 truncate text-xs" title={change.path}>{change.path.split('/').pop()}</span>
              </div>
              <p className="mt-1 truncate pl-[42px] text-xs" style={{ color: '#9999B3' }}>{change.path.includes('/') ? change.path.slice(0, change.path.lastIndexOf('/')) : '项目根目录'}</p>
            </button>
          );
        })}
      </aside>
      <DiffFile change={selected} />
    </div>
  );
}

function DocumentPreview({ document }: { document: ActiveDoc }) {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const paragraphs = useMemo(
    () => String(document.content || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/),
    [document.content]
  );
  const targetIndex = document.evidence?.paragraphStart
    ? Math.max(0, document.evidence.paragraphStart - 1)
    : -1;
  useEffect(() => {
    if (targetIndex < 0) return;
    window.requestAnimationFrame(() => targetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, [document.id, targetIndex]);

  if (!document.evidence) {
    return (
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-6 text-sm" style={{ color: '#2A2A3E', lineHeight: 1.9, fontFamily: document.path?.endsWith('.json') || document.path?.endsWith('.jsonl') ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : "'Noto Serif SC', 'STSong', serif" }}>
        {document.content || '文件为空'}
      </pre>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6" style={{ background: '#FFFDF8' }}>
      {paragraphs.map((paragraph, index) => {
        const highlighted = index === targetIndex;
        return (
          <div
            key={`${index}-${paragraph.slice(0, 24)}`}
            ref={highlighted ? targetRef : undefined}
            className="mb-5 rounded-md px-3 py-2 transition-colors"
            style={{
              background: highlighted ? '#FFF0B8' : 'transparent',
              borderLeft: highlighted ? '3px solid #C98A19' : '3px solid transparent',
              boxShadow: highlighted ? '0 4px 14px rgba(121, 82, 17, 0.12)' : 'none'
            }}
          >
            <pre className="whitespace-pre-wrap text-sm" style={{ color: '#2A2A3E', lineHeight: 1.9, fontFamily: "'Noto Serif SC', 'STSong', serif" }}>{paragraph || ' '}</pre>
            {highlighted && <span className="mt-2 inline-block text-xs" style={{ color: '#8A5A00' }}>图谱引用的原文位置</span>}
          </div>
        );
      })}
    </div>
  );
}

export function DocumentWorkspace({ documents, activeTabId, diffTask, graph, onOpenEvidence, onSelectTab, onCloseDocument }: DocumentWorkspaceProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const diffTabId = diffTask ? `diff:${diffTask.id}` : '';
  const activeDocument = documents.find((document) => `file:${document.id}` === activeTabId) || null;
  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);

  const panelClassName = fullscreen
    ? 'fixed inset-x-0 bottom-0 top-14 z-40 flex flex-col'
    : 'flex h-full min-h-0 flex-col';

  return (
    <section className={panelClassName} style={{ background: '#FFFFFF', borderLeft: fullscreen ? 'none' : '1px solid #E7E7EE', boxShadow: fullscreen ? '0 -8px 30px rgba(28, 31, 45, 0.12)' : 'none' }} data-testid="document-workspace">
      <div className="flex h-11 flex-shrink-0 items-end justify-between" style={{ background: '#F5F5F7', borderBottom: '1px solid #DCDCE5' }}>
        <div className="flex min-w-0 flex-1 items-end overflow-x-auto px-2">
          {graph !== undefined && (
            <button
              onClick={() => onSelectTab('graph')}
              className="flex h-9 flex-shrink-0 items-center gap-2 rounded-t-lg px-3 text-xs"
              style={{ background: activeTabId === 'graph' ? '#FFFFFF' : 'transparent', color: activeTabId === 'graph' ? '#1A1A2E' : '#77778E', border: activeTabId === 'graph' ? '1px solid #DCDCE5' : '1px solid transparent', borderBottomColor: activeTabId === 'graph' ? '#FFFFFF' : 'transparent' }}
            >
              <NetworkIcon size={13} />
              <span>关系图谱</span>
              <span className="rounded px-1.5 py-0.5" style={{ background: graph ? '#E8F1ED' : '#EFEFF3', color: graph ? '#326D54' : '#8B8B9E' }}>{graph?.edges.length || 0}</span>
            </button>
          )}
          {diffTask && (
            <button
              onClick={() => onSelectTab(diffTabId)}
              className="flex h-9 flex-shrink-0 items-center gap-2 rounded-t-lg px-3 text-xs"
              style={{ background: activeTabId === diffTabId ? '#FFFFFF' : 'transparent', color: activeTabId === diffTabId ? '#1A1A2E' : '#77778E', border: activeTabId === diffTabId ? '1px solid #DCDCE5' : '1px solid transparent', borderBottomColor: activeTabId === diffTabId ? '#FFFFFF' : 'transparent' }}
            >
              <FileDiffIcon size={13} />
              <span>本次修改</span>
              <span className="rounded px-1.5 py-0.5" style={{ background: '#E9EEFA', color: '#3159A8' }}>{Array.isArray(diffTask.result?.changes) ? diffTask.result?.changes.length : 0}</span>
            </button>
          )}
          {documents.map((document) => {
            const tabId = `file:${document.id}`;
            const active = activeTabId === tabId;
            return (
              <div key={document.id} className="flex h-9 flex-shrink-0 items-center rounded-t-lg" style={{ background: active ? '#FFFFFF' : 'transparent', color: active ? '#1A1A2E' : '#77778E', border: active ? '1px solid #DCDCE5' : '1px solid transparent', borderBottomColor: active ? '#FFFFFF' : 'transparent' }}>
                <button onClick={() => onSelectTab(tabId)} className="flex min-w-0 items-center gap-2 py-2 pl-3 text-xs">
                  <FileTextIcon size={12} />
                  <span className="max-w-[150px] truncate">{document.title}</span>
                </button>
                <button onClick={() => onCloseDocument(document.id)} aria-label={`关闭 ${document.title}`} className="mx-1 rounded p-1" style={{ color: '#9999AB' }}><XIcon size={11} /></button>
              </div>
            );
          })}
        </div>
        <button
          onClick={() => setFullscreen((current) => !current)}
          aria-label={fullscreen ? '退出全屏查看' : '全屏查看文件'}
          title={fullscreen ? '退出全屏（Esc）' : '全屏查看'}
          className="mb-1.5 mr-2 rounded-lg p-2"
          style={{ color: '#68687C', background: '#FFFFFF', border: '1px solid #DEDEE6' }}
        >
          {fullscreen ? <Minimize2Icon size={14} /> : <Maximize2Icon size={14} />}
        </button>
      </div>
      <div className="min-h-0 flex-1" style={{ background: '#FFFFFF' }}>
        {activeTabId === 'graph' ? (
          graph ? (
            <GraphWorkspace
              graph={graph}
              className="h-full border-0"
              onOpenEvidence={onOpenEvidence || (() => undefined)}
            />
          ) : (
            <div className="flex h-full items-center justify-center" style={{ background: '#FCFAF4' }}>
              <div className="max-w-sm px-8 text-center">
                <NetworkIcon size={28} color="#7A8494" className="mx-auto" />
                <p className="mt-4 text-base" style={{ color: '#2D3541', fontFamily: "'Noto Serif SC', 'STSong', serif" }}>关系图谱正在等待分析</p>
                <p className="mt-2 text-xs leading-5" style={{ color: '#777267' }}>完成后会在这个页签中展示人物关系、章节变化和原文证据。</p>
              </div>
            </div>
          )
        ) : diffTask && activeTabId === diffTabId ? (
          <DiffWorkspace task={diffTask} />
        ) : activeDocument ? (
          <div className="flex h-full flex-col">
            <div className="flex-shrink-0 px-5 py-3" style={{ borderBottom: '1px solid #ECECF1', background: '#FCFCFD' }}>
              <p className="truncate text-xs" style={{ color: '#3A3A5A' }}>{activeDocument.path || activeDocument.title}</p>
              <p className="mt-0.5 text-xs" style={{ color: activeDocument.evidence?.status === 'stale' ? '#A14A40' : '#9999B3' }}>
                {activeDocument.evidence ? (activeDocument.evidence.status === 'stale' ? '证据位置已变化，请核对相关段落' : '已定位到图谱引用段落') : '文件预览'}
              </p>
            </div>
            <DocumentPreview document={activeDocument} />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm" style={{ color: '#9999B3' }}>选择一个页签查看内容</div>
        )}
      </div>
    </section>
  );
}
