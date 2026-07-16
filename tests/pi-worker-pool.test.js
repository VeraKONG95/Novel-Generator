const { performance } = require("node:perf_hooks");
const { PiWorkerPool } = require("../services/pi-worker-pool");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await delay(2);
  }
}

describe("Pi worker pool", () => {
  it("finishes twenty independent jobs with concurrency four in under forty percent of the serial baseline", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const pool = new PiWorkerPool({
      maxConcurrency: 4,
      execute: async (job) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(100);
        inFlight -= 1;
        return { id: job.id };
      }
    });

    const startedAt = performance.now();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => pool.enqueue({ id: `job-${index + 1}` }))
    );
    const elapsedMs = performance.now() - startedAt;

    expect(results).toHaveLength(20);
    expect(maxInFlight).toBe(4);
    expect(elapsedMs).toBeLessThan(800);
    await pool.close();
  });

  it("pauses smoothly by finishing active jobs without starting queued jobs, then resumes", async () => {
    const gates = [deferred(), deferred()];
    const started = [];
    const pool = new PiWorkerPool({
      maxConcurrency: 2,
      execute: async (job) => {
        started.push(job.id);
        if (started.length <= 2) await gates[started.length - 1].promise;
        return job.id;
      }
    });

    const jobs = ["a", "b", "c", "d"].map((id) => pool.enqueue({ id }));
    await waitFor(() => started.length === 2);
    const paused = pool.pause();
    gates.forEach((gate) => gate.resolve());
    await paused;
    await delay(20);

    expect(started).toEqual(["a", "b"]);
    pool.resume();
    await expect(Promise.all(jobs)).resolves.toEqual(["a", "b", "c", "d"]);
    await pool.close();
  });

  it("deduplicates jobs with the same id and returns the first accepted result", async () => {
    let calls = 0;
    const pool = new PiWorkerPool({
      maxConcurrency: 2,
      execute: async (job) => {
        calls += 1;
        await delay(10);
        return `${job.id}-result`;
      }
    });

    const first = pool.enqueue({ id: "same-job", payload: "first" });
    const duplicate = pool.enqueue({ id: "same-job", payload: "duplicate" });

    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      "same-job-result",
      "same-job-result"
    ]);
    expect(calls).toBe(1);
    await pool.close();
  });

  it("cancels a running job, aborts its signal, and ignores its late result", async () => {
    const lateResult = deferred();
    let firstStarted = false;
    let firstAborted = false;
    let secondStarted = false;
    const pool = new PiWorkerPool({
      maxConcurrency: 1,
      execute: async (job, { signal }) => {
        if (job.id === "slow") {
          firstStarted = true;
          signal.addEventListener("abort", () => { firstAborted = true; });
          await lateResult.promise;
          return "must-be-ignored";
        }
        secondStarted = true;
        return "next-result";
      }
    });

    const slow = pool.enqueue({ id: "slow" });
    await waitFor(() => firstStarted);
    expect(pool.cancel("slow")).toBe(true);
    await expect(slow).rejects.toMatchObject({ code: "PI_WORKER_JOB_CANCELLED" });
    expect(firstAborted).toBe(true);

    const next = pool.enqueue({ id: "next" });
    await delay(20);
    expect(secondStarted).toBe(false);
    lateResult.resolve();
    await expect(next).resolves.toBe("next-result");
    await pool.close();
  });

  it("retries a failed job at most two times with a fresh attempt number", async () => {
    const attempts = new Map();
    const pool = new PiWorkerPool({
      maxConcurrency: 1,
      execute: async (job, { attempt }) => {
        const seen = [...(attempts.get(job.id) || []), attempt];
        attempts.set(job.id, seen);
        if (job.id === "eventual" && attempt === 3) return "recovered";
        throw new Error(`${job.id}-failure-${attempt}`);
      }
    });

    await expect(pool.enqueue({ id: "eventual" })).resolves.toBe("recovered");
    expect(attempts.get("eventual")).toEqual([1, 2, 3]);

    await expect(pool.enqueue({ id: "exhausted" })).rejects.toThrow("exhausted-failure-3");
    expect(attempts.get("exhausted")).toEqual([1, 2, 3]);
    await pool.close();
  });

  it("does not repeat an unchanged request after the model reports that its context is too long", async () => {
    let attempts = 0;
    const pool = new PiWorkerPool({
      maxConcurrency: 1,
      execute: async () => {
        attempts += 1;
        const error = new Error("maximum context length exceeded");
        error.code = "CONTEXT_LENGTH_EXCEEDED";
        throw error;
      }
    });

    await expect(pool.enqueue({ id: "oversized" })).rejects.toThrow("context length");
    expect(attempts).toBe(1);
    await pool.close();
  });

  it("halves concurrency after rate limiting and restores one slot after each ten consecutive successes", async () => {
    const pool = new PiWorkerPool({
      maxConcurrency: 4,
      execute: async (job, { attempt }) => {
        if (job.id === "rate-limited" && attempt === 1) {
          const error = new Error("too many requests");
          error.status = 429;
          throw error;
        }
        await delay(2);
        return job.id;
      }
    });

    await expect(pool.enqueue({ id: "rate-limited" })).resolves.toBe("rate-limited");
    expect(pool.getStats()).toMatchObject({ maxConcurrency: 4, effectiveConcurrency: 2, successStreak: 1 });

    await Promise.all(Array.from({ length: 9 }, (_, index) => pool.enqueue({ id: `recovery-a-${index}` })));
    expect(pool.getStats()).toMatchObject({ effectiveConcurrency: 3, successStreak: 0 });

    await Promise.all(Array.from({ length: 10 }, (_, index) => pool.enqueue({ id: `recovery-b-${index}` })));
    expect(pool.getStats()).toMatchObject({ effectiveConcurrency: 4, successStreak: 0 });
    await pool.close();
  });

  it("accepts runtime concurrency changes only within the supported one-to-eight range", async () => {
    const gate = deferred();
    let started = 0;
    const pool = new PiWorkerPool({
      maxConcurrency: 1,
      execute: async (job) => {
        started += 1;
        await gate.promise;
        return job.id;
      }
    });

    expect(() => pool.setMaxConcurrency(0)).toThrow("1 到 8");
    expect(() => pool.setMaxConcurrency(9)).toThrow("1 到 8");
    expect(() => pool.setMaxConcurrency(1.5)).toThrow("1 到 8");
    pool.setMaxConcurrency(3);
    const jobs = [1, 2, 3].map((id) => pool.enqueue({ id: `resize-${id}` }));
    await waitFor(() => started === 3);
    expect(pool.getStats()).toMatchObject({ maxConcurrency: 3, effectiveConcurrency: 3, running: 3 });
    gate.resolve();
    await Promise.all(jobs);
    await pool.close();
  });

  it("never assigns one worker id to two active jobs and reuses the worker that became free", async () => {
    const gates = { a: deferred(), b: deferred(), c: deferred() };
    const workers = {};
    const activeWorkers = new Set();
    let duplicateWorkerSeen = false;
    const pool = new PiWorkerPool({
      maxConcurrency: 2,
      execute: async (job, { workerId }) => {
        workers[job.id] = workerId;
        if (activeWorkers.has(workerId)) duplicateWorkerSeen = true;
        activeWorkers.add(workerId);
        await gates[job.id].promise;
        activeWorkers.delete(workerId);
        return job.id;
      }
    });

    const jobs = ["a", "b", "c"].map((id) => pool.enqueue({ id }));
    await waitFor(() => Boolean(workers.a && workers.b));
    gates.b.resolve();
    await waitFor(() => Boolean(workers.c));

    expect(duplicateWorkerSeen).toBe(false);
    expect(workers.c).toBe(workers.b);
    gates.a.resolve();
    gates.c.resolve();
    await Promise.all(jobs);
    await pool.close();
  });

  it("closes by aborting active work, rejecting queued work, and refusing new jobs", async () => {
    let activeSignal;
    const pool = new PiWorkerPool({
      maxConcurrency: 1,
      execute: async (_job, { signal }) => {
        activeSignal = signal;
        await Promise.race([
          new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true })),
          delay(100)
        ]);
        return "late-close-result";
      }
    });

    const active = pool.enqueue({ id: "active-on-close" }).catch((error) => error);
    const queued = pool.enqueue({ id: "queued-on-close" }).catch((error) => error);
    await waitFor(() => Boolean(activeSignal));
    await pool.close();

    expect(activeSignal.aborted).toBe(true);
    await expect(active).resolves.toMatchObject({ code: "PI_WORKER_POOL_CLOSED" });
    await expect(queued).resolves.toMatchObject({ code: "PI_WORKER_POOL_CLOSED" });
    await expect(pool.enqueue({ id: "after-close" })).rejects.toMatchObject({
      code: "PI_WORKER_POOL_CLOSED"
    });
    expect(pool.getStats()).toMatchObject({ closed: true, running: 0, queued: 0 });
  });
});
