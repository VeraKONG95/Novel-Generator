const { selectWritingContext } = require("../services/analysis/context-selector");

describe("writing context selector", () => {
  it("keeps current relationships and character knowledge while excluding ended relationships", () => {
    const selected = selectWritingContext({
      goal: "让林默和顾言在灯塔会面",
      targetCharacterIds: ["char-lin"],
      targetChapterIndex: 5,
      contextWindow: 32000,
      currentStage: "林默刚抵达灯塔。",
      style: "克制，短句。",
      entities: [
        { id: "char-lin", type: "character", canonicalName: "林默" },
        { id: "char-gu", type: "character", canonicalName: "顾言" },
        { id: "char-old", type: "character", canonicalName: "旧盟友" }
      ],
      relations: [
        { id: "rel-current", subjectId: "char-lin", objectId: "char-gu", type: "合作", validFrom: 3, validTo: null, status: "active" },
        { id: "rel-ended", subjectId: "char-lin", objectId: "char-old", type: "合作", validFrom: 1, validTo: 2, status: "ended" }
      ],
      assertions: [
        { id: "know-1", scope: "KNOWLEDGE", holderId: "char-lin", proposition: "顾言知道灯塔入口", validFrom: 4, validTo: null },
        { id: "know-old", scope: "KNOWLEDGE", holderId: "char-old", proposition: "旧盟友知道入口", validFrom: 1, validTo: null }
      ],
      overrides: [{ overrideId: "override-1", status: "active", content: "顾言一直知道灯塔入口" }],
      events: [
        { id: "event-4", participantIds: ["char-lin", "char-gu"], narrativeIndex: 4, summary: "两人约定在灯塔会合" }
      ],
      chapters: [{ id: "chapter-4", index: 4, title: "潮汐", content: "林默抬头看向灯塔。" }]
    });

    expect(selected.sections.relationships.map((item) => item.id)).toEqual(["rel-current"]);
    expect(selected.sections.knowledge.map((item) => item.id)).toContain("know-1");
    expect(selected.sections.knowledge.map((item) => item.id)).not.toContain("know-old");
    expect(selected.sections.authorOverrides.map((item) => item.overrideId)).toEqual(["override-1"]);
    expect(selected.sections.adjacentChapters[0].id).toBe("chapter-4");
    expect(selected.estimatedTokens).toBeLessThanOrEqual(12800);
  });

  it("never allocates more than forty percent of the model context or 120000 tokens", () => {
    const events = Array.from({ length: 3000 }, (_, index) => ({
      id: `event-${index}`,
      participantIds: ["char-lin"],
      narrativeIndex: index,
      summary: "很长的事件说明".repeat(80)
    }));
    const selected = selectWritingContext({
      goal: "续写林默",
      targetCharacterIds: ["char-lin"],
      targetChapterIndex: 3001,
      contextWindow: 1000000,
      entities: [{ id: "char-lin", type: "character", canonicalName: "林默" }],
      relations: [], assertions: [], events, chapters: []
    });

    expect(selected.tokenBudget).toBe(120000);
    expect(selected.estimatedTokens).toBeLessThanOrEqual(120000);
    expect(selected.sections.events.length).toBeLessThan(events.length);
  });

  it("maps stable chapter ids to narrative positions before selecting current knowledge", () => {
    const selected = selectWritingContext({
      goal: "续写林默",
      targetCharacterIds: ["char-lin"],
      targetChapterIndex: 5,
      chapters: [
        { id: "uuid-chapter-2", index: 2, title: "第二章" },
        { id: "uuid-chapter-10", index: 10, title: "第十章" }
      ],
      entities: [{ id: "char-lin", type: "character", canonicalName: "林默" }],
      assertions: [
        { id: "obsolete", scope: "KNOWLEDGE", holderId: "char-lin", proposition: "旧密码有效", validFrom: "uuid-chapter-2", validTo: "uuid-chapter-2" },
        { id: "future", scope: "KNOWLEDGE", holderId: "char-lin", proposition: "未来密码", validFrom: "uuid-chapter-10" },
        { id: "current", scope: "KNOWLEDGE", holderId: "char-lin", proposition: "当前密码", validFrom: "uuid-chapter-2" }
      ],
      relations: [], events: []
    });

    expect(selected.sections.knowledge.map((item) => item.id)).toEqual(["current"]);
  });

  it("infers likely characters from the current stage and recent events when no target ids are supplied", () => {
    const selected = selectWritingContext({
      goal: "续写下一章",
      targetChapterIndex: 6,
      currentStage: "林默和顾言已经抵达灯塔。",
      chapters: [{ id: "chapter-5", index: 5, title: "抵达", content: "二人走进灯塔。" }],
      entities: [
        { id: "char-lin", type: "character", canonicalName: "林默" },
        { id: "char-gu", type: "character", canonicalName: "顾言" }
      ],
      relations: [{ id: "allies", subjectId: "char-lin", objectId: "char-gu", type: "合作", validFrom: "chapter-5", status: "active" }],
      assertions: [{ id: "password", scope: "KNOWLEDGE", holderId: "char-gu", proposition: "顾言知道密码", validFrom: "chapter-5" }],
      events: [{ id: "arrival", chapterId: "chapter-5", participantIds: ["char-lin", "char-gu"], summary: "两人抵达灯塔" }],
      storylines: [{ id: "line-lighthouse", status: "active", characterIds: ["char-lin", "char-gu"], title: "灯塔线" }]
    });

    expect(selected.selectedEntityIds).toEqual(expect.arrayContaining(["char-lin", "char-gu"]));
    expect(selected.sections.relationships.map((item) => item.id)).toContain("allies");
    expect(selected.sections.knowledge.map((item) => item.id)).toContain("password");
    expect(selected.sections.events.map((item) => item.id)).toContain("arrival");
  });
});
