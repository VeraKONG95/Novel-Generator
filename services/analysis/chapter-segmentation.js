const crypto = require("node:crypto");

const EXTRACTION_FIELDS = ["mentions", "events", "assertions", "relationChanges", "hooks", "styleSamples"];

function list(value) {
  return Array.isArray(value) ? value : [];
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function normalizeParagraph(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function estimateConservativeTokens(value) {
  const source = typeof value === "string" ? value : JSON.stringify(value ?? null);
  let tokens = 0;
  for (const character of source) {
    const codePoint = character.codePointAt(0) || 0;
    if (/\s/.test(character)) tokens += 0.15;
    else if (codePoint <= 0x7f) tokens += 0.3;
    else tokens += 1;
  }
  return Math.ceil(tokens * 1.2) + 16;
}

function truncateToTokenBudget(value, tokenBudget) {
  const source = String(value || "");
  const budget = Math.max(1, Math.floor(Number(tokenBudget) || 1));
  if (estimateConservativeTokens(source) <= budget) return source;
  let low = 0;
  let high = source.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateConservativeTokens(source.slice(0, middle)) <= budget) low = middle;
    else high = middle - 1;
  }
  return `${source.slice(0, Math.max(0, low - 1))}…`;
}

function extractionPayloadBudget(contextWindow, outputReserve = 4096) {
  const window = Math.max(8000, Number(contextWindow) || 128000);
  const output = Math.max(1024, Math.min(Number(outputReserve) || 4096, Math.floor(window * 0.45)));
  return Math.max(768, Math.floor(window * 0.9) - output - 1100);
}

function paragraphEvidenceIndex(content) {
  const paragraphs = String(content || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  const occurrences = new Map();
  return paragraphs.map((text, index) => {
    const paragraphHash = sha256(normalizeParagraph(text));
    const occurrenceIndex = occurrences.get(paragraphHash) || 0;
    occurrences.set(paragraphHash, occurrenceIndex + 1);
    return {
      paragraphStart: index + 1,
      paragraphEnd: index + 1,
      paragraphHash,
      occurrenceIndex,
      excerpt: text.slice(0, 160),
      text
    };
  });
}

function compactEvidence(paragraph, excerpt = paragraph.excerpt) {
  return {
    paragraphStart: paragraph.paragraphStart,
    paragraphEnd: paragraph.paragraphEnd,
    paragraphHash: paragraph.paragraphHash,
    occurrenceIndex: paragraph.occurrenceIndex,
    excerpt: String(excerpt || "").slice(0, 160)
  };
}

function splitLongText(text, tokenBudget) {
  const source = String(text || "");
  if (estimateConservativeTokens(source) <= tokenBudget) return [source];
  const pieces = [];
  let offset = 0;
  while (offset < source.length) {
    let end = offset;
    let tokens = 0;
    while (end < source.length && tokens < tokenBudget) {
      const character = source[end];
      const next = estimateConservativeTokens(character) - 16;
      if (end > offset && tokens + next > tokenBudget) break;
      tokens += Math.max(0.1, next);
      end += 1;
    }
    if (end <= offset) end = offset + 1;
    if (end < source.length) {
      const minimum = offset + Math.floor((end - offset) * 0.65);
      for (let cursor = end - 1; cursor >= minimum; cursor -= 1) {
        if (/[。！？!?；;\n]/.test(source[cursor])) {
          end = cursor + 1;
          break;
        }
      }
    }
    pieces.push(source.slice(offset, end));
    offset = end;
  }
  return pieces;
}

function segmentPayloadTokens(segment) {
  return estimateConservativeTokens(segment.content) + estimateConservativeTokens({
    chapterId: segment.chapterId,
    chapterIndex: segment.chapterIndex,
    sourcePath: segment.sourcePath,
    partIndex: segment.partIndex,
    partCount: segment.partCount,
    evidenceIndex: segment.evidenceIndex
  });
}

function splitChapterForExtraction(chapter, { contextWindow, outputReserve = 4096 } = {}) {
  const sourceContent = String(chapter?.sourceContent ?? chapter?.content ?? "");
  const paragraphs = paragraphEvidenceIndex(sourceContent);
  const payloadBudget = extractionPayloadBudget(contextWindow, outputReserve);
  const unitBudget = Math.max(256, Math.floor(payloadBudget * 0.72));
  const units = [];
  for (const paragraph of paragraphs) {
    const metadata = compactEvidence(paragraph);
    const textBudget = Math.max(128, unitBudget - estimateConservativeTokens(metadata));
    const pieces = splitLongText(paragraph.text, textBudget);
    pieces.forEach((text, pieceIndex) => units.push({
      text,
      evidence: compactEvidence(paragraph, text.trim().slice(0, 160)),
      paragraphStart: paragraph.paragraphStart,
      paragraphEnd: paragraph.paragraphEnd,
      sceneBoundary: pieceIndex === 0 && /^(?:#{1,6}\s|\*{3,}$|-{3,}$|第.+(?:场|幕|节))/u.test(text.trim())
    }));
  }
  if (!units.length) {
    units.push({
      text: "（空章节）",
      evidence: null,
      paragraphStart: 0,
      paragraphEnd: 0,
      sceneBoundary: false
    });
  }

  const groups = [];
  let current = [];
  const fits = (items) => {
    const content = items.map((item) => item.text).join("\n\n");
    const evidenceIndex = items.map((item) => item.evidence).filter(Boolean);
    return estimateConservativeTokens(content) + estimateConservativeTokens({
      chapterId: chapter.id || chapter.chapterId,
      chapterIndex: chapter.index,
      sourcePath: chapter.path || chapter.sourcePath,
      evidenceIndex
    }) <= payloadBudget - 128;
  };
  for (const unit of units) {
    if (current.length && (unit.sceneBoundary || !fits([...current, unit]))) {
      groups.push(current);
      current = [];
    }
    current.push(unit);
    if (!fits(current) && current.length > 1) {
      const last = current.pop();
      groups.push(current);
      current = [last];
    }
  }
  if (current.length) groups.push(current);

  const chapterId = String(chapter.id || chapter.chapterId || "chapter");
  const sourcePath = String(chapter.path || chapter.sourcePath || "");
  return groups.map((items, index) => {
    const paragraphStart = items[0]?.paragraphStart || 0;
    const paragraphEnd = items.at(-1)?.paragraphEnd || paragraphStart;
    const partIndex = index + 1;
    const partCount = groups.length;
    const segment = {
      id: `${chapterId}:segment:${String(partIndex).padStart(4, "0")}:p${paragraphStart}-${paragraphEnd}`,
      title: `${chapter.title || `第 ${chapter.index || "?"} 章`}${partCount > 1 ? `（片段 ${partIndex}/${partCount}）` : ""}`,
      chapterId,
      chapterIndex: chapter.index,
      chapterTitle: chapter.title || "",
      sourcePath,
      partIndex,
      partCount,
      paragraphStart,
      paragraphEnd,
      content: items.map((item) => item.text).join("\n\n"),
      evidenceIndex: items.map((item) => item.evidence).filter(Boolean),
      payloadBudget
    };
    segment.estimatedPayloadTokens = segmentPayloadTokens(segment);
    return segment;
  });
}

function bisectExtractionSegment(segment) {
  const parts = String(segment?.content || "").split(/\n\s*\n/);
  const evidence = list(segment?.evidenceIndex);
  let leftParts;
  let rightParts;
  let leftEvidence;
  let rightEvidence;
  if (parts.length > 1 && parts.length === evidence.length) {
    const middle = Math.ceil(parts.length / 2);
    leftParts = parts.slice(0, middle);
    rightParts = parts.slice(middle);
    leftEvidence = evidence.slice(0, middle);
    rightEvidence = evidence.slice(middle);
  } else {
    const source = String(segment?.content || "");
    let middle = Math.floor(source.length / 2);
    const minimum = Math.floor(source.length * 0.3);
    const maximum = Math.ceil(source.length * 0.7);
    for (let offset = 0; offset <= Math.max(middle - minimum, maximum - middle); offset += 1) {
      for (const candidate of [middle + offset, middle - offset]) {
        if (candidate >= minimum && candidate <= maximum && /[。！？!?；;\n]/.test(source[candidate] || "")) {
          middle = candidate + 1;
          offset = Number.MAX_SAFE_INTEGER;
          break;
        }
      }
    }
    if (middle <= 0 || middle >= source.length) return [];
    leftParts = [source.slice(0, middle)];
    rightParts = [source.slice(middle)];
    leftEvidence = evidence;
    rightEvidence = evidence;
  }
  if (!leftParts.length || !rightParts.length) return [];
  const create = (suffix, contentParts, refs) => {
    const paragraphStart = refs[0]?.paragraphStart ?? segment.paragraphStart;
    const paragraphEnd = refs.at(-1)?.paragraphEnd ?? segment.paragraphEnd;
    const child = {
      ...segment,
      id: `${segment.id}:split-${suffix}`,
      title: `${segment.title}（自动缩小 ${suffix === "a" ? "1" : "2"}/2）`,
      partCount: Math.max(2, Number(segment.partCount) || 1),
      content: contentParts.join("\n\n"),
      evidenceIndex: refs.map((ref) => ({ ...ref })),
      paragraphStart,
      paragraphEnd,
      splitDepth: Number(segment.splitDepth || 0) + 1
    };
    child.estimatedPayloadTokens = segmentPayloadTokens(child);
    return child;
  };
  return [create("a", leftParts, leftEvidence), create("b", rightParts, rightEvidence)];
}

function evidenceKey(ref) {
  return [ref?.chapterId, ref?.paragraphHash, ref?.occurrenceIndex ?? 0, ref?.type, ref?.overrideId]
    .map((item) => String(item ?? ""))
    .join("|");
}

function uniqueEvidence(refs) {
  const seen = new Set();
  return list(refs).filter((ref) => {
    const key = evidenceKey(ref);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validateSegmentEvidence(segment, result) {
  const allowed = new Set(segment.evidenceIndex.map((ref) =>
    [segment.chapterId, ref.paragraphHash, ref.occurrenceIndex ?? 0].join("|")
  ));
  const records = [
    ...list(result.mentions),
    ...list(result.events),
    ...list(result.assertions),
    ...list(result.relationChanges),
    ...list(result.hooks),
    ...list(result.styleSamples)
  ];
  for (const record of records) {
    for (const ref of list(record?.evidenceRefs)) {
      const key = [String(ref?.chapterId || ""), String(ref?.paragraphHash || ""), Number(ref?.occurrenceIndex || 0)].join("|");
      if (!allowed.has(key)) {
        throw new Error(`R03 返回了片段范围外的原文证据：${segment.title}`);
      }
    }
  }
}

function namespaceSegmentResult(segment, value) {
  validateSegmentEvidence(segment, value);
  const result = Object.fromEntries(EXTRACTION_FIELDS.map((field) => [field, list(value?.[field]).map((item) => ({ ...item }))]));
  if (segment.partCount <= 1) return result;
  const prefix = `${segment.id}::`;
  const candidateMap = new Map();
  const eventMap = new Map();
  const namespace = (raw, map) => {
    const source = String(raw || "").trim();
    if (!source) return source;
    if (!map.has(source)) map.set(source, `${prefix}${source}`);
    return map.get(source);
  };
  result.mentions = result.mentions.map((item) => {
    const rawId = item.candidateId || item.entityId || item.id;
    const candidateId = namespace(rawId, candidateMap);
    return { ...item, ...(candidateId ? { candidateId, id: candidateId } : {}), segmentId: segment.id };
  });
  result.events = result.events.map((item) => {
    const rawId = item.candidateId || item.eventId || item.id;
    const candidateId = namespace(rawId, eventMap);
    return {
      ...item,
      ...(candidateId ? { candidateId, id: candidateId } : {}),
      participantIds: list(item.participantIds || item.participants).map((id) => namespace(id, candidateMap)),
      sceneId: item.sceneId || segment.id,
      segmentId: segment.id
    };
  });
  result.assertions = result.assertions.map((item) => ({
    ...item,
    ...(item.id ? { id: `${prefix}${item.id}` } : {}),
    ...(item.assertionId ? { assertionId: `${prefix}${item.assertionId}` } : {}),
    ...(item.propositionId ? { propositionId: `${prefix}${item.propositionId}` } : {}),
    ...(item.holderId ? { holderId: namespace(item.holderId, candidateMap) } : {}),
    ...(list(item.subjectIds).length ? { subjectIds: list(item.subjectIds).map((id) => namespace(id, candidateMap)) } : {}),
    ...(item.acquiredByEventId ? { acquiredByEventId: namespace(item.acquiredByEventId, eventMap) } : {}),
    ...(item.invalidatedByEventId ? { invalidatedByEventId: namespace(item.invalidatedByEventId, eventMap) } : {}),
    segmentId: segment.id
  }));
  result.relationChanges = result.relationChanges.map((item) => ({
    ...item,
    ...(item.id ? { id: `${prefix}${item.id}` } : {}),
    ...(item.relationId ? { relationId: `${prefix}${item.relationId}` } : {}),
    subjectId: namespace(item.subjectId || item.subject, candidateMap),
    objectId: namespace(item.objectId || item.object, candidateMap),
    ...(item.holderId ? { holderId: namespace(item.holderId, candidateMap) } : {}),
    sourceEventIds: list(item.sourceEventIds).map((id) => namespace(id, eventMap)),
    segmentId: segment.id
  }));
  result.hooks = result.hooks.map((item) => ({
    ...item,
    id: item.id ? `${prefix}${item.id}` : item.id,
    setupEventIds: list(item.setupEventIds).map((id) => namespace(id, eventMap)),
    payoffEventIds: list(item.payoffEventIds).map((id) => namespace(id, eventMap)),
    segmentId: segment.id
  }));
  result.styleSamples = result.styleSamples.map((item) => ({ ...item, segmentId: segment.id }));
  return result;
}

function mergeRecords(records, keyFor) {
  const merged = new Map();
  for (const record of records) {
    const key = keyFor(record);
    if (!merged.has(key)) {
      merged.set(key, { ...record, evidenceRefs: uniqueEvidence(record.evidenceRefs) });
      continue;
    }
    const previous = merged.get(key);
    previous.evidenceRefs = uniqueEvidence([...list(previous.evidenceRefs), ...list(record.evidenceRefs)]);
  }
  return [...merged.values()];
}

function mergeChapterExtractionSegments(chapters, outputs) {
  const byChapter = new Map();
  for (const output of outputs) {
    const chapterId = output.segment.chapterId;
    const bucket = byChapter.get(chapterId) || Object.fromEntries(EXTRACTION_FIELDS.map((field) => [field, []]));
    const normalized = namespaceSegmentResult(output.segment, output.result);
    EXTRACTION_FIELDS.forEach((field) => bucket[field].push(...normalized[field]));
    byChapter.set(chapterId, bucket);
  }
  return list(chapters).map((chapter) => {
    const chapterId = String(chapter.id || chapter.chapterId || "");
    const bucket = byChapter.get(chapterId) || Object.fromEntries(EXTRACTION_FIELDS.map((field) => [field, []]));
    return {
      ...bucket,
      mentions: mergeRecords(bucket.mentions, (item) => `${item.candidateId || item.id}|${item.canonicalName || item.name}|${evidenceKey(item.evidenceRefs?.[0])}`),
      events: mergeRecords(bucket.events, (item) => `${item.type}|${item.summary || item.action}|${evidenceKey(item.evidenceRefs?.[0])}`),
      assertions: mergeRecords(bucket.assertions, (item) => `${item.scope}|${item.holderId}|${item.proposition}|${evidenceKey(item.evidenceRefs?.[0])}`),
      relationChanges: mergeRecords(bucket.relationChanges, (item) => `${item.subjectId}|${item.objectId}|${item.type}|${evidenceKey(item.evidenceRefs?.[0])}`),
      hooks: mergeRecords(bucket.hooks, (item) => `${item.title || item.id}|${evidenceKey(item.evidenceRefs?.[0])}`),
      styleSamples: mergeRecords(bucket.styleSamples, (item) => `${item.excerpt}|${evidenceKey(item.evidenceRefs?.[0])}`),
      _chapterId: chapterId,
      _chapterIndex: chapter.index,
      _sourcePath: chapter.path || chapter.sourcePath || ""
    };
  });
}

function navigationEntries(chapters) {
  return list(chapters).map((chapter) => {
    const content = String(chapter.sourceContent ?? chapter.content ?? "");
    const sampleSize = 600;
    const first = content.slice(0, sampleSize);
    const last = content.length > sampleSize ? content.slice(-sampleSize) : "";
    return {
      id: String(chapter.id || chapter.chapterId || ""),
      title: String(chapter.title || `第 ${chapter.index || "?"} 章`),
      index: chapter.index,
      content: `第 ${chapter.index || "?"} 章 ${chapter.title || ""}\n开头：${first}${last ? `\n结尾：${last}` : ""}`
    };
  });
}

function partitionByTokenBudget(items, budget, valueFor = (item) => item) {
  const batches = [];
  let current = [];
  let used = 0;
  for (const item of list(items)) {
    const tokens = estimateConservativeTokens(valueFor(item));
    if (current.length && used + tokens > budget) {
      batches.push(current);
      current = [];
      used = 0;
    }
    current.push(item);
    used += tokens;
  }
  if (current.length) batches.push(current);
  return batches.length ? batches : [[]];
}

function buildNavigationBatches(chapters, { contextWindow } = {}) {
  const budget = extractionPayloadBudget(contextWindow, 2048);
  return partitionByTokenBudget(navigationEntries(chapters), budget, (item) => item.content)
    .map((entries, index, batches) => ({
      id: `book-map-${index + 1}`,
      title: batches.length > 1 ? `全书导航 ${index + 1}/${batches.length}` : "全书目录与抽样",
      content: entries.map((entry) => entry.content).join("\n\n"),
      chapterIds: entries.map((entry) => entry.id),
      partIndex: index + 1,
      partCount: batches.length
    }));
}

module.exports = {
  bisectExtractionSegment,
  buildNavigationBatches,
  estimateConservativeTokens,
  extractionPayloadBudget,
  mergeChapterExtractionSegments,
  paragraphEvidenceIndex,
  partitionByTokenBudget,
  segmentPayloadTokens,
  splitChapterForExtraction,
  truncateToTokenBudget
};
