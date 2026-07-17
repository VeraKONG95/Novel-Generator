const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  auditCurrentGeneration,
  buildGraph,
  publishGeneration,
  readCurrentGeneration,
  readGraph,
  resolveEvidence
} = require("../services/analysis/graph-store");

const cleanup = [];

afterEach(async () => {
  while (cleanup.length) await fs.rm(cleanup.pop(), { recursive: true, force: true });
});

async function tempProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noval-graph-store-"));
  cleanup.push(root);
  await fs.mkdir(path.join(root, "chapters"), { recursive: true });
  await fs.writeFile(path.join(root, "chapters", "0001.md"), "# 第一章\n\n林默救下顾言。\n", "utf8");
  return root;
}

function paragraphHash(value) {
  return crypto.createHash("sha256").update(String(value).trim().replace(/\s+/g, " ")).digest("hex");
}

function validPayload(generationId = "generation-1") {
  const evidence = {
    sourcePath: "chapters/0001.md",
    chapterId: "chapter-1",
    paragraphHash: paragraphHash("林默救下顾言。"),
    occurrenceIndex: 0,
    paragraphStart: 2,
    paragraphEnd: 2,
    excerpt: "林默救下顾言"
  };
  return {
    generationId,
    projectFormatVersion: 5,
    graphFormatVersion: 1,
    model: "fixture-model",
    roleVersions: { R03: "1" },
    workflowId: "WF01",
    workflowVersion: "1",
    entities: [
      { id: "person-lin", type: "人物", canonicalName: "林默", evidenceRefs: [evidence] },
      { id: "person-gu", type: "人物", canonicalName: "顾言", evidenceRefs: [evidence] }
    ],
    events: [{ eventId: "event-rescue", type: "营救", evidenceRefs: [evidence] }],
    assertions: [],
    relations: [{
      relationId: "relation-trust",
      subjectId: "person-gu",
      objectId: "person-lin",
      type: "信任",
      sourceEventIds: ["event-rescue"],
      evidenceRefs: [evidence]
    }],
    overrides: [],
    materials: {
      "STYLE.md": "# 文风\n\n克制、简洁。\n",
      "characters/林默.md": "# 林默\n\n当前状态：活跃。\n",
      "outline/stages/current.md": "# 当前阶段\n\n顾言刚刚获救。\n",
      "memory/hooks.md": "# 伏笔\n\n- 救人动机尚未揭示。\n"
    }
  };
}

describe("graph store", () => {
  it("builds the page graph only from formal graph records", () => {
    const evidence = {
      sourcePath: "chapters/0001.md",
      chapterId: "chapter-1",
      paragraphHash: "a".repeat(64),
      occurrenceIndex: 0,
      excerpt: "林默救下顾言"
    };
    const graph = buildGraph({
      entities: [
        { id: "person-lin", type: "人物", canonicalName: "林默" },
        { id: "person-gu", type: "人物", canonicalName: "顾言" }
      ],
      events: [{ eventId: "event-rescue", type: "营救", evidenceRefs: [evidence] }],
      assertions: [],
      relations: [{
        relationId: "relation-trust",
        subjectId: "person-gu",
        objectId: "person-lin",
        type: "信任",
        sourceEventIds: ["event-rescue"],
        evidenceRefs: [evidence]
      }],
      overrides: []
    });

    expect(graph.nodes.map((node) => node.id)).toEqual(["person-lin", "person-gu"]);
    expect(graph.edges[0]).toMatchObject({
      id: "relation-trust",
      source: "person-gu",
      target: "person-lin",
      type: "信任"
    });
    expect(graph.chapterIndex["chapter-1"]).toMatchObject({
      sourcePath: "chapters/0001.md",
      eventIds: ["event-rescue"],
      relationIds: ["relation-trust"]
    });
    expect(Object.values(graph.evidenceIndex)).toContainEqual(expect.objectContaining({
      recordType: "event",
      recordId: "event-rescue",
      chapterId: "chapter-1"
    }));
  });

  it("derives entity first and last appearance from evidence chapter order", () => {
    const graph = buildGraph({
      coveredChapters: [
        { chapterId: "uuid-chapter-1", index: 1, title: "第一章", sourcePath: "chapters/0001.md" },
        { chapterId: "uuid-chapter-10", index: 10, title: "第十章", sourcePath: "chapters/0010.md" }
      ],
      entities: [{
        id: "future-person",
        type: "character",
        canonicalName: "迟到者",
        evidenceRefs: [{ chapterId: "uuid-chapter-10", sourcePath: "chapters/0010.md" }]
      }],
      events: [], assertions: [], relations: [], overrides: []
    });

    expect(graph.nodes[0]).toMatchObject({ firstSeen: "uuid-chapter-10", lastSeen: "uuid-chapter-10" });
  });

  it("publishes a complete generation and reads it through the current pointer", async () => {
    const root = await tempProject();

    await publishGeneration(root, validPayload());
    const current = await readCurrentGeneration(root);

    expect(current.generationId).toBe("generation-1");
    expect(current.entities).toHaveLength(2);
    expect(current.events[0].eventId).toBe("event-rescue");
    expect(current.relations[0].relationId).toBe("relation-trust");
    expect(current.graph.edges).toHaveLength(1);
    expect(current.manifest.previousGenerationId).toBeNull();
    expect(current.manifest).toMatchObject({
      model: "fixture-model",
      roleVersions: { R03: "1" },
      workflowId: "WF01",
      workflowVersion: "1"
    });
    expect(current.manifest.files["memory/graph/graph.json"].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(current.manifest.fileFingerprints["memory/graph/graph.json"]).toMatch(/^[a-f0-9]{64}$/);
    expect(current.materialsRoot).toBe(path.join(root, "knowledge", "generations", "generation-1"));
    await expect(fs.readFile(path.join(current.materialsRoot, "characters", "林默.md"), "utf8"))
      .resolves.toContain("当前状态");

    const pointer = JSON.parse(await fs.readFile(path.join(root, "knowledge", "CURRENT.json"), "utf8"));
    expect(pointer).toMatchObject({
      generationId: "generation-1",
      manifestPath: "knowledge/generations/generation-1/manifest.json"
    });
    expect(pointer.manifestFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a relation whose endpoint is not a formal entity", async () => {
    const root = await tempProject();
    const payload = validPayload();
    payload.relations[0].objectId = "person-missing";

    await expect(publishGeneration(root, payload)).rejects.toThrow("关系端点不存在");
    await expect(fs.access(path.join(root, "knowledge", "CURRENT.json"))).rejects.toThrow();
    await expect(fs.access(path.join(root, "knowledge", "generations", "generation-1"))).rejects.toThrow();
  });

  it("does not publish a formal event without original-text evidence", async () => {
    const root = await tempProject();
    const payload = validPayload();
    payload.events[0].evidenceRefs = [];

    await expect(publishGeneration(root, payload)).rejects.toThrow("正式事件缺少证据");
    expect(await readCurrentGeneration(root)).toBeNull();
  });

  it("does not publish a formal entity without original-text or author evidence", async () => {
    const root = await tempProject();
    const payload = validPayload();
    payload.entities[0].evidenceRefs = [];

    await expect(publishGeneration(root, payload)).rejects.toThrow("正式实体缺少证据");
    expect(await readCurrentGeneration(root)).toBeNull();
  });

  it("does not publish a formal character state without its own evidence", async () => {
    const root = await tempProject();
    const payload = validPayload();
    payload.entities[0].states = [{ validFrom: "chapter-1", sourceEventIds: ["event-rescue"], emotional: "警惕", evidenceRefs: [] }];

    await expect(publishGeneration(root, payload)).rejects.toThrow("正式人物状态缺少证据");
    expect(await readCurrentGeneration(root)).toBeNull();
  });

  it("does not publish a formal relation without original-text evidence", async () => {
    const root = await tempProject();
    const payload = validPayload();
    payload.relations[0].evidenceRefs = [];

    await expect(publishGeneration(root, payload)).rejects.toThrow("正式关系缺少证据");
    expect(await readCurrentGeneration(root)).toBeNull();
  });

  it("does not publish a non-world relationship without an existing holder", async () => {
    const root = await tempProject();
    const payload = validPayload();
    payload.relations[0].scope = "KNOWLEDGE";
    payload.relations[0].holderId = null;

    await expect(publishGeneration(root, payload)).rejects.toThrow("缺少认知持有人");
    expect(await readCurrentGeneration(root)).toBeNull();
  });

  it("does not publish formal character knowledge without verifiable evidence", async () => {
    const root = await tempProject();
    const payload = validPayload();
    payload.assertions = [{
      id: "knowledge-gu-knows-lin",
      propositionId: "proposition-gu-knows-lin",
      scope: "KNOWLEDGE",
      holderId: "person-gu",
      proposition: "顾言知道林默救了自己",
      truthStatus: "true",
      evidenceRefs: []
    }];

    await expect(publishGeneration(root, payload)).rejects.toThrow("正式认知记录缺少证据");
    expect(await readCurrentGeneration(root)).toBeNull();
  });

  it("does not publish non-world knowledge without an existing holder", async () => {
    const root = await tempProject();
    const payload = validPayload();
    payload.assertions = [{
      id: "knowledge-without-holder",
      propositionId: "proposition-without-holder",
      scope: "KNOWLEDGE",
      holderId: null,
      proposition: "有人知道林默的身份",
      truthStatus: "true",
      evidenceRefs: [payload.events[0].evidenceRefs[0]]
    }];

    await expect(publishGeneration(root, payload)).rejects.toThrow("缺少认知持有人");
    expect(await readCurrentGeneration(root)).toBeNull();
  });

  it("rejects evidence paths that escape the project", async () => {
    const root = await tempProject();
    const payload = validPayload();
    payload.events[0].evidenceRefs[0].sourcePath = "../outside.md";

    await expect(publishGeneration(root, payload)).rejects.toThrow("证据路径");
    expect(await readCurrentGeneration(root)).toBeNull();
  });

  it("reads the page graph from the complete current generation", async () => {
    const root = await tempProject();
    await publishGeneration(root, validPayload());

    const graph = await readGraph(root);

    expect(graph.generationId).toBe("generation-1");
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges[0].id).toBe("relation-trust");
  });

  it("resolves a graph evidence reference back to its exact paragraph", async () => {
    const root = await tempProject();
    await publishGeneration(root, validPayload());

    const resolved = await resolveEvidence(root, "event:event-rescue:0");

    expect(resolved).toMatchObject({
      status: "current",
      generationId: "generation-1",
      sourcePath: "chapters/0001.md",
      chapterId: "chapter-1",
      paragraphStart: 2,
      paragraphEnd: 2,
      content: "林默救下顾言。"
    });
  });

  it("audits every formal record and original-text reference in the current generation", async () => {
    const root = await tempProject();
    await publishGeneration(root, validPayload());
    await expect(auditCurrentGeneration(root)).resolves.toMatchObject({ records: 4, evidenceChapters: 1 });
    await fs.writeFile(path.join(root, "chapters", "0001.md"), "# 第一章\n\n原文已经被彻底改写。\n", "utf8");
    await expect(auditCurrentGeneration(root)).rejects.toThrow("无法定位");
  });

  it("rejects a generation file replaced by an out-of-project link", async () => {
    const root = await tempProject();
    await publishGeneration(root, validPayload());
    const graphPath = path.join(root, "knowledge", "generations", "generation-1", "memory", "graph", "graph.json");
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "noval-graph-outside-"));
    cleanup.push(outside);
    const outsideGraph = path.join(outside, "graph.json");
    await fs.writeFile(outsideGraph, await fs.readFile(graphPath));
    await fs.rm(graphPath);
    await fs.symlink(outsideGraph, graphPath);

    await expect(readCurrentGeneration(root)).rejects.toThrow("越过当前代次目录");
  });

  it("keeps the old generation current when publication stops before the atomic switch", async () => {
    const root = await tempProject();
    await publishGeneration(root, validPayload("generation-1"));
    const oldManifestPath = path.join(root, "knowledge", "generations", "generation-1", "manifest.json");
    const oldManifest = await fs.readFile(oldManifestPath, "utf8");

    await expect(publishGeneration(root, validPayload("generation-2"), {
      beforeCurrentSwitch: async () => {
        throw new Error("simulated stop before pointer switch");
      }
    })).rejects.toThrow("simulated stop");

    expect((await readCurrentGeneration(root)).generationId).toBe("generation-1");
    expect(await fs.readFile(oldManifestPath, "utf8")).toBe(oldManifest);

    await publishGeneration(root, validPayload("generation-3"));
    const current = await readCurrentGeneration(root);
    expect(current.generationId).toBe("generation-3");
    expect(current.manifest.previousGenerationId).toBe("generation-1");
    expect(await fs.readFile(oldManifestPath, "utf8")).toBe(oldManifest);
  });

  it("detects external edits by checking every published file fingerprint", async () => {
    const root = await tempProject();
    await publishGeneration(root, validPayload());
    const relationsPath = path.join(
      root,
      "knowledge",
      "generations",
      "generation-1",
      "memory",
      "graph",
      "relations.jsonl"
    );
    const original = await fs.readFile(relationsPath, "utf8");
    await fs.writeFile(relationsPath, original.replace("信任", "敌对"), "utf8");

    await expect(readCurrentGeneration(root)).rejects.toThrow("文件指纹不匹配");
  });

  it("rejects a relation that points to a missing source event", async () => {
    const root = await tempProject();
    const payload = validPayload();
    payload.relations[0].sourceEventIds = ["event-missing"];

    await expect(publishGeneration(root, payload)).rejects.toThrow("来源事件不存在");
    expect(await readCurrentGeneration(root)).toBeNull();
  });

  it("stores assertions backed by an author override and resolves that evidence", async () => {
    const root = await tempProject();
    const payload = validPayload();
    payload.overrides = [{
      overrideId: "override-1",
      status: "active",
      userText: "顾言在获救前已经认识林默。"
    }];
    payload.assertions = [{
      propositionId: "proposition-known-before-rescue",
      scope: "WORLD",
      truthStatus: "true",
      evidenceRefs: [{
        type: "author_override",
        sourcePath: "memory/graph/overrides.jsonl",
        overrideId: "override-1"
      }]
    }];

    const published = await publishGeneration(root, payload);
    const assertionEvidence = Object.values(published.graph.evidenceIndex)
      .find((item) => item.recordType === "assertion");
    const resolved = await resolveEvidence(root, assertionEvidence.refId);

    expect(published.assertions[0].propositionId).toBe("proposition-known-before-rescue");
    expect(published.overrides[0].overrideId).toBe("override-1");
    expect(resolved).toMatchObject({
      status: "current",
      sourcePath: "memory/graph/overrides.jsonl",
      overrideId: "override-1",
      content: { userText: "顾言在获救前已经认识林默。" }
    });
  });

  it("does not follow a managed directory link outside the project while publishing", async () => {
    const root = await tempProject();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "noval-knowledge-outside-"));
    cleanup.push(outside);
    await fs.symlink(outside, path.join(root, "knowledge"));

    await expect(publishGeneration(root, validPayload())).rejects.toThrow("受管目录");
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it("builds a complete chapter index from covered chapter metadata even when a chapter has no graph records", async () => {
    const root = await tempProject();
    await fs.writeFile(path.join(root, "chapters", "0002.md"), "# 第二章\n\n顾言独自醒来。\n", "utf8");
    const payload = validPayload();
    const firstChapterId = "99999999-9999-4999-8999-999999999999";
    const secondChapterId = "00000000-0000-4000-8000-000000000001";
    payload.events[0].evidenceRefs[0].chapterId = firstChapterId;
    payload.chapters = [
      { id: firstChapterId, path: "chapters/0001.md", index: 1, title: "雨夜" },
      { id: secondChapterId, path: "chapters/0002.md", index: 2, title: "醒来" }
    ];

    const published = await publishGeneration(root, payload);

    expect(published.manifest.coveredChapters).toEqual([
      expect.objectContaining({
        chapterId: firstChapterId,
        sourcePath: "chapters/0001.md",
        contentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/)
      }),
      expect.objectContaining({
        chapterId: secondChapterId,
        sourcePath: "chapters/0002.md",
        contentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    ]);
    expect(Object.keys(published.graph.chapterIndex)).toEqual([firstChapterId, secondChapterId]);
    expect(published.graph.chapterIndex[firstChapterId]).toMatchObject({
      chapterId: firstChapterId,
      index: 1,
      title: "雨夜",
      sourcePath: "chapters/0001.md",
      eventIds: ["event-rescue"]
    });
    expect(published.graph.chapterIndex[secondChapterId]).toEqual({
      chapterId: secondChapterId,
      index: 2,
      title: "醒来",
      sourcePath: "chapters/0002.md",
      entityIds: [],
      eventIds: [],
      assertionIds: [],
      relationIds: []
    });
  });

  it("inherits analyzed chapters into a later partial generation", async () => {
    const root = await tempProject();
    await fs.writeFile(path.join(root, "chapters", "0002.md"), "# 第二章\n\n顾言独自醒来。\n", "utf8");
    const first = validPayload("generation-1");
    first.chapters = [
      { id: "chapter-1", path: "chapters/0001.md" },
      { id: "chapter-2", path: "chapters/0002.md" }
    ];
    await publishGeneration(root, first);

    const second = await publishGeneration(root, validPayload("generation-2"));

    expect(second.manifest.coveredChapters.map((chapter) => chapter.chapterId))
      .toEqual(["chapter-1", "chapter-2"]);
  });
});
