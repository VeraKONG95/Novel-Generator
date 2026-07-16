const crypto = require("node:crypto");
const {
  buildNavigationBatches,
  estimateConservativeTokens,
  extractionPayloadBudget,
  mergeChapterExtractionSegments,
  paragraphEvidenceIndex,
  splitChapterForExtraction
} = require("../services/analysis/chapter-segmentation");

function compact(value) {
  return String(value || "").replace(/\s+/g, "");
}

function evidenceFor(segment, index = 0) {
  const ref = segment.evidenceIndex[index];
  return {
    ...ref,
    chapterId: segment.chapterId,
    sourcePath: segment.sourcePath
  };
}

describe("long chapter segmentation", () => {
  it("splits a long Chinese chapter within budget without losing text or resetting global evidence positions", () => {
    const repeated = "同一句重复段落。";
    const paragraphs = [
      "# 第一章 长夜",
      repeated,
      ...Array.from({ length: 380 }, (_, index) => `第${index + 1}段，林默沿着雨夜中的长街前行，并记下第${index + 1}个路标。`),
      repeated,
      `## 地下室\n${"这是一段没有空行的超长场景，人物持续行动并交换信息。".repeat(650)}`
    ];
    const content = paragraphs.join("\n\n");
    const chapter = {
      id: "123e4567-e89b-42d3-a456-426614174000",
      index: 1,
      title: "长夜",
      path: "chapters/0001.md",
      sourceContent: content
    };

    const first = splitChapterForExtraction(chapter, { contextWindow: 8000, outputReserve: 4096 });
    const second = splitChapterForExtraction(chapter, { contextWindow: 8000, outputReserve: 4096 });

    expect(first.length).toBeGreaterThan(10);
    expect(first.map((item) => item.id)).toEqual(second.map((item) => item.id));
    expect(first.every((item) => item.estimatedPayloadTokens <= item.payloadBudget)).toBe(true);
    expect(first.flatMap((item) => item.evidenceIndex).every((item) => !("text" in item))).toBe(true);
    expect(compact(first.map((item) => item.content).join(""))).toBe(compact(content));

    const repeatedHash = crypto.createHash("sha256").update(repeated).digest("hex");
    const repeatedEvidence = first.flatMap((item) => item.evidenceIndex)
      .filter((item) => item.paragraphHash === repeatedHash);
    expect(repeatedEvidence.map((item) => item.occurrenceIndex)).toEqual([0, 1]);
    expect(repeatedEvidence.map((item) => item.paragraphStart)).toEqual([2, 383]);
  });

  it("namespaces local ids from separate pieces and rewrites their internal references before chapter merge", () => {
    const chapter = {
      id: "chapter-long",
      index: 7,
      title: "双线",
      path: "chapters/0007.md",
      sourceContent: `场景一。${"甲".repeat(2600)}\n\n场景二。${"乙".repeat(2600)}`
    };
    const segments = splitChapterForExtraction(chapter, { contextWindow: 8000, outputReserve: 4096 });
    expect(segments.length).toBeGreaterThan(1);
    const selected = [segments[0], segments.at(-1)];
    const outputs = selected.map((segment, index) => ({
      segment,
      result: {
        mentions: [{ candidateId: "person-1", canonicalName: index ? "顾言" : "林默", type: "character", evidenceRefs: [evidenceFor(segment)] }],
        events: [{ candidateId: "event-1", type: "action", summary: index ? "顾言离开" : "林默抵达", participantIds: ["person-1"], evidenceRefs: [evidenceFor(segment)] }],
        assertions: [{ id: "knowledge-1", propositionId: "proposition-1", scope: "KNOWLEDGE", holderId: "person-1", proposition: index ? "出口已关闭" : "入口仍开放", acquiredByEventId: "event-1", evidenceRefs: [evidenceFor(segment)] }],
        relationChanges: [{ id: "relation-1", relationId: "relation-1", subjectId: "person-1", objectId: "person-1", type: "自我状态", sourceEventIds: ["event-1"], evidenceRefs: [evidenceFor(segment)] }],
        hooks: [],
        styleSamples: []
      }
    }));

    const [merged] = mergeChapterExtractionSegments([chapter], outputs);

    expect(merged.events).toHaveLength(2);
    expect(new Set(merged.events.map((item) => item.candidateId)).size).toBe(2);
    expect(new Set(merged.events.flatMap((item) => item.participantIds)).size).toBe(2);
    expect(new Set(merged.assertions.map((item) => item.id)).size).toBe(2);
    expect(new Set(merged.assertions.map((item) => item.propositionId)).size).toBe(2);
    expect(new Set(merged.relationChanges.map((item) => item.id)).size).toBe(2);
    merged.relationChanges.forEach((relation) => {
      expect(merged.events.some((event) => event.candidateId === relation.sourceEventIds[0])).toBe(true);
    });
    merged.assertions.forEach((assertion) => {
      expect(merged.events.some((event) => event.candidateId === assertion.acquiredByEventId)).toBe(true);
    });
  });

  it("keeps the existing whole-chapter behavior for a short chapter", () => {
    const content = "# 第一章\n\n林默救下顾言。";
    const [segment] = splitChapterForExtraction({
      id: "short", index: 1, title: "雨夜", path: "chapters/0001.md", sourceContent: content
    }, { contextWindow: 8000 });

    expect(segment.partCount).toBe(1);
    expect(segment.content).toBe(paragraphEvidenceIndex(content).map((item) => item.text).join("\n\n"));
  });

  it("partitions a hundred-chapter navigation map without dropping a chapter or exceeding its input budget", () => {
    const chapters = Array.from({ length: 100 }, (_, index) => ({
      id: `chapter-${index + 1}`,
      index: index + 1,
      title: `第 ${index + 1} 章`,
      sourceContent: `开场${index + 1}。${"长篇正文。".repeat(500)}结尾${index + 1}。`
    }));
    const batches = buildNavigationBatches(chapters, { contextWindow: 8000 });
    const budget = extractionPayloadBudget(8000, 2048);

    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flatMap((item) => item.chapterIds)).toEqual(chapters.map((item) => item.id));
    expect(batches.every((item) => estimateConservativeTokens(item.content) <= budget)).toBe(true);
  });
});
