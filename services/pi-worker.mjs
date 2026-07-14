import { Agent } from "@earendil-works/pi-agent-core";
import { Type, createModels, createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import promptModule from "./pi-prompts.js";

const { BASE_SYSTEM_PROMPT, buildTaskPrompt, temperatureForTask } = promptModule;

let activeAgent = null;
let activeTaskId = "";
let activeResult = null;

function emit(message) {
  if (process.parentPort?.postMessage) process.parentPort.postMessage(message);
  else if (typeof process.send === "function") process.send(message);
}

function textResult(text, details = {}, terminate = false) {
  return {
    content: [{ type: "text", text }],
    details,
    terminate
  };
}

function createRuntime(settings, taskId) {
  const baseUrl = String(settings.baseUrl || "").replace(/\/+$/, "");
  const model = {
    id: settings.model,
    name: settings.model,
    api: "openai-completions",
    provider: "noval-openai-compatible",
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
    name: "Noval OpenAI Compatible",
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
    streamFn: (selectedModel, context, options = {}) =>
      models.streamSimple(selectedModel, context, {
        ...options,
        apiKey: settings.apiKey,
        temperature: Number(settings.temperature) || 0.4,
        maxTokens: Number(settings.maxOutputTokens) || 16384,
        timeoutMs: 120000,
        maxRetries: 0,
        signal: options.signal
      }),
    sessionId: taskId
  };
}

function buildTools(context, materialLimit) {
  const docs = Array.isArray(context.documents) ? context.documents : [];
  const submitCandidate = {
    name: "submit_candidate",
    label: "提交文件改动",
    description: "提交等待作者确认的文件改动清单。正式文件不会在此动作中被修改。",
    parameters: Type.Object({
      title: Type.String(),
      summary: Type.String(),
      changes: Type.Array(Type.Object({
        path: Type.String(),
        action: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("delete")]),
        content: Type.Optional(Type.String()),
        reason: Type.Optional(Type.String())
      }), { minItems: 1, maxItems: 30 }),
      impact: Type.Optional(Type.Array(Type.String()))
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      for (const change of params.changes) {
        if (change.action !== "delete" && !String(change.content || "").trim()) {
          throw new Error(`文件改动缺少完整内容：${change.path}`);
        }
        if (String(change.path || "").startsWith(".noval/") || String(change.path || "").includes("..")) {
          throw new Error("不能修改内部记录或项目之外的文件。");
        }
      }
      activeResult = { kind: "candidate", ...params };
      return textResult("文件改动已安全保存，正在等待作者确认。", activeResult, true);
    }
  };

  const submitReview = {
    name: "submit_review",
    label: "提交评审结果",
    description: "提交只读评审结果，不修改正文。",
    parameters: Type.Object({
      summary: Type.String(),
      issues: Type.Array(
        Type.Object({
          location: Type.String(),
          severity: Type.Union([Type.Literal("严重"), Type.Literal("重要"), Type.Literal("一般")]),
          rule: Type.String(),
          reason: Type.String(),
          suggestion: Type.String(),
          downstreamImpact: Type.Optional(Type.String())
        })
      )
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      activeResult = { kind: "review", ...params };
      return textResult("评审结果已提交，不会修改正文。", activeResult, true);
    }
  };

  const submitMemory = {
    name: "submit_memory_changes",
    label: "提交记忆变更",
    description: "提交可追溯的故事记忆变更。",
    parameters: Type.Object({
      summary: Type.String(),
      changes: Type.Array(
        Type.Object({
          category: Type.Union([
            Type.Literal("character"),
            Type.Literal("timeline"),
            Type.Literal("fact"),
            Type.Literal("relationship"),
            Type.Literal("plot"),
            Type.Literal("foreshadowing"),
            Type.Literal("conflict")
          ]),
          action: Type.Union([Type.Literal("add"), Type.Literal("update"), Type.Literal("close")]),
          targetId: Type.Optional(Type.String()),
          name: Type.String(),
          content: Type.String(),
          sourceChapter: Type.Number(),
          sourceExcerpt: Type.String(),
          currentGoal: Type.Optional(Type.String()),
          emotionalState: Type.Optional(Type.String()),
          physicalState: Type.Optional(Type.String()),
          location: Type.Optional(Type.String()),
          knowledge: Type.Optional(Type.Array(Type.String())),
          requiresAuthorConfirmation: Type.Optional(Type.Boolean()),
          confirmationReason: Type.Optional(Type.String())
        })
      )
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      if (params.changes.some((item) => !item.sourceChapter || !item.sourceExcerpt.trim())) {
        throw new Error("每条记忆变更都必须带有来源章节和来源片段。" );
      }
      const requiresConfirmation = params.changes.some((item) => item.requiresAuthorConfirmation);
      activeResult = { kind: requiresConfirmation ? "memory_confirmation" : "memory", ...params };
      return textResult(
        requiresConfirmation ? "检测到核心设定变化，正在等待作者确认。" : "记忆变更已提交。",
        activeResult,
        true
      );
    }
  };

  const submitQuestion = {
    name: "submit_question",
    label: "提交澄清问题",
    description: "当缺少会改变作品方向的信息时，一次提交一至三个问题。作者可以跳过。",
    parameters: Type.Object({
      reason: Type.String(),
      questions: Type.Array(
        Type.Object({
          id: Type.String(),
          question: Type.String(),
          canSkip: Type.Optional(Type.Boolean())
        }),
        { minItems: 1, maxItems: 3 }
      )
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      activeResult = { kind: "question", ...params, questions: params.questions.slice(0, 3) };
      return textResult("问题已提交，正在等待作者回答。", activeResult, true);
    }
  };

  const submitAnswer = {
    name: "submit_answer",
    label: "提交项目回答",
    description: "提交基于项目正式资料的回答。",
    parameters: Type.Object({
      answer: Type.String(),
      sources: Type.Optional(Type.Array(Type.String()))
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      activeResult = { kind: "answer", ...params };
      return textResult("回答已提交。", activeResult, true);
    }
  };

  const reportConflict = {
    name: "report_conflict",
    label: "报告创作冲突",
    description: "当作者要求与已确认规则或正文冲突时提交影响说明。",
    parameters: Type.Object({
      title: Type.String(),
      conflict: Type.String(),
      affectedCharacters: Type.Optional(Type.Array(Type.String())),
      affectedForeshadowing: Type.Optional(Type.Array(Type.String())),
      affectedChapters: Type.Optional(Type.Array(Type.String())),
      options: Type.Array(Type.String())
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      activeResult = { kind: "conflict", ...params };
      return textResult("冲突已报告，正在等待作者选择。", activeResult, true);
    }
  };

  const readMaterial = {
    name: "read_project_material",
    label: "读取项目资料",
    description: "按应用分配的资料编号读取当前项目内容，不能读取任意路径。",
    parameters: Type.Object({ id: Type.String() }),
    execute: async (_id, params) => {
      const doc = docs.find((item) => item.id === params.id);
      if (!doc) throw new Error("资料不存在或不在当前任务允许范围内。");
      if (doc.content.length > materialLimit) {
        throw new Error(`资料“${doc.title}”超过本次模型可处理范围，没有静默截断。请缩小任务范围或使用更大上下文的模型。`);
      }
      return textResult(doc.content, { id: doc.id, title: doc.title });
    }
  };

  const searchProject = {
    name: "search_project",
    label: "搜索当前项目",
    description: "只在应用已提供的当前项目资料中搜索。",
    parameters: Type.Object({ query: Type.String() }),
    execute: async (_id, params) => {
      const query = params.query.trim().toLowerCase();
      const results = docs
        .filter((doc) => `${doc.title}\n${doc.content}`.toLowerCase().includes(query))
        .slice(0, 12)
        .map((doc) => ({ id: doc.id, title: doc.title, excerpt: doc.content.slice(0, 600) }));
      return textResult(JSON.stringify(results, null, 2), { count: results.length });
    }
  };

  return [readMaterial, searchProject, submitCandidate, submitReview, submitMemory, submitAnswer, submitQuestion, reportConflict];
}

function eventForUi(event) {
  if (event.type === "message_update") {
    const delta = event.assistantMessageEvent;
    if (delta?.type === "text_delta") return { type: "text_delta", text: delta.delta || "" };
    if (delta?.type === "toolcall_delta") return { type: "stream_delta" };
    return null;
  }
  if (event.type === "tool_execution_start") {
    return { type: "action", action: event.toolName };
  }
  if (event.type === "turn_start") return { type: "stage", stage: "executing" };
  return null;
}

async function runTask(message) {
  const { taskId, settings, request } = message;
  if (activeAgent) throw new Error("已有任务正在运行。");
  if (!settings?.apiKey) throw new Error("尚未配置 API Key。");
  if (!settings?.baseUrl || !settings?.model) throw new Error("模型地址或模型名为空。");

  activeTaskId = taskId;
  activeResult = null;
  const runtime = createRuntime(
    { ...settings, temperature: temperatureForTask(request.taskType) },
    taskId
  );
  activeAgent = new Agent({
    initialState: {
      systemPrompt: BASE_SYSTEM_PROMPT,
      model: runtime.model,
      thinkingLevel: "off",
      tools: buildTools(
        request.context,
        Math.max(4000, Math.floor((Number(settings.contextWindow) || 128000) * 0.35))
      )
    },
    streamFn: runtime.streamFn,
    sessionId: runtime.sessionId,
    toolExecution: "sequential",
    maxRetryDelayMs: 5000
  });

  activeAgent.subscribe((event) => {
    const uiEvent = eventForUi(event);
    if (uiEvent) emit({ channel: "task-event", taskId, event: uiEvent });
  });

  emit({ channel: "task-event", taskId, event: { type: "stage", stage: "planning" } });
  await activeAgent.prompt(buildTaskPrompt(request));

  const errorMessage = activeAgent.state.errorMessage;
  if (errorMessage) throw new Error(errorMessage);
  if (!activeResult) {
    throw new Error("模型没有通过受控动作提交结果，任务未产生候选内容。");
  }
  const expectedKinds = request.taskType === "review"
    ? ["review"]
    : request.taskType === "refresh_memory"
      ? ["memory", "memory_confirmation"]
      : request.taskType === "query"
        ? ["answer"]
        : ["candidate"];
  if (![...expectedKinds, "question", "conflict"].includes(activeResult.kind)) {
    throw new Error("模型使用了不适合当前任务的提交动作，任务未产生候选内容。" );
  }

  emit({ channel: "task-result", taskId, result: activeResult });
}

function handleParentMessage(rawMessage) {
  const message = rawMessage?.data ?? rawMessage;
  if (!message || typeof message !== "object") return;
  if (message.type === "abort" && activeAgent && message.taskId === activeTaskId) {
    activeAgent.abort();
    return;
  }
  if (message.type !== "run") return;

  runTask(message)
    .catch((error) => {
      const aborted = activeAgent?.signal?.aborted;
      emit({
        channel: aborted ? "task-stopped" : "task-error",
        taskId: message.taskId,
        error: aborted ? "任务已停止。" : error instanceof Error ? error.message : String(error)
      });
    })
    .finally(() => {
      activeAgent = null;
      activeTaskId = "";
      activeResult = null;
    });
}

if (process.parentPort?.on) {
  process.parentPort.on("message", handleParentMessage);
} else {
  process.on("message", handleParentMessage);
}

emit({ channel: "worker-ready" });
