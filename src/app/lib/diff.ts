export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  text: string;
  oldNumber: number | null;
  newNumber: number | null;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

function splitLines(content: string) {
  if (!content) return [];
  return content.replace(/\r\n/g, '\n').split('\n');
}

function fallbackDiff(before: string[], after: string[]) {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;
  const operations: Array<{ type: DiffLine['type']; text: string }> = [];
  before.slice(0, prefix).forEach((text) => operations.push({ type: 'context', text }));
  before.slice(prefix, before.length - suffix).forEach((text) => operations.push({ type: 'remove', text }));
  after.slice(prefix, after.length - suffix).forEach((text) => operations.push({ type: 'add', text }));
  before.slice(before.length - suffix).forEach((text) => operations.push({ type: 'context', text }));
  return operations;
}

export function buildLineDiff(beforeContent = '', afterContent = ''): DiffLine[] {
  const before = splitLines(beforeContent);
  const after = splitLines(afterContent);
  let operations: Array<{ type: DiffLine['type']; text: string }> = [];

  if (before.length * after.length > 1_500_000) {
    operations = fallbackDiff(before, after);
  } else {
    const matrix = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
    for (let oldIndex = before.length - 1; oldIndex >= 0; oldIndex -= 1) {
      for (let newIndex = after.length - 1; newIndex >= 0; newIndex -= 1) {
        matrix[oldIndex][newIndex] = before[oldIndex] === after[newIndex]
          ? matrix[oldIndex + 1][newIndex + 1] + 1
          : Math.max(matrix[oldIndex + 1][newIndex], matrix[oldIndex][newIndex + 1]);
      }
    }
    let oldIndex = 0;
    let newIndex = 0;
    while (oldIndex < before.length && newIndex < after.length) {
      if (before[oldIndex] === after[newIndex]) {
        operations.push({ type: 'context', text: before[oldIndex] });
        oldIndex += 1;
        newIndex += 1;
      } else if (matrix[oldIndex + 1][newIndex] >= matrix[oldIndex][newIndex + 1]) {
        operations.push({ type: 'remove', text: before[oldIndex] });
        oldIndex += 1;
      } else {
        operations.push({ type: 'add', text: after[newIndex] });
        newIndex += 1;
      }
    }
    while (oldIndex < before.length) operations.push({ type: 'remove', text: before[oldIndex++] });
    while (newIndex < after.length) operations.push({ type: 'add', text: after[newIndex++] });
  }

  let oldNumber = 1;
  let newNumber = 1;
  return operations.map((operation) => {
    const line: DiffLine = {
      ...operation,
      oldNumber: operation.type === 'add' ? null : oldNumber,
      newNumber: operation.type === 'remove' ? null : newNumber
    };
    if (operation.type !== 'add') oldNumber += 1;
    if (operation.type !== 'remove') newNumber += 1;
    return line;
  });
}

export function buildDiffHunks(beforeContent = '', afterContent = '', context = 3): DiffHunk[] {
  const lines = buildLineDiff(beforeContent, afterContent);
  const changed = lines.map((line, index) => line.type === 'context' ? -1 : index).filter((index) => index >= 0);
  if (!changed.length) return [];
  const ranges: Array<[number, number]> = [];
  changed.forEach((index) => {
    const start = Math.max(0, index - context);
    const end = Math.min(lines.length, index + context + 1);
    const previous = ranges[ranges.length - 1];
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else ranges.push([start, end]);
  });
  return ranges.map(([start, end]) => {
    const hunkLines = lines.slice(start, end);
    const oldStart = hunkLines.find((line) => line.oldNumber !== null)?.oldNumber || 0;
    const newStart = hunkLines.find((line) => line.newNumber !== null)?.newNumber || 0;
    const oldCount = hunkLines.filter((line) => line.type !== 'add').length;
    const newCount = hunkLines.filter((line) => line.type !== 'remove').length;
    return { header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, lines: hunkLines };
  });
}

export function countDiffChanges(beforeContent = '', afterContent = '') {
  const lines = buildLineDiff(beforeContent, afterContent);
  return {
    additions: lines.filter((line) => line.type === 'add').length,
    deletions: lines.filter((line) => line.type === 'remove').length
  };
}
