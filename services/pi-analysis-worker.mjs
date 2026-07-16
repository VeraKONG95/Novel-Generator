import { Agent } from "@earendil-works/pi-agent-core";
import { Type, createModels, createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

let activeAgent = null;
let activeJobId = "";
let activeResult = null;

function emit(message) {
  if (process.parentPort?.postMessage) process.parentPort.postMessage(message);
  else if (typeof process.send === "function") process.send(message);
}

function toolText(text, details = {}, terminate = false) {
  return { content: [{ type: "text", text }], details, terminate };
}

function createRuntime(settings, jobId) {
  const baseUrl = String(settings.baseUrl || "").replace(/\/+$/, "");
  const model = {
    id: settings.model,
    name: settings.model,
    api: "openai-completions",
    provider: "noval-analysis-openai-compatible",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: Number(settings.contextWindow) || 128000,
    maxTokens: Number(settings.maxOutputTokens) || 16384,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStrictMode: false,
      maxTokensField: "max_tokens"
    }
  };
  const provider = createProvider({
    id: model.provider,
    name: "Noval Analysis OpenAI Compatible",
    baseUrl,
    auth: {
      apiKey: {
        name: "Noval API Key",
        resolve: async () => ({ auth: { apiKey: settings.apiKey }, source: "Noval 设置" })
      }
    },
    models: [model],
    api: openAICompletionsApi()
  });
  const models = createModels();
  models.setProvider(provider);
  return {
    model,
    sessionId: jobId,
    streamFn: (selectedModel, context, options = {}) =>
      models.streamSimple(selectedModel, context, {
        ...options,
        apiKey: settings.apiKey,
        temperature: Number.isFinite(Number(settings.temperature)) ? Number(settings.temperature) : 0.1,
        maxTokens: Number(settings.maxOutputTokens) || 16384,
        timeoutMs: Number(settings.timeoutMs) || 120000,
        maxRetries: 0,
        signal: options.signal
      })
  };
}

function buildTools(task, requiredFields) {
  const materials = Array.isArray(task.materials) ? task.materials : [];
  const materialReadLimitChars = Math.max(1000, Number(task.materialReadLimitChars) || 100000);
  let materialCharsRead = 0;
  return [
    {
      name: "read_material",
      label: "读取任务材料",
      description: "只读取协调器为本节点分配的材料，不能访问任意文件路径。",
      parameters: Type.Object({ id: Type.String() }),
      execute: async (_toolCallId, params) => {
        const material = materials.find((item) => item.id === params.id);
        if (!material) throw new Error("材料不存在或不在本节点允许范围内。");
        const content = String(material.content || "");
        if (materialCharsRead + content.length > materialReadLimitChars) {
          throw new Error("本节点读取的材料已经达到上下文上限，请只选择最相关的材料。");
        }
        materialCharsRead += content.length;
        return toolText(content, { id: material.id, title: material.title || material.id });
      }
    },
    {
      name: "submit_result",
      label: "提交分析结果",
      description: "提交当前角色唯一的结构化结果。提交成功后立即结束本节点。",
      parameters: Type.Object({ result: Type.Any() }),
      executionMode: "sequential",
      execute: async (_toolCallId, params) => {
        const result = params.result;
        if (!result || typeof result !== "object" || Array.isArray(result)) {
          throw new Error("result 必须是结构化对象。");
        }
        for (const field of requiredFields) {
          if (!(field in result)) throw new Error(`结果缺少字段：${field}`);
        }
        activeResult = result;
        return toolText("结果已提交。", { accepted: true }, true);
      }
    }
  ];
}

function promptFor(role, task) {
  const directory = (task.materials || []).map((item) => ({ id: item.id, title: item.title || item.id }));
  return [
    "你正在执行一个独立的小说分析节点。只处理本次目标，不延伸到其他任务。",
    `角色：${role.id}（版本 ${role.version}）`,
    role.prompt,
    `任务目标：${task.goal || "完成当前分析节点"}`,
    `可读材料：${JSON.stringify(directory)}`,
    task.input ? `结构化输入：${JSON.stringify(task.input)}` : "",
    `结果必须包含字段：${(role.requiredFields || []).join("、") || "按角色要求"}`,
    `结果结构：${role.resultGuide || "按角色说明提交结构化对象"}`,
    "需要材料时调用 read_material；完成后只调用一次 submit_result。不要输出无法回到材料证据的正式事实。"
  ].filter(Boolean).join("\n\n");
}

function uiEvent(event) {
  if (event.type === "message_update") {
    const delta = event.assistantMessageEvent;
    if (delta?.type === "text_delta") return { type: "text_delta", text: delta.delta || "" };
    if (delta?.type === "toolcall_delta") return { type: "stream_delta" };
  }
  if (event.type === "tool_execution_start") return { type: "action", action: event.toolName };
  return null;
}

async function run(message) {
  const { jobId, settings, role, task } = message;
  if (activeAgent) throw new Error("这个分析 Worker 已经有任务在运行。");
  if (!settings?.apiKey || !settings?.baseUrl || !settings?.model) throw new Error("模型设置不完整。");
  if (!role?.id || !role?.prompt) throw new Error("分析角色无效。");
  activeJobId = jobId;
  activeResult = null;
  const runtime = createRuntime(settings, jobId);
  activeAgent = new Agent({
    initialState: {
      systemPrompt: "你是 Noval 的受控小说分析节点。原文证据优先；区分世界事实、人物认知与推断；不得写文件。",
      model: runtime.model,
      thinkingLevel: "off",
      tools: buildTools(task || {}, role.requiredFields || [])
    },
    streamFn: runtime.streamFn,
    sessionId: runtime.sessionId,
    toolExecution: "sequential",
    maxRetryDelayMs: 5000
  });
  activeAgent.subscribe((event) => {
    const translated = uiEvent(event);
    if (translated) emit({ channel: "job-event", jobId, event: translated });
  });
  await activeAgent.prompt(promptFor(role, task || {}));
  if (activeAgent.state.errorMessage) throw new Error(activeAgent.state.errorMessage);
  if (!activeResult) throw new Error("模型没有通过 submit_result 提交结果。");
  emit({ channel: "job-result", jobId, result: activeResult });
}

function handle(rawMessage) {
  const message = rawMessage?.data ?? rawMessage;
  if (!message || typeof message !== "object") return;
  if (message.type === "abort" && activeAgent && message.jobId === activeJobId) {
    activeAgent.abort();
    return;
  }
  if (message.type !== "run") return;
  run(message)
    .catch((error) => {
      const cancelled = Boolean(activeAgent?.signal?.aborted);
      const errorText = cancelled ? "分析节点已取消。" : error instanceof Error ? error.message : String(error);
      emit({
        channel: cancelled ? "job-cancelled" : "job-error",
        jobId: message.jobId,
        error: errorText,
        rateLimited: /(?:429|rate.?limit|限流|too many requests)/i.test(errorText),
        retryable: !cancelled && /(?:429|5\d\d|timeout|timed out|限流|繁忙|connection)/i.test(errorText)
      });
    })
    .finally(() => {
      activeAgent = null;
      activeJobId = "";
      activeResult = null;
    });
}

if (process.parentPort?.on) process.parentPort.on("message", handle);
else process.on("message", handle);

emit({ channel: "analysis-worker-ready" });
