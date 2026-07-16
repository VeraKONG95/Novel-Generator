export type AnalysisStatus =
  | 'uninitialized'
  | 'raw_imported'
  | 'analyzing'
  | 'paused'
  | 'ready'
  | 'degraded'
  | 'failed'
  | 'cancelled';

export type AnalysisGraphView =
  | 'relationships'
  | 'characters'
  | 'storylines'
  | 'foreshadowing'
  | 'chapters';

export interface AnalysisRunSummary {
  status: AnalysisStatus | string;
  runId?: string;
  workflowId?: string;
  generationId?: string;
  stage?: string;
  stageLabel?: string;
  blockingGaps?: string[];
  nonBlockingGaps?: string[];
  updatedAt?: string;
  [key: string]: unknown;
}

export interface AnalysisEvidenceRef {
  refId?: string;
  recordType?: string;
  recordId?: string;
  sourcePath?: string;
  chapterId?: string;
  sceneId?: string;
  paragraphHash?: string;
  occurrenceIndex?: number;
  paragraphStart?: number;
  paragraphEnd?: number;
  excerpt?: string;
  stale?: boolean;
  type?: string;
  [key: string]: unknown;
}

type ChapterBoundary =
  | string
  | number
  | null
  | undefined
  | {
      chapterId?: string;
      chapterIndex?: number;
      index?: number;
      order?: number;
      number?: number;
      [key: string]: unknown;
    };

export interface AnalysisGraphNode {
  id: string;
  label?: string;
  type?: string;
  canonicalName?: string;
  aliases?: string[];
  status?: string;
  confidence?: string;
  firstSeen?: ChapterBoundary;
  lastSeen?: ChapterBoundary;
  validFrom?: ChapterBoundary;
  validTo?: ChapterBoundary;
  evidenceRefs?: AnalysisEvidenceRef[];
  [key: string]: unknown;
}

export interface AnalysisGraphEdge {
  id: string;
  source: string;
  target: string;
  subjectId?: string;
  objectId?: string;
  type?: string;
  status?: string;
  strength?: string;
  scope?: string;
  holderId?: string;
  confidence?: string;
  validFrom?: ChapterBoundary;
  validTo?: ChapterBoundary;
  narrativeFrom?: ChapterBoundary;
  narrativeTo?: ChapterBoundary;
  storyTimeFrom?: ChapterBoundary;
  storyTimeTo?: ChapterBoundary;
  sourceEventIds?: string[];
  evidenceRefs?: AnalysisEvidenceRef[];
  [key: string]: unknown;
}

export interface AnalysisChapterRecord {
  chapterId?: string;
  title?: string;
  chapterTitle?: string;
  label?: string;
  sourcePath?: string;
  index?: number;
  order?: number;
  chapterIndex?: number;
  number?: number;
  entityIds?: string[];
  eventIds?: string[];
  assertionIds?: string[];
  relationIds?: string[];
  storylineIds?: string[];
  foreshadowingIds?: string[];
  [key: string]: unknown;
}

export interface AnalysisGraph {
  graphFormatVersion?: number;
  nodes: AnalysisGraphNode[];
  edges: AnalysisGraphEdge[];
  chapterIndex: Record<string, AnalysisChapterRecord>;
  evidenceIndex: Record<string, AnalysisEvidenceRef>;
}

export interface OrderedAnalysisChapter {
  id: string;
  label: string;
  sourcePath: string;
  position: number;
  record: AnalysisChapterRecord;
}

export interface GraphFilterOptions {
  chapterId?: string;
  personIds?: string[];
  relationTypes?: string[];
  confidences?: string[];
}

export interface AnalysisStatusCopy {
  label: string;
  description: string;
  shortLabel: string;
}

const STATUS_COPY: Record<string, AnalysisStatusCopy> = {
  uninitialized: {
    label: '尚未建立关系图谱',
    shortLabel: '未分析',
    description: '可以继续现有创作，也可以开始分析并建立可回溯的关系图谱。'
  },
  raw_imported: {
    label: '正文已经就位',
    shortLabel: '等待分析',
    description: '小说正文已安全保存，正在等待分析流程开始。'
  },
  analyzing: {
    label: '正在整理小说证据',
    shortLabel: '分析中',
    description: '人物、事件和关系正在分批整理；这段时间可以查看，但暂不能续写。'
  },
  paused: {
    label: '分析已平滑暂停',
    shortLabel: '已暂停',
    description: '已停止派发新工作，完成的结果仍然保留，可随时继续。'
  },
  ready: {
    label: '关系图谱已经就绪',
    shortLabel: '可创作',
    description: '关键材料已经整理完成，图谱、规划和续写均可正常使用。'
  },
  degraded: {
    label: '主要分析已经完成',
    shortLabel: '有缺口',
    description: '关键材料可用，少量非关键内容仍可稍后补跑。'
  },
  failed: {
    label: '分析未能完成',
    shortLabel: '需处理',
    description: '已完成的中间结果仍然保留，处理失败项后即可继续。'
  },
  cancelled: {
    label: '本轮分析已取消',
    shortLabel: '已取消',
    description: '没有发布不完整结果；重新开始时会复用仍然有效的工作。'
  }
};

const PERSON_TYPES = new Set(['人物', 'person', 'character', 'characters']);

function normalizedText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizedType(value: unknown) {
  return normalizedText(value).toLowerCase();
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(normalizedText).filter(Boolean) : [];
}

function finiteNumber(...values: unknown[]) {
  for (const value of values) {
    const number = typeof value === 'number' ? value : Number.NaN;
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function numericHint(value: unknown) {
  const matches = normalizedText(value).match(/\d+/g);
  if (!matches?.length) return null;
  const number = Number(matches[matches.length - 1]);
  return Number.isFinite(number) ? number : null;
}

function chapterLabel(id: string, record: AnalysisChapterRecord) {
  const explicit = normalizedText(record.label || record.chapterTitle || record.title);
  if (explicit) return explicit;
  const number = finiteNumber(record.number, record.chapterIndex, record.index, record.order) ?? numericHint(id);
  return number == null ? id : `第 ${number} 章`;
}

export function getOrderedAnalysisChapters(graph: Pick<AnalysisGraph, 'chapterIndex'>) {
  return Object.entries(graph.chapterIndex || {})
    .map<OrderedAnalysisChapter>(([id, record], insertionIndex) => {
      const explicitPosition = finiteNumber(record.order, record.chapterIndex, record.index, record.number);
      const hintedPosition = numericHint(id) ?? numericHint(record.sourcePath);
      return {
        id,
        label: chapterLabel(id, record),
        sourcePath: normalizedText(record.sourcePath),
        position: explicitPosition ?? hintedPosition ?? 100_000 + insertionIndex,
        record
      };
    })
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id, 'zh-CN'));
}

export function resolveActiveAnalysisChapterId(chapters: OrderedAnalysisChapter[], requestedChapterId?: string) {
  if (requestedChapterId && chapters.some((chapter) => chapter.id === requestedChapterId)) return requestedChapterId;
  return chapters[chapters.length - 1]?.id || '';
}

function positionOfBoundary(boundary: ChapterBoundary, chapters: OrderedAnalysisChapter[]) {
  if (boundary == null || boundary === '') return null;
  if (typeof boundary === 'number') return boundary;

  if (typeof boundary === 'object') {
    if (boundary.chapterId) return positionOfBoundary(boundary.chapterId, chapters);
    return finiteNumber(boundary.order, boundary.chapterIndex, boundary.index, boundary.number);
  }

  const exactIndex = chapters.findIndex((chapter) => chapter.id === boundary);
  if (exactIndex >= 0) return chapters[exactIndex].position;

  const embedded = chapters.find((chapter) => boundary.includes(chapter.id));
  if (embedded) return embedded.position;

  const hint = numericHint(boundary);
  if (hint == null) return null;
  const hintedChapter = chapters.find((chapter) => chapter.position === hint || numericHint(chapter.id) === hint);
  return hintedChapter?.position ?? hint;
}

function recordIsActiveAtChapter(
  record: AnalysisGraphNode | AnalysisGraphEdge,
  selectedPosition: number | null,
  chapters: OrderedAnalysisChapter[]
) {
  if (selectedPosition == null) return true;

  const isEdge = typeof (record as AnalysisGraphEdge).source === 'string';
  const startBoundary: ChapterBoundary = isEdge
    ? (record as AnalysisGraphEdge).narrativeFrom ?? (record as AnalysisGraphEdge).validFrom
    : (record as AnalysisGraphNode).validFrom ?? (record as AnalysisGraphNode).firstSeen;
  const endBoundary: ChapterBoundary = isEdge
    ? (record as AnalysisGraphEdge).narrativeTo ?? (record as AnalysisGraphEdge).validTo
    : (record as AnalysisGraphNode).validTo;
  const start = positionOfBoundary(startBoundary, chapters);
  const end = positionOfBoundary(endBoundary, chapters);

  if (start != null && selectedPosition < start) return false;
  if (end != null && selectedPosition > end) return false;
  return true;
}

export function isPersonNode(node: Pick<AnalysisGraphNode, 'type'>) {
  return PERSON_TYPES.has(normalizedType(node.type));
}

export function analysisStatusCopy(status: AnalysisStatus | string | null | undefined): AnalysisStatusCopy {
  const key = normalizedText(status) || 'uninitialized';
  return STATUS_COPY[key] || {
    label: '正在读取分析状态',
    shortLabel: '同步中',
    description: '项目文件保持可查看，状态同步完成后会自动更新。'
  };
}

export function shouldLockCreation(
  statusOrRun: AnalysisStatus | string | AnalysisRunSummary | null | undefined
) {
  const run = typeof statusOrRun === 'object' && statusOrRun !== null ? statusOrRun : null;
  const status = normalizedText(run?.status ?? statusOrRun);
  const blockingGaps = stringList(run?.blockingGaps);

  if (!status || status === 'uninitialized' || status === 'ready') return false;
  if (status === 'degraded') return blockingGaps.length > 0;
  return true;
}

export function filterGraphAtChapter(graph: AnalysisGraph, options: GraphFilterOptions = {}): AnalysisGraph {
  const chapters = getOrderedAnalysisChapters(graph);
  const selectedChapter = options.chapterId
    ? chapters.find((chapter) => chapter.id === options.chapterId)
    : null;
  const selectedPosition = selectedChapter?.position ?? null;
  const personIds = new Set(stringList(options.personIds));
  const relationTypes = new Set(stringList(options.relationTypes));
  const confidences = new Set(stringList(options.confidences));

  const edges = (graph.edges || []).filter((edge) => {
    if (!recordIsActiveAtChapter(edge, selectedPosition, chapters)) return false;
    if (personIds.size > 0 && !personIds.has(edge.source) && !personIds.has(edge.target)) return false;
    if (relationTypes.size > 0 && !relationTypes.has(normalizedText(edge.type))) return false;
    if (confidences.size > 0 && !confidences.has(normalizedText(edge.confidence))) return false;
    return true;
  });

  const connectedNodeIds = new Set<string>();
  edges.forEach((edge) => {
    connectedNodeIds.add(edge.source);
    connectedNodeIds.add(edge.target);
  });

  const hasRelationshipFilter = personIds.size > 0 || relationTypes.size > 0;
  const nodes = (graph.nodes || []).filter((node) => {
    if (!recordIsActiveAtChapter(node, selectedPosition, chapters)) return false;
    if (connectedNodeIds.has(node.id)) return true;
    if (personIds.size > 0) return personIds.has(node.id);
    if (hasRelationshipFilter) return false;
    if (confidences.size > 0 && !confidences.has(normalizedText(node.confidence))) return false;
    return true;
  });

  return {
    ...graph,
    nodes,
    edges,
    chapterIndex: graph.chapterIndex || {},
    evidenceIndex: graph.evidenceIndex || {}
  };
}

export function evidenceForRecord(
  graph: Pick<AnalysisGraph, 'evidenceIndex'>,
  recordType: 'entity' | 'relation' | 'event' | 'assertion' | 'override',
  recordId: string,
  embedded: AnalysisEvidenceRef[] = []
) {
  const seen = new Set<string>();
  return [
    ...embedded,
    ...Object.values(graph.evidenceIndex || {}).filter(
      (reference) => reference.recordType === recordType && reference.recordId === recordId
    )
  ].filter((reference) => {
    const identity = normalizedText(reference.refId)
      || [reference.sourcePath, reference.chapterId, reference.paragraphHash, reference.occurrenceIndex].join(':');
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function graphRecordLabel(record: AnalysisGraphNode | AnalysisGraphEdge) {
  if ('source' in record) return normalizedText(record.type) || '未标注关系';
  return normalizedText(record.label || record.canonicalName) || record.id;
}

export function humanizeAnalysisValue(value: unknown) {
  if (value == null || value === '') return '未记录';
  if (Array.isArray(value)) return value.map(normalizedText).filter(Boolean).join('、') || '未记录';
  if (typeof value === 'object') {
    const boundary = value as Record<string, unknown>;
    return normalizedText(boundary.chapterId)
      || normalizedText(boundary.label)
      || normalizedText(boundary.title)
      || '已记录';
  }
  return normalizedText(value);
}
