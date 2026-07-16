const http = require("node:http");
const path = require("node:path");
const { fork } = require("node:child_process");

function startModel(result) {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });
    const send = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
    const common = { id: "analysis-test", object: "chat.completion.chunk", created: 1, model: "fake" };
    send({ ...common, choices: [{ index: 0, delta: { role: "assistant", content: "正在抽取证据。" }, finish_reason: null }] });
    send({
      ...common,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: "submit-analysis",
            type: "function",
            function: { name: "submit_result", arguments: JSON.stringify({ result }) }
          }]
        },
        finish_reason: null
      }]
    });
    send({ ...common, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
    response.end("data: [DONE]\n\n");
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function runWorker(baseUrl, resultFields) {
  const worker = fork(path.join(__dirname, "..", "services", "pi-analysis-worker.mjs"), [], { silent: true });
  const messages = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.kill();
      reject(new Error("analysis worker timed out"));
    }, 15000);
    worker.on("message", (message) => {
      messages.push(message);
      if (message.channel === "analysis-worker-ready") {
        worker.send({
          type: "run",
          jobId: "job-1",
          settings: {
            apiKey: "test",
            baseUrl,
            model: "fake",
            contextWindow: 32000,
            maxOutputTokens: 2000
          },
          role: {
            id: "R03",
            version: "1.0.0",
            prompt: "只抽取指定章节，所有正式候选必须有证据。",
            requiredFields: resultFields
          },
          task: {
            goal: "分析第一章",
            materials: [{ id: "chapter-1", title: "第一章", content: "林默推开门。" }]
          }
        });
      }
      if (["job-result", "job-error", "job-cancelled"].includes(message.channel)) {
        clearTimeout(timer);
        worker.kill();
        resolve({ terminal: message, messages });
      }
    });
    worker.on("error", reject);
  });
}

describe("Pi analysis worker", () => {
  it("exposes one controlled result action for one temporary role agent", async () => {
    const result = {
      mentions: [], events: [], assertions: [], relationChanges: [], hooks: [], styleSamples: []
    };
    const server = await startModel(result);
    try {
      const address = server.address();
      const run = await runWorker(`http://127.0.0.1:${address.port}/v1`, Object.keys(result));
      expect(run.terminal).toMatchObject({ channel: "job-result", jobId: "job-1", result });
      expect(run.messages.some((message) => message.channel === "job-event" && message.event?.type === "text_delta")).toBe(true);
    } finally {
      server.close();
    }
  });
});
