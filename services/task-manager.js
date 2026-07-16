const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const ACTIVE_STATUSES = new Set(["queued", "reading", "planning", "executing"]);
const RUNNING_STATUSES = new Set(["queued", "reading", "planning", "executing"]);
const TERMINAL_STATUSES = new Set(["completed", "stopped", "failed", "interrupted", "rejected", "abandoned"]);

function nowIso() {
  return new Date().toISOString();
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

class TaskManager {
  constructor({ utilityProcess, workerPath, userDataDir, onEvent, workflowRunner = null }) {
    this.utilityProcess = utilityProcess;
    this.workerPath = workerPath;
    this.userDataDir = userDataDir;
    this.onEvent = onEvent;
    this.worker = null;
    this.workerReady = false;
    this.workerReadyPromise = null;
    this.tasks = new Map();
    this.activeTaskId = "";
    this.pendingProbe = null;
    this.messageQueue = Promise.resolve();
    this.workflowRunner = workflowRunner;
    this.workflowPromises = new Map();
  }

  taskRoot(workspaceRoot, taskId) {
    const base = workspaceRoot
      ? path.join(workspaceRoot, ".noval", "tasks")
      : path.join(this.userDataDir, "noval-tasks");
    return taskId ? path.join(base, taskId) : base;
  }

  async ensureWorker() {
    if (this.worker && this.workerReady) return;
    if (this.workerReadyPromise) return this.workerReadyPromise;

    this.workerReadyPromise = new Promise((resolve, reject) => {
      const worker = this.utilityProcess.fork(this.workerPath, [], {
        serviceName: "Noval Pi Runtime",
        stdio: "pipe"
      });
      this.worker = worker;
      const timeout = setTimeout(() => reject(new Error("Pi 后台启动超时。")), 10000);

      worker.on("message", (message) => {
        if (message?.channel === "worker-ready") {
          clearTimeout(timeout);
          this.workerReady = true;
          resolve();
          return;
        }
        this.messageQueue = this.messageQueue
          .then(() => this.handleWorkerMessage(message))
          .catch((error) => {
            const taskId = message?.taskId;
            if (taskId && this.tasks.has(taskId)) {
              return this.failTask(taskId, error instanceof Error ? error.message : String(error));
            }
            return null;
          });
      });
      worker.on("exit", (_code) => {
        this.worker = null;
        this.workerReady = false;
        this.workerReadyPromise = null;
        if (this.activeTaskId) {
          const interruptedTaskId = this.activeTaskId;
          this.messageQueue = this.messageQueue
            .then(() => this.failTask(interruptedTaskId, "Pi 后台意外退出，正式内容没有被修改。", "interrupted"))
            .catch(() => null);
        }
      });
    }).finally(() => {
      this.workerReadyPromise = null;
    });
    return this.workerReadyPromise;
  }

  async persistTask(task) {
    const root = this.taskRoot(task.workspaceRoot, task.id);
    await fs.mkdir(root, { recursive: true });
    const temp = path.join(root, `task.json.${crypto.randomUUID()}.tmp`);
    const target = path.join(root, "task.json");
    await fs.writeFile(temp, JSON.stringify(task, null, 2), "utf8");
    await fs.rename(temp, target);
  }

  async appendEvent(task, event) {
    const root = this.taskRoot(task.workspaceRoot, task.id);
    await fs.mkdir(root, { recursive: true });
    await fs.appendFile(
      path.join(root, "events.jsonl"),
      `${JSON.stringify({ at: nowIso(), ...event })}\n`,
      "utf8"
    );
  }

  emit(task, event) {
    this.onEvent?.({ taskId: task.id, task: { ...task }, event });
  }

  async updateTask(taskId, patch, event = null) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    Object.assign(task, patch, { updatedAt: nowIso() });
    if (event) {
      task.events = [...(task.events || []), { at: nowIso(), ...event }].slice(-120);
      await this.appendEvent(task, event);
    }
    await this.persistTask(task);
    this.emit(task, event || { type: "task_updated" });
    return task;
  }

  async start({ taskType, instruction, target, context, settings, baseRevisions = {}, workspaceRoot = "", projectId = "", conversationId = "", conversationTitle = "", contextRetryCount = 0 }) {
    if (this.activeTaskId) throw new Error("当前已有任务正在运行，请等待完成或先停止。" );
    if (!settings?.apiKey) throw new Error("请先配置并检查模型。" );
    const id = `task-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const task = {
      id,
      projectId,
      conversationId: String(conversationId || id),
      conversationTitle: String(conversationTitle || instruction || "新对话").trim().slice(0, 28),
      workspaceRoot,
      taskType,
      instruction: String(instruction || ""),
      target: target || null,
      baseRevisions,
      status: "queued",
      plan: [],
      materials: (context?.documents || []).map((item) => ({ id: item.id, title: item.title })),
      contextSelection: context?.contextSelection || null,
      contextRetryCount: Math.max(0, Number(contextRetryCount) || 0),
      assistantText: "",
      result: null,
      error: "",
      warnings: [],
      events: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      startedAt: nowIso(),
      finishedAt: ""
    };
    this.tasks.set(id, task);
    this.activeTaskId = id;
    await this.persistTask(task);
    await this.updateTask(id, { status: "reading" }, { type: "stage", stage: "reading", text: "正在读取相关创作资料" });

    try {
      if (workspaceRoot && this.workflowRunner?.supports?.(taskType)) {
        const run = await this.workflowRunner.start({
          taskId: id,
          taskType,
          instruction: task.instruction,
          target: task.target,
          context,
          settings,
          workspaceRoot,
          projectId,
          maxConcurrency: settings?.analysisMaxConcurrency
        });
        await this.updateTask(
          id,
          { status: "planning", workflowRunId: run.runId, workflowId: run.workflowId || "" },
          { type: "stage", stage: "planning", text: "正在按创作流程准备和检查" }
        );
        const observed = this.observeWorkflow(id, run.runId);
        this.workflowPromises.set(id, observed);
        return { ...this.tasks.get(id) };
      }
      await this.ensureWorker();
      this.worker.postMessage({
        type: "run",
        taskId: id,
        settings,
        request: { taskType, instruction, target, context }
      });
    } catch (error) {
      await this.failTask(id, error instanceof Error ? error.message : String(error));
      throw error;
    }
    return { ...task };
  }

  async observeWorkflow(taskId, runId) {
    try {
      const run = await this.workflowRunner.wait(runId);
      const task = this.tasks.get(taskId);
      if (!task || TERMINAL_STATUSES.has(task.status)) return task ? { ...task } : null;
      if (run?.status === "cancelled") {
        return this.failTask(taskId, "任务已由作者停止，正式内容没有被修改。", "stopped");
      }
      if (!run || run.status === "failed" || !run.result) {
        return this.failTask(taskId, run?.error || "创作流程没有产生可用结果。", "failed");
      }
      return this.completeTaskResult(taskId, run.result);
    } catch (error) {
      const task = this.tasks.get(taskId);
      if (!task || TERMINAL_STATUSES.has(task.status)) return task ? { ...task } : null;
      return this.failTask(taskId, error instanceof Error ? error.message : String(error), "failed");
    }
  }

  async completeTaskResult(taskId, result) {
    const task = this.tasks.get(taskId);
    if (!task || TERMINAL_STATUSES.has(task.status)) return task ? { ...task } : null;
    const awaiting = ["candidate", "conflict", "question"].includes(result?.kind);
    const plan = String(task.assistantText || "")
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*]|\d+[.、)])\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 5);
    const root = this.taskRoot(task.workspaceRoot, task.id);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "result.json"), JSON.stringify(result, null, 2), "utf8");
    const latest = this.tasks.get(taskId);
    if (!latest || TERMINAL_STATUSES.has(latest.status)) return latest ? { ...latest } : null;
    const updated = await this.updateTask(
      task.id,
      {
        status: awaiting ? "awaiting_confirmation" : "completed",
        plan,
        result,
        contextSelection: result?.contextSelection || task.contextSelection || null,
        finishedAt: awaiting ? "" : nowIso()
      },
      { type: "result", kind: result?.kind || "unknown" }
    );
    if (this.activeTaskId === task.id) this.activeTaskId = "";
    return updated;
  }

  async handleWorkerMessage(message) {
    if (!message?.taskId) return;
    const task = this.tasks.get(message.taskId);
    if (!task) return;
    if (TERMINAL_STATUSES.has(task.status)) return;

    if (message.channel === "task-event") {
      const event = message.event || {};
      if (event.type === "stage") {
        const nextStatus = event.stage === "planning" ? "planning" : "executing";
        await this.updateTask(task.id, { status: nextStatus }, event);
        return;
      }
      if (event.type === "text_delta") {
        task.assistantText += String(event.text || "");
        task.streamingSeen = true;
        if (task.assistantText.length % 120 < String(event.text || "").length) {
          await this.persistTask(task);
          this.emit(task, event);
        } else {
          this.emit(task, event);
        }
        return;
      }
      if (event.type === "stream_delta") {
        task.streamingSeen = true;
      }
      await this.updateTask(task.id, {}, event);
      return;
    }

    if (message.channel === "task-result") {
      await this.completeTaskResult(task.id, message.result);
      return;
    }

    if (message.channel === "task-stopped") {
      await this.failTask(task.id, message.error || "任务已停止。", "stopped");
      return;
    }

    if (message.channel === "task-error") {
      await this.failTask(task.id, message.error || "模型任务失败。", "failed");
    }
  }

  async failTask(taskId, error, status = "failed") {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    if (this.activeTaskId === taskId) this.activeTaskId = "";
    return this.updateTask(
      taskId,
      { status, error: String(error || "任务失败。"), finishedAt: nowIso() },
      { type: "error", status, text: String(error || "任务失败。") }
    );
  }

  async stop(taskId) {
    const task = this.tasks.get(taskId);
    if (!task || !ACTIVE_STATUSES.has(task.status)) return task ? { ...task } : null;
    if (task.workflowRunId && this.workflowRunner?.cancel) {
      const stopped = await this.failTask(taskId, "任务已由作者停止，正式内容没有被修改。", "stopped");
      try { await this.workflowRunner.cancel(task.workflowRunId); }
      catch { /* The local stopped state remains authoritative for a failed cancel request. */ }
      return stopped;
    }
    if (this.worker && this.activeTaskId === taskId) {
      this.worker.postMessage({ type: "abort", taskId });
    }
    return this.failTask(taskId, "任务已由作者停止，正式内容没有被修改。", "stopped");
  }

  async decide(taskId, decision, resultOverride = null) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("任务不存在。" );
    if (task.status !== "awaiting_confirmation") throw new Error("当前任务不在等待确认状态。" );
    const status = decision === "accept" ? "completed" : "rejected";
    const sourceResult = resultOverride || task.result;
    const compactResult = decision === "accept"
      ? sourceResult
      : sourceResult?.kind === "candidate" && Array.isArray(sourceResult?.changes)
        ? {
            ...sourceResult,
            changes: sourceResult.changes.map((item) => ({ path: item.path, action: item.action, reason: item.reason || "" }))
          }
        : sourceResult;
    const updated = await this.updateTask(
      taskId,
      { status, decision, result: compactResult, finishedAt: nowIso() },
      { type: "decision", decision }
    );
    if (this.activeTaskId === taskId) this.activeTaskId = "";
    return updated;
  }

  async answer(taskId, answer, { context, settings } = {}) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("任务不存在。" );
    if (task.status !== "awaiting_confirmation" || task.result?.kind !== "question") {
      throw new Error("当前任务不在等待回答状态。" );
    }
    if (!String(answer || "").trim()) throw new Error("回答不能为空。" );
    if (!settings?.apiKey) throw new Error("请重新检查模型设置。" );
    if (this.activeTaskId && this.activeTaskId !== taskId) throw new Error("当前另一段对话正在生成，请等它完成或先停止。");

    const answerRecord = { at: nowIso(), answer: String(answer).trim() };
    const answers = [...(task.answers || []), answerRecord];
    const questionHistory = [
      ...(task.questionHistory || []),
      { askedAt: task.updatedAt, result: task.result, ...answerRecord }
    ];
    await this.updateTask(
      taskId,
      { status: "reading", answers, questionHistory, result: null, error: "", assistantText: "", streamingSeen: false },
      { type: "answer", text: String(answer).trim() }
    );
    this.activeTaskId = taskId;
    try {
      await this.ensureWorker();
      this.worker.postMessage({
        type: "run",
        taskId,
        settings,
        request: {
          taskType: task.taskType,
          instruction: [task.instruction, ...answers.map((item, index) => `作者第 ${index + 1} 次补充：${item.answer}`)].join("\n\n"),
          target: task.target,
          context
        }
      });
    } catch (error) {
      await this.failTask(taskId, error instanceof Error ? error.message : String(error));
      throw error;
    }
    return { ...task };
  }

  async abandon(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("任务不存在。" );
    const compactResult = task.result?.kind === "candidate" && Array.isArray(task.result?.changes)
      ? { ...task.result, changes: task.result.changes.map((item) => ({ path: item.path, action: item.action, reason: item.reason || "" })) }
      : task.result;
    const updated = await this.updateTask(taskId, { status: "abandoned", result: compactResult, finishedAt: nowIso() }, { type: "decision", decision: "abandon" });
    if (this.activeTaskId === taskId) this.activeTaskId = "";
    return updated;
  }

  async loadWorkspaceTasks(workspaceRoot) {
    const root = this.taskRoot(workspaceRoot);
    if (!(await fileExists(root))) return [];
    const names = await fs.readdir(root);
    const tasks = [];
    for (const name of names) {
      const filePath = path.join(root, name, "task.json");
      if (!(await fileExists(filePath))) continue;
      try {
        const task = JSON.parse(await fs.readFile(filePath, "utf8"));
        const liveTask = this.tasks.get(task.id);
        if (liveTask && this.activeTaskId === task.id && RUNNING_STATUSES.has(liveTask.status)) {
          tasks.push({ ...liveTask });
          continue;
        }
        if (RUNNING_STATUSES.has(task.status)) {
          task.status = "interrupted";
          task.error = "应用上次在任务完成前关闭，正式内容没有被修改。";
          task.finishedAt = nowIso();
          task.updatedAt = nowIso();
          await this.persistTask(task);
        }
        this.tasks.set(task.id, task);
        tasks.push(task);
      } catch {
        // A malformed task record must not block opening the novel.
      }
    }
    return tasks.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  list(projectId = "") {
    return Array.from(this.tasks.values())
      .filter((task) => !projectId || task.projectId === projectId)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map((task) => ({ ...task }));
  }

  get(taskId) {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : null;
  }

  async probe(settings) {
    if (!settings?.apiKey || !settings?.baseUrl || !settings?.model) {
      return { ok: false, error: "请先填写 Base URL、模型名和 API Key。" };
    }
    if (this.activeTaskId) return { ok: false, error: "请等待当前任务结束后再检查模型。" };
    const task = await this.start({
      taskType: "query",
      instruction: "这是模型能力检查。请用中文简短回答“模型连接正常”，然后调用 submit_answer。",
      settings: { ...settings, maxOutputTokens: 512 },
      projectId: "__model_probe__",
      context: { agents: "模型能力检查，不包含真实小说资料。", materials: {}, memory: {}, recentChapters: [], documents: [] }
    });
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const current = this.tasks.get(task.id);
      if (["completed", "failed", "stopped", "interrupted"].includes(current?.status)) {
        if (current.status !== "completed" || current.result?.kind !== "answer") {
          return { ok: false, error: current.error || "模型没有完成受控动作调用。", checks: current };
        }
        const answer = String(current.result.answer || "");
        const chinese = /[\u3400-\u9fff]/.test(answer);
        const streaming = Boolean(current.streamingSeen);
        const stopTask = await this.start({
          taskType: "query",
          instruction: "这是停止能力检查。请先连续输出一段不少于一千字的中文说明，最后再调用 submit_answer。",
          settings: { ...settings, maxOutputTokens: 2048 },
          projectId: "__model_probe__",
          context: { agents: "模型停止能力检查。", materials: {}, memory: {}, recentChapters: [], documents: [] }
        });
        await this.stop(stopTask.id);
        const stopped = this.tasks.get(stopTask.id)?.status === "stopped";
        const checks = { connection: true, chinese, streaming, toolCalling: true, stopControl: stopped };
        const ok = Object.values(checks).every(Boolean);
        const failed = [
          !chinese ? "中文输出" : "",
          !streaming ? "连续输出" : "",
          !stopped ? "停止任务" : ""
        ].filter(Boolean);
        return {
          ok,
          error: ok ? "" : `模型未通过：${failed.join("、")}。`,
          checks,
          answer
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await this.stop(task.id);
    return { ok: false, error: "模型能力检查超时。" };
  }
}

module.exports = { ACTIVE_STATUSES, RUNNING_STATUSES, TaskManager };
