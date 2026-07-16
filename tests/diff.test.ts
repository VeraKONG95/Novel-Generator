import { describe, expect, it } from 'vitest';
import { buildDiffHunks, buildLineDiff, countDiffChanges } from '../src/app/lib/diff';

describe('file diff', () => {
  it('marks added and removed lines with their original line numbers', () => {
    const lines = buildLineDiff('第一段\n旧句\n结尾', '第一段\n新句\n结尾');
    expect(lines.map((line) => line.type)).toEqual(['context', 'remove', 'add', 'context']);
    expect(lines[1]).toMatchObject({ oldNumber: 2, newNumber: null, text: '旧句' });
    expect(lines[2]).toMatchObject({ oldNumber: null, newNumber: 2, text: '新句' });
    expect(countDiffChanges('旧句', '新句')).toEqual({ additions: 1, deletions: 1 });
  });

  it('keeps only nearby context around separate changes', () => {
    const before = Array.from({ length: 14 }, (_, index) => `第 ${index + 1} 行`).join('\n');
    const after = before.replace('第 2 行', '第二行已修改').replace('第 13 行', '第十三行已修改');
    const hunks = buildDiffHunks(before, after, 1);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].lines.some((line) => line.text === '第二行已修改')).toBe(true);
    expect(hunks[1].lines.some((line) => line.text === '第十三行已修改')).toBe(true);
  });
});
