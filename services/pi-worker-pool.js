function normalizeConcurrency(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    throw new RangeError("Pi Worker 并发数必须是 1 到 8 之间的整数。");
  }
  return parsed;
}

function isRateLimitError(error) {
  return Boolean(
    error?.rateLimited ||
    Number(error?.status) === 429 ||
    Number(error?.statusCode) === 429 ||
    String(error?.code || "").toUpperCase() === "RATE_LIMITED"
  );
}

function isContextLengthError(error) {
  return Boolean(
    ["CONTEXT_LENGTH_EXCEEDED", "MAXIMUM_CONTEXT_LENGTH", "PROMPT_TOO_LONG"]
      .includes(String(error?.code || "").toUpperCase()) ||
    /(?:context length exceeded|maximum context length|prompt (?:is )?too long|too many tokens|上下文(?:长度)?(?:过长|超限)|提示词过长)/i
      .test(String(error?.message || error || ""))
  );
}

function isRetryableError(error) {
  return !isContextLengthError(error);
}

class PiWorkerJobCancelledError extends Error {
  constructor(jobId, message = "Pi Worker 任务已取消。") {
    super(message);
    this.name = "PiWorkerJobCancelledError";
    this.code = "PI_WORKER_JOB_CANCELLED";
    this.jobId = jobId;
  }
}

class PiWorkerPoolClosedError extends Error {
  constructor(jobId = "") {
    super("Pi Worker 池已经关闭。");
    this.name = "PiWorkerPoolClosedError";
    this.code = "PI_WORKER_POOL_CLOSED";
    this.jobId = jobId;
  }
}

class PiWorkerPool {
  constructor({ maxConcurrency = 4, maxRetries = 2, execute } = {}) {
    if (typeof execute !== "function") throw new TypeError("Pi Worker 池需要 execute 函数。");
    this.maxConcurrency = normalizeConcurrency(maxConcurrency);
    this.effectiveConcurrency = this.maxConcurrency;
    this.successStreak = 0;
    this.maxRetries = Math.max(0, Math.min(2, Math.trunc(Number(maxRetries) || 0)));
    this.execute = execute;
    this.queue = [];
    this.records = new Map();
    this.running = 0;
    this.paused = false;
    this.pauseWaiters = [];
    this.closeWaiters = [];
    this.closed = false;
    this.busyWorkerIds = new Set();
  }

  enqueue(job) {
    if (this.closed) return Promise.reject(new PiWorkerPoolClosedError(String(job?.id || "")));
    const id = String(job?.id || "").trim();
    if (!id) return Promise.reject(new TypeError("Pi Worker 任务必须包含 id。"));
    const existing = this.records.get(id);
    if (existing) return existing.promise;
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const record = { id, job, promise, resolve, reject, status: "queued", attempt: 0 };
    this.records.set(id, record);
    this.queue.push(record);
    this.schedule();
    return promise;
  }

  schedule() {
    while (!this.closed && !this.paused && this.running < this.effectiveConcurrency && this.queue.length) {
      const workerId = this.nextAvailableWorkerId();
      if (!workerId) return;
      const record = this.queue.shift();
      record.status = "running";
      record.attempt += 1;
      this.running += 1;
      this.busyWorkerIds.add(workerId);
      record.workerId = workerId;
      const controller = new AbortController();
      record.controller = controller;
      Promise.resolve()
        .then(() => this.execute(record.job, {
          signal: controller.signal,
          workerId,
          attempt: record.attempt
        }))
        .then(
          (result) => {
            if (record.status !== "running" || record.controller !== controller) return;
            record.status = "succeeded";
            this.successStreak += 1;
            if (this.successStreak >= 10) {
              if (this.effectiveConcurrency < this.maxConcurrency) this.effectiveConcurrency += 1;
              this.successStreak = 0;
            }
            record.resolve(result);
          },
          (error) => {
            if (record.status !== "running" || record.controller !== controller) return;
            this.successStreak = 0;
            if (isRateLimitError(error)) {
              this.effectiveConcurrency = Math.max(1, Math.floor(this.effectiveConcurrency / 2));
            }
            if (record.attempt <= this.maxRetries && isRetryableError(error)) {
              record.status = "retry_wait";
              record.lastError = error;
            } else {
              record.status = "failed";
              record.reject(error);
            }
          }
        )
        .finally(() => {
          if (record.controller === controller) record.controller = null;
          if (record.workerId === workerId) record.workerId = "";
          this.busyWorkerIds.delete(workerId);
          this.running -= 1;
          if (record.status === "retry_wait") {
            record.status = "queued";
            this.queue.push(record);
          }
          this.settlePauseWaiters();
          this.schedule();
        });
    }
  }

  nextAvailableWorkerId() {
    for (let index = 1; index <= this.maxConcurrency; index += 1) {
      const workerId = `worker-${index}`;
      if (!this.busyWorkerIds.has(workerId)) return workerId;
    }
    return "";
  }

  cancel(jobId) {
    const id = String(jobId || "").trim();
    const record = this.records.get(id);
    if (!record || ["succeeded", "failed", "cancelled", "closed"].includes(record.status)) return false;
    record.status = "cancelled";
    if (record.controller) record.controller.abort();
    else this.queue = this.queue.filter((item) => item !== record);
    record.reject(new PiWorkerJobCancelledError(id));
    return true;
  }

  pause() {
    if (this.closed) return Promise.reject(new Error("Pi Worker 池已经关闭。"));
    this.paused = true;
    if (this.running === 0) return Promise.resolve();
    return new Promise((resolve) => this.pauseWaiters.push(resolve));
  }

  resume() {
    if (this.closed) throw new Error("Pi Worker 池已经关闭。");
    this.paused = false;
    this.schedule();
  }

  setMaxConcurrency(value) {
    if (this.closed) throw new Error("Pi Worker 池已经关闭。");
    const next = normalizeConcurrency(value);
    const wasFullyAvailable = this.effectiveConcurrency === this.maxConcurrency;
    this.maxConcurrency = next;
    if (wasFullyAvailable || this.effectiveConcurrency > next) {
      this.effectiveConcurrency = next;
    }
    if (this.effectiveConcurrency === this.maxConcurrency) this.successStreak = 0;
    this.schedule();
    return this.getStats();
  }

  settlePauseWaiters() {
    if (this.running > 0) return;
    while (this.pauseWaiters.length) this.pauseWaiters.shift()();
    while (this.closeWaiters.length) this.closeWaiters.shift()();
  }

  getStats() {
    return {
      maxConcurrency: this.maxConcurrency,
      effectiveConcurrency: this.effectiveConcurrency,
      successStreak: this.successStreak,
      queued: this.queue.length,
      running: this.running,
      paused: this.paused,
      closed: this.closed,
      total: this.records.size
    };
  }

  async close() {
    if (this.closed && this.running === 0) return;
    this.closed = true;
    this.queue = [];
    for (const record of this.records.values()) {
      if (!["queued", "running", "retry_wait"].includes(record.status)) continue;
      record.status = "closed";
      if (record.controller) record.controller.abort();
      record.reject(new PiWorkerPoolClosedError(record.id));
    }
    if (this.running > 0) {
      await new Promise((resolve) => this.closeWaiters.push(resolve));
    } else {
      this.settlePauseWaiters();
    }
  }
}

module.exports = {
  PiWorkerJobCancelledError,
  PiWorkerPool,
  PiWorkerPoolClosedError,
  isContextLengthError,
  isRateLimitError,
  isRetryableError,
  normalizeConcurrency
};
