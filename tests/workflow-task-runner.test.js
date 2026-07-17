const { TASK_WORKFLOWS, WorkflowTaskRunner } = require("../services/workflow-task-runner");

describe("workflow task runner", () => {
  it("routes the four creative task types while preserving task ownership and selected context", async () => {
    const calls = [];
    const orchestrator = {
      start: async (payload) => { calls.push(payload); return { runId: "run-1", workflowId: payload.workflowId }; },
      wait: async () => ({ status: "ready", result: { kind: "answer", answer: "完成" } }),
      cancel: async () => ({ status: "cancelled" })
    };
    const runner = new WorkflowTaskRunner({ orchestrator });

    for (const [taskType, workflowId] of Object.entries(TASK_WORKFLOWS)) {
      const started = await runner.start({
        taskId: `task-${taskType}`,
        taskType,
        instruction: "完成任务",
        target: { chapterIndex: 2 },
        context: {
          documents: [{ id: "analysis:writing-context", title: "材料包", content: "{}" }],
          contextSelection: { tokenBudget: 1000, materialIds: ["analysis:writing-context"] }
        },
        settings: { apiKey: "secret", model: "fake", baseUrl: "http://fake" },
        workspaceRoot: "/tmp/noval",
        projectId: "project-1"
      });
      expect(started.workflowId).toBe(workflowId);
    }

    expect(calls).toHaveLength(4);
    expect(calls[0]).toMatchObject({
      workflowId: "WF04",
      category: "creative_task",
      ownerTaskId: "task-query",
      input: {
        instruction: "完成任务",
        contextSelection: { tokenBudget: 1000, materialIds: ["analysis:writing-context"] }
      }
    });
    expect(runner.supports("rewrite")).toBe(false);
  });
});
