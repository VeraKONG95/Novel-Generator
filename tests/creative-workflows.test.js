const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AnalysisOrchestrator } = require("../services/analysis-orchestrator");

const cleanup = [];

afterEach(async () => {
  while (cleanup.length) await fs.rm(cleanup.pop(), { recursive: true, force: true });
});

async function workspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "noval-creative-flow-"));
  cleanup.push(root);
  await fs.mkdir(path.join(root, "chapters"), { recursive: true });
  await fs.writeFile(path.join(root, "chapters", "0001.md"), "# 第一章 雨夜\n\n林默救下顾言。\n", "utf8");
  return root;
}

const settings = { apiKey: "secret", model: "fake", baseUrl: "http://fake", contextWindow: 32000 };
const materials = [
  { id: "analysis:writing-context", title: "图谱材料包", content: "顾言信任林默，因为林默在雨夜救过他。" },
  { id: "chapter:one", title: "第一章", content: "林默救下顾言。" }
];

describe("creative dynamic workflows", () => {
  it("answers a project question through material selection and a grounded answer role without writing files", async () => {
    const root = await workspace();
    const roles = [];
    const orchestrator = new AnalysisOrchestrator({ executeJob: async (job) => {
      roles.push(job.role.id);
      if (job.role.id === "R14") return { materials: [{ id: "analysis:writing-context", kind: "relationship", reason: "直接相关", priority: 1, estimatedTokens: 30 }] };
      if (job.role.id === "R16") return {
        content: "顾言信任林默，是因为林默在雨夜救过他。",
        citations: [{ materialId: "analysis:writing-context", chapterId: "chapter-1", sourcePath: "chapters/0001.md", excerpt: "林默救下顾言" }]
      };
      throw new Error(`unexpected role ${job.role.id}`);
    }});
    const started = await orchestrator.start({
      workspaceRoot: root, projectId: "project-1", workflowId: "WF04", settings,
      category: "creative_task", ownerTaskId: "task-query",
      input: { instruction: "顾言为什么信任林默？", materials }
    });
    const completed = await orchestrator.wait(started.runId);

    expect(completed).toMatchObject({ category: "creative_task", ownerTaskId: "task-query", status: "ready" });
    expect(completed.result).toMatchObject({ kind: "answer", answer: "顾言信任林默，是因为林默在雨夜救过他。" });
    expect(completed.result.sources[0]).toMatchObject({ materialId: "analysis:writing-context", chapterId: "chapter-1" });
    expect(roles).toEqual(["R14", "R16"]);
    await expect(fs.access(path.join(root, "knowledge", "CURRENT.json"))).rejects.toThrow();
  });

  it("rejects a project answer whose citation names a material but cannot locate the supporting passage", async () => {
    const root = await workspace();
    const orchestrator = new AnalysisOrchestrator({ executeJob: async (job) => {
      if (job.role.id === "R14") return { materials: [{ id: "analysis:writing-context", priority: 1 }] };
      if (job.role.id === "R16") return {
        content: "顾言信任林默。",
        citations: [{ materialId: "analysis:writing-context" }]
      };
      throw new Error(`unexpected role ${job.role.id}`);
    }});
    const started = await orchestrator.start({
      workspaceRoot: root, projectId: "project-1", workflowId: "WF04", settings,
      category: "creative_task", ownerTaskId: "task-query-without-location",
      input: { instruction: "顾言信任谁？", materials }
    });
    const completed = await orchestrator.wait(started.runId);

    expect(completed.status).toBe("failed");
    expect(completed.result).toBeNull();
    expect(completed.error).toContain("章节或材料依据");
  });

  it("rejects a project answer whose citation points to a nonexistent chapter passage", async () => {
    const root = await workspace();
    const orchestrator = new AnalysisOrchestrator({ executeJob: async (job) => {
      if (job.role.id === "R14") return { materials: [{ id: "analysis:writing-context", priority: 1 }] };
      if (job.role.id === "R16") return {
        content: "顾言信任林默。",
        citations: [{ materialId: "analysis:writing-context", sourcePath: "chapters/9999.md", excerpt: "并不存在的原文" }]
      };
      throw new Error(`unexpected role ${job.role.id}`);
    }});
    const started = await orchestrator.start({
      workspaceRoot: root, projectId: "project-1", workflowId: "WF04", settings,
      category: "creative_task", ownerTaskId: "task-query-with-fake-location",
      input: { instruction: "顾言信任谁？", materials }
    });
    const completed = await orchestrator.wait(started.runId);

    expect(completed.status).toBe("failed");
    expect(completed.error).toContain("章节或材料依据");
  });

  it("covers every material across seven independent checks and merges duplicate issues", async () => {
    const root = await workspace();
    const seenMaterialIds = new Set();
    const orchestrator = new AnalysisOrchestrator({ executeJob: async (job) => {
      if (job.role.id === "R14") return { materials: [{ id: "chapter:one", kind: "chapter", reason: "检查正文", priority: 1, estimatedTokens: 20 }] };
      if (job.role.id === "R12") {
        job.task.materials.forEach((item) => seenMaterialIds.add(item.sourceMaterialId || item.id));
        return { issues: [{ severity: "important", blocking: false, location: "第一章", reason: "人物位置跳变" }] };
      }
      throw new Error(`unexpected role ${job.role.id}`);
    }});
    const started = await orchestrator.start({
      workspaceRoot: root, projectId: "project-1", workflowId: "WF05", settings,
      category: "creative_task", ownerTaskId: "task-review",
      input: { instruction: "检查有没有吃书", materials: [...materials, { id: "appendix", title: "未被导航选中的附录", content: "仍需完整检查" }] }, maxConcurrency: 5
    });
    const completed = await orchestrator.wait(started.runId);

    expect(completed.status).toBe("ready");
    expect(completed.counts.completed).toBe(8);
    expect(completed.result.kind).toBe("review");
    expect(completed.result.issues).toHaveLength(1);
    expect(completed.result.issues[0]).toMatchObject({ location: "第一章", severity: "重要" });
    expect(Array.from(seenMaterialIds)).toEqual(expect.arrayContaining(["analysis:writing-context", "chapter:one", "appendix"]));
  });

  it("compares observations from separate material partitions so cross-chapter contradictions are found", async () => {
    const root = await workspace();
    const partitionedMaterials = [
      { id: "analysis:writing-context", title: "图谱材料包", content: "人物状态检查。" },
      { id: "chapter:early", title: "前段章节", content: `林默仍然活着。${"前段资料。".repeat(900)}` },
      { id: "chapter:late", title: "后段章节", content: `后文却说林默已经死亡。${"后段资料。".repeat(900)}` }
    ];
    let crossBatchCalls = 0;
    const orchestrator = new AnalysisOrchestrator({ executeJob: async (job) => {
      if (job.role.id === "R14") return { materials: [{ id: "chapter:early", priority: 1 }] };
      if (job.role.id === "R12" && job.task.input.mode === "cross_batch_synthesis") {
        crossBatchCalls += 1;
        const observations = job.task.input.batchFindings.flatMap((item) => item.observations || []);
        const values = new Set(observations.filter((item) => item.subject === "林默").map((item) => item.value));
        return {
          issues: job.task.input.perspective === "人物状态" && values.has("alive") && values.has("dead")
            ? [{ severity: "critical", blocking: true, perspective: "人物状态", location: "前段章节与后段章节", reason: "林默生死状态矛盾" }]
            : []
        };
      }
      if (job.role.id === "R12") {
        const ids = job.task.materials.map((item) => item.sourceMaterialId || item.id);
        const observations = [];
        if (ids.includes("chapter:early")) observations.push({ subject: "林默", key: "life_status", value: "alive", sourcePath: "chapters/0001.md" });
        if (ids.includes("chapter:late")) observations.push({ subject: "林默", key: "life_status", value: "dead", sourcePath: "chapters/0100.md" });
        return { issues: [], observations };
      }
      throw new Error(`unexpected role ${job.role.id}`);
    }});
    const started = await orchestrator.start({
      workspaceRoot: root, projectId: "project-1", workflowId: "WF05",
      settings: { ...settings, contextWindow: 8000 },
      category: "creative_task", ownerTaskId: "task-cross-batch-review",
      input: { instruction: "检查全书前后矛盾", materials: partitionedMaterials }, maxConcurrency: 5
    });
    const completed = await orchestrator.wait(started.runId);

    expect(completed.status).toBe("ready");
    expect(completed.result.contextSelection.partitionCount).toBeGreaterThan(1);
    expect(crossBatchCalls).toBe(7);
    expect(completed.result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ location: "前段章节与后段章节", reason: "林默生死状态矛盾", severity: "严重" })
    ]));
  });

  it("revises a chapter plan once after critical review and returns a deterministic file candidate", async () => {
    const root = await workspace();
    let planCalls = 0;
    const orchestrator = new AnalysisOrchestrator({ executeJob: async (job) => {
      if (job.role.id === "R14") return { materials: [{ id: "analysis:writing-context", kind: "context", reason: "规划", priority: 1, estimatedTokens: 30 }] };
      if (job.role.id === "R15") {
        planCalls += 1;
        return { plan: { title: planCalls === 1 ? "失稳计划" : "灯塔会面", goal: "查明真相", scenes: [{ title: "会面", conflict: "互相试探" }], characters: ["林默", "顾言"], conflicts: ["不信任"], storylineProgress: ["灯塔线"], hooks: ["旧钥匙"], endState: "二人暂时合作" } };
      }
      if (job.role.id === "R17") {
        const title = job.task.input.plan?.title;
        return { issues: title === "失稳计划" ? [{ perspective: job.task.input.perspective, severity: "critical", location: "场景1", reason: "顾言提前知道真相", suggestion: "保留认知边界" }] : [] };
      }
      throw new Error(`unexpected role ${job.role.id}`);
    }});
    const started = await orchestrator.start({
      workspaceRoot: root, projectId: "project-1", workflowId: "WF06", settings,
      category: "creative_task", ownerTaskId: "task-plan",
      input: { instruction: "规划下一章", target: { chapterIndex: 2, chapterTitle: "灯塔" }, materials }, maxConcurrency: 5
    });
    const completed = await orchestrator.wait(started.runId);

    expect(completed.status).toBe("ready");
    expect(planCalls).toBe(2);
    expect(completed.result).toMatchObject({ kind: "candidate" });
    expect(completed.result.changes[0]).toMatchObject({ path: "outline/chapters/0002.md", action: "create" });
    expect(completed.result.changes[0].content).toContain("灯塔会面");
  });

  it("revises drafted prose, only returning a chapter candidate after all critical issues are cleared", async () => {
    const root = await workspace();
    let writingCalls = 0;
    const orchestrator = new AnalysisOrchestrator({ executeJob: async (job) => {
      if (job.role.id === "R14") return { materials: [{ id: "analysis:writing-context", kind: "context", reason: "续写", priority: 1, estimatedTokens: 30 }] };
      if (job.role.id === "R15") return { plan: { title: "灯塔", goal: "会面", scenes: [{ title: "门前" }], characters: ["林默"], conflicts: [], storylineProgress: [], hooks: [], endState: "入塔" } };
      if (job.role.id === "R16") {
        writingCalls += 1;
        return { content: writingCalls === 1 ? "林默说出了自己不该知道的秘密。" : "林默停在门外，没有说破顾言的秘密。" };
      }
      if (job.role.id === "R17") return { issues: job.task.input.content.includes("不该知道") ? [{ perspective: job.task.input.perspective, severity: "critical", location: "第一段", reason: "认知泄漏", suggestion: "删去秘密内容" }] : [] };
      throw new Error(`unexpected role ${job.role.id}`);
    }});
    const started = await orchestrator.start({
      workspaceRoot: root, projectId: "project-1", workflowId: "WF07", settings,
      category: "creative_task", ownerTaskId: "task-write",
      input: { instruction: "续写下一章", target: { chapterIndex: 2, chapterTitle: "灯塔" }, materials }, maxConcurrency: 5
    });
    const completed = await orchestrator.wait(started.runId);

    expect(completed.status).toBe("ready");
    expect(writingCalls).toBe(2);
    expect(completed.result.kind).toBe("candidate");
    expect(completed.result.changes[0]).toMatchObject({ path: "chapters/0002.md", action: "create" });
    expect(completed.result.changes[0].content).toContain("没有说破");
  });

  it("returns a conflict and no file candidate when two prose revisions still leave critical issues", async () => {
    const root = await workspace();
    let writingCalls = 0;
    const orchestrator = new AnalysisOrchestrator({ executeJob: async (job) => {
      if (job.role.id === "R14") return { materials: [{ id: "analysis:writing-context", kind: "context", reason: "续写", priority: 1, estimatedTokens: 30 }] };
      if (job.role.id === "R15") return { plan: { title: "灯塔", goal: "会面", scenes: [{ title: "门前" }], characters: [], conflicts: [], storylineProgress: [], hooks: [], endState: "入塔" } };
      if (job.role.id === "R16") { writingCalls += 1; return { content: `仍有严重矛盾-${writingCalls}` }; }
      if (job.role.id === "R17") return { issues: [{ perspective: job.task.input.perspective, severity: "critical", location: "全文", reason: "严重矛盾", suggestion: "重新处理" }] };
      throw new Error(`unexpected role ${job.role.id}`);
    }});
    const started = await orchestrator.start({
      workspaceRoot: root, projectId: "project-1", workflowId: "WF07", settings,
      category: "creative_task", ownerTaskId: "task-conflict",
      input: { instruction: "续写下一章", target: { chapterIndex: 2 }, materials }, maxConcurrency: 5
    });
    const completed = await orchestrator.wait(started.runId);

    expect(writingCalls).toBe(3);
    expect(completed.status).toBe("ready");
    expect(completed.result).toMatchObject({ kind: "conflict" });
    expect(completed.result.changes).toBeUndefined();
  });
});
