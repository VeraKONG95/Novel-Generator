const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AnalysisOrchestrator } = require("../services/analysis-orchestrator");
const { readCurrentGeneration } = require("../services/analysis/graph-store");
const {
  estimateConservativeTokens,
  extractionPayloadBudget
} = require("../services/analysis/chapter-segmentation");

const cleanup = [];

afterEach(async () => {
  while (cleanup.length) await fs.rm(cleanup.pop(), { recursive: true, force: true });
});

describe("long chapter import", () => {
  it("takes a roughly thirty-thousand-character chapter from import through ready using bounded R03 pieces", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "noval-long-chapter-"));
    cleanup.push(root);
    await fs.mkdir(path.join(root, "chapters"), { recursive: true });
    const content = [
      "# 第一章 漫长雨夜",
      ...Array.from({ length: 520 }, (_, index) => `第${index + 1}段，林默穿过雨夜中的街巷，观察门牌、灯光与行人的变化，并继续寻找顾言。`)
    ].join("\n\n");
    await fs.writeFile(path.join(root, "chapters", "0001.md"), content, "utf8");

    const extractionJobs = [];
    const executeJob = async (job) => {
      if (job.role.id === "R02") return {
        entityCandidates: [], aliasCandidates: [], timeStructure: {}, storylines: [], keyChapters: [], styleSamples: []
      };
      if (job.role.id === "R03") {
        extractionJobs.push(job);
        return { mentions: [], events: [], assertions: [], relationChanges: [], hooks: [], styleSamples: [] };
      }
      if (job.role.id === "R04") return { decisions: [] };
      if (job.role.id === "R05") return { events: [], uncertainties: [] };
      if (job.role.id === "R10") return { style: { summary: "克制" } };
      if (job.role.id === "R12") return { issues: [] };
      if (job.role.id === "R13") return { materials: {} };
      throw new Error(`unexpected role ${job.role.id}`);
    };
    const orchestrator = new AnalysisOrchestrator({ executeJob });
    const started = await orchestrator.start({
      workspaceRoot: root,
      projectId: "long-book",
      workflowId: "WF01",
      settings: { model: "fake", contextWindow: 8000, maxOutputTokens: 4096 },
      maxConcurrency: 4,
      chapters: [{ id: "uuid-chapter-one", index: 1, title: "漫长雨夜", path: "chapters/0001.md" }]
    });
    const completed = await orchestrator.wait(started.runId);
    const current = await readCurrentGeneration(root);
    const payloadBudget = extractionPayloadBudget(8000, 4096);

    expect(completed.status).toBe("ready");
    expect(completed.counts.failed).toBe(0);
    expect(extractionJobs.length).toBeGreaterThan(10);
    for (const job of extractionJobs) {
      expect(job.task.input.target).toEqual(expect.objectContaining({ id: expect.any(String), title: expect.any(String) }));
      expect(job.task.input.target.content).toBeUndefined();
      expect(job.task.input.target.sourceContent).toBeUndefined();
      expect(job.task.input.evidenceIndex.every((item) => !("text" in item))).toBe(true);
      const estimated = estimateConservativeTokens(job.task.materials[0].content) + estimateConservativeTokens({
        chapterId: job.task.input.chapterId,
        chapterIndex: job.task.input.chapterIndex,
        sourcePath: job.task.input.sourcePath,
        partIndex: job.task.input.partIndex,
        partCount: job.task.input.partCount,
        evidenceIndex: job.task.input.evidenceIndex
      });
      expect(estimated).toBeLessThanOrEqual(payloadBudget);
    }
    expect(current.manifest.coveredChapters).toEqual([
      expect.objectContaining({ chapterId: "uuid-chapter-one", index: 1, title: "漫长雨夜" })
    ]);
    expect(current.graph.chapterIndex["uuid-chapter-one"]).toMatchObject({ index: 1, title: "漫长雨夜" });
  });
});
