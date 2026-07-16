function send(worker, message) {
  if (typeof worker.postMessage === "function") worker.postMessage(message);
  else if (typeof worker.send === "function") worker.send(message);
  else throw new Error("分析 Worker 不支持消息发送。");
}

class UtilityAnalysisExecutor {
  constructor({ utilityProcess, workerPath, onEvent, startupTimeoutMs = 10000 }) {
    this.utilityProcess = utilityProcess;
    this.workerPath = workerPath;
    this.onEvent = onEvent;
    this.startupTimeoutMs = startupTimeoutMs;
    this.slots = new Map();
    this.closed = false;
  }

  async ensureSlot(workerId) {
    const existing = this.slots.get(workerId);
    if (existing?.ready) return existing;
    if (existing?.readyPromise) return existing.readyPromise;
    if (this.closed) throw new Error("分析 Worker 执行器已经关闭。");
    const worker = this.utilityProcess.fork(this.workerPath, [], {
      serviceName: `Noval Analysis ${workerId}`,
      stdio: "pipe"
    });
    const slot = { workerId, worker, ready: false, pending: null, readyPromise: null };
    this.slots.set(workerId, slot);
    slot.readyPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("分析 Worker 启动超时。")), this.startupTimeoutMs);
      worker.on("message", (message) => {
        if (message?.channel === "analysis-worker-ready") {
          clearTimeout(timer);
          slot.ready = true;
          resolve(slot);
          return;
        }
        this.handleMessage(slot, message);
      });
      worker.on("exit", () => {
        clearTimeout(timer);
        slot.ready = false;
        this.slots.delete(workerId);
        if (slot.pending) {
          const error = new Error("分析 Worker 意外退出，任务将重新分配。");
          error.retryable = true;
          slot.pending.reject(error);
          slot.pending = null;
        }
      });
      worker.on?.("error", (error) => {
        if (!slot.ready) reject(error);
      });
    }).finally(() => { slot.readyPromise = null; });
    return slot.readyPromise;
  }

  handleMessage(slot, message) {
    if (message?.channel === "job-event") {
      this.onEvent?.({ workerId: slot.workerId, ...message });
      return;
    }
    const pending = slot.pending;
    if (!pending || message?.jobId !== pending.jobId) return;
    if (message.channel === "job-result") {
      slot.pending = null;
      pending.cleanup();
      pending.resolve(message.result);
      return;
    }
    if (["job-error", "job-cancelled"].includes(message.channel)) {
      slot.pending = null;
      pending.cleanup();
      const error = new Error(message.error || "分析节点失败。");
      error.rateLimited = Boolean(message.rateLimited);
      error.retryable = Boolean(message.retryable);
      error.code = message.channel === "job-cancelled" ? "PI_WORKER_JOB_CANCELLED" : undefined;
      pending.reject(error);
    }
  }

  async execute(job, { signal, workerId = "worker-1" } = {}) {
    const slot = await this.ensureSlot(workerId);
    if (slot.pending) throw Object.assign(new Error("分析 Worker 收到了重叠任务。"), { retryable: true });
    if (signal?.aborted) throw Object.assign(new Error("分析节点已取消。"), { code: "PI_WORKER_JOB_CANCELLED" });
    const jobId = String(job.jobId || job.id || "");
    return new Promise((resolve, reject) => {
      const abort = () => send(slot.worker, { type: "abort", jobId });
      const cleanup = () => signal?.removeEventListener?.("abort", abort);
      slot.pending = { jobId, resolve, reject, cleanup };
      signal?.addEventListener?.("abort", abort, { once: true });
      try {
        send(slot.worker, { type: "run", ...job, jobId });
      } catch (error) {
        slot.pending = null;
        cleanup();
        reject(error);
      }
    });
  }

  async close() {
    this.closed = true;
    for (const slot of this.slots.values()) {
      if (slot.pending) {
        send(slot.worker, { type: "abort", jobId: slot.pending.jobId });
        slot.pending.cleanup();
        slot.pending.reject(new Error("分析 Worker 执行器已经关闭。"));
        slot.pending = null;
      }
      slot.worker.kill?.();
    }
    this.slots.clear();
  }
}

module.exports = { UtilityAnalysisExecutor };
