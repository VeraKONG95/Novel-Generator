const { EventEmitter } = require("node:events");
const { UtilityAnalysisExecutor } = require("../services/analysis-worker-executor");

function fakeUtilityProcess() {
  const workers = [];
  return {
    workers,
    fork() {
      const worker = new EventEmitter();
      worker.postMessage = (message) => {
        if (message.type === "run") {
          setTimeout(() => worker.emit("message", { channel: "job-result", jobId: message.jobId, result: { value: message.jobId } }), 1);
        }
      };
      worker.kill = () => worker.emit("exit", 0);
      workers.push(worker);
      setTimeout(() => worker.emit("message", { channel: "analysis-worker-ready" }), 0);
      return worker;
    }
  };
}

describe("analysis worker executor", () => {
  it("reuses one isolated analysis process for sequential jobs on the same worker slot", async () => {
    const utilityProcess = fakeUtilityProcess();
    const executor = new UtilityAnalysisExecutor({ utilityProcess, workerPath: "fake-worker" });

    await expect(executor.execute({ id: "job-1", jobId: "job-1" }, { workerId: "worker-1" })).resolves.toEqual({ value: "job-1" });
    await expect(executor.execute({ id: "job-2", jobId: "job-2" }, { workerId: "worker-1" })).resolves.toEqual({ value: "job-2" });

    expect(utilityProcess.workers).toHaveLength(1);
    await executor.close();
  });
});
