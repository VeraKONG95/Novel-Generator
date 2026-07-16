const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AnalysisOrchestrator } = require("../services/analysis-orchestrator");
const graphStore = require("../services/analysis/graph-store");

const cleanup = [];

afterEach(async () => {
  while (cleanup.length) await fs.rm(cleanup.pop(), { recursive: true, force: true });
});

function hashParagraph(value) {
  return crypto.createHash("sha256").update(String(value).trim().replace(/\s+/g, " ")).digest("hex");
}

async function projectRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noval-analysis-"));
  cleanup.push(root);
  await fs.mkdir(path.join(root, "chapters"), { recursive: true });
  await fs.writeFile(path.join(root, "chapters", "0001.md"), "# 第一章 雨夜\n\n林默救下顾言。\n", "utf8");
  return root;
}

function chapterEvidence() {
  return {
    sourcePath: "chapters/0001.md",
    chapterId: "chapter-stable-1",
    paragraphHash: hashParagraph("林默救下顾言。"),
    occurrenceIndex: 0,
    paragraphStart: 2,
    paragraphEnd: 2,
    excerpt: "林默救下顾言"
  };
}

async function publishCorrectionBaseline(root) {
  const evidence = chapterEvidence();
  return await graphStore.publishGeneration(root, {
    generationId: `baseline-${crypto.randomUUID()}`,
    entities: [
      { id: "lin", type: "character", canonicalName: "林默", aliases: [], status: "active", evidenceRefs: [evidence] },
      { id: "gu", type: "character", canonicalName: "顾言", aliases: [], status: "active", evidenceRefs: [evidence] }
    ],
    events: [{
      id: "event-rescue", eventId: "event-rescue", type: "rescue", chapterId: "chapter-stable-1",
      participantIds: ["lin", "gu"], action: "林默救下顾言", result: "顾言获救", evidenceRefs: [evidence]
    }],
    assertions: [{
      id: "assertion-identity", propositionId: "identity", scope: "KNOWLEDGE", holderId: "gu",
      proposition: "林默的真实身份", truthStatus: "unknown", evidenceRefs: [evidence]
    }],
    relations: [{
      id: "relation-trust", relationId: "relation-trust", subjectId: "gu", objectId: "lin", type: "信任",
      status: "active", strength: "一般", sourceEventIds: ["event-rescue"], evidenceRefs: [evidence]
    }],
    overrides: [],
    materials: {
      "STYLE.md": "# 文风\n\n克制。\n",
      "characters/顾言.md": "# 顾言\n\n他不知道林默的真实身份。\n",
      "characters/林默.md": "# 林默\n\n身份仍是秘密。\n",
      "outline/stages/current.md": "# 当前阶段\n\n顾言已经获救。\n",
      "memory/hooks.md": "# 伏笔\n\n身份秘密尚未揭开。\n"
    },
    dependencies: {
      "chapter-stable-1": {
        sourcePath: "chapters/0001.md",
        eventIds: ["event-rescue"],
        entityIds: ["lin", "gu"],
        relationIds: ["relation-trust"],
        assertionIds: ["assertion-identity"]
      }
    }
  });
}

function evidenceFor({ sourcePath, chapterId, text }) {
  return {
    sourcePath,
    chapterId,
    paragraphHash: hashParagraph(text),
    occurrenceIndex: 0,
    paragraphStart: 2,
    paragraphEnd: 2,
    excerpt: text.replace(/[。！？].*$/, "") || text
  };
}

async function publishIncrementalBaseline(root) {
  const firstText = "林默救下顾言。";
  const secondText = "周宁和陈澈守在灯塔。";
  await fs.writeFile(path.join(root, "chapters", "0002.md"), `# 第二章 灯塔\n\n${secondText}\n`, "utf8");
  const firstEvidence = evidenceFor({
    sourcePath: "chapters/0001.md",
    chapterId: "chapter-stable-1",
    text: firstText
  });
  const secondEvidence = evidenceFor({
    sourcePath: "chapters/0002.md",
    chapterId: "chapter-stable-2",
    text: secondText
  });
  await graphStore.publishGeneration(root, {
    generationId: `incremental-baseline-${crypto.randomUUID()}`,
    chapters: [
      { id: "chapter-stable-1", index: 1, title: "雨夜", path: "chapters/0001.md" },
      { id: "chapter-stable-2", index: 2, title: "灯塔", path: "chapters/0002.md" }
    ],
    entities: [
      { id: "entity-lin-stable", type: "character", canonicalName: "林默", aliases: [], status: "active", evidenceRefs: [firstEvidence] },
      { id: "entity-gu-stable", type: "character", canonicalName: "顾言", aliases: [], status: "active", evidenceRefs: [firstEvidence] },
      { id: "entity-zhou-stable", type: "character", canonicalName: "周宁", aliases: [], status: "active", evidenceRefs: [secondEvidence] },
      { id: "entity-chen-stable", type: "character", canonicalName: "陈澈", aliases: [], status: "active", evidenceRefs: [secondEvidence] }
    ],
    events: [
      {
        id: "event-old-rescue", eventId: "event-old-rescue", type: "rescue", chapterId: "chapter-stable-1",
        participantIds: ["entity-lin-stable", "entity-gu-stable"], action: firstText,
        evidenceRefs: [firstEvidence]
      },
      {
        id: "event-untouched-watch", eventId: "event-untouched-watch", type: "watch", chapterId: "chapter-stable-2",
        participantIds: ["entity-zhou-stable", "entity-chen-stable"], action: secondText,
        evidenceRefs: [secondEvidence]
      }
    ],
    assertions: [
      {
        id: "assertion-old-debt", propositionId: "debt", scope: "KNOWLEDGE", holderId: "entity-gu-stable",
        proposition: "顾言欠林默一条命", truthStatus: "true", acquiredByEventId: "event-old-rescue",
        evidenceRefs: [firstEvidence]
      },
      {
        id: "assertion-untouched-lamp", propositionId: "lamp", scope: "KNOWLEDGE", holderId: "entity-zhou-stable",
        proposition: "灯塔仍然亮着", truthStatus: "true", acquiredByEventId: "event-untouched-watch",
        evidenceRefs: [secondEvidence]
      }
    ],
    relations: [
      {
        id: "relation-old-trust", relationId: "relation-old-trust", subjectId: "entity-gu-stable", objectId: "entity-lin-stable",
        type: "信任", status: "active", sourceEventIds: ["event-old-rescue"], evidenceRefs: [firstEvidence]
      },
      {
        id: "relation-untouched-allies", relationId: "relation-untouched-allies", subjectId: "entity-zhou-stable", objectId: "entity-chen-stable",
        type: "同盟", status: "active", sourceEventIds: ["event-untouched-watch"], evidenceRefs: [secondEvidence]
      }
    ],
    overrides: [],
    materials: {
      "STYLE.md": "# 文风\n\n旧版稳定文风。\n",
      "characters/林默.md": "# 林默\n\n他刚刚救下顾言。\n",
      "characters/顾言.md": "# 顾言\n\n他欠林默一条命。\n",
      "characters/周宁.md": "# 周宁\n\n未受影响的哨守。\n",
      "characters/陈澈.md": "# 陈澈\n\n未受影响的同伴。\n",
      "outline/stages/current.md": "# 当前阶段\n\n灯塔仍然亮着。\n",
      "memory/hooks.md": "# 伏笔\n\n救命之恩。\n"
    },
    dependencies: {
      "chapter-stable-1": {
        sourcePath: "chapters/0001.md",
        eventIds: ["event-old-rescue"],
        entityIds: ["entity-lin-stable", "entity-gu-stable"],
        relationIds: ["relation-old-trust"],
        assertionIds: ["assertion-old-debt"],
        materialPaths: ["characters/林默.md", "characters/顾言.md", "outline/stages/current.md", "memory/hooks.md"]
      },
      "chapter-stable-2": {
        sourcePath: "chapters/0002.md",
        eventIds: ["event-untouched-watch"],
        entityIds: ["entity-zhou-stable", "entity-chen-stable"],
        relationIds: ["relation-untouched-allies"],
        assertionIds: ["assertion-untouched-lamp"],
        materialPaths: ["characters/周宁.md", "characters/陈澈.md"]
      }
    }
  });
  return { firstEvidence, secondEvidence };
}

describe("analysis orchestrator", () => {
  it("runs the complete import workflow to a published ready generation", async () => {
    const root = await projectRoot();
    const evidence = {
      sourcePath: "chapters/0001.md",
      chapterId: "chapter-stable-1",
      paragraphHash: hashParagraph("林默救下顾言。"),
      occurrenceIndex: 0,
      paragraphStart: 2,
      paragraphEnd: 2,
      excerpt: "林默救下顾言"
    };
    const executeJob = async (job) => {
      const roleId = job.role.id;
      if (roleId === "R02") return {
        entityCandidates: [{ candidateId: "lin", name: "林默", type: "character" }, { candidateId: "gu", name: "顾言", type: "character" }],
        aliasCandidates: [], timeStructure: {}, storylines: [{ id: "line-rescue", title: "灯塔救援" }],
        keyChapters: ["chapter-stable-1"], styleSamples: ["chapter-stable-1"]
      };
      if (roleId === "R03") return {
        mentions: [
          { candidateId: "lin", canonicalName: "林默", type: "character", evidenceRefs: [evidence] },
          { candidateId: "gu", canonicalName: "顾言", type: "character", evidenceRefs: [evidence] }
        ],
        events: [{ candidateId: "rescue", type: "rescue", summary: "林默救下顾言", participantIds: ["lin", "gu"], evidenceRefs: [evidence] }],
        assertions: [{ propositionId: "rescue-known", scope: "KNOWLEDGE", holderId: "gu", proposition: "林默救了顾言", truthStatus: "true", evidenceRefs: [evidence] }],
        relationChanges: [{ subjectId: "gu", objectId: "lin", type: "信任", strength: "一般", sourceEventIds: ["rescue"], evidenceRefs: [evidence] }],
        hooks: [{ id: "hook-motive", title: "救人动机", status: "open", evidenceRefs: [evidence] }],
        styleSamples: [{ excerpt: "林默救下顾言。", evidenceRefs: [evidence] }]
      };
      if (roleId === "R04") return { decisions: [] };
      if (roleId === "R05") return { events: [{ eventId: "rescue", storyTime: "雨夜", narrativeOrder: 1 }], uncertainties: [] };
      if (roleId === "R06") return {
        characterId: job.task.input.target.id,
        states: [{ validFrom: "chapter-stable-1", validTo: null, emotional: "警惕", sourceEventIds: ["rescue"], evidenceRefs: [evidence] }]
      };
      if (roleId === "R07") return {
        subjectId: "gu", objectId: "lin",
        stages: [{ type: "信任", strength: "一般", status: "active", validFrom: 1, validTo: null, sourceEventIds: ["rescue"], evidenceRefs: [evidence] }]
      };
      if (roleId === "R08") return { storylineId: "line-rescue", events: ["rescue"], currentState: "进行中", openQuestions: ["救人动机"] };
      if (roleId === "R09") return { hooks: [{ id: "hook-motive", title: "救人动机", status: "open", evidenceRefs: [evidence] }] };
      if (roleId === "R10") return { style: { summary: "克制、短句", examples: ["林默救下顾言。"] } };
      if (roleId === "R11") return {
        characterId: job.task.input.target.id,
        assertions: job.task.input.target.id === "gu"
          ? [{ propositionId: "rescue-known", scope: "KNOWLEDGE", holderId: "gu", proposition: "顾言知道自己被林默救下", truthStatus: "true", evidenceRefs: [evidence] }]
          : []
      };
      if (roleId === "R12") return { issues: [] };
      if (roleId === "R13") return {
        materials: {
          "STYLE.md": "# 文风\n\n克制、短句。\n",
          "outline/stages/current.md": "# 当前阶段\n\n顾言刚刚获救。\n",
          "outline/storylines/灯塔救援.md": "# 灯塔救援\n\n救援刚刚发生。\n",
          "memory/hooks.md": "# 伏笔\n\n- 救人动机尚未揭示。\n"
        }
      };
      throw new Error(`unexpected role ${roleId}`);
    };
    const orchestrator = new AnalysisOrchestrator({ executeJob });

    const started = await orchestrator.start({
      workspaceRoot: root,
      projectId: "project-1",
      workflowId: "WF01",
      settings: { apiKey: "secret-not-persisted", model: "fake", baseUrl: "http://fake", contextWindow: 32000 },
      maxConcurrency: 4,
      chapters: [{ id: "chapter-stable-1", index: 1, title: "雨夜", path: "chapters/0001.md", content: "林默救下顾言。" }]
    });
    const completed = await orchestrator.wait(started.runId);

    expect(completed.error).toBe("");
    expect(completed.status).toBe("ready");
    expect(completed.counts.failed).toBe(0);
    expect(completed.generationId).toBeTruthy();
    const pointer = JSON.parse(await fs.readFile(path.join(root, "knowledge", "CURRENT.json"), "utf8"));
    const graph = JSON.parse(await fs.readFile(
      path.join(root, "knowledge", "generations", pointer.generationId, "memory", "graph", "graph.json"),
      "utf8"
    ));
    expect(graph.nodes.map((node) => node.label)).toEqual(expect.arrayContaining(["林默", "顾言", "灯塔救援", "救人动机"]));
    expect(graph.edges[0]).toMatchObject({ type: "信任" });
    expect(graph.nodes.find((node) => node.label === "林默").states[0]).toMatchObject({ emotional: "警惕" });
    const formalEvents = (await fs.readFile(
      path.join(root, "knowledge", "generations", pointer.generationId, "memory", "graph", "events.jsonl"),
      "utf8"
    )).trim().split(/\r?\n/).map((line) => JSON.parse(line));
    expect(formalEvents[0]).toMatchObject({ storyTime: "雨夜", narrativeOrder: 1 });
    const current = await graphStore.readCurrentGeneration(root);
    expect(current.assertions).toHaveLength(1);
    expect(current.assertions[0]).toMatchObject({
      propositionId: "rescue-known",
      scope: "KNOWLEDGE",
      proposition: "顾言知道自己被林默救下"
    });
    const persistedRun = JSON.parse(await fs.readFile(path.join(root, ".noval", "analysis", started.runId, "run.json"), "utf8"));
    expect(persistedRun.status).toBe("ready");
    expect(JSON.stringify(persistedRun)).not.toContain("secret-not-persisted");
  });

  it("bisects only an extraction piece that still exceeds the model context instead of retrying it unchanged", async () => {
    const root = await projectRoot();
    const originalCalls = [];
    const splitCalls = [];
    const executeJob = async (job) => {
      if (job.role.id === "R02") return {
        entityCandidates: [], aliasCandidates: [], timeStructure: {}, storylines: [], keyChapters: [], styleSamples: []
      };
      if (job.role.id === "R03") {
        const segmentId = job.task.input.segmentId;
        if (!segmentId.includes(":split-")) {
          originalCalls.push(segmentId);
          const error = new Error("maximum context length exceeded");
          error.code = "CONTEXT_LENGTH_EXCEEDED";
          throw error;
        }
        splitCalls.push(segmentId);
        const content = job.task.materials[0].content;
        const evidence = job.task.input.evidenceIndex[0]
          ? [{
              ...job.task.input.evidenceIndex[0],
              chapterId: job.task.input.chapterId,
              sourcePath: job.task.input.sourcePath
            }]
          : [];
        return {
          mentions: [],
          events: content.includes("林默救下顾言")
            ? [{ candidateId: "event-1", type: "rescue", summary: "林默救下顾言", participantIds: [], evidenceRefs: evidence }]
            : [],
          assertions: [], relationChanges: [], hooks: [], styleSamples: []
        };
      }
      if (job.role.id === "R04") return { decisions: [] };
      if (job.role.id === "R05") return {
        events: job.task.input.events.map((event, index) => ({ eventId: event.candidateId, narrativeOrder: index + 1 })),
        uncertainties: []
      };
      if (job.role.id === "R10") return { style: { summary: "克制" } };
      if (job.role.id === "R12") return { issues: [] };
      if (job.role.id === "R13") return { materials: {} };
      throw new Error(`unexpected role ${job.role.id}`);
    };
    const orchestrator = new AnalysisOrchestrator({ executeJob });
    const started = await orchestrator.start({
      workspaceRoot: root,
      projectId: "project-dynamic-split",
      workflowId: "WF01",
      settings: { model: "fake", contextWindow: 128000 },
      chapters: [{ id: "chapter-stable-1", index: 1, title: "雨夜", path: "chapters/0001.md" }]
    });
    const completed = await orchestrator.wait(started.runId);
    const current = await graphStore.readCurrentGeneration(root);

    expect(completed.status).toBe("ready");
    expect(completed.counts.failed).toBe(0);
    expect(originalCalls).toHaveLength(1);
    expect(splitCalls).toHaveLength(2);
    expect(current.events).toHaveLength(1);
    expect(current.events[0].action).toBe("林默救下顾言");
  });

  it("replays every downstream chapter from the earliest change and replaces stale later tracks", async () => {
    const root = await projectRoot();
    await publishIncrementalBaseline(root);
    const before = await graphStore.readCurrentGeneration(root);
    const staleLaterEvent = before.events.find((item) => item.id === "event-untouched-watch");

    const changedText = "林默拒绝再帮助顾言。";
    const laterText = "周宁和陈澈守在灯塔。";
    await fs.writeFile(path.join(root, "chapters", "0001.md"), `# 第一章 雨夜\n\n${changedText}\n`, "utf8");
    const changedEvidence = evidenceFor({
      sourcePath: "chapters/0001.md",
      chapterId: "chapter-stable-1",
      text: changedText
    });
    const laterEvidence = evidenceFor({
      sourcePath: "chapters/0002.md",
      chapterId: "chapter-stable-2",
      text: laterText
    });
    let previousEntitiesSeen = [];
    const extractedChapterIds = [];
    const executeJob = async (job) => {
      const roleId = job.role.id;
      if (roleId === "R02") return {
        entityCandidates: [
          { candidateId: "fresh-lin", name: "林默", type: "character" },
          { candidateId: "fresh-gu", name: "顾言", type: "character" },
          { candidateId: "fresh-zhou", name: "周宁", type: "character" },
          { candidateId: "fresh-chen", name: "陈澈", type: "character" }
        ],
        aliasCandidates: [], timeStructure: {}, storylines: [], keyChapters: ["chapter-stable-1"], styleSamples: []
      };
      if (roleId === "R03") {
        const chapterId = job.task.input.chapterId;
        extractedChapterIds.push(chapterId);
        if (chapterId === "chapter-stable-2") return {
          mentions: [
            { candidateId: "fresh-zhou", canonicalName: "周宁", type: "character", evidenceRefs: [laterEvidence] },
            { candidateId: "fresh-chen", canonicalName: "陈澈", type: "character", evidenceRefs: [laterEvidence] }
          ],
          events: [{ candidateId: "watch-replayed", type: "watch", summary: laterText, participantIds: ["fresh-zhou", "fresh-chen"], evidenceRefs: [laterEvidence] }],
          assertions: [{ id: "assertion-replayed-lamp", propositionId: "lamp", scope: "KNOWLEDGE", holderId: "fresh-zhou", proposition: "灯塔仍然亮着", truthStatus: "true", acquiredByEventId: "watch-replayed", evidenceRefs: [laterEvidence] }],
          relationChanges: [{ subjectId: "fresh-zhou", objectId: "fresh-chen", type: "同盟", sourceEventIds: ["watch-replayed"], evidenceRefs: [laterEvidence] }],
          hooks: [], styleSamples: []
        };
        return {
          mentions: [
            { candidateId: "fresh-lin", canonicalName: "林默", type: "character", evidenceRefs: [changedEvidence] },
            { candidateId: "fresh-gu", canonicalName: "顾言", type: "character", evidenceRefs: [changedEvidence] }
          ],
          events: [{ candidateId: "refusal", type: "refusal", summary: changedText, participantIds: ["fresh-lin", "fresh-gu"], evidenceRefs: [changedEvidence] }],
          assertions: [],
          relationChanges: [{ subjectId: "fresh-gu", objectId: "fresh-lin", type: "疏远", sourceEventIds: ["refusal"], evidenceRefs: [changedEvidence] }],
          hooks: [], styleSamples: []
        };
      }
      if (roleId === "R04") {
        previousEntitiesSeen = job.task.input.previousEntities || [];
        return { decisions: [] };
      }
      if (roleId === "R05") return { events: [{ eventId: "refusal", narrativeOrder: 1 }, { eventId: "watch-replayed", narrativeOrder: 2 }], uncertainties: [] };
      if (roleId === "R06") return {
        characterId: job.task.input.target.id,
        states: [job.task.input.target.canonicalName === "周宁" || job.task.input.target.canonicalName === "陈澈"
          ? { validFrom: "chapter-stable-2", location: "灯塔", sourceEventIds: ["watch-replayed"], evidenceRefs: [laterEvidence] }
          : { validFrom: "chapter-stable-1", emotional: "疏离", sourceEventIds: ["refusal"], evidenceRefs: [changedEvidence] }]
      };
      if (roleId === "R07") {
        const laterPair = [job.task.input.target.subjectId, job.task.input.target.objectId].includes("fresh-zhou");
        return laterPair
          ? { subjectId: "fresh-zhou", objectId: "fresh-chen", stages: [{ type: "同盟", status: "active", validFrom: 2, sourceEventIds: ["watch-replayed"], evidenceRefs: [laterEvidence] }] }
          : { subjectId: "fresh-gu", objectId: "fresh-lin", stages: [{ type: "疏远", status: "active", validFrom: 1, sourceEventIds: ["refusal"], evidenceRefs: [changedEvidence] }] };
      }
      if (roleId === "R10") return { style: { summary: "不应覆盖原有文风" } };
      if (roleId === "R11") return {
        characterId: job.task.input.target.id,
        assertions: job.task.input.target.canonicalName === "顾言"
          ? [{
              id: "assertion-new-refusal", propositionId: "refusal", scope: "KNOWLEDGE", holderId: "fresh-gu",
              proposition: "林默拒绝再帮助自己", truthStatus: "true", acquiredByEventId: "refusal",
              evidenceRefs: [changedEvidence]
            }]
          : []
      };
      if (roleId === "R12") return { issues: [] };
      if (roleId === "R13") return {
        materials: {
          "characters/林默.md": "# 林默\n\n他拒绝再帮助顾言。\n",
          "characters/顾言.md": "# 顾言\n\n他意识到林默已经疏远。\n",
          "characters/周宁.md": "# 周宁\n\n重新推演后仍在灯塔守望。\n",
          "characters/陈澈.md": "# 陈澈\n\n重新推演后仍在灯塔守望。\n",
          "outline/stages/current.md": "# 当前阶段\n\n周宁和陈澈仍在灯塔。\n"
        }
      };
      throw new Error(`unexpected role ${roleId}`);
    };
    const orchestrator = new AnalysisOrchestrator({ executeJob });
    const started = await orchestrator.start({
      workspaceRoot: root,
      projectId: "project-incremental",
      workflowId: "WF02",
      settings: { model: "fake" },
      chapters: [{ id: "chapter-stable-1", index: 1, title: "雨夜", path: "chapters/0001.md", content: changedText }],
      input: {
        changedPaths: ["chapters/0001.md"],
        allChapters: [
          { id: "chapter-stable-1", index: 1, title: "雨夜", path: "chapters/0001.md" },
          { id: "chapter-stable-2", index: 2, title: "灯塔", path: "chapters/0002.md" }
        ]
      }
    });
    const completed = await orchestrator.wait(started.runId);
    const current = await graphStore.readCurrentGeneration(root);

    expect(completed.error).toBe("");
    expect(completed.status).toBe("ready");
    expect(previousEntitiesSeen.map((item) => item.id)).toEqual(expect.arrayContaining([
      "entity-lin-stable", "entity-gu-stable", "entity-zhou-stable", "entity-chen-stable"
    ]));
    expect(extractedChapterIds).toEqual(expect.arrayContaining(["chapter-stable-1", "chapter-stable-2"]));
    expect(current.entities.find((item) => item.canonicalName === "林默").id).toBe("entity-lin-stable");
    expect(current.entities.find((item) => item.canonicalName === "顾言").id).toBe("entity-gu-stable");
    expect(current.events.some((item) => item.id === "event-old-rescue")).toBe(false);
    expect(current.assertions.some((item) => item.id === "assertion-old-debt")).toBe(false);
    expect(current.relations.some((item) => item.id === "relation-old-trust")).toBe(false);
    expect(current.events).not.toContainEqual(staleLaterEvent);
    expect(current.events.some((item) => item.action === laterText)).toBe(true);
    expect(current.assertions.some((item) => item.id === "assertion-replayed-lamp")).toBe(true);
    expect(await fs.readFile(path.join(current.materialsRoot, "characters", "周宁.md"), "utf8")).toContain("重新推演");
    expect(await fs.readFile(path.join(current.materialsRoot, "STYLE.md"), "utf8")).toBe("# 文风\n\n旧版稳定文风。\n");
    expect(current.manifest.coveredChapters.map((item) => item.chapterId)).toEqual([
      "chapter-stable-1", "chapter-stable-2"
    ]);
    expect(current.manifest.dependencies["chapter-stable-1"].assertionIds).toContain("assertion-new-refusal");
    expect(current.manifest.dependencies["chapter-stable-2"].assertionIds).toContain("assertion-replayed-lamp");
  });

  it.each(["WF02", "WF08"])("publishes a %s deletion-only run with the removed chapter absent from every dependency and covered-chapter list", async (workflowId) => {
    const root = await projectRoot();
    await publishIncrementalBaseline(root);
    const before = await graphStore.readCurrentGeneration(root);
    const untouchedEntity = before.entities.find((item) => item.id === "entity-lin-stable");
    const untouchedEvent = before.events.find((item) => item.id === "event-old-rescue");
    const untouchedAssertion = before.assertions.find((item) => item.id === "assertion-old-debt");
    const untouchedRelation = before.relations.find((item) => item.id === "relation-old-trust");
    const untouchedMaterial = await fs.readFile(path.join(before.materialsRoot, "characters", "林默.md"), "utf8");
    await fs.rm(path.join(root, "chapters", "0002.md"));

    const calledRoles = [];
    const executeJob = async (job) => {
      calledRoles.push(job.role.id);
      if (job.role.id === "R12") return { issues: [] };
      if (job.role.id === "R13") return {
        materials: {
          "characters/林默.md": "# 林默\n\n错误覆盖。\n",
          "outline/stages/current.md": "# 当前阶段\n\n故事回到雨夜救援。\n",
          "memory/hooks.md": "# 伏笔\n\n灯塔章节已经删除。\n"
        }
      };
      throw new Error(`unexpected role ${job.role.id}`);
    };
    const orchestrator = new AnalysisOrchestrator({ executeJob });
    const started = await orchestrator.start({
      workspaceRoot: root,
      projectId: `project-delete-${workflowId}`,
      workflowId,
      settings: { model: "fake" },
      chapters: [],
      input: {
        deletedChapters: [{ chapterId: "chapter-stable-2", index: 2, sourcePath: "chapters/0002.md" }],
        allChapters: [{ id: "chapter-stable-1", index: 1, title: "雨夜", path: "chapters/0001.md" }]
      }
    });
    const completed = await orchestrator.wait(started.runId);
    const current = await graphStore.readCurrentGeneration(root);

    expect(completed.error).toBe("");
    expect(completed.status).toBe("ready");
    expect(calledRoles).toEqual(expect.arrayContaining(["R12", "R13"]));
    expect(calledRoles).not.toContain("R03");
    expect(current.manifest.coveredChapters.map((item) => item.chapterId)).toEqual(["chapter-stable-1"]);
    expect(current.manifest.dependencies["chapter-stable-2"]).toBeUndefined();
    expect(current.entities.some((item) => ["entity-zhou-stable", "entity-chen-stable"].includes(item.id))).toBe(false);
    expect(current.events.some((item) => item.id === "event-untouched-watch")).toBe(false);
    expect(current.assertions.some((item) => item.id === "assertion-untouched-lamp")).toBe(false);
    expect(current.relations.some((item) => item.id === "relation-untouched-allies")).toBe(false);
    expect(current.entities).toContainEqual(untouchedEntity);
    expect(current.events).toContainEqual(untouchedEvent);
    expect(current.assertions).toContainEqual(untouchedAssertion);
    expect(current.relations).toContainEqual(untouchedRelation);
    expect(await fs.readFile(path.join(current.materialsRoot, "characters", "林默.md"), "utf8")).toBe(untouchedMaterial);
    await expect(fs.access(path.join(current.materialsRoot, "characters", "周宁.md"))).rejects.toThrow();
    await expect(fs.access(path.join(current.materialsRoot, "characters", "陈澈.md"))).rejects.toThrow();
  });

  it("pauses smoothly after in-flight checks finish and resumes the waiting checks", async () => {
    const root = await projectRoot();
    let startedJobs = 0;
    let releaseJobs = () => {};
    const inFlightGate = new Promise((resolve) => { releaseJobs = resolve; });
    const executeJob = async (job) => {
      if (job.role.id === "R14") return { materials: [] };
      startedJobs += 1;
      await inFlightGate;
      return { issues: [] };
    };
    const orchestrator = new AnalysisOrchestrator({ executeJob });
    const started = await orchestrator.start({
      workspaceRoot: root,
      projectId: "project-pause",
      workflowId: "WF05",
      settings: { apiKey: "secret", model: "fake", baseUrl: "http://fake" },
      maxConcurrency: 2
    });
    while (startedJobs < 2) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const pausePromise = orchestrator.pause(started.runId);
    releaseJobs();
    const paused = await pausePromise;

    expect(paused.status).toBe("paused");
    expect(paused.counts.running).toBe(0);
    expect(paused.counts.completed).toBe(3);
    expect(paused.counts.waiting).toBe(5);
    await orchestrator.resume(started.runId);
    const completed = await orchestrator.wait(started.runId);
    expect(completed.status).toBe("ready");
    expect(completed.counts.completed).toBe(8);
  });

  it("does not accept late check results after cancellation", async () => {
    const root = await projectRoot();
    const executeJob = async () => {
      await new Promise((resolve) => setTimeout(resolve, 45));
      return { issues: [] };
    };
    const orchestrator = new AnalysisOrchestrator({ executeJob });
    const started = await orchestrator.start({
      workspaceRoot: root,
      projectId: "project-cancel",
      workflowId: "WF05",
      settings: { apiKey: "secret", model: "fake", baseUrl: "http://fake" },
      maxConcurrency: 2
    });
    while ((orchestrator.getStatus(started.runId)?.counts.running || 0) === 0) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    await orchestrator.cancel(started.runId);
    const completed = await orchestrator.wait(started.runId);

    expect(completed.status).toBe("cancelled");
    expect(completed.generationId).toBe("");
    await expect(fs.access(path.join(root, "knowledge", "CURRENT.json"))).rejects.toThrow();
  });

  it("applies an author correction to every affected graph record and regenerates affected materials", async () => {
    const root = await projectRoot();
    await publishCorrectionBaseline(root);
    const calledRoles = [];
    const executeJob = async (job) => {
      calledRoles.push(job.role.id);
      if (job.role.id === "R01") return {
        taskType: "author_correction",
        correctionType: "identity_and_knowledge",
        workflowId: "WF03",
        risks: [],
        affected: [
          { kind: "entity", id: "gu", changes: { aliases: ["顾医生"] } },
          { kind: "event", id: "event-rescue", changes: { result: "顾言只是佯装获救" } },
          { kind: "relation", id: "relation-trust", changes: { type: "隐瞒", strength: "强" } },
          {
            kind: "assertion", id: "assertion-identity",
            changes: { proposition: "顾言早已知道林默的真实身份", truthStatus: "true" }
          }
        ]
      };
      if (job.role.id === "R12") return {
        issues: job.task.input.target.id === "knowledge"
          ? [{ severity: "critical", blocking: true, reason: "旧正文表现为顾言不知情" }]
          : []
      };
      if (job.role.id === "R13") return {
        materials: {
          "characters/顾言.md": "# 顾言\n\n顾言早已知道林默的真实身份，只是在伪装。\n",
          "outline/stages/current.md": "# 当前阶段\n\n顾言佯装获救，并继续隐瞒自己知情。\n"
        }
      };
      throw new Error(`unexpected role ${job.role.id}`);
    };
    const orchestrator = new AnalysisOrchestrator({ executeJob });

    const started = await orchestrator.start({
      workspaceRoot: root,
      projectId: "project-correction",
      workflowId: "WF03",
      settings: { model: "fake" },
      input: { correction: "顾言早就知道林默的身份，获救也是伪装。" }
    });
    const completed = await orchestrator.wait(started.runId);
    const current = await graphStore.readCurrentGeneration(root);

    expect(completed.status).toBe("degraded");
    expect(completed.generationId).not.toBe("baseline");
    expect(calledRoles).toEqual(expect.arrayContaining(["R01", "R12", "R13"]));
    expect(current.entities.find((item) => item.id === "gu").aliases).toEqual(["顾医生"]);
    expect(current.events.find((item) => item.id === "event-rescue").result).toBe("顾言只是佯装获救");
    expect(current.relations.find((item) => item.id === "relation-trust")).toMatchObject({ type: "隐瞒", strength: "强" });
    expect(current.assertions.find((item) => item.id === "assertion-identity")).toMatchObject({
      proposition: "顾言早已知道林默的真实身份",
      truthStatus: "true"
    });
    for (const record of [
      current.entities.find((item) => item.id === "gu"),
      current.events.find((item) => item.id === "event-rescue"),
      current.relations.find((item) => item.id === "relation-trust"),
      current.assertions.find((item) => item.id === "assertion-identity")
    ]) {
      expect(record.evidenceRefs[0]).toMatchObject({ type: "author_override", overrideId: current.overrides[0].overrideId });
      expect(record.authorOverrideIds).toContain(current.overrides[0].overrideId);
    }
    expect(current.overrides[0].operations).toHaveLength(4);
    expect(await fs.readFile(path.join(current.materialsRoot, "characters", "顾言.md"), "utf8"))
      .toContain("早已知道");
    expect(await fs.readFile(path.join(current.materialsRoot, "outline", "stages", "current.md"), "utf8"))
      .toContain("佯装获救");
  });

  it("appends a revocation and restores body-evidence conclusions after the active correction is removed", async () => {
    const root = await projectRoot();
    await publishCorrectionBaseline(root);
    const executeJob = async (job) => {
      const correction = String(job.task.input.correction || "");
      if (job.role.id === "R01" && correction.includes("撤销")) return {
        taskType: "author_correction", correctionType: "revoke", workflowId: "WF03", risks: [],
        affected: [{ kind: "assertion", id: "assertion-identity" }]
      };
      if (job.role.id === "R01") return {
        taskType: "author_correction", correctionType: "knowledge", workflowId: "WF03", risks: [],
        affected: [{
          kind: "assertion", id: "assertion-identity",
          changes: { proposition: "顾言早已知道林默的真实身份", truthStatus: "true" }
        }]
      };
      if (job.role.id === "R12") return { issues: [] };
      if (job.role.id === "R13" && correction.includes("撤销")) return {
        materials: {
          "characters/顾言.md": "# 顾言\n\n他不知道林默的真实身份。\n",
          "outline/stages/current.md": "# 当前阶段\n\n顾言已经获救。\n"
        }
      };
      if (job.role.id === "R13") return {
        materials: {
          "characters/顾言.md": "# 顾言\n\n他早已知情，只是在伪装。\n",
          "outline/stages/current.md": "# 当前阶段\n\n顾言隐瞒自己早已知情。\n"
        }
      };
      throw new Error(`unexpected role ${job.role.id}`);
    };
    const orchestrator = new AnalysisOrchestrator({ executeJob });
    const applied = await orchestrator.start({
      workspaceRoot: root, projectId: "project-revoke", workflowId: "WF03", settings: { model: "fake" },
      input: { correction: "顾言早就知道林默的身份。" }
    });
    await expect(orchestrator.wait(applied.runId)).resolves.toMatchObject({ status: "ready" });
    let current = await graphStore.readCurrentGeneration(root);
    const activeOverrideId = current.overrides[0].overrideId;
    expect(current.assertions[0].truthStatus).toBe("true");

    const revoked = await orchestrator.start({
      workspaceRoot: root, projectId: "project-revoke", workflowId: "WF03", settings: { model: "fake" },
      input: { correction: "撤销刚才的修正。" }
    });
    await expect(orchestrator.wait(revoked.runId)).resolves.toMatchObject({ status: "ready" });
    current = await graphStore.readCurrentGeneration(root);

    expect(current.assertions[0]).toMatchObject({ proposition: "林默的真实身份", truthStatus: "unknown" });
    expect(current.assertions[0].authorOverrideIds).toBeUndefined();
    expect(current.assertions[0].evidenceRefs.some((ref) => ref.type === "author_override")).toBe(false);
    expect(current.overrides).toHaveLength(2);
    expect(current.overrides[1]).toMatchObject({ status: "revoked", supersedes: [activeOverrideId] });
    expect(await fs.readFile(path.join(current.materialsRoot, "characters", "顾言.md"), "utf8"))
      .toContain("不知道林默");
  });

  it("keeps the previous complete generation current when corrected materials cannot be produced", async () => {
    const root = await projectRoot();
    const baseline = await publishCorrectionBaseline(root);
    const executeJob = async (job) => {
      if (job.role.id === "R01") return {
        taskType: "author_correction", correctionType: "relation", workflowId: "WF03", risks: [],
        affected: [{ kind: "relation", id: "relation-trust", changes: { type: "敌对" } }]
      };
      if (job.role.id === "R12") return { issues: [] };
      if (job.role.id === "R13") throw new Error("材料生成失败");
      throw new Error(`unexpected role ${job.role.id}`);
    };
    const orchestrator = new AnalysisOrchestrator({ executeJob });
    const started = await orchestrator.start({
      workspaceRoot: root, projectId: "project-atomic-correction", workflowId: "WF03", settings: { model: "fake" },
      input: { correction: "顾言和林默现在是敌对关系。" }
    });
    const completed = await orchestrator.wait(started.runId);
    const current = await graphStore.readCurrentGeneration(root);

    expect(completed.status).toBe("failed");
    expect(current.generationId).toBe(baseline.generationId);
    expect(current.relations[0].type).toBe("信任");
    expect(current.overrides).toEqual([]);
  });
});
