import { describe, expect, it } from 'vitest';
import {
  AnalysisGraph,
  analysisStatusCopy,
  filterGraphAtChapter,
  getOrderedAnalysisChapters,
  resolveActiveAnalysisChapterId,
  shouldLockCreation
} from '../src/app/lib/analysis';

const graph: AnalysisGraph = {
  graphFormatVersion: 1,
  nodes: [
    { id: 'person-lin', type: '人物', canonicalName: '林默', confidence: '原文明示', firstSeen: 'chapter-1' },
    { id: 'person-gu', type: '人物', canonicalName: '顾言', confidence: '原文明示', firstSeen: 'chapter-1' },
    { id: 'person-zhou', type: '人物', canonicalName: '周岚', confidence: '合理推断', firstSeen: 'chapter-3' },
    { id: 'story-main', type: '故事线', canonicalName: '失踪案', confidence: '原文明示', firstSeen: 'chapter-1' }
  ],
  edges: [
    {
      id: 'relation-trust',
      source: 'person-gu',
      target: 'person-lin',
      type: '信任',
      strength: '强',
      confidence: '原文明示',
      narrativeFrom: 'chapter-1',
      narrativeTo: 'chapter-2'
    },
    {
      id: 'relation-hostile',
      source: 'person-zhou',
      target: 'person-lin',
      type: '敌对',
      strength: '一般',
      confidence: '合理推断',
      narrativeFrom: 'chapter-3'
    }
  ],
  chapterIndex: {
    'chapter-3': { chapterId: 'chapter-3', title: '第三章 对峙', index: 3 },
    'chapter-1': { chapterId: 'chapter-1', title: '第一章 来信', index: 1 },
    'chapter-2': { chapterId: 'chapter-2', title: '第二章 旧港', index: 2 }
  },
  evidenceIndex: {}
};

describe('analysis creation lock', () => {
  it('locks creation while imported work is incomplete', () => {
    expect(shouldLockCreation('raw_imported')).toBe(true);
    expect(shouldLockCreation('analyzing')).toBe(true);
    expect(shouldLockCreation('paused')).toBe(true);
    expect(shouldLockCreation('failed')).toBe(true);
    expect(shouldLockCreation('cancelled')).toBe(true);
    expect(shouldLockCreation('syncing-new-status')).toBe(true);
  });

  it('keeps legacy and usable projects writable', () => {
    expect(shouldLockCreation('uninitialized')).toBe(false);
    expect(shouldLockCreation('ready')).toBe(false);
    expect(shouldLockCreation({ status: 'degraded', blockingGaps: [] })).toBe(false);
    expect(shouldLockCreation({ status: 'degraded', blockingGaps: ['主要人物身份仍有冲突'] })).toBe(true);
  });
});

describe('analysis status copy', () => {
  it('returns stable user-facing labels', () => {
    expect(analysisStatusCopy('analyzing').shortLabel).toBe('分析中');
    expect(analysisStatusCopy('ready').label).toContain('就绪');
    expect(analysisStatusCopy('unexpected').shortLabel).toBe('同步中');
  });
});

describe('graph chapter filtering', () => {
  it('sorts chapter records by their explicit order', () => {
    expect(getOrderedAnalysisChapters(graph).map((chapter) => chapter.id)).toEqual([
      'chapter-1',
      'chapter-2',
      'chapter-3'
    ]);
  });

  it('falls back to the latest remaining chapter after the selected chapter is deleted', () => {
    const chapters = getOrderedAnalysisChapters(graph).filter((chapter) => chapter.id !== 'chapter-2');
    expect(resolveActiveAnalysisChapterId(chapters, 'chapter-2')).toBe('chapter-3');
  });

  it('shows only relationships active at the selected chapter', () => {
    expect(filterGraphAtChapter(graph, { chapterId: 'chapter-1' }).edges.map((edge) => edge.id)).toEqual([
      'relation-trust'
    ]);
    expect(filterGraphAtChapter(graph, { chapterId: 'chapter-2' }).edges.map((edge) => edge.id)).toEqual([
      'relation-trust'
    ]);
    expect(filterGraphAtChapter(graph, { chapterId: 'chapter-3' }).edges.map((edge) => edge.id)).toEqual([
      'relation-hostile'
    ]);
  });

  it('keeps an active person visible after their most recent appearance chapter', () => {
    const graphWithQuietCharacter: AnalysisGraph = {
      ...graph,
      nodes: [
        ...graph.nodes,
        { id: 'person-quiet', type: '人物', canonicalName: '静默者', status: 'active', firstSeen: 'chapter-1', lastSeen: 'chapter-2' }
      ]
    };

    expect(filterGraphAtChapter(graphWithQuietCharacter, { chapterId: 'chapter-3' }).nodes.map((node) => node.id))
      .toContain('person-quiet');
  });

  it('combines person, relationship and confidence filters', () => {
    const filtered = filterGraphAtChapter(graph, {
      chapterId: 'chapter-3',
      personIds: ['person-lin'],
      relationTypes: ['敌对'],
      confidences: ['合理推断']
    });

    expect(filtered.edges.map((edge) => edge.id)).toEqual(['relation-hostile']);
    expect(filtered.nodes.map((node) => node.id).sort()).toEqual(['person-lin', 'person-zhou']);
  });

  it('keeps unknown chapter boundaries visible rather than inventing precision', () => {
    const uncertainGraph: AnalysisGraph = {
      ...graph,
      edges: [{
        id: 'relation-uncertain',
        source: 'person-gu',
        target: 'person-lin',
        type: '隐瞒',
        narrativeFrom: 'unknown-event'
      }]
    };

    expect(filterGraphAtChapter(uncertainGraph, { chapterId: 'chapter-1' }).edges).toHaveLength(1);
  });
});
