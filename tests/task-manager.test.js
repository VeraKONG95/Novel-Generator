const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { TaskManager } = require("../services/task-manager");

function fakeUtilityProcess() {
  return {
    fork() {
      const worker = new EventEmitter();
      worker.postMessage = () => {};
      worker.kill = () => worker.emit("exit", 0);
      setTimeout(() => worker.emit("message", { channel: "worker-ready" }), 0);
      return worker;
    }
  };
}

function controllableUtilityProcess() {
  let worker;
  return {
    api: {
      fork() {
        worker = new EventEmitter();
        worker.messages = [];
        worker.postMessage = (message) => worker.messages.push(message);
        worker.kill = () => worker.emit("exit", 0);
        setTimeout(() => worker.emit("message", { channel: "worker-ready" }), 0);
        return worker;
      }
    },
    get worker() {
      return worker;
    }
  };
}

describe("task manager", () => {
  it("stops a running task without creating a result", async () => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "noval-tasks-"));
    try {
      const manager = new TaskManager({
        utilityProcess: fakeUtilityProcess(),
        workerPath: "fake-worker",
        userDataDir
      });
      const task = await manager.start({
        taskType: "query",
        instruction: "测试停止",
        context: { documents: [] },
        settings: { apiKey: "x", baseUrl: "http://example.test", model: "fake" },
        projectId: "project-1"
      });
      const stopped = await manager.stop(task.id);
      expect(stopped.status).toBe("stopped");
      expect(stopped.result).toBeNull();
      expect(stopped.error).toContain("正式内容没有被修改");
    } finally {
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  });

  it("marks unfinished persisted tasks as interrupted on reopen", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "noval-task-recovery-"));
    try {
      const taskDir = path.join(root, ".noval", "tasks", "task-old");
      await fs.mkdir(taskDir, { recursive: true });
      await fs.writeFile(
        path.join(taskDir, "task.json"),
        JSON.stringify({
          id: "task-old",
          projectId: "project-1",
          workspaceRoot: root,
          status: "executing",
          updatedAt: new Date().toISOString()
        }),
        "utf8"
      );
      const manager = new TaskManager({
        utilityProcess: fakeUtilityProcess(),
        workerPath: "fake-worker",
        userDataDir: root
      });
      const tasks = await manager.loadWorkspaceTasks(root);
      expect(tasks[0].status).toBe("interrupted");
      expect(tasks[0].error).toContain("正式内容没有被修改");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps a confirmed candidate waiting after reopen", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "noval-task-candidate-"));
    try {
      const taskDir = path.join(root, ".noval", "tasks", "task-candidate");
      await fs.mkdir(taskDir, { recursive: true });
      await fs.writeFile(path.join(taskDir, "task.json"), JSON.stringify({
        id: "task-candidate",
        projectId: "project-1",
        workspaceRoot: root,
        status: "awaiting_confirmation",
        result: { kind: "candidate", content: "候选正文" },
        updatedAt: new Date().toISOString()
      }), "utf8");
      const manager = new TaskManager({ utilityProcess: fakeUtilityProcess(), workerPath: "fake", userDataDir: root });
      const tasks = await manager.loadWorkspaceTasks(root);
      expect(tasks[0].status).toBe("awaiting_confirmation");
      expect(tasks[0].result.content).toBe("候选正文");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("continues the same interview task after the author answers", async () => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "noval-task-answer-"));
    const controlled = controllableUtilityProcess();
    try {
      const manager = new TaskManager({ utilityProcess: controlled.api, workerPath: "fake", userDataDir });
      const task = await manager.start({
        taskType: "create_project",
        instruction: "建立新书",
        context: { documents: [] },
        settings: { apiKey: "x", baseUrl: "http://example.test", model: "fake" },
        projectId: "project-1"
      });
      await manager.handleWorkerMessage({
        channel: "task-result",
        taskId: task.id,
        result: { kind: "question", reason: "缺少方向", questions: [{ id: "q1", question: "结局更明亮还是更冷峻？" }] }
      });
      const resumed = await manager.answer(task.id, "更冷峻", {
        context: { documents: [] },
        settings: { apiKey: "x", baseUrl: "http://example.test", model: "fake" }
      });
      expect(resumed.status).toBe("reading");
      expect(controlled.worker.messages.at(-1).request.instruction).toContain("更冷峻");
      expect(resumed.answers).toHaveLength(1);
      expect(resumed.questionHistory[0].result.questions[0].question).toContain("结局");
    } finally {
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  });

  it("ignores a late model result after the author stops", async () => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "noval-task-late-"));
    try {
      const manager = new TaskManager({ utilityProcess: fakeUtilityProcess(), workerPath: "fake", userDataDir });
      const task = await manager.start({
        taskType: "query",
        instruction: "停止测试",
        context: { documents: [] },
        settings: { apiKey: "x", baseUrl: "http://example.test", model: "fake" },
        projectId: "project-1"
      });
      await manager.stop(task.id);
      await manager.handleWorkerMessage({ channel: "task-result", taskId: task.id, result: { kind: "answer", answer: "迟到结果" } });
      expect(manager.get(task.id).status).toBe("stopped");
      expect(manager.get(task.id).result).toBeNull();
    } finally {
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  });

  it("serializes rapid worker events without corrupting the task record", async () => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "noval-task-events-"));
    const controlled = controllableUtilityProcess();
    try {
      const manager = new TaskManager({ utilityProcess: controlled.api, workerPath: "fake", userDataDir });
      const task = await manager.start({
        taskType: "query", instruction: "高频事件", context: { documents: [] },
        settings: { apiKey: "x", baseUrl: "http://example.test", model: "fake" }, projectId: "project-1"
      });
      for (let index = 0; index < 40; index += 1) {
        controlled.worker.emit("message", {
          channel: "task-event", taskId: task.id, event: { type: "text_delta", text: String(index % 10) }
        });
      }
      controlled.worker.emit("message", {
        channel: "task-result", taskId: task.id, result: { kind: "answer", answer: "完成" }
      });
      await manager.messageQueue;
      const stored = JSON.parse(await fs.readFile(path.join(userDataDir, "noval-tasks", task.id, "task.json"), "utf8"));
      expect(stored.status).toBe("completed");
      expect(stored.assistantText).toHaveLength(40);
    } finally {
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  });

  it("keeps conversation identity across tasks and allows several pending candidates", async () => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "noval-task-conversations-"));
    try {
      const manager = new TaskManager({ utilityProcess: fakeUtilityProcess(), workerPath: "fake", userDataDir });
      const first = await manager.start({
        taskType: "rewrite", instruction: "修改蓝图", context: { documents: [] },
        settings: { apiKey: "x", baseUrl: "http://example.test", model: "fake" }, projectId: "project-1",
        conversationId: "conversation-a", conversationTitle: "蓝图讨论"
      });
      await manager.handleWorkerMessage({ channel: "task-result", taskId: first.id, result: {
        kind: "candidate", title: "蓝图修改", summary: "已修改", changes: [{ path: "outline/book.md", action: "update", content: "# 蓝图" }]
      }});
      const second = await manager.start({
        taskType: "query", instruction: "再说说人物", context: { documents: [] },
        settings: { apiKey: "x", baseUrl: "http://example.test", model: "fake" }, projectId: "project-1",
        conversationId: "conversation-a", conversationTitle: "蓝图讨论"
      });
      await manager.handleWorkerMessage({ channel: "task-result", taskId: second.id, result: {
        kind: "question", reason: "需要确认", questions: [{ id: "q1", question: "主角是谁？" }]
      }});
      const listed = manager.list("project-1");
      expect(listed).toHaveLength(2);
      expect(listed.every((task) => task.conversationId === "conversation-a")).toBe(true);
      expect(listed.every((task) => task.status === "awaiting_confirmation")).toBe(true);
    } finally {
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  });
});
