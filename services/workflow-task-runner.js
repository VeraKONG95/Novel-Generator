const TASK_WORKFLOWS = Object.freeze({
  query: "WF04",
  review: "WF05",
  plan_chapters: "WF06",
  write_chapter: "WF07"
});

class WorkflowTaskRunner {
  constructor({ orchestrator }) {
    if (!orchestrator) throw new TypeError("创作流程连接器需要分析协调器。");
    this.orchestrator = orchestrator;
  }

  supports(taskType) {
    return Boolean(TASK_WORKFLOWS[String(taskType || "")]);
  }

  async start({ taskId, taskType, instruction, target, context, settings, workspaceRoot, projectId, maxConcurrency }) {
    const workflowId = TASK_WORKFLOWS[String(taskType || "")];
    if (!workflowId) throw new Error(`当前任务没有受控创作流程：${taskType || "未知"}`);
    return this.orchestrator.start({
      workspaceRoot,
      projectId,
      workflowId,
      settings,
      maxConcurrency: maxConcurrency || 4,
      category: "creative_task",
      ownerTaskId: taskId,
      input: {
        instruction: String(instruction || ""),
        target: target || null,
        materials: Array.isArray(context?.documents) ? context.documents : [],
        contextSelection: context?.contextSelection || null,
        memory: context?.memory || {},
        recentChapters: context?.recentChapters || [],
        agents: String(context?.agents || "")
      }
    });
  }

  wait(runId) {
    return this.orchestrator.wait(runId);
  }

  cancel(runId) {
    return this.orchestrator.cancel(runId);
  }
}

module.exports = { TASK_WORKFLOWS, WorkflowTaskRunner };
