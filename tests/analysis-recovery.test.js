const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AnalysisOrchestrator } = require("../services/analysis-orchestrator");

const cleanup = [];

afterEach(async () => {
  while (cleanup.length) await fs.rm(cleanup.pop(), { recursive: true, force: true });
});

describe("analysis restart recovery", () => {
  it("continues the same persisted run with its original input and cached completed jobs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "noval-analysis-resume-"));
    cleanup.push(root);
    await fs.mkdir(path.join(root, "chapters"), { recursive: true });
    await fs.writeFile(path.join(root, "chapters", "0001.md"), "# 第一章\n\n正文。\n", "utf8");
    let releaseChecks = () => {};
    const checkGate = new Promise((resolve) => { releaseChecks = resolve; });
    let startedChecks = 0;
    const first = new AnalysisOrchestrator({ executeJob: async (job) => {
      if (job.role.id === "R14") return { materials: [] };
      startedChecks += 1;
      await checkGate;
      return { issues: [] };
    }});
    const started = await first.start({
      workspaceRoot: root,
      projectId: "project-recovery",
      workflowId: "WF05",
      category: "project_analysis",
      settings: { apiKey: "must-not-be-persisted", model: "fake", baseUrl: "http://fake" },
      maxConcurrency: 2,
      input: { instruction: "只检查林默的认知边界", target: { entityId: "lin" } }
    });
    while (startedChecks < 2) await new Promise((resolve) => setTimeout(resolve, 2));
    const pausing = first.pause(started.runId);
    releaseChecks();
    const paused = await pausing;
    expect(paused.status).toBe("paused");

    const requestPath = path.join(root, ".noval", "analysis", started.runId, "request.json");
    const persistedRequest = JSON.parse(await fs.readFile(requestPath, "utf8"));
    expect(persistedRequest.input).toMatchObject({ instruction: "只检查林默的认知边界", target: { entityId: "lin" } });
    expect(JSON.stringify(persistedRequest)).not.toContain("must-not-be-persisted");

    const resumedInputs = [];
    const second = new AnalysisOrchestrator({ executeJob: async (job) => {
      resumedInputs.push(job.task.input);
      if (job.role.id === "R14") return { materials: [] };
      return { issues: [] };
    }});
    const resumed = await second.resumeLatest({
      workspaceRoot: root,
      settings: { apiKey: "fresh-secret", model: "fake", baseUrl: "http://fake" },
      chapters: []
    });
    const completed = await second.wait(resumed.runId);

    expect(resumed.runId).toBe(started.runId);
    expect(completed).toMatchObject({ status: "ready", counts: { total: 8, completed: 8, running: 0, failed: 0, waiting: 0 } });
    expect(resumedInputs.some((input) => input.instruction === "只检查林默的认知边界")).toBe(true);
    const finalRun = JSON.parse(await fs.readFile(path.join(root, ".noval", "analysis", started.runId, "run.json"), "utf8"));
    expect(finalRun.status).toBe("ready");
  });
});
