const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AnalysisOrchestrator } = require("../services/analysis-orchestrator");
const { TaskManager } = require("../services/task-manager");
const { WorkflowTaskRunner } = require("../services/workflow-task-runner");

describe("creative workflow task integration", () => {
  it("keeps the existing task lifecycle while isolating creative runs from project analysis status", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "noval-workflow-task-integration-"));
    try {
      await fs.mkdir(path.join(root, "chapters"), { recursive: true });
      await fs.writeFile(path.join(root, "chapters", "0001.md"), "# 第一章\n\n林默救下顾言。\n", "utf8");
      const orchestrator = new AnalysisOrchestrator({ executeJob: async (job) => {
        if (job.role.id === "R14") return { materials: [{ id: "context", kind: "graph", reason: "直接相关", priority: 1, estimatedTokens: 20 }] };
        if (job.role.id === "R16") return {
          content: "顾言信任林默，因为林默救过他。",
          citations: [{ materialId: "context", sourcePath: "chapters/0001.md", excerpt: "林默救下顾言" }]
        };
        throw new Error(`unexpected role ${job.role.id}`);
      }});
      const runner = new WorkflowTaskRunner({ orchestrator });
      const manager = new TaskManager({
        utilityProcess: { fork: () => { throw new Error("ordinary worker must not start"); } },
        workerPath: "unused",
        userDataDir: root,
        workflowRunner: runner
      });

      const task = await manager.start({
        taskType: "query",
        instruction: "顾言为什么信任林默？",
        context: { documents: [{ id: "context", title: "关系材料", content: "林默救下顾言。" }] },
        settings: { apiKey: "secret", model: "fake", baseUrl: "http://fake", contextWindow: 32000 },
        workspaceRoot: root,
        projectId: "project-1"
      });
      await manager.workflowPromises.get(task.id);

      expect(manager.get(task.id)).toMatchObject({
        status: "completed",
        result: { kind: "answer", answer: "顾言信任林默，因为林默救过他。" }
      });
      expect(await orchestrator.readLatestStatus(root)).toBeNull();
      expect(await orchestrator.readLatestStatus(root, { category: "creative_task" }))
        .toMatchObject({ status: "ready", ownerTaskId: task.id, workflowId: "WF04" });
      const finishedRun = orchestrator.runs.get(task.workflowRunId);
      expect(finishedRun.pool).toBeNull();
      expect(finishedRun.input.materials).toBeUndefined();
      expect(finishedRun.settings).toEqual({ model: "fake" });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
