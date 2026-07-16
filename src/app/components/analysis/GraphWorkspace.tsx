import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRightIcon,
  BookmarkIcon,
  BookOpenIcon,
  ChevronRightIcon,
  CircleDotIcon,
  FileTextIcon,
  FilterIcon,
  GitBranchIcon,
  HistoryIcon,
  NetworkIcon,
  QuoteIcon,
  RotateCcwIcon,
  Rows3Icon,
  SearchXIcon,
  UsersIcon
} from 'lucide-react';
import {
  AnalysisEvidenceRef,
  AnalysisGraph,
  AnalysisGraphEdge,
  AnalysisGraphNode,
  AnalysisGraphView,
  OrderedAnalysisChapter,
  evidenceForRecord,
  filterGraphAtChapter,
  getOrderedAnalysisChapters,
  graphRecordLabel,
  humanizeAnalysisValue,
  isPersonNode,
  resolveActiveAnalysisChapterId
} from '../../lib/analysis';

type Selection = { kind: 'node' | 'edge'; id: string } | null;

export interface GraphWorkspaceProps {
  graph: AnalysisGraph;
  className?: string;
  view?: AnalysisGraphView;
  initialView?: AnalysisGraphView;
  chapterId?: string;
  initialChapterId?: string;
  onViewChange?: (view: AnalysisGraphView) => void;
  onChapterChange?: (chapterId: string) => void;
  onOpenEvidence: (reference: AnalysisEvidenceRef) => void | Promise<void>;
}

const VIEW_ITEMS: Array<{
  id: AnalysisGraphView;
  label: string;
  eyebrow: string;
  icon: typeof NetworkIcon;
}> = [
  { id: 'relationships', label: '人物关系', eyebrow: 'RELATIONS', icon: NetworkIcon },
  { id: 'characters', label: '人物', eyebrow: 'PEOPLE', icon: UsersIcon },
  { id: 'storylines', label: '故事线', eyebrow: 'STORYLINES', icon: GitBranchIcon },
  { id: 'foreshadowing', label: '伏笔', eyebrow: 'HOOKS', icon: BookmarkIcon },
  { id: 'chapters', label: '章节影响', eyebrow: 'IMPACT', icon: Rows3Icon }
];

const STORYLINE_TYPES = new Set(['故事线', 'storyline', 'storylines', 'plotline', 'plotlines']);
const FORESHADOWING_TYPES = new Set(['伏笔', 'hook', 'hooks', 'foreshadowing']);

function text(value: unknown) {
  return String(value ?? '').trim();
}

function lower(value: unknown) {
  return text(value).toLowerCase();
}

function unique(values: unknown[]) {
  return Array.from(new Set(values.map(text).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function nodeTitle(node: AnalysisGraphNode) {
  return text(node.label || node.canonicalName) || node.id;
}

function recordSummary(record: AnalysisGraphNode | AnalysisGraphEdge) {
  const candidates = [
    record.summary,
    record.description,
    record.content,
    record.dynamic,
    record.currentState,
    record.reason,
    record.outcome,
    record.goal
  ];
  return candidates.map(text).find(Boolean) || '';
}

function isStorylineNode(node: AnalysisGraphNode) {
  return STORYLINE_TYPES.has(lower(node.type));
}

function isForeshadowingNode(node: AnalysisGraphNode) {
  return FORESHADOWING_TYPES.has(lower(node.type));
}

function relationColor(type: unknown) {
  const value = text(type);
  if (/敌|恨|竞争|怀疑/.test(value)) return '#A94B42';
  if (/信任|合作|保护|盟/.test(value)) return '#2F6E66';
  if (/亲属|婚姻|师徒|上下级|组织/.test(value)) return '#8A633C';
  if (/爱慕|依赖|亏欠/.test(value)) return '#A6525F';
  if (/隐瞒|欺骗|误解|秘密/.test(value)) return '#5F6D82';
  return '#3F68A5';
}

function nodeAccent(type: unknown) {
  const value = lower(type);
  if (STORYLINE_TYPES.has(value)) return '#2F6E66';
  if (FORESHADOWING_TYPES.has(value)) return '#A56731';
  if (value === '地点' || value === 'location') return '#7B684C';
  if (value === '组织' || value === 'organization') return '#586879';
  return '#3F68A5';
}

function scopeLabel(value: unknown) {
  const labels: Record<string, string> = {
    WORLD: '世界事实',
    KNOWLEDGE: '人物认知',
    BELIEF: '人物相信',
    CLAIM: '公开说法',
    RUMOR: '传闻',
    UNKNOWN: '尚未确认'
  };
  const raw = text(value);
  return labels[raw.toUpperCase()] || raw || '未标注范围';
}

function formatChapter(chapter: OrderedAnalysisChapter | undefined) {
  if (!chapter) return '全书当前';
  return chapter.label === chapter.id ? chapter.id : `${chapter.label} · ${chapter.id}`;
}

function selectValue(value: string) {
  return value || '__all__';
}

function fromSelectValue(value: string) {
  return value === '__all__' ? '' : value;
}

function layoutGraph(nodes: AnalysisGraphNode[], edges: AnalysisGraphEdge[]) {
  const degree = new Map<string, number>();
  edges.forEach((edge) => {
    degree.set(edge.source, (degree.get(edge.source) || 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) || 0) + 1);
  });
  const ordered = [...nodes].sort(
    (left, right) => (degree.get(right.id) || 0) - (degree.get(left.id) || 0) || nodeTitle(left).localeCompare(nodeTitle(right), 'zh-CN')
  );
  const positions = new Map<string, { x: number; y: number }>();
  if (!ordered.length) return positions;
  if (ordered.length === 1) {
    positions.set(ordered[0].id, { x: 50, y: 48 });
    return positions;
  }

  const hasCenter = ordered.length >= 5;
  const ringNodes = hasCenter ? ordered.slice(1) : ordered;
  if (hasCenter) positions.set(ordered[0].id, { x: 50, y: 48 });
  const firstRingCount = Math.min(ringNodes.length, 10);
  ringNodes.forEach((node, index) => {
    const outer = index >= firstRingCount;
    const ringIndex = outer ? index - firstRingCount : index;
    const ringCount = outer ? ringNodes.length - firstRingCount : firstRingCount;
    const angle = -Math.PI / 2 + (ringIndex / Math.max(1, ringCount)) * Math.PI * 2;
    const radiusX = outer ? 43 : hasCenter ? 32 : 36;
    const radiusY = outer ? 42 : hasCenter ? 31 : 35;
    positions.set(node.id, {
      x: 50 + Math.cos(angle) * radiusX,
      y: 48 + Math.sin(angle) * radiusY
    });
  });
  return positions;
}

function edgePath(
  edge: AnalysisGraphEdge,
  positions: Map<string, { x: number; y: number }>,
  parallelIndex: number,
  parallelTotal: number
) {
  const source = positions.get(edge.source);
  const target = positions.get(edge.target);
  if (!source || !target) return null;
  const x1 = source.x * 10;
  const y1 = source.y * 6;
  const x2 = target.x * 10;
  const y2 = target.y * 6;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const offset = (parallelIndex - (parallelTotal - 1) / 2) * 22;
  const midX = (x1 + x2) / 2 - (dy / length) * offset;
  const midY = (y1 + y2) / 2 + (dx / length) * offset;
  return {
    d: `M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`,
    labelX: midX / 10,
    labelY: midY / 6
  };
}

function EmptyState({ title, text: description }: { title: string; text: string }) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border" style={{ borderColor: '#D8D1C1', background: '#FBF8EF' }}>
        <SearchXIcon size={21} color="#8A877D" />
      </div>
      <h3 className="mt-4 font-serif text-base" style={{ color: '#333A45' }}>{title}</h3>
      <p className="mt-1.5 max-w-sm text-xs leading-5" style={{ color: '#858176' }}>{description}</p>
    </div>
  );
}

function EvidenceList({
  references,
  onOpenEvidence
}: {
  references: AnalysisEvidenceRef[];
  onOpenEvidence: GraphWorkspaceProps['onOpenEvidence'];
}) {
  if (!references.length) {
    return <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs" style={{ borderColor: '#D8D1C1', color: '#8A877D' }}>暂无可跳转的原文证据</p>;
  }
  return (
    <div className="space-y-2">
      {references.map((reference, index) => (
        <button
          key={reference.refId || `${reference.sourcePath}-${reference.paragraphHash}-${index}`}
          type="button"
          onClick={() => void onOpenEvidence(reference)}
          className="group w-full rounded-lg border bg-[#FFFEFA] p-3 text-left transition-all hover:-translate-y-px hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A7CF7]/35"
          style={{ borderColor: reference.stale ? '#E2B3AC' : '#D8D1C1' }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-mono text-[10px]" style={{ color: '#6E7480' }}>{reference.sourcePath || reference.chapterId || '作者修正记录'}</p>
              <p className="mt-1 text-[11px] leading-5" style={{ color: '#3B4350' }}>
                {reference.excerpt ? `“${reference.excerpt}”` : '打开对应位置核对原文'}
              </p>
            </div>
            <ArrowUpRightIcon size={13} className="mt-0.5 flex-shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" color="#3F68A5" />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[10px]" style={{ color: '#918D82' }}>
            <span>{reference.paragraphStart ? `第 ${reference.paragraphStart} 段` : reference.chapterId || '定位记录'}</span>
            {reference.stale && <span style={{ color: '#A14A40' }}>位置待复核</span>}
          </div>
        </button>
      ))}
    </div>
  );
}

function DetailPanel({
  graph,
  node,
  edge,
  nodeMap,
  onOpenEvidence
}: {
  graph: AnalysisGraph;
  node: AnalysisGraphNode | null;
  edge: AnalysisGraphEdge | null;
  nodeMap: Map<string, AnalysisGraphNode>;
  onOpenEvidence: GraphWorkspaceProps['onOpenEvidence'];
}) {
  const record = node || edge;
  if (!record) {
    return (
      <aside className="flex min-h-[360px] flex-col border-l px-5 py-6" style={{ borderColor: '#D9D3C5', background: '#F7F3E8' }}>
        <span className="font-mono text-[9px] tracking-[0.22em]" style={{ color: '#9A9589' }}>EVIDENCE FILE</span>
        <div className="mt-10 flex flex-1 flex-col items-center justify-center text-center">
          <CircleDotIcon size={24} color="#A49E90" />
          <p className="mt-4 font-serif text-sm" style={{ color: '#4A515D' }}>选择一个人物或关系</p>
          <p className="mt-1.5 max-w-[220px] text-[11px] leading-5" style={{ color: '#8A877D' }}>这里会展示状态、关系阶段，以及能够回到原文的证据卡。</p>
        </div>
      </aside>
    );
  }

  const isEdge = Boolean(edge);
  const references = evidenceForRecord(
    graph,
    isEdge ? 'relation' : 'entity',
    record.id,
    Array.isArray(record.evidenceRefs) ? record.evidenceRefs : []
  );
  const title = isEdge
    ? `${nodeTitle(nodeMap.get(edge!.source) || { id: edge!.source })} → ${nodeTitle(nodeMap.get(edge!.target) || { id: edge!.target })}`
    : nodeTitle(node!);
  const summary = recordSummary(record);

  return (
    <aside className="min-h-[360px] overflow-y-auto border-l" style={{ borderColor: '#D9D3C5', background: '#F7F3E8' }}>
      <div className="sticky top-0 z-10 border-b px-5 py-5" style={{ borderColor: '#D9D3C5', background: 'rgba(247,243,232,0.96)', backdropFilter: 'blur(8px)' }}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[9px] tracking-[0.22em]" style={{ color: '#9A9589' }}>{isEdge ? 'RELATION FILE' : 'ENTITY FILE'}</span>
          <span className="rounded-sm border px-1.5 py-0.5 font-mono text-[9px]" style={{ borderColor: '#CFC8B7', color: '#777267' }}>{record.id}</span>
        </div>
        <h3 className="mt-3 font-serif text-lg leading-7" style={{ color: '#242B36' }}>{title}</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: '#B9C7DD', background: '#EEF3FA', color: '#315C9B' }}>
            {isEdge ? graphRecordLabel(edge!) : text(node!.type) || '实体'}
          </span>
          {record.status && <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: '#D6CEBC', background: '#FFFCF5', color: '#6F695C' }}>{record.status}</span>}
          {record.confidence && <span className="rounded-full border px-2 py-0.5 text-[10px]" style={{ borderColor: '#D6CEBC', background: '#FFFCF5', color: '#6F695C' }}>{record.confidence}</span>}
        </div>
      </div>

      <div className="space-y-5 px-5 py-5">
        {summary && (
          <div className="relative border-l-2 pl-3" style={{ borderColor: '#7890B4' }}>
            <QuoteIcon size={13} className="absolute -left-[7px] -top-1 bg-[#F7F3E8]" color="#7890B4" />
            <p className="text-xs leading-6" style={{ color: '#454C57' }}>{summary}</p>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {isEdge ? (
            <>
              <MetaItem label="关系强弱" value={humanizeAnalysisValue(edge!.strength)} />
              <MetaItem label="信息范围" value={scopeLabel(edge!.scope)} />
              <MetaItem label="开始位置" value={humanizeAnalysisValue(edge!.narrativeFrom ?? edge!.validFrom)} />
              <MetaItem label="结束位置" value={humanizeAnalysisValue(edge!.narrativeTo ?? edge!.validTo)} />
            </>
          ) : (
            <>
              <MetaItem label="当前状态" value={humanizeAnalysisValue(node!.status)} />
              <MetaItem label="可信程度" value={humanizeAnalysisValue(node!.confidence)} />
              <MetaItem label="首次出现" value={humanizeAnalysisValue(node!.firstSeen)} />
              <MetaItem label="最近出现" value={humanizeAnalysisValue(node!.lastSeen)} />
            </>
          )}
        </dl>

        {!isEdge && Array.isArray(node!.aliases) && node!.aliases!.length > 0 && (
          <div>
            <p className="text-[10px] tracking-[0.16em]" style={{ color: '#928D80' }}>别名与称号</p>
            <p className="mt-1.5 text-xs leading-5" style={{ color: '#4A515D' }}>{node!.aliases!.join('、')}</p>
          </div>
        )}

        <div>
          <div className="mb-2.5 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[10px] tracking-[0.16em]" style={{ color: '#928D80' }}>
              <FileTextIcon size={12} /> 原文证据
            </p>
            <span className="font-mono text-[10px]" style={{ color: '#928D80' }}>{references.length}</span>
          </div>
          <EvidenceList references={references} onOpenEvidence={onOpenEvidence} />
        </div>
      </div>
    </aside>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px]" style={{ color: '#969185' }}>{label}</dt>
      <dd className="mt-1 text-xs leading-5" style={{ color: '#414955' }}>{value}</dd>
    </div>
  );
}

function RelationshipNetwork({
  nodes,
  edges,
  selection,
  onSelect
}: {
  nodes: AnalysisGraphNode[];
  edges: AnalysisGraphEdge[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const positions = useMemo(() => layoutGraph(nodes, edges), [nodes, edges]);
  const parallel = useMemo(() => {
    const groups = new Map<string, string[]>();
    edges.forEach((edge) => {
      const pair = [edge.source, edge.target].sort().join('::');
      groups.set(pair, [...(groups.get(pair) || []), edge.id]);
    });
    return groups;
  }, [edges]);

  if (!nodes.length) {
    return <EmptyState title="当前筛选下没有人物关系" text="调整人物、关系类型、可信程度或章节位置，再查看对应阶段。" />;
  }

  return (
    <div className="overflow-x-auto">
      <div
        className="relative min-h-[500px] min-w-[760px] overflow-hidden border-b"
        style={{
          borderColor: '#DED8CA',
          backgroundColor: '#FCFAF4',
          backgroundImage: 'linear-gradient(rgba(71, 84, 104, 0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(71, 84, 104, 0.045) 1px, transparent 1px)',
          backgroundSize: '28px 28px'
        }}
      >
        <div className="absolute left-5 top-4 z-10 flex items-center gap-2 rounded-sm border bg-[#FFFEFA]/90 px-2.5 py-1.5 font-mono text-[9px] tracking-[0.16em]" style={{ borderColor: '#D8D1C1', color: '#888377' }}>
          <NetworkIcon size={11} /> RELATION MAP / {nodes.length} 人 · {edges.length} 条关系
        </div>
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 600" aria-hidden="true">
          <defs>
            <marker id="graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="context-stroke" opacity="0.76" />
            </marker>
          </defs>
          {edges.map((edge) => {
            const pair = [edge.source, edge.target].sort().join('::');
            const siblings = parallel.get(pair) || [edge.id];
            const geometry = edgePath(edge, positions, siblings.indexOf(edge.id), siblings.length);
            if (!geometry) return null;
            const active = selection?.kind === 'edge' && selection.id === edge.id;
            return (
              <path
                key={edge.id}
                d={geometry.d}
                fill="none"
                stroke={relationColor(edge.type)}
                strokeWidth={active ? 3.2 : 1.7}
                strokeOpacity={active ? 1 : 0.64}
                strokeDasharray={/传闻|误解|隐瞒|RUMOR|BELIEF/.test(`${edge.type || ''}${edge.scope || ''}`) ? '7 5' : undefined}
                markerEnd="url(#graph-arrow)"
              />
            );
          })}
        </svg>

        {edges.map((edge) => {
          const pair = [edge.source, edge.target].sort().join('::');
          const siblings = parallel.get(pair) || [edge.id];
          const geometry = edgePath(edge, positions, siblings.indexOf(edge.id), siblings.length);
          if (!geometry) return null;
          const active = selection?.kind === 'edge' && selection.id === edge.id;
          return (
            <button
              key={`label-${edge.id}`}
              type="button"
              onClick={() => onSelect({ kind: 'edge', id: edge.id })}
              aria-label={`查看关系：${graphRecordLabel(edge)}`}
              aria-pressed={active}
              className="absolute z-10 max-w-[112px] -translate-x-1/2 -translate-y-1/2 truncate rounded-full border px-2 py-1 text-[9px] shadow-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A7CF7]/35"
              style={{
                left: `${geometry.labelX}%`,
                top: `${geometry.labelY}%`,
                borderColor: active ? relationColor(edge.type) : '#D8D1C1',
                background: active ? relationColor(edge.type) : '#FFFEFA',
                color: active ? '#FFFFFF' : relationColor(edge.type)
              }}
              title={graphRecordLabel(edge)}
            >
              {graphRecordLabel(edge)}
            </button>
          );
        })}

        {nodes.map((node) => {
          const position = positions.get(node.id);
          if (!position) return null;
          const active = selection?.kind === 'node' && selection.id === node.id;
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelect({ kind: 'node', id: node.id })}
              aria-pressed={active}
              className="absolute z-20 w-[132px] -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-[#FFFEFA] px-3 py-2.5 text-left transition-all hover:-translate-y-[54%] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A7CF7]/40"
              style={{
                left: `${position.x}%`,
                top: `${position.y}%`,
                borderColor: active ? nodeAccent(node.type) : '#CFC8B8',
                boxShadow: active ? `0 0 0 2px ${nodeAccent(node.type)}22, 0 8px 18px rgba(36,43,54,0.12)` : '0 3px 9px rgba(36,43,54,0.08)'
              }}
            >
              <span className="absolute inset-y-0 left-0 w-1 rounded-l-lg" style={{ background: nodeAccent(node.type) }} />
              <span className="block truncate font-serif text-sm" style={{ color: '#29313D' }}>{nodeTitle(node)}</span>
              <span className="mt-1 flex items-center justify-between gap-2 text-[9px]" style={{ color: '#8A877D' }}>
                <span className="truncate">{text(node.type) || '人物'}</span>
                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: node.status === '死亡' ? '#A94B42' : '#4C7B65' }} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RelationshipLedger({
  edges,
  nodeMap,
  selection,
  onSelect
}: {
  edges: AnalysisGraphEdge[];
  nodeMap: Map<string, AnalysisGraphNode>;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  return (
    <section className="px-5 py-5" aria-labelledby="relationship-ledger-title">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <span className="font-mono text-[9px] tracking-[0.18em]" style={{ color: '#9A9589' }}>KEYBOARD LEDGER</span>
          <h3 id="relationship-ledger-title" className="mt-1 font-serif text-sm" style={{ color: '#333A45' }}>关系列表</h3>
        </div>
        <span className="text-[10px]" style={{ color: '#908B7F' }}>Tab 逐条浏览，Enter 查看证据</span>
      </div>
      {edges.length ? (
        <div className="overflow-hidden rounded-lg border" role="table" aria-label="当前章节有效关系" style={{ borderColor: '#D8D1C1' }}>
          <div className="grid grid-cols-[minmax(110px,1fr)_100px_minmax(110px,1fr)_80px_90px] gap-3 border-b bg-[#F3EFE3] px-3 py-2 text-[10px]" role="row" style={{ borderColor: '#D8D1C1', color: '#837E72' }}>
            <span role="columnheader">关系起点</span><span role="columnheader">类型</span><span role="columnheader">关系终点</span><span role="columnheader">强弱</span><span role="columnheader">可信程度</span>
          </div>
          {edges.map((edge) => {
            const active = selection?.kind === 'edge' && selection.id === edge.id;
            const source = nodeTitle(nodeMap.get(edge.source) || { id: edge.source });
            const target = nodeTitle(nodeMap.get(edge.target) || { id: edge.target });
            return (
              <button
                key={edge.id}
                type="button"
                role="row"
                aria-label={`查看 ${source} 对 ${target} 的${graphRecordLabel(edge)}关系`}
                aria-pressed={active}
                onClick={() => onSelect({ kind: 'edge', id: edge.id })}
                className="grid w-full grid-cols-[minmax(110px,1fr)_100px_minmax(110px,1fr)_80px_90px] gap-3 border-b px-3 py-2.5 text-left text-xs transition-colors last:border-b-0 hover:bg-[#F8F5EB] focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4A7CF7]/35"
                style={{ borderColor: '#E5E0D4', background: active ? '#EEF3FA' : '#FFFEFA', color: '#3E4653' }}
              >
                <span role="cell" className="truncate font-medium">{source}</span>
                <span role="cell" className="truncate" style={{ color: relationColor(edge.type) }}>{graphRecordLabel(edge)}</span>
                <span role="cell" className="truncate">{target}</span>
                <span role="cell" className="truncate" style={{ color: '#7D786C' }}>{text(edge.strength) || '—'}</span>
                <span role="cell" className="truncate" style={{ color: '#7D786C' }}>{text(edge.confidence) || '未标注'}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-xs" style={{ borderColor: '#D8D1C1', color: '#8A877D' }}>当前筛选下没有有效关系</p>
      )}
    </section>
  );
}

function EntityCards({
  nodes,
  selection,
  onSelect,
  emptyTitle,
  emptyText
}: {
  nodes: AnalysisGraphNode[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
  emptyTitle: string;
  emptyText: string;
}) {
  if (!nodes.length) return <EmptyState title={emptyTitle} text={emptyText} />;
  return (
    <div className="grid gap-3 p-5 sm:grid-cols-2 2xl:grid-cols-3">
      {nodes.map((node, index) => {
        const active = selection?.kind === 'node' && selection.id === node.id;
        const summary = recordSummary(node);
        return (
          <button
            key={node.id}
            type="button"
            onClick={() => onSelect({ kind: 'node', id: node.id })}
            aria-pressed={active}
            className="group relative min-h-[146px] overflow-hidden rounded-lg border bg-[#FFFEFA] p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A7CF7]/35"
            style={{ borderColor: active ? nodeAccent(node.type) : '#D8D1C1', boxShadow: active ? `0 0 0 2px ${nodeAccent(node.type)}20` : undefined }}
          >
            <span className="absolute right-3 top-2 font-mono text-3xl font-light leading-none" style={{ color: '#ECE6D9' }}>{String(index + 1).padStart(2, '0')}</span>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: nodeAccent(node.type) }} />
              <span className="text-[9px] tracking-[0.16em]" style={{ color: '#958F82' }}>{text(node.type).toUpperCase() || 'ENTITY'}</span>
            </div>
            <h3 className="mt-3 pr-9 font-serif text-base" style={{ color: '#2D3541' }}>{nodeTitle(node)}</h3>
            {summary && <p className="mt-2 line-clamp-2 text-[11px] leading-5" style={{ color: '#716D62' }}>{summary}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[9px]" style={{ color: '#8C877B' }}>
              {node.status && <span className="rounded-full border px-2 py-0.5" style={{ borderColor: '#D8D1C1' }}>{node.status}</span>}
              {node.confidence && <span className="rounded-full border px-2 py-0.5" style={{ borderColor: '#D8D1C1' }}>{node.confidence}</span>}
              <span className="ml-auto inline-flex items-center gap-1 text-[#3F68A5] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">查看证据 <ChevronRightIcon size={11} /></span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ChapterImpactView({
  chapter,
  graph,
  nodeMap,
  edgeMap,
  selection,
  onSelect
}: {
  chapter: OrderedAnalysisChapter | undefined;
  graph: AnalysisGraph;
  nodeMap: Map<string, AnalysisGraphNode>;
  edgeMap: Map<string, AnalysisGraphEdge>;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  if (!chapter) return <EmptyState title="暂无章节索引" text="分析发布章节索引后，这里会列出人物、事件和关系受到的影响。" />;
  const record = chapter.record;
  const evidenceRecords = Object.values(graph.evidenceIndex || {}).filter((reference) => reference.chapterId === chapter.id);
  const entityIds = unique([...(record.entityIds || []), ...evidenceRecords.filter((item) => item.recordType === 'entity').map((item) => item.recordId)]);
  const relationIds = unique([...(record.relationIds || []), ...evidenceRecords.filter((item) => item.recordType === 'relation').map((item) => item.recordId)]);
  const eventIds = unique([...(record.eventIds || []), ...evidenceRecords.filter((item) => item.recordType === 'event').map((item) => item.recordId)]);
  const assertionIds = unique([...(record.assertionIds || []), ...evidenceRecords.filter((item) => item.recordType === 'assertion').map((item) => item.recordId)]);

  return (
    <div className="p-5">
      <div className="relative overflow-hidden rounded-xl border bg-[#FFFEFA] p-5" style={{ borderColor: '#D8D1C1', boxShadow: '0 6px 20px rgba(45, 52, 64, 0.06)' }}>
        <span className="absolute -right-3 -top-7 select-none font-serif text-[92px] leading-none" style={{ color: '#F0EBDD' }}>{chapter.position}</span>
        <div className="relative">
          <span className="font-mono text-[9px] tracking-[0.2em]" style={{ color: '#958F82' }}>CHAPTER IMPACT</span>
          <h3 className="mt-2 font-serif text-xl" style={{ color: '#2D3541' }}>{chapter.label}</h3>
          <p className="mt-1 font-mono text-[10px]" style={{ color: '#8C877B' }}>{record.sourcePath || chapter.id}</p>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['相关实体', entityIds.length],
              ['事件', eventIds.length],
              ['关系变化', relationIds.length],
              ['事实与认知', assertionIds.length]
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border px-3 py-3" style={{ borderColor: '#E0DACD', background: '#F9F6ED' }}>
                <div className="font-mono text-lg" style={{ color: '#3F68A5' }}>{value}</div>
                <div className="mt-0.5 text-[10px]" style={{ color: '#8C877B' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ImpactList
          title="涉及实体"
          ids={entityIds}
          renderLabel={(id) => nodeTitle(nodeMap.get(id) || { id })}
          activeId={selection?.kind === 'node' ? selection.id : ''}
          onSelect={(id) => onSelect({ kind: 'node', id })}
        />
        <ImpactList
          title="关系变化"
          ids={relationIds}
          renderLabel={(id) => {
            const edge = edgeMap.get(id);
            if (!edge) return id;
            return `${nodeTitle(nodeMap.get(edge.source) || { id: edge.source })} · ${graphRecordLabel(edge)} · ${nodeTitle(nodeMap.get(edge.target) || { id: edge.target })}`;
          }}
          activeId={selection?.kind === 'edge' ? selection.id : ''}
          onSelect={(id) => onSelect({ kind: 'edge', id })}
        />
      </div>
    </div>
  );
}

function ImpactList({
  title,
  ids,
  renderLabel,
  activeId,
  onSelect
}: {
  title: string;
  ids: string[];
  renderLabel: (id: string) => string;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="rounded-lg border bg-[#FFFEFA] p-4" style={{ borderColor: '#D8D1C1' }}>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="font-serif text-sm" style={{ color: '#3A424E' }}>{title}</h4>
        <span className="font-mono text-[10px]" style={{ color: '#918B7E' }}>{ids.length}</span>
      </div>
      {ids.length ? (
        <div className="space-y-1">
          {ids.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors hover:bg-[#F5F1E6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A7CF7]/35"
              style={{ background: activeId === id ? '#EEF3FA' : undefined, color: '#49515D' }}
            >
              <span className="truncate">{renderLabel(id)}</span>
              <ChevronRightIcon size={12} className="flex-shrink-0" color="#8D887C" />
            </button>
          ))}
        </div>
      ) : (
        <p className="py-5 text-center text-[11px]" style={{ color: '#928D80' }}>本章暂无记录</p>
      )}
    </section>
  );
}

export function GraphWorkspace({
  graph,
  className = '',
  view,
  initialView = 'relationships',
  chapterId,
  initialChapterId = '',
  onViewChange,
  onChapterChange,
  onOpenEvidence
}: GraphWorkspaceProps) {
  const [internalView, setInternalView] = useState<AnalysisGraphView>(initialView);
  const [internalChapterId, setInternalChapterId] = useState(initialChapterId);
  const [personFilter, setPersonFilter] = useState('');
  const [relationFilter, setRelationFilter] = useState('');
  const [confidenceFilter, setConfidenceFilter] = useState('');
  const [selection, setSelection] = useState<Selection>(null);

  const chapters = useMemo(() => getOrderedAnalysisChapters(graph), [graph]);
  const activeView = view ?? internalView;
  const requestedChapterId = chapterId ?? internalChapterId;
  const activeChapterId = resolveActiveAnalysisChapterId(chapters, requestedChapterId);
  const activeChapterIndex = Math.max(0, chapters.findIndex((chapter) => chapter.id === activeChapterId));
  const activeChapter = chapters[activeChapterIndex];
  const fullNodeMap = useMemo(() => new Map((graph.nodes || []).map((node) => [node.id, node])), [graph.nodes]);
  const fullEdgeMap = useMemo(() => new Map((graph.edges || []).map((edge) => [edge.id, edge])), [graph.edges]);
  const people = useMemo(() => {
    const typed = (graph.nodes || []).filter(isPersonNode);
    return typed.length ? typed : graph.nodes || [];
  }, [graph.nodes]);
  const relationTypes = useMemo(() => unique((graph.edges || []).map((edge) => edge.type)), [graph.edges]);
  const confidences = useMemo(
    () => unique([...(graph.nodes || []).map((node) => node.confidence), ...(graph.edges || []).map((edge) => edge.confidence)]),
    [graph.edges, graph.nodes]
  );
  const filteredGraph = useMemo(
    () => filterGraphAtChapter(graph, {
      chapterId: activeChapterId || undefined,
      personIds: personFilter ? [personFilter] : undefined,
      relationTypes: relationFilter ? [relationFilter] : undefined,
      confidences: confidenceFilter ? [confidenceFilter] : undefined
    }),
    [activeChapterId, confidenceFilter, graph, personFilter, relationFilter]
  );
  const filteredNodeMap = useMemo(() => new Map(filteredGraph.nodes.map((node) => [node.id, node])), [filteredGraph.nodes]);
  const filteredPeople = useMemo(() => filteredGraph.nodes.filter((node) => people.some((person) => person.id === node.id)), [filteredGraph.nodes, people]);
  const filteredPersonIds = useMemo(() => new Set(filteredPeople.map((node) => node.id)), [filteredPeople]);
  const relationshipEdges = useMemo(() => {
    if (!filteredPeople.length) return [];
    return filteredGraph.edges.filter((edge) => filteredPersonIds.has(edge.source) && filteredPersonIds.has(edge.target));
  }, [filteredGraph.edges, filteredPeople.length, filteredPersonIds]);
  const relationshipNodeIds = useMemo(() => {
    const ids = new Set<string>();
    relationshipEdges.forEach((edge) => {
      ids.add(edge.source);
      ids.add(edge.target);
    });
    if (!relationshipEdges.length) filteredPeople.forEach((node) => ids.add(node.id));
    return ids;
  }, [filteredPeople, relationshipEdges]);
  const relationshipNodes = useMemo(
    () => filteredPeople.filter((node) => relationshipNodeIds.has(node.id)),
    [filteredPeople, relationshipNodeIds]
  );

  const selectedNode = selection?.kind === 'node' ? fullNodeMap.get(selection.id) || null : null;
  const selectedEdge = selection?.kind === 'edge' ? fullEdgeMap.get(selection.id) || null : null;

  useEffect(() => {
    if (chapterId === undefined && internalChapterId && internalChapterId !== activeChapterId) {
      setInternalChapterId(activeChapterId);
      onChapterChange?.(activeChapterId);
    }
  }, [activeChapterId, chapterId, internalChapterId, onChapterChange]);

  useEffect(() => {
    if (!selection) return;
    if (selection.kind === 'node' && !filteredNodeMap.has(selection.id)) setSelection(null);
    if (selection.kind === 'edge' && !filteredGraph.edges.some((edge) => edge.id === selection.id)) setSelection(null);
  }, [filteredGraph.edges, filteredNodeMap, selection]);

  const changeView = (next: AnalysisGraphView) => {
    if (view === undefined) setInternalView(next);
    setSelection(null);
    onViewChange?.(next);
  };

  const changeChapter = (next: string) => {
    if (chapterId === undefined) setInternalChapterId(next);
    setSelection(null);
    onChapterChange?.(next);
  };

  const resetFilters = () => {
    setPersonFilter('');
    setRelationFilter('');
    setConfidenceFilter('');
    setSelection(null);
  };

  const storylines = filteredGraph.nodes.filter(isStorylineNode);
  const foreshadowing = filteredGraph.nodes.filter(isForeshadowingNode);
  const hasFilters = Boolean(personFilter || relationFilter || confidenceFilter);

  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border ${className}`}
      aria-label="小说关系图谱"
      style={{
        borderColor: '#D5CEBE',
        background: '#F6F2E7',
        color: '#2D3541',
        boxShadow: '0 16px 40px rgba(42, 48, 59, 0.09)',
        fontFamily: "'Noto Sans SC', sans-serif"
      }}
    >
      <header className="border-b bg-[#FCFAF4] px-5 pt-5" style={{ borderColor: '#D8D1C1' }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.24em]" style={{ color: '#958F82' }}>
              <BookOpenIcon size={12} /> EDITORIAL EVIDENCE DESK
            </div>
            <h1 className="mt-2 font-serif text-xl font-medium tracking-wide" style={{ color: '#242B36' }}>关系证据桌</h1>
            <p className="mt-1 text-xs" style={{ color: '#7D786D' }}>按章节回看人物、关系与线索，每条结论都能回到原文。</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-[#F7F3E8] px-3 py-2" style={{ borderColor: '#D8D1C1' }}>
            <HistoryIcon size={14} color="#58709A" />
            <div>
              <p className="font-mono text-[9px] tracking-[0.12em]" style={{ color: '#958F82' }}>NARRATIVE POSITION</p>
              <p className="mt-0.5 text-xs" style={{ color: '#3F4B5E' }}>{formatChapter(activeChapter)}</p>
            </div>
          </div>
        </div>

        <nav className="mt-5 flex min-w-0 gap-1 overflow-x-auto" aria-label="图谱视图">
          {VIEW_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => changeView(item.id)}
                aria-current={active ? 'page' : undefined}
                className="relative flex min-w-[116px] items-center gap-2 border-x border-t px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4A7CF7]/35"
                style={{
                  borderColor: active ? '#C9C0AE' : 'transparent',
                  background: active ? '#F6F2E7' : 'transparent',
                  color: active ? '#2D3541' : '#777267',
                  borderRadius: '8px 8px 0 0',
                  marginBottom: '-1px'
                }}
              >
                <Icon size={14} color={active ? '#3F68A5' : '#969084'} />
                <span>
                  <span className="block text-[9px] tracking-[0.12em]" style={{ color: active ? '#6A7C99' : '#A09A8E' }}>{item.eyebrow}</span>
                  <span className="mt-0.5 block text-xs">{item.label}</span>
                </span>
                {active && <span className="absolute inset-x-3 bottom-0 h-0.5" style={{ background: '#3F68A5' }} />}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="border-b bg-[#F6F2E7] px-5 py-3" style={{ borderColor: '#D8D1C1' }}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[150px] flex-1 sm:max-w-[220px]">
            <span className="mb-1 flex items-center gap-1.5 text-[10px]" style={{ color: '#837E72' }}><UsersIcon size={11} /> 人物</span>
            <select
              value={selectValue(personFilter)}
              onChange={(event) => { setPersonFilter(fromSelectValue(event.target.value)); setSelection(null); }}
              className="h-9 w-full rounded-md border bg-[#FFFEFA] px-2.5 text-xs outline-none focus:border-[#7890B4] focus:ring-2 focus:ring-[#4A7CF7]/15"
              style={{ borderColor: '#CEC7B7', color: '#3E4653' }}
            >
              <option value="__all__">全部人物</option>
              {people.map((person) => <option key={person.id} value={person.id}>{nodeTitle(person)}</option>)}
            </select>
          </label>
          <label className="min-w-[150px] flex-1 sm:max-w-[220px]">
            <span className="mb-1 flex items-center gap-1.5 text-[10px]" style={{ color: '#837E72' }}><NetworkIcon size={11} /> 关系类型</span>
            <select
              value={selectValue(relationFilter)}
              onChange={(event) => { setRelationFilter(fromSelectValue(event.target.value)); setSelection(null); }}
              className="h-9 w-full rounded-md border bg-[#FFFEFA] px-2.5 text-xs outline-none focus:border-[#7890B4] focus:ring-2 focus:ring-[#4A7CF7]/15"
              style={{ borderColor: '#CEC7B7', color: '#3E4653' }}
            >
              <option value="__all__">全部关系</option>
              {relationTypes.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label className="min-w-[150px] flex-1 sm:max-w-[220px]">
            <span className="mb-1 flex items-center gap-1.5 text-[10px]" style={{ color: '#837E72' }}><FilterIcon size={11} /> 可信程度</span>
            <select
              value={selectValue(confidenceFilter)}
              onChange={(event) => { setConfidenceFilter(fromSelectValue(event.target.value)); setSelection(null); }}
              className="h-9 w-full rounded-md border bg-[#FFFEFA] px-2.5 text-xs outline-none focus:border-[#7890B4] focus:ring-2 focus:ring-[#4A7CF7]/15"
              style={{ borderColor: '#CEC7B7', color: '#3E4653' }}
            >
              <option value="__all__">全部可信度</option>
              {confidences.map((confidence) => <option key={confidence} value={confidence}>{confidence}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={resetFilters}
            disabled={!hasFilters}
            className="flex h-9 items-center gap-1.5 rounded-md border bg-[#FFFEFA] px-3 text-xs transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4A7CF7]/35 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ borderColor: '#CEC7B7', color: '#626A77' }}
          >
            <RotateCcwIcon size={12} /> 重置
          </button>
        </div>

        <div className="mt-3 grid grid-cols-[auto_minmax(120px,1fr)_auto] items-center gap-3">
          <span className="font-mono text-[9px]" style={{ color: '#989285' }}>{chapters.length ? '01' : '--'}</span>
          <input
            type="range"
            min={0}
            max={Math.max(0, chapters.length - 1)}
            step={1}
            value={activeChapterIndex}
            disabled={chapters.length <= 1}
            onChange={(event) => changeChapter(chapters[Number(event.target.value)]?.id || '')}
            aria-label="按章节回看关系"
            aria-valuetext={formatChapter(activeChapter)}
            className="h-1.5 w-full cursor-pointer accent-[#3F68A5] disabled:cursor-not-allowed disabled:opacity-45"
          />
          <span className="min-w-[50px] text-right font-mono text-[9px]" style={{ color: '#989285' }}>{chapters.length ? String(chapters.length).padStart(2, '0') : '--'}</span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0 overflow-y-auto bg-[#FCFAF4]">
          {activeView === 'relationships' && (
            <>
              <RelationshipNetwork nodes={relationshipNodes} edges={relationshipEdges} selection={selection} onSelect={setSelection} />
              <RelationshipLedger edges={relationshipEdges} nodeMap={fullNodeMap} selection={selection} onSelect={setSelection} />
            </>
          )}
          {activeView === 'characters' && (
            <EntityCards nodes={filteredPeople} selection={selection} onSelect={setSelection} emptyTitle="当前章节没有人物记录" emptyText="调整章节或可信程度，查看其他阶段的人物状态。" />
          )}
          {activeView === 'storylines' && (
            <EntityCards nodes={storylines} selection={selection} onSelect={setSelection} emptyTitle="当前筛选下没有故事线" emptyText="故事线会在分析识别出持续推进的事件链后出现在这里。" />
          )}
          {activeView === 'foreshadowing' && (
            <EntityCards nodes={foreshadowing} selection={selection} onSelect={setSelection} emptyTitle="当前筛选下没有伏笔" emptyText="伏笔出现、误导和回收都会保留原文证据，并按章节显示。" />
          )}
          {activeView === 'chapters' && (
            <ChapterImpactView chapter={activeChapter} graph={graph} nodeMap={fullNodeMap} edgeMap={fullEdgeMap} selection={selection} onSelect={setSelection} />
          )}
        </main>
        <DetailPanel graph={graph} node={selectedNode} edge={selectedEdge} nodeMap={fullNodeMap} onOpenEvidence={onOpenEvidence} />
      </div>
    </section>
  );
}
