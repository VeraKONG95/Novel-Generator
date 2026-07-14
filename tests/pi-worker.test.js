const http = require("node:http");
const path = require("node:path");
const { fork } = require("node:child_process");

function startFakeModel({ fail = false, toolName = "submit_answer", toolArgs = { answer: "模型连接正常", sources: [] } } = {}) {
  const server = http.createServer((request, response) => {
    if (fail) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "fake upstream failure" } }));
      return;
    }
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });
    const send = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
    const common = { id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "fake-model" };
    send({ ...common, choices: [{ index: 0, delta: { role: "assistant", content: "正在用中文检查。" }, finish_reason: null }] });
    send({
      ...common,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call-submit",
                type: "function",
                function: {
                  name: toolName,
                  arguments: JSON.stringify(toolArgs)
                }
              }
            ]
          },
          finish_reason: null
        }
      ]
    });
    send({ ...common, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
    response.write("data: [DONE]\n\n");
    response.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function runWorker(baseUrl, taskType = "query") {
  const worker = fork(path.join(__dirname, "..", "services", "pi-worker.mjs"), [], {
    silent: true
  });
  const messages = [];
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.kill();
      reject(new Error("worker test timed out"));
    }, 15000);
    worker.on("message", (message) => {
      messages.push(message);
      if (message.channel === "worker-ready") {
        worker.send({
          type: "run",
          taskId: "task-test",
          settings: {
            apiKey: "test-key",
            baseUrl,
            model: "fake-model",
            contextWindow: 32000,
            maxOutputTokens: 1000
          },
          request: {
            taskType,
            instruction: "检查模型",
            context: { agents: "测试", materials: {}, memory: {}, recentChapters: [], documents: [] }
          }
        });
      }
      if (["task-result", "task-error", "task-stopped"].includes(message.channel)) {
        clearTimeout(timeout);
        worker.kill();
        resolve({ terminal: message, messages });
      }
    });
    worker.on("error", reject);
  });
}

describe("Pi worker", () => {
  it("streams through Pi and accepts only a controlled tool result", async () => {
    const server = await startFakeModel();
    try {
      const address = server.address();
      const result = await runWorker(`http://127.0.0.1:${address.port}/v1`);
      expect(result.terminal.channel).toBe("task-result");
      expect(result.terminal.result).toMatchObject({ kind: "answer", answer: "模型连接正常" });
      expect(result.messages.some((item) => item.event?.type === "text_delta")).toBe(true);
    } finally {
      server.close();
    }
  });

  it("reports a real provider failure without producing fallback content", async () => {
    const server = await startFakeModel({ fail: true });
    try {
      const address = server.address();
      const result = await runWorker(`http://127.0.0.1:${address.port}/v1`);
      expect(result.terminal.channel).toBe("task-error");
      expect(result.messages.some((item) => item.channel === "task-result")).toBe(false);
    } finally {
      server.close();
    }
  });

  it("rejects a submission action that does not match the task", async () => {
    const server = await startFakeModel();
    try {
      const address = server.address();
      const result = await runWorker(`http://127.0.0.1:${address.port}/v1`, "plan_chapters");
      expect(result.terminal.channel).toBe("task-error");
      expect(result.terminal.error).toContain("不适合当前任务");
      expect(result.messages.some((item) => item.channel === "task-result")).toBe(false);
    } finally {
      server.close();
    }
  });
});
