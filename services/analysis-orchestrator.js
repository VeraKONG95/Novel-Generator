const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { PiWorkerPool, isContextLengthError } = require("./pi-worker-pool");
const { RoleRegistry } = require("./analysis/role-registry");
const { WorkflowRegistry } = require("./analysis/workflow-registry");
const graphStoreModule = require("./analysis/graph-store");
const { resolveEntityClusters } = require("./analysis/entity-resolver");
const {
  batchWorkflowMaterials,
  criticalIssues,
  dedupeIssues,
  renderPlanMarkdown,
  safeCreativePath,
  selectWorkflowMaterials,
  taskReviewIssue
} = require("./analysis/creative-workflow-utils");
const { buildRunRequest, readRunRequest, writeRunRequest } = require("./analysis/run-request-store");
const {
  bisectExtractionSegment,
  buildNavigationBatches,
  estimateConservativeTokens,
  extractionPayloadBudget,
  mergeChapterExtractionSegments,
  partitionByTokenBudget,
  splitChapterForExtraction,
  truncateToTokenBudget
} = require("./analysis/chapter-segmentation");

const TERMINAL = new Set(["ready", "degraded", "failed", "cancelled"]);
const REVIEW_PERSPECTIVES = ["时间地点和状态", "人物行为和关系", "人物认知边界", "故事线和伏笔", "语言风格"];
const CONSISTENCY_PERSPECTIVES = [
  "人物身份与别名",
  "时间与地点",
  "人物状态",
  "人物关系",
  "人物认知边界",
  "故事线与伏笔",
  "图谱引用完整性"
];

function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function safeFileName(value, fallback = "material") {
  const result = String(value || "").trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, "-");
  return result || fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function roleExecutionSettings(settings, roleId, input = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const contextWindow = Math.max(8000, Number(source.contextWindow) || 128000);
  const configuredMax = Math.max(512, Math.min(Number(source.maxOutputTokens) || 16384, Math.floor(contextWindow * 0.45)));
  const limits = { R01: 2048, R02: 4096, R03: 8192, R04: 4096, R05: 4096, R06: 4096, R07: 4096, R08: 4096, R09: 4096, R10: 4096, R11: 4096, R12: 4096, R13: 8192, R14: 4096, R15: 8192, R17: 4096 };
  const roleLimit = roleId === "R16" && input?.mode === "grounded_answer" ? 4096 : limits[roleId];
  const temperatures = { R13: 0.2, R14: 0.1, R15: 0.4, R17: 0.1 };
  return {
    ...source,
    ...(roleLimit ? { maxOutputTokens: Math.min(configuredMax, roleLimit) } : {}),
    temperature: roleId === "R16" ? Number(source.temperature) || 0.7 : temperatures[roleId] ?? 0.1
  };
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function uniqueStrings(values) {
  return Array.from(new Set(list(values).map((value) => String(value || "").trim()).filter(Boolean)));
}

function isLocatableCitation(citation) {
  if (!citation || typeof citation !== "object" || Array.isArray(citation)) return false;
  const evidenceRef = citation.evidenceRef && typeof citation.evidenceRef === "object"
    ? citation.evidenceRef
    : null;
  if (evidenceRef) {
    if (String(evidenceRef.refId || evidenceRef.overrideId || "").trim()) return true;
    const evidenceLocation = String(evidenceRef.chapterId || evidenceRef.sourcePath || "").trim();
    if (evidenceLocation && String(evidenceRef.excerpt || "").trim()) return true;
  }
  const location = String(citation.chapterId || citation.sourcePath || "").trim();
  return Boolean(location && String(citation.excerpt || "").trim());
}

function safeCitationSourcePath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || path.posix.isAbsolute(normalized) || path.posix.normalize(normalized) !== normalized || normalized.split("/").includes("..")) {
    throw new Error("回答引用的正文路径无效。");
  }
  return normalized;
}

async function excerptExistsInWorkspace(workspaceRoot, sourcePath, excerpt) {
  const normalized = safeCitationSourcePath(sourcePath);
  const root = await fs.realpath(path.resolve(workspaceRoot));
  const target = await fs.realpath(path.join(root, ...normalized.split("/")));
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("回答引用超出项目目录。");
  const content = await fs.readFile(target, "utf8");
  const expected = String(excerpt || "").trim();
  if (!expected) return false;
  return content.includes(expected) || content.replace(/\s+/g, " ").includes(expected.replace(/\s+/g, " "));
}

function targetKeys(target) {
  return new Set([
    target?.id,
    target?.candidateId,
    target?.entityId,
    target?.canonicalName,
    target?.name,
    ...list(target?.aliases)
  ].map((item) => String(item || "").trim()).filter(Boolean));
}

function eventsForTarget(events, target) {
  const keys = targetKeys(target);
  if (!keys.size) return list(events);
  return list(events).filter((event) =>
    list(event.participantIds || event.participants).some((id) => keys.has(String(id || ""))) ||
    keys.has(String(event.locationId || "")) ||
    list(event.characterIds).some((id) => keys.has(String(id || "")))
  );
}

function timelineForEvents(timeline, events) {
  const ids = new Set(list(events).flatMap((event) => [event.id, event.eventId, event.candidateId]).map(String));
  return {
    ...timeline,
    events: list(timeline?.events).filter((event) => ids.has(String(event.eventId || event.id || event.candidateId || "")))
  };
}

function eventsForPair(events, pair) {
  const left = String(pair?.subjectId || "");
  const right = String(pair?.objectId || "");
  return list(events).filter((event) => {
    const participants = new Set(list(event.participantIds || event.participants).map(String));
    return participants.has(left) && participants.has(right);
  });
}

function eventsForNarrativeTarget(events, target) {
  const referencedIds = new Set([
    ...list(target?.events),
    ...list(target?.eventIds),
    ...list(target?.setupEventIds),
    ...list(target?.payoffEventIds)
  ].map(String));
  if (referencedIds.size) {
    return list(events).filter((event) =>
      [event.id, event.eventId, event.candidateId].some((id) => referencedIds.has(String(id || "")))
    );
  }
  const title = String(target?.title || target?.name || "").trim();
  if (title) {
    const matches = list(events).filter((event) => String(event.summary || event.action || "").includes(title));
    if (matches.length) return matches;
  }
  return list(events);
}

function compactReviewRecord(record, kind) {
  const compact = {
    ...(record?.subject ? { subject: truncateToTokenBudget(record.subject, 48) } : {}),
    ...(record?.key ? { key: truncateToTokenBudget(record.key, 48) } : {}),
    ...(record?.value != null ? { value: truncateToTokenBudget(typeof record.value === "string" ? record.value : JSON.stringify(record.value), 128) } : {}),
    ...(record?.time ? { time: truncateToTokenBudget(record.time, 48) } : {}),
    ...(record?.chapterId ? { chapterId: truncateToTokenBudget(record.chapterId, 48) } : {}),
    ...(record?.sourcePath ? { sourcePath: truncateToTokenBudget(record.sourcePath, 64) } : {}),
    ...(record?.location ? { location: truncateToTokenBudget(record.location, 72) } : {}),
    ...(record?.reason ? { reason: truncateToTokenBudget(record.reason, 144) } : {}),
    ...(record?.suggestion ? { suggestion: truncateToTokenBudget(record.suggestion, 96) } : {}),
    ...(record?.perspective ? { perspective: truncateToTokenBudget(record.perspective, 48) } : {}),
    ...(record?.severity ? { severity: record.severity } : {}),
    ...(record?.blocking != null ? { blocking: Boolean(record.blocking) } : {}),
    evidenceRefs: list(record?.evidenceRefs).slice(0, 2).map((ref) => ({
      refId: ref?.refId,
      chapterId: ref?.chapterId,
      sourcePath: ref?.sourcePath,
      paragraphStart: ref?.paragraphStart,
      excerpt: truncateToTokenBudget(ref?.excerpt, 64)
    }))
  };
  return { kind, value: compact };
}

function normalizeCorrectionKind(value) {
  const source = String(value || "").trim().toLowerCase();
  if (["entity", "entities", "character", "characters", "identity", "alias", "人物", "人物身份", "别名"].includes(source)) return "entities";
  if (["event", "events", "timeline", "time", "事件", "故事内时间", "时间"].includes(source)) return "events";
  if (["assertion", "assertions", "knowledge", "cognition", "belief", "认知", "人物认知", "命题"].includes(source)) return "assertions";
  if (["relation", "relations", "relationship", "人物关系", "关系"].includes(source)) return "relations";
  if (["storyline", "storylines", "故事线"].includes(source)) return "storylines";
  if (["hook", "hooks", "foreshadowing", "伏笔", "谜团"].includes(source)) return "hooks";
  if (["style", "writing_style", "文风", "文风要求"].includes(source)) return "style";
  return source;
}

function graphRecordId(record, collection) {
  if (collection === "events") return String(record?.id || record?.eventId || "");
  if (collection === "assertions") return String(record?.id || record?.assertionId || record?.propositionId || "");
  if (collection === "relations") return String(record?.id || record?.relationId || "");
  return String(record?.id || record?.entityId || "");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function atomicJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temp, filePath);
}

function recordIdentifier(record, fallback = "") {
  return String(record?.id || record?.candidateId || record?.entityId || record?.name || record?.canonicalName || fallback);
}

function mergeNavigationResults(results, { timeStructureTokenBudget = 1024 } = {}) {
  const source = list(results);
  const mergeRecords = (records, keyFor) => {
    const map = new Map();
    for (const record of records) {
      const key = String(keyFor(record) || "").trim();
      if (!key) continue;
      const previous = map.get(key) || {};
      map.set(key, {
        ...previous,
        ...record,
        aliases: uniqueStrings([...list(previous.aliases), ...list(record.aliases)])
      });
    }
    return [...map.values()];
  };
  const timeBudget = Math.max(128, Math.floor(Number(timeStructureTokenBudget) || 1024));
  const rawTimeStructures = source.map((item) => item.timeStructure || {});
  let timeStructure;
  if (rawTimeStructures.length <= 1 && estimateConservativeTokens(rawTimeStructures[0] || {}) <= timeBudget) {
    timeStructure = rawTimeStructures[0] || {};
  } else {
    const maximumEntries = Math.max(1, Math.min(rawTimeStructures.length, Math.floor(timeBudget / 48)));
    const selectedIndexes = Array.from({ length: maximumEntries }, (_, index) =>
      Math.min(rawTimeStructures.length - 1, Math.floor(index * rawTimeStructures.length / maximumEntries))
    );
    const perEntryBudget = Math.max(12, Math.floor(timeBudget / maximumEntries) - 32);
    let partitions = Array.from(new Set(selectedIndexes)).map((sourceIndex) => ({
      index: sourceIndex + 1,
      summary: truncateToTokenBudget(JSON.stringify(rawTimeStructures[sourceIndex] || {}), perEntryBudget)
    }));
    timeStructure = { partitionCount: rawTimeStructures.length, partitions };
    while (partitions.length > 1 && estimateConservativeTokens(timeStructure) > timeBudget) {
      partitions = partitions.filter((_, index) => index % 2 === 0);
      timeStructure = { partitionCount: rawTimeStructures.length, partitions };
    }
    if (estimateConservativeTokens(timeStructure) > timeBudget) {
      timeStructure = {
        partitionCount: rawTimeStructures.length,
        summary: truncateToTokenBudget(JSON.stringify(rawTimeStructures[0] || {}), Math.max(16, timeBudget - 32))
      };
    }
  }
  return {
    entityCandidates: mergeRecords(source.flatMap((item) => list(item.entityCandidates)), (item) =>
      item.candidateId || item.entityId || `${item.name || item.canonicalName}|${item.type || ""}`
    ),
    aliasCandidates: mergeRecords(source.flatMap((item) => list(item.aliasCandidates)), (item) =>
      item.id || `${item.leftId || item.name || ""}|${item.rightId || item.alias || ""}`
    ),
    timeStructure,
    storylines: mergeRecords(source.flatMap((item) => list(item.storylines)), (item) => item.id || item.storylineId || item.title),
    keyChapters: uniqueStrings(source.flatMap((item) => list(item.keyChapters))),
    styleSamples: uniqueStrings(source.flatMap((item) => list(item.styleSamples)))
  };
}

class AnalysisOrchestrator {
  constructor({
    executeJob,
    roleRegistry,
    workflowRegistry,
    graphStore = graphStoreModule,
    onEvent,
    now = () => new Date(),
    randomUUID = () => crypto.randomUUID()
  } = {}) {
    if (typeof executeJob !== "function") throw new TypeError("分析协调器需要 executeJob 函数。");
    this.executeJob = executeJob;
    this.roleRegistry = roleRegistry || new RoleRegistry({ rolesDir: path.join(__dirname, "..", "resources", "pi", "roles") });
    this.workflowRegistry = workflowRegistry || new WorkflowRegistry({
      workflowsDir: path.join(__dirname, "..", "resources", "pi", "workflows"),
      roleRegistry: this.roleRegistry
    });
    this.graphStore = graphStore;
    this.onEvent = onEvent;
    this.now = now;
    this.randomUUID = randomUUID;
    this.loaded = false;
    this.runs = new Map();
    this.runPromises = new Map();
    this.activeByWorkspace = new Map();
  }

  timestamp() {
    return this.now().toISOString();
  }

  async ensureRegistries() {
    if (this.loaded) return;
    await this.roleRegistry.load();
    await this.workflowRegistry.load();
    this.loaded = true;
  }

  runRoot(run) {
    return path.join(run.workspaceRoot, ".noval", "analysis", run.id);
  }

  counts(run) {
    const counts = { total: run.jobs.size, completed: 0, running: 0, failed: 0, waiting: 0 };
    for (const job of run.jobs.values()) {
      if (job.status === "completed") counts.completed += 1;
      else if (job.status === "running") counts.running += 1;
      else if (job.status === "failed") counts.failed += 1;
      else counts.waiting += 1;
    }
    return counts;
  }

  publicRun(run) {
    const poolStats = run.pool?.getStats?.() || {};
    return {
      runId: run.id,
      projectId: run.projectId,
      category: run.category,
      ownerTaskId: run.ownerTaskId,
      workflowId: run.workflow.id,
      workflowVersion: run.workflow.version,
      status: run.status,
      stage: run.stage,
      counts: this.counts(run),
      maxConcurrency: poolStats.maxConcurrency || run.maxConcurrency,
      actualConcurrency: poolStats.effectiveConcurrency || run.maxConcurrency,
      currentItems: [...run.currentItems],
      blockingGaps: [...run.blockingGaps],
      nonBlockingGaps: [...run.nonBlockingGaps],
      hasBlockingGaps: run.blockingGaps.length > 0,
      generationId: run.generationId || "",
      result: run.result || null,
      error: run.error || "",
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      finishedAt: run.finishedAt || ""
    };
  }

  async persistRun(run) {
    run.updatedAt = this.timestamp();
    const snapshot = this.publicRun(run);
    run.persistQueue = run.persistQueue.then(() => atomicJson(path.join(this.runRoot(run), "run.json"), snapshot));
    await run.persistQueue;
    return snapshot;
  }

  async persistJob(run, job) {
    const publicJob = {
      id: job.id,
      nodeId: job.nodeId,
      roleId: job.roleId,
      roleVersion: job.roleVersion,
      target: job.target,
      required: job.required,
      status: job.status,
      attempt: job.attempt,
      workerId: job.workerId || "",
      leaseExpiresAt: job.leaseExpiresAt || "",
      cacheKey: job.cacheKey,
      inputFingerprint: job.inputFingerprint,
      error: job.error || "",
      createdAt: job.createdAt,
      updatedAt: this.timestamp(),
      finishedAt: job.finishedAt || ""
    };
    await atomicJson(path.join(this.runRoot(run), "jobs", `${job.id}.json`), publicJob);
  }

  async event(run, event) {
    const payload = { at: this.timestamp(), runId: run.id, workflowId: run.workflow.id, ...event };
    await fs.mkdir(this.runRoot(run), { recursive: true });
    await fs.appendFile(path.join(this.runRoot(run), "events.jsonl"), `${JSON.stringify(payload)}\n`, "utf8");
    this.onEvent?.({ ...this.publicRun(run), event: payload });
  }

  async start({
    workspaceRoot,
    projectId,
    workflowId = "WF01",
    settings,
    maxConcurrency = 4,
    chapters = [],
    input = {},
    category = "project_analysis",
    ownerTaskId = "",
    runId = "",
    createdAt = "",
    resuming = false
  }) {
    await this.ensureRegistries();
    const root = path.resolve(String(workspaceRoot || ""));
    if (!root || !(await exists(root))) throw new Error("分析项目目录不存在。");
    const workflow = this.workflowRegistry.get(workflowId);
    const activeId = this.activeByWorkspace.get(root);
    if (activeId) {
      const active = this.runs.get(activeId);
      if (active && !TERMINAL.has(active.status)) throw new Error("这个项目已有会修改图谱的分析正在运行。");
    }
    const id = String(runId || `run-${Date.now()}-${this.randomUUID().slice(0, 8)}`);
    if (this.runs.has(id)) throw new Error("这个分析运行已经在当前应用中加载。");
    const run = {
      id,
      workspaceRoot: root,
      projectId: String(projectId || ""),
      category: String(category || "project_analysis"),
      ownerTaskId: String(ownerTaskId || ""),
      workflow,
      status: "analyzing",
      stage: "preparing",
      jobs: new Map(),
      outputs: new Map(),
      currentItems: new Set(),
      blockingGaps: [],
      nonBlockingGaps: [],
      generationId: "",
      result: null,
      error: "",
      settings,
      maxConcurrency,
      chapters: list(chapters),
      input: input && typeof input === "object" ? input : {},
      createdAt: createdAt || this.timestamp(),
      updatedAt: this.timestamp(),
      finishedAt: "",
      cancelRequested: false,
      pauseRequested: false,
      resumeResolver: null,
      persistQueue: Promise.resolve()
    };
    run.pool = new PiWorkerPool({
      maxConcurrency,
      maxRetries: 2,
      execute: (job, execution) => this.executePoolJob(run, job, execution)
    });
    if (!resuming) await writeRunRequest(root, buildRunRequest(run));
    this.runs.set(id, run);
    if (workflow.writesGraph) this.activeByWorkspace.set(root, id);
    await this.persistRun(run);
    await this.event(run, { type: resuming ? "run_resumed_after_restart" : "run_started", stage: run.stage });
    const promise = this.executeRun(run)
      .catch(async (error) => {
        if (run.cancelRequested) return;
        run.status = "failed";
        run.error = safeError(error);
        if (!run.blockingGaps.includes(run.error)) run.blockingGaps.push(run.error);
        run.finishedAt = this.timestamp();
        await this.persistRun(run);
        await this.event(run, { type: "run_failed", error: run.error });
      })
      .finally(async () => {
        if (TERMINAL.has(run.status)) {
          await run.pool.close();
          run.pool = null;
          run.outputs.clear();
          run.chapters = [];
          run.input = {
            instruction: run.input?.instruction || run.input?.correction || "",
            target: run.input?.target || null,
            contextSelection: run.creativeContextSelection || run.input?.contextSelection || null
          };
          run.settings = { model: run.settings?.model || "" };
          if (this.activeByWorkspace.get(root) === id) this.activeByWorkspace.delete(root);
        }
      })
      .then(() => this.publicRun(run));
    this.runPromises.set(id, promise);
    return this.publicRun(run);
  }

  async wait(runId) {
    const promise = this.runPromises.get(runId);
    if (promise) return promise;
    const run = this.runs.get(runId);
    if (!run) throw new Error("分析运行不存在。");
    return this.publicRun(run);
  }

  getStatus(runId) {
    const run = this.runs.get(runId);
    return run ? this.publicRun(run) : null;
  }

  getActiveStatus(workspaceRoot) {
    const id = this.activeByWorkspace.get(path.resolve(String(workspaceRoot || "")));
    return id ? this.getStatus(id) : null;
  }

  async readLatestStatus(workspaceRoot, { category = "project_analysis" } = {}) {
    const root = path.join(path.resolve(String(workspaceRoot || "")), ".noval", "analysis");
    if (!(await exists(root))) return null;
    const candidates = [];
    for (const name of await fs.readdir(root)) {
      if (!name.startsWith("run-")) continue;
      try {
        const value = JSON.parse(await fs.readFile(path.join(root, name, "run.json"), "utf8"));
        if (category && String(value.category || "project_analysis") !== category) continue;
        candidates.push(value);
      } catch {
        // A damaged historical run must not prevent opening the project.
      }
    }
    return candidates.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] || null;
  }

  async readLatestRequest(workspaceRoot, { category = "project_analysis" } = {}) {
    const status = await this.readLatestStatus(workspaceRoot, { category });
    if (!status?.runId) return null;
    try {
      return await readRunRequest(workspaceRoot, status.runId);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async resumeLatest({ workspaceRoot, settings, chapters = [], category = "project_analysis" }) {
    const status = await this.readLatestStatus(workspaceRoot, { category });
    if (!status?.runId) throw new Error("没有找到可继续的分析运行。");
    if (!["analyzing", "paused"].includes(status.status)) {
      throw new Error("最近一次分析不在可继续状态，请使用补跑或重新开始。");
    }
    let request;
    try {
      request = await readRunRequest(workspaceRoot, status.runId);
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error("这次旧分析缺少恢复信息，请使用补跑重新开始。");
      throw error;
    }
    if (String(request.category || "project_analysis") !== category) {
      throw new Error("恢复信息不属于当前分析类型。");
    }
    const supplied = list(chapters);
    const byId = new Map(supplied.map((chapter) => [String(chapter.id || chapter.chapterId || ""), chapter]));
    const byPath = new Map(supplied.map((chapter) => [String(chapter.path || chapter.sourcePath || "").replace(/\\/g, "/"), chapter]));
    const selectedChapters = list(request.chapters).map((chapter) =>
      byId.get(String(chapter.id || chapter.chapterId || "")) || byPath.get(String(chapter.path || chapter.sourcePath || "").replace(/\\/g, "/"))
    ).filter(Boolean);
    return this.start({
      workspaceRoot,
      projectId: request.projectId,
      workflowId: request.workflowId,
      settings,
      maxConcurrency: request.maxConcurrency,
      chapters: selectedChapters,
      input: request.input || {},
      category: request.category || category,
      ownerTaskId: request.ownerTaskId || "",
      runId: request.runId,
      createdAt: request.createdAt || status.createdAt,
      resuming: true
    });
  }

  async setStage(run, stage, currentItems = []) {
    run.stage = stage;
    run.currentItems = new Set(currentItems.filter(Boolean));
    await this.persistRun(run);
    await this.event(run, { type: "stage", stage, currentItems: [...run.currentItems] });
  }

  cachePath(run, cacheKey) {
    return path.join(run.workspaceRoot, ".noval", "analysis", "cache", `${cacheKey}.json`);
  }

  async executePoolJob(run, descriptor, { signal, workerId, attempt }) {
    const job = run.jobs.get(descriptor.id);
    if (!job || run.cancelRequested) throw Object.assign(new Error("分析运行已取消。"), { code: "PI_WORKER_JOB_CANCELLED" });
    job.status = "running";
    job.workerId = workerId;
    job.attempt = attempt;
    job.leaseExpiresAt = new Date(Date.now() + 45000).toISOString();
    run.currentItems.add(job.target?.title || job.target?.id || job.nodeId);
    await this.persistJob(run, job);
    await this.persistRun(run);
    await this.event(run, { type: "job_started", jobId: job.id, roleId: job.roleId, workerId, attempt });
    const heartbeat = setInterval(() => {
      if (job.status !== "running") return;
      job.leaseExpiresAt = new Date(Date.now() + 45000).toISOString();
      void this.persistJob(run, job).catch(() => null);
    }, 15000);
    try {
      const result = await this.executeJob(descriptor, { signal, workerId, attempt });
      if (run.cancelRequested || signal.aborted) throw Object.assign(new Error("分析运行已取消。"), { code: "PI_WORKER_JOB_CANCELLED" });
      this.roleRegistry.validateResult(job.roleId, result);
      job.status = "completed";
      job.error = "";
      job.finishedAt = this.timestamp();
      job.leaseExpiresAt = "";
      run.outputs.set(job.id, result);
      await atomicJson(path.join(this.runRoot(run), "outputs", `${job.id}.json`), result);
      await atomicJson(this.cachePath(run, job.cacheKey), {
        cacheKey: job.cacheKey,
        roleId: job.roleId,
        roleVersion: job.roleVersion,
        workflowVersion: run.workflow.version,
        result
      });
      await this.persistJob(run, job);
      await this.event(run, { type: "job_completed", jobId: job.id, roleId: job.roleId });
      return result;
    } catch (error) {
      job.error = safeError(error);
      await this.persistJob(run, job);
      throw error;
    } finally {
      clearInterval(heartbeat);
      run.currentItems.delete(job.target?.title || job.target?.id || job.nodeId);
    }
  }

  async roleJob(run, { nodeId, roleId, target = {}, input = {}, materials = [], required = true, goal = "" }) {
    await this.waitIfPaused(run);
    if (run.cancelRequested) throw new Error("分析运行已取消。");
    const role = this.roleRegistry.get(roleId);
    const inputFingerprint = sha256({ target, input, materials: materials.map((item) => ({ id: item.id, content: item.content })) });
    const cacheKey = sha256({
      projectId: run.projectId,
      inputFingerprint,
      model: run.settings?.model || "",
      roleId,
      roleVersion: role.version,
      outputSchemaVersion: 1,
      workflowId: run.workflow.id,
      workflowVersion: run.workflow.version
    });
    const suffix = sha256({ nodeId, target, inputFingerprint }).slice(0, 12);
    const id = `${nodeId}-${suffix}`;
    let job = run.jobs.get(id);
    if (!job) {
      job = {
        id, nodeId, roleId, roleVersion: role.version, target, required,
        status: "queued", attempt: 0, workerId: "", leaseExpiresAt: "", cacheKey,
        inputFingerprint, error: "", createdAt: this.timestamp(), finishedAt: ""
      };
      run.jobs.set(id, job);
      await this.persistJob(run, job);
      await this.persistRun(run);
    }
    const cachePath = this.cachePath(run, cacheKey);
    if (await exists(cachePath)) {
      try {
        const cached = JSON.parse(await fs.readFile(cachePath, "utf8"));
        this.roleRegistry.validateResult(roleId, cached.result);
        job.status = "completed";
        job.finishedAt = this.timestamp();
        run.outputs.set(id, cached.result);
        await this.persistJob(run, job);
        await this.event(run, { type: "job_reused", jobId: id, roleId });
        return cached.result;
      } catch {
        await fs.rm(cachePath, { force: true });
      }
    }
    const descriptor = {
      id,
      jobId: id,
      role,
      task: {
        goal,
        input: { ...input, target },
        materials,
        materialReadLimitChars: Math.max(8000, Math.floor((Number(run.settings?.contextWindow) || 128000) * 0.4 * 2))
      },
      settings: roleExecutionSettings(run.settings, roleId, input)
    };
    try {
      return await run.pool.enqueue(descriptor);
    } catch (error) {
      if (run.cancelRequested) throw error;
      job.status = "failed";
      job.error = safeError(error);
      job.finishedAt = this.timestamp();
      await this.persistJob(run, job);
      await this.event(run, { type: "job_failed", jobId: id, roleId, error: job.error, required });
      if (required) throw error;
      run.nonBlockingGaps.push(`${roleId} ${target.title || target.id || nodeId}：${job.error}`);
      return null;
    }
  }

  async roleBatch(run, options, targets) {
    const results = await Promise.all(list(targets).map((target) => this.roleJob(run, {
      ...options,
      target,
      input: typeof options.input === "function" ? options.input(target) : options.input,
      materials: typeof options.materials === "function" ? options.materials(target) : options.materials
    })));
    await this.waitIfPaused(run);
    return results.filter((item) => item != null);
  }

  async waitIfPaused(run) {
    if (!run.pauseRequested) return;
    run.status = "paused";
    await this.persistRun(run);
    await this.event(run, { type: "run_paused" });
    await new Promise((resolve) => { run.resumeResolver = resolve; });
    run.resumeResolver = null;
    if (run.cancelRequested) throw new Error("分析运行已取消。");
  }

  async executeRun(run) {
    if (["WF01", "WF02", "WF08"].includes(run.workflow.id)) await this.runImportWorkflow(run);
    else if (run.workflow.id === "WF03") await this.runCorrectionWorkflow(run);
    else if (run.workflow.id === "WF04") await this.runQueryWorkflow(run);
    else if (run.workflow.id === "WF05") await this.runReviewWorkflow(run);
    else if (run.workflow.id === "WF06") await this.runPlanningWorkflow(run);
    else if (run.workflow.id === "WF07") await this.runWritingWorkflow(run);
    else await this.runLinearWorkflow(run);
    if (run.cancelRequested) return;
    run.status = run.nonBlockingGaps.length ? "degraded" : "ready";
    run.stage = "completed";
    run.currentItems.clear();
    run.finishedAt = this.timestamp();
    await this.persistRun(run);
    await this.event(run, { type: "run_completed", status: run.status, generationId: run.generationId });
  }

  async runEntityUnification(run, { navigator, mentions, current }) {
    const clip = (value, budget = 96) => truncateToTokenBudget(String(value || ""), budget);
    const compactEvidenceRef = (ref) => ({
      chapterId: clip(ref?.chapterId, 32),
      sourcePath: clip(ref?.sourcePath, 48),
      paragraphHash: clip(ref?.paragraphHash, 32),
      occurrenceIndex: Number(ref?.occurrenceIndex || 0),
      paragraphStart: Number(ref?.paragraphStart || 0),
      paragraphEnd: Number(ref?.paragraphEnd || ref?.paragraphStart || 0),
      excerpt: clip(ref?.excerpt, 96)
    });
    const compactRecord = (record) => ({
      ...(record?.id ? { id: clip(record.id, 48) } : {}),
      ...(record?.candidateId ? { candidateId: clip(record.candidateId, 48) } : {}),
      ...(record?.entityId ? { entityId: clip(record.entityId, 48) } : {}),
      ...(record?.leftId ? { leftId: clip(record.leftId, 48) } : {}),
      ...(record?.rightId ? { rightId: clip(record.rightId, 48) } : {}),
      ...(record?.canonicalName ? { canonicalName: clip(record.canonicalName, 64) } : {}),
      ...(record?.name ? { name: clip(record.name, 64) } : {}),
      ...(record?.alias ? { alias: clip(record.alias, 64) } : {}),
      ...(record?.label ? { label: clip(record.label, 64) } : {}),
      ...(record?.type ? { type: clip(record.type, 32) } : {}),
      aliases: list(record?.aliases).slice(0, 24).map((item) => clip(item, 48)),
      evidenceRefs: list(record?.evidenceRefs).slice(0, 4).map(compactEvidenceRef)
    });
    const items = [
      ...list(navigator.entityCandidates).map((value) => ({ kind: "entity", value: compactRecord(value) })),
      ...list(navigator.aliasCandidates).map((value) => ({ kind: "alias", value: compactRecord(value) })),
      ...list(mentions).map((value) => ({ kind: "mention", value: compactRecord(value) }))
    ];
    const budget = extractionPayloadBudget(run.settings?.contextWindow, roleExecutionSettings(run.settings, "R04").maxOutputTokens || 4096);
    const batches = partitionByTokenBudget(items, Math.max(256, Math.floor(budget * 0.72)), (item) => item);
    const previousEntities = list(current?.entities).map((entity) => ({
      id: entity.id,
      type: entity.type,
      canonicalName: clip(entity.canonicalName, 64),
      aliases: list(entity.aliases).slice(0, 24).map((item) => clip(item, 48))
    }));
    const unificationJobs = [];
    batches.forEach((batch, index) => {
      const entityCandidates = batch.filter((item) => item.kind === "entity").map((item) => item.value);
      const aliasCandidates = batch.filter((item) => item.kind === "alias").map((item) => item.value);
      const batchMentions = batch.filter((item) => item.kind === "mention").map((item) => item.value);
      const names = new Set([...entityCandidates, ...batchMentions]
        .flatMap((item) => [item.canonicalName, item.name, ...list(item.aliases)])
        .map((item) => String(item || "").trim())
        .filter(Boolean));
      const relevantPrevious = previousEntities.filter((entity) =>
        [entity.canonicalName, ...entity.aliases].some((name) => names.has(String(name || "").trim()))
      );
      const baseTokens = estimateConservativeTokens({ entityCandidates, aliasCandidates, mentions: batchMentions }) + 180;
      const previousBudget = Math.max(192, budget - baseTokens);
      const previousBatches = relevantPrevious.length
        ? partitionByTokenBudget(relevantPrevious, previousBudget, (entity) => entity)
        : [[]];
      previousBatches.forEach((previousBatch, previousIndex) => {
        const partitioned = batches.length > 1 || previousBatches.length > 1;
        unificationJobs.push(this.roleJob(run, {
          nodeId: partitioned ? `unify_${index + 1}_${previousIndex + 1}` : "unify",
          roleId: "R04",
          target: {
            id: `entity-group-${index + 1}-${previousIndex + 1}`,
            title: partitioned
              ? `实体分组 ${index + 1}/${batches.length} · 历史 ${previousIndex + 1}/${previousBatches.length}`
              : "全书实体"
          },
          goal: partitioned
            ? "判断本实体分组及本批历史同名记录的合并、拆分和不确定项；分组结果由协调器统一分配稳定编号。"
            : "判断实体候选的合并、拆分和不确定项。",
          input: {
            partIndex: index + 1,
            partCount: batches.length,
            historyPartIndex: previousIndex + 1,
            historyPartCount: previousBatches.length,
            entityCandidates,
            aliasCandidates,
            mentions: batchMentions,
            previousEntities: previousBatch
          }
        }));
      });
    });
    const results = await Promise.all(unificationJobs);
    const decisionMap = new Map();
    const entityMap = new Map();
    results.flatMap((result) => list(result.decisions)).forEach((decision) => {
      const key = [decision.leftId, decision.rightId, decision.decision].map(String).join("|");
      decisionMap.set(key, decision);
    });
    results.flatMap((result) => list(result.entities)).forEach((entity) => {
      const key = String(entity.candidateId || entity.entityId || entity.id || entity.canonicalName || entity.name || "");
      if (key) entityMap.set(key, entity);
    });
    return { decisions: [...decisionMap.values()], entities: [...entityMap.values()] };
  }

  async runTimelineAnalysis(run, { events, timeStructure }) {
    const budget = extractionPayloadBudget(run.settings?.contextWindow, roleExecutionSettings(run.settings, "R05").maxOutputTokens || 4096);
    const compactEvent = (event) => ({
      id: event.id || event.eventId || event.candidateId,
      eventId: event.eventId || event.id || event.candidateId,
      candidateId: event.candidateId || event.id || event.eventId,
      type: truncateToTokenBudget(event.type, 32),
      chapterId: event.chapterId || event.evidenceRefs?.[0]?.chapterId || "",
      sceneId: event.sceneId || "",
      storyTime: truncateToTokenBudget(event.storyTime, 96),
      narrativeOrder: event.narrativeOrder ?? null,
      summary: truncateToTokenBudget(event.summary || event.action, 192),
      cause: truncateToTokenBudget(event.cause, 96),
      action: truncateToTokenBudget(event.action || event.summary, 192),
      result: truncateToTokenBudget(event.result, 96),
      participantIds: list(event.participantIds || event.participants).slice(0, 32),
      evidenceRefs: list(event.evidenceRefs).slice(0, 3).map((ref) => ({
        chapterId: ref.chapterId,
        sourcePath: ref.sourcePath,
        paragraphStart: ref.paragraphStart,
        paragraphEnd: ref.paragraphEnd,
        excerpt: truncateToTokenBudget(ref.excerpt, 64)
      }))
    });
    const compactEvents = list(events).map(compactEvent);
    const fixedTokens = estimateConservativeTokens(timeStructure) + 160;
    const eventBudget = Math.max(256, budget - fixedTokens);
    const batches = partitionByTokenBudget(compactEvents, eventBudget, (event) => event);
    const partials = await Promise.all(batches.map((batch, index) => this.roleJob(run, {
      nodeId: batches.length > 1 ? `timeline_${index + 1}` : "timeline",
      roleId: "R05",
      target: { id: `timeline-part-${index + 1}`, title: batches.length > 1 ? `时间分区 ${index + 1}/${batches.length}` : "全书时间线" },
      goal: batches.length > 1
        ? "整理本事件分区的故事时间、倒叙和不确定范围；保留事件编号，供跨分区边界复核。"
        : "整理叙述顺序与故事时间。",
      input: { phase: batches.length > 1 ? "partition" : "complete", partIndex: index + 1, partCount: batches.length, events: batch, timeStructure }
    })));
    const eventMap = new Map();
    partials.flatMap((result) => list(result.events)).forEach((event) => {
      const id = String(event.eventId || event.id || event.candidateId || "");
      if (id) eventMap.set(id, { ...(eventMap.get(id) || {}), ...event });
    });
    let uncertainties = partials.flatMap((result) => list(result.uncertainties));
    if (partials.length > 1) {
      let boundaryEvents = partials.flatMap((result, index) => {
        const values = list(result.events);
        return [values[0], values.at(-1)].filter(Boolean).map((event) => ({ ...compactEvent(event), partitionIndex: index + 1 }));
      });
      for (let level = 1; level <= 12; level += 1) {
        let groups = partitionByTokenBudget(boundaryEvents, eventBudget, (event) => event);
        if (groups.length >= boundaryEvents.length && boundaryEvents.length > 1) {
          groups = Array.from({ length: Math.ceil(boundaryEvents.length / 2) }, (_, index) =>
            boundaryEvents.slice(index * 2, index * 2 + 2)
          );
        }
        const finalLevel = groups.length === 1;
        const globalResults = await Promise.all(groups.map((group, groupIndex) => this.roleJob(run, {
          nodeId: finalLevel ? "timeline_global" : `timeline_boundary_${level}_${groupIndex + 1}`,
          roleId: "R05",
          target: {
            id: finalLevel ? "timeline-global" : `timeline-boundary-${level}-${groupIndex + 1}`,
            title: finalLevel ? "跨分区时间边界" : `时间边界归并 ${level} · ${groupIndex + 1}/${groups.length}`
          },
          goal: finalLevel
            ? "对全部时间分区的归并边界做最终串行复核，判断跨区顺序、倒叙和时间锚点；保留原事件编号。"
            : "复核本组时间边界并保留首尾锚点；结果会进入下一层全局时间检查，必须保留原事件编号。",
          input: {
            phase: finalLevel ? "global_boundaries" : "boundary_reduction",
            level,
            groupIndex: groupIndex + 1,
            groupCount: groups.length,
            events: group,
            timeStructure
          }
        })));
        globalResults.flatMap((result) => list(result.events)).forEach((event) => {
          const id = String(event.eventId || event.id || event.candidateId || "");
          if (id) eventMap.set(id, { ...(eventMap.get(id) || {}), ...event });
        });
        uncertainties = [...uncertainties, ...globalResults.flatMap((result) => list(result.uncertainties))];
        if (finalLevel) break;
        boundaryEvents = globalResults.flatMap((result, index) => {
          const values = list(result.events);
          return [values[0], values.at(-1)].filter(Boolean).map((event) => ({
            ...compactEvent(event),
            boundaryGroupIndex: index + 1
          }));
        });
        if (!boundaryEvents.length) throw new Error("跨分区时间检查没有保留边界事件。");
        if (level === 12) throw new Error("跨分区时间检查层级过深。");
      }
    }
    return { events: [...eventMap.values()], uncertainties };
  }

  async runExtractionSegment(run, segment) {
    try {
      const result = await this.roleJob(run, {
        nodeId: "extract",
        roleId: "R03",
        goal: segment.partCount > 1
          ? "抽取指定长章节片段的原文证据；只引用本片段证据表中的全局段落位置，不推断片段外内容。"
          : "抽取指定章节的原文证据。",
        required: true,
        target: { id: segment.id, title: segment.title },
        input: {
          chapterId: segment.chapterId,
          chapterIndex: segment.chapterIndex,
          sourcePath: segment.sourcePath,
          segmentId: segment.id,
          partIndex: segment.partIndex,
          partCount: segment.partCount,
          paragraphStart: segment.paragraphStart,
          paragraphEnd: segment.paragraphEnd,
          evidenceIndex: segment.evidenceIndex
        },
        materials: [{ id: segment.id, title: segment.title, content: segment.content }]
      });
      return [{ segment, result }];
    } catch (error) {
      const children = isContextLengthError(error) && Number(segment.splitDepth || 0) < 6
        ? bisectExtractionSegment(segment)
        : [];
      if (!children.length) throw error;
      for (const [jobId, job] of run.jobs) {
        if (job.nodeId === "extract" && job.target?.id === segment.id && job.status === "failed") {
          run.jobs.delete(jobId);
          run.outputs.delete(jobId);
          await fs.rm(path.join(this.runRoot(run), "jobs", `${jobId}.json`), { force: true });
        }
      }
      await this.persistRun(run);
      const nested = await Promise.all(children.map((child) => this.runExtractionSegment(run, child)));
      return nested.flat();
    }
  }

  compactTrackEvent(event) {
    return {
      id: event.id || event.eventId || event.candidateId,
      eventId: event.eventId || event.id || event.candidateId,
      candidateId: event.candidateId || event.id || event.eventId,
      type: truncateToTokenBudget(event.type, 32),
      chapterId: event.chapterId || event.evidenceRefs?.[0]?.chapterId || "",
      sceneId: event.sceneId || "",
      storyTime: truncateToTokenBudget(event.storyTime, 64),
      narrativeOrder: event.narrativeOrder ?? null,
      summary: truncateToTokenBudget(event.summary || event.action, 160),
      cause: truncateToTokenBudget(event.cause, 80),
      action: truncateToTokenBudget(event.action || event.summary, 160),
      result: truncateToTokenBudget(event.result, 80),
      participantIds: list(event.participantIds || event.participants).slice(0, 32),
      locationId: event.locationId || "",
      evidenceRefs: list(event.evidenceRefs).slice(0, 4).map((ref) => ({
        chapterId: ref.chapterId,
        sourcePath: ref.sourcePath,
        paragraphHash: ref.paragraphHash,
        occurrenceIndex: ref.occurrenceIndex,
        paragraphStart: ref.paragraphStart,
        paragraphEnd: ref.paragraphEnd,
        excerpt: truncateToTokenBudget(ref.excerpt, 80)
      }))
    };
  }

  async runBoundedTrackRole(run, {
    nodeId,
    roleId,
    goal,
    target,
    events = [],
    assertions = [],
    timeline = null,
    required = true
  }) {
    const compactEvents = list(events).map((event) => this.compactTrackEvent(event));
    const compactAssertions = list(assertions).map((assertion) => ({
      id: assertion.id || assertion.assertionId || "",
      assertionId: assertion.assertionId || assertion.id || "",
      propositionId: assertion.propositionId || "",
      scope: assertion.scope || "WORLD",
      holderId: assertion.holderId || null,
      proposition: truncateToTokenBudget(assertion.proposition || assertion.content || assertion.statement, 192),
      truthStatus: assertion.truthStatus || "unknown",
      validFrom: assertion.validFrom || null,
      validTo: assertion.validTo || null,
      acquiredByEventId: assertion.acquiredByEventId || null,
      invalidatedByEventId: assertion.invalidatedByEventId || null,
      evidenceRefs: list(assertion.evidenceRefs).slice(0, 4)
    }));
    const items = [
      ...compactEvents.map((value) => ({ kind: "event", value })),
      ...compactAssertions.map((value) => ({ kind: "assertion", value }))
    ];
    const budget = extractionPayloadBudget(
      run.settings?.contextWindow,
      roleExecutionSettings(run.settings, roleId).maxOutputTokens || 4096
    );
    const batches = items.length
      ? partitionByTokenBudget(items, Math.max(256, Math.floor(budget * 0.68)), (item) => item)
      : [[]];
    const timelineById = new Map(list(timeline?.events).map((event) => [
      String(event.eventId || event.id || event.candidateId || ""),
      event
    ]));
    const compactTarget = {
      id: target.id,
      title: truncateToTokenBudget(target.title || target.canonicalName || target.name || target.id, 64),
      ...(target.canonicalName ? { canonicalName: truncateToTokenBudget(target.canonicalName, 64) } : {}),
      ...(target.name ? { name: truncateToTokenBudget(target.name, 64) } : {}),
      ...(target.type ? { type: truncateToTokenBudget(target.type, 32) } : {}),
      ...(target.kind ? { kind: truncateToTokenBudget(target.kind, 32) } : {}),
      ...(target.status ? { status: truncateToTokenBudget(target.status, 32) } : {}),
      ...(target.subjectId ? { subjectId: target.subjectId } : {}),
      ...(target.objectId ? { objectId: target.objectId } : {}),
      aliases: list(target.aliases).slice(0, 16).map((alias) => truncateToTokenBudget(alias, 48))
    };
    const results = (await Promise.all(batches.map((batch, index) => {
      const batchEvents = batch.filter((item) => item.kind === "event").map((item) => item.value);
      const batchAssertions = batch.filter((item) => item.kind === "assertion").map((item) => item.value);
      const batchTimeline = batchEvents.map((event) => timelineById.get(String(event.eventId || event.id || event.candidateId || ""))).filter(Boolean);
      return this.roleJob(run, {
        nodeId: batches.length > 1 ? `${nodeId}_${index + 1}` : nodeId,
        roleId,
        goal: batches.length > 1 ? `${goal} 只处理当前分区，协调器会按叙述顺序合并全部分区。` : goal,
        target: {
          ...compactTarget,
          id: batches.length > 1 ? `${target.id}:part-${index + 1}` : target.id,
          title: batches.length > 1 ? `${compactTarget.title} · ${index + 1}/${batches.length}` : compactTarget.title
        },
        input: {
          phase: batches.length > 1 ? "partition" : "complete",
          partIndex: index + 1,
          partCount: batches.length,
          events: batchEvents,
          assertions: batchAssertions,
          ...(timeline ? { timeline: { ...timeline, events: batchTimeline } } : {})
        },
        required
      });
    }))).filter(Boolean);

    if (roleId === "R06") return {
      characterId: target.id,
      states: results.flatMap((result) => list(result.states))
    };
    if (roleId === "R07") return {
      subjectId: target.subjectId,
      objectId: target.objectId,
      stages: results.flatMap((result, resultIndex) => list(result.stages).map((stage) => ({
        ...stage,
        ...(batches.length > 1 && stage.id ? { id: `${target.id}:part-${resultIndex + 1}:${stage.id}` } : {})
      })))
    };
    if (roleId === "R08") return {
      storylineId: target.id,
      title: results.find((result) => result.title)?.title || target.title,
      events: uniqueStrings(results.flatMap((result) => list(result.events))),
      currentState: results.map((result) => result.currentState).filter(Boolean).at(-1) || "",
      openQuestions: uniqueStrings(results.flatMap((result) => list(result.openQuestions)))
    };
    if (roleId === "R09") {
      const hooks = new Map();
      results.flatMap((result) => list(result.hooks)).forEach((hook, hookIndex) => {
        const key = String(hook.id || hook.title || `hook-${hookIndex + 1}`);
        const previous = hooks.get(key) || {};
        hooks.set(key, {
          ...previous,
          ...hook,
          evidenceRefs: [...list(previous.evidenceRefs), ...list(hook.evidenceRefs)],
          setupEventIds: uniqueStrings([...list(previous.setupEventIds), ...list(hook.setupEventIds)]),
          payoffEventIds: uniqueStrings([...list(previous.payoffEventIds), ...list(hook.payoffEventIds)])
        });
      });
      return { hooks: [...hooks.values()] };
    }
    if (roleId === "R11") return {
      characterId: target.id,
      assertions: results.flatMap((result, resultIndex) => list(result.assertions).map((assertion) => ({
        ...assertion,
        holderId: String(assertion.scope || "WORLD").toUpperCase() === "WORLD" ? null : target.id,
        ...(batches.length > 1 && assertion.id ? { id: `${target.id}:part-${resultIndex + 1}:${assertion.id}` } : {}),
        ...(batches.length > 1 && assertion.assertionId ? { assertionId: `${target.id}:part-${resultIndex + 1}:${assertion.assertionId}` } : {})
      })))
    };
    return results[0] || null;
  }

  async runStyleAnalysis(run, samples) {
    const compactSamples = list(samples).map((sample) => ({
      excerpt: truncateToTokenBudget(sample?.excerpt || sample?.text || sample, 192),
      evidenceRefs: list(sample?.evidenceRefs).slice(0, 2)
    }));
    const budget = extractionPayloadBudget(
      run.settings?.contextWindow,
      roleExecutionSettings(run.settings, "R10").maxOutputTokens || 4096
    );
    const batches = compactSamples.length
      ? partitionByTokenBudget(compactSamples, Math.max(256, Math.floor(budget * 0.68)), (sample) => sample)
      : [[]];
    const results = await Promise.all(batches.map((batch, index) => this.roleJob(run, {
      nodeId: batches.length > 1 ? `style_${index + 1}` : "style",
      roleId: "R10",
      target: { id: `style-part-${index + 1}`, title: batches.length > 1 ? `文风样本 ${index + 1}/${batches.length}` : "全书文风" },
      goal: batches.length > 1 ? "归纳当前样本分区的可执行文风规律，协调器会合并各阶段风格。" : "归纳可执行文风规律。",
      input: { partIndex: index + 1, partCount: batches.length, samples: batch }
    })));
    if (results.length <= 1) return results;
    const summaries = results.map((result) => result.style?.summary || result.style).filter(Boolean);
    return [{
      style: {
        summary: truncateToTokenBudget(summaries.map((summary) => typeof summary === "string" ? summary : JSON.stringify(summary)).join("；"), 512),
        stageStyles: results.slice(0, 24).map((result, index) => ({
          partIndex: index + 1,
          summary: truncateToTokenBudget(result.style?.summary || JSON.stringify(result.style || {}), 96)
        }))
      }
    }];
  }

  async runImportConsistencyChecks(run, data, perspectives = REVIEW_PERSPECTIVES) {
    const item = (kind, value, metadata = {}) => ({
      kind,
      ...metadata,
      summary: truncateToTokenBudget(JSON.stringify(value ?? null), 320)
    });
    const reviewItems = [];
    list(data.extracts).forEach((extract) => {
      const chapter = { chapterId: extract._chapterId, chapterIndex: extract._chapterIndex, sourcePath: extract._sourcePath };
      for (const field of ["mentions", "events", "assertions", "relationChanges", "hooks", "styleSamples"]) {
        list(extract[field]).forEach((value) => reviewItems.push(item(`extract.${field}`, value, chapter)));
      }
    });
    list(data.characterStates).forEach((track) => list(track.states).forEach((state) =>
      reviewItems.push(item("character_state", state, { characterId: track.characterId }))
    ));
    list(data.relationTracks).forEach((track) => list(track.stages).forEach((stage) =>
      reviewItems.push(item("relationship_stage", stage, { subjectId: track.subjectId, objectId: track.objectId }))
    ));
    list(data.storylineTracks).forEach((track) => reviewItems.push(item("storyline", track)));
    list(data.hookTracks).forEach((track) => reviewItems.push(item("hook_track", track)));
    list(data.knowledgeTracks).forEach((track) => list(track.assertions).forEach((assertion) =>
      reviewItems.push(item("knowledge", assertion, { characterId: track.characterId }))
    ));
    list(data.styleResults).forEach((style) => reviewItems.push(item("style", style)));
    if (data.reviewContext) reviewItems.push(item("workflow_context", data.reviewContext));
    if (!reviewItems.length) reviewItems.push({ kind: "empty", summary: "本次没有抽取到正式候选。" });

    const budget = extractionPayloadBudget(
      run.settings?.contextWindow,
      roleExecutionSettings(run.settings, "R12").maxOutputTokens || 4096
    );
    const batches = partitionByTokenBudget(reviewItems, Math.max(256, Math.floor(budget * 0.68)), (value) => value);
    const partitionJobs = list(perspectives).flatMap((perspectiveSource, perspectiveIndex) => {
      const perspective = typeof perspectiveSource === "string"
        ? perspectiveSource
        : String(perspectiveSource?.title || perspectiveSource?.id || `检查视角 ${perspectiveIndex + 1}`);
      const perspectiveId = typeof perspectiveSource === "string"
        ? `check-${perspectiveIndex + 1}`
        : String(perspectiveSource?.id || `check-${perspectiveIndex + 1}`);
      return batches.map(async (records, batchIndex) => {
        const result = await this.roleJob(run, {
          nodeId: batches.length > 1 ? `check_${perspectiveIndex + 1}_${batchIndex + 1}` : "check",
          roleId: "R12",
          target: {
            id: batches.length > 1 ? `${perspectiveId}:part-${batchIndex + 1}` : perspectiveId,
            title: batches.length > 1 ? `${perspective} · ${batchIndex + 1}/${batches.length}` : perspective
          },
          goal: batches.length > 1
            ? "只检查当前正式记录分区的指定一致性视角，并在 observations 中保留跨分区比较所需的简短事实。"
            : "只报告指定视角的一致性问题。",
          input: {
            perspective,
            batchIndex: batchIndex + 1,
            batchCount: batches.length,
            records
          }
        });
        return { perspective, perspectiveIndex, batchIndex: batchIndex + 1, result };
      });
    });
    const partitionFindings = await Promise.all(partitionJobs);
    const checks = partitionFindings.map((finding) => finding.result);
    if (batches.length > 1) {
      for (const finding of partitionFindings) {
        if (!Array.isArray(finding.result?.observations)) {
          throw new Error(`导入一致性分区缺少事实摘要：${finding.perspective} · ${finding.batchIndex}/${batches.length}`);
        }
      }
      const cross = await Promise.all(list(perspectives).map((perspective, perspectiveIndex) =>
        this.runCrossBatchPerspectiveReview(run, {
          perspective,
          perspectiveIndex,
          tokenBudget: budget,
          findings: partitionFindings.filter((finding) => finding.perspective === perspective).map((finding) => ({
            batchIndex: finding.batchIndex,
            issues: finding.result.issues,
            observations: finding.result.observations
          }))
        })
      ));
      checks.push(...cross.flat());
    }
    return checks;
  }

  async mergeMaterialPathCandidates(run, relativePath, candidates, tokenBudget) {
    let current = list(candidates);
    const budget = Math.max(512, Math.floor(Number(tokenBudget) || 2000));
    for (let level = 1; level <= 12 && current.length > 1; level += 1) {
      const groups = Array.from({ length: Math.ceil(current.length / 2) }, (_, index) =>
        current.slice(index * 2, index * 2 + 2)
      );
      const merged = await Promise.all(groups.map(async (group, groupIndex) => {
        const result = await this.roleJob(run, {
          nodeId: `materials_merge_${sha256(relativePath).slice(0, 8)}_${level}_${groupIndex + 1}`,
          roleId: "R13",
          target: { id: `material-${level}-${groupIndex + 1}`, title: `${relativePath} · 合并 ${level}` },
          goal: `把同一路径 ${relativePath} 的分区内容合并成一个完整、无重复、以最新叙述状态为准的文件；只输出这个路径。`,
          input: {
            relativePath,
            candidates: group.map((candidate) => ({
              partIndex: candidate.partIndex,
              maxNarrativePosition: candidate.maxNarrativePosition,
              content: truncateToTokenBudget(candidate.content, Math.max(128, Math.floor(budget * 0.3)))
            }))
          }
        });
        const content = result.materials?.[relativePath];
        return {
          partIndex: Math.max(...group.map((candidate) => Number(candidate.partIndex) || 0)),
          maxNarrativePosition: Math.max(...group.map((candidate) => Number(candidate.maxNarrativePosition) || 0)),
          content: content == null
            ? group.map((candidate) => String(candidate.content || "")).filter(Boolean).join("\n\n")
            : String(content)
        };
      }));
      current = merged;
    }
    if (current.length !== 1) throw new Error(`项目材料合并层级过深：${relativePath}`);
    return current[0].content;
  }

  async runImportMaterialGeneration(run, data) {
    const fullInput = {
      ...(data.context || {}),
      entities: data.merged.entities,
      events: data.merged.events,
      assertions: data.merged.assertions,
      relations: data.merged.relations,
      timeline: data.timeline,
      characterStates: data.characterStates,
      storylines: data.storylineTracks,
      hooks: data.hookTracks,
      style: data.styleResults[0]?.style || {}
    };
    const budget = extractionPayloadBudget(
      run.settings?.contextWindow,
      roleExecutionSettings(run.settings, "R13").maxOutputTokens || 8192
    );
    if (estimateConservativeTokens(fullInput) <= Math.floor(budget * 0.68)) {
      return this.roleJob(run, {
        nodeId: data.nodeId || "materials",
        roleId: "R13",
        goal: data.goal || "从已检查结构化结果生成项目可读材料。",
        input: fullInput
      });
    }

    const records = [];
    const narrativePosition = (value) => {
      for (const candidate of [value?.narrativeIndex, value?.narrativeOrder, value?.index, value?.chapterIndex, value?.validFrom]) {
        const numeric = Number(candidate);
        if (Number.isFinite(numeric)) return numeric;
        const hint = String(candidate || "").match(/\d+/g)?.at(-1);
        if (hint && Number.isFinite(Number(hint))) return Number(hint);
      }
      const evidenceHint = String(value?.evidenceRefs?.[0]?.chapterId || "").match(/\d+/g)?.at(-1);
      return evidenceHint && Number.isFinite(Number(evidenceHint)) ? Number(evidenceHint) : 0;
    };
    const append = (kind, values) => list(values).forEach((value) => records.push({
      kind,
      narrativePosition: narrativePosition(value),
      summary: truncateToTokenBudget(JSON.stringify(value ?? null), 320)
    }));
    append("entity", data.merged.entities);
    append("event", data.merged.events);
    append("assertion", data.merged.assertions);
    append("relation", data.merged.relations);
    append("character_state_track", data.characterStates);
    append("storyline", data.storylineTracks);
    append("hook", data.hookTracks);
    append("style", data.styleResults);
    if (data.context) records.push({ kind: "workflow_context", narrativePosition: 0, summary: truncateToTokenBudget(JSON.stringify(data.context), 320) });
    if (!records.length) records.push({ kind: "empty", summary: "没有正式记录。" });
    const batches = partitionByTokenBudget(records, Math.max(256, Math.floor(budget * 0.65)), (value) => value);
    const results = await Promise.all(batches.map(async (batch, index) => ({
      partIndex: index + 1,
      maxNarrativePosition: Math.max(0, ...batch.map((record) => Number(record.narrativePosition) || 0)),
      result: await this.roleJob(run, {
        nodeId: `${data.nodeId || "materials"}_${index + 1}`,
        roleId: "R13",
        target: { id: `materials-part-${index + 1}`, title: `项目材料分区 ${index + 1}/${batches.length}` },
        goal: "根据当前正式记录分区生成相关的完整项目材料文件；只输出本分区有依据的文件，其他分区会由协调器合并。",
        input: { ...(data.context || {}), partIndex: index + 1, partCount: batches.length, records: batch }
      })
    })));
    const byPath = new Map();
    for (const item of results) {
      for (const [relativePath, content] of Object.entries(item.result.materials || {})) {
        byPath.set(relativePath, [...(byPath.get(relativePath) || []), {
          partIndex: item.partIndex,
          maxNarrativePosition: item.maxNarrativePosition,
          content: String(content)
        }]);
      }
    }
    const materials = {};
    for (const [relativePath, candidates] of byPath) {
      if (candidates.length === 1) {
        materials[relativePath] = candidates[0].content;
      } else if (relativePath === "outline/stages/current.md") {
        materials[relativePath] = [...candidates].sort((left, right) =>
          left.maxNarrativePosition - right.maxNarrativePosition || left.partIndex - right.partIndex
        ).at(-1).content;
      } else {
        materials[relativePath] = await this.mergeMaterialPathCandidates(run, relativePath, candidates, budget);
      }
    }
    return { materials };
  }

  async runImportWorkflow(run) {
    const incremental = ["WF02", "WF08"].includes(run.workflow.id);
    const current = incremental
      ? await this.graphStore.readCurrentGeneration(run.workspaceRoot)
      : null;
    if (incremental && current) this.prepareIncrementalReplay(run, current);
    if (!run.chapters.length) {
      if (incremental && current && this.incrementalChapterIds(run, current).size) {
        await this.runDeletionOnlyIncremental(run, current);
        return;
      }
      throw new Error("没有可分析的正式章节。");
    }
    run.chapters = await Promise.all(run.chapters.map(async (chapter) => {
      let sourceContent = String(chapter.content || "");
      try { sourceContent = await fs.readFile(path.join(run.workspaceRoot, chapter.path), "utf8"); }
      catch { /* The persisted chapter content remains the fallback. */ }
      return { ...chapter, sourceContent };
    }));
    await this.setStage(run, "navigation");
    const navigationBatches = buildNavigationBatches(run.chapters, { contextWindow: run.settings?.contextWindow });
    const navigationResults = await Promise.all(navigationBatches.map((batch, index) => this.roleJob(run, {
      nodeId: navigationBatches.length > 1 ? `navigate_${index + 1}` : "navigate",
      roleId: "R02",
      target: { id: batch.id, title: batch.title },
      goal: navigationBatches.length > 1
        ? "建立指定章节分区的导航候选，不形成正式事实；章节分区会由协调器汇总。"
        : "建立全书导航，不形成正式事实。",
      input: { partIndex: batch.partIndex, partCount: batch.partCount, chapterIds: batch.chapterIds },
      materials: [{ id: batch.id, title: batch.title, content: batch.content }]
    })));
    const timelineInputBudget = extractionPayloadBudget(
      run.settings?.contextWindow,
      roleExecutionSettings(run.settings, "R05").maxOutputTokens || 4096
    );
    const navigator = mergeNavigationResults(navigationResults, {
      timeStructureTokenBudget: Math.max(128, Math.floor(timelineInputBudget * 0.25))
    });

    const extractionSegments = run.chapters.flatMap((chapter) => splitChapterForExtraction(chapter, {
      contextWindow: run.settings?.contextWindow,
      outputReserve: roleExecutionSettings(run.settings, "R03").maxOutputTokens || 4096
    }));
    await this.setStage(run, "extracting", extractionSegments.map((segment) => segment.title));
    const extractionOutputs = (await Promise.all(
      extractionSegments.map((segment) => this.runExtractionSegment(run, segment))
    )).flat();
    const extracts = mergeChapterExtractionSegments(run.chapters, extractionOutputs);

    const mentions = extracts.flatMap((result) => list(result.mentions));
    const rawEvents = extracts.flatMap((result) => list(result.events));
    await this.setStage(run, "entity_resolution");
    const unification = await this.runEntityUnification(run, { navigator, mentions, current });
    await this.setStage(run, "timeline");
    const timeline = await this.runTimelineAnalysis(run, { events: rawEvents, timeStructure: navigator.timeStructure });

    const candidates = this.entityCandidates(navigator, extracts, unification);
    const entityResolution = resolveEntityClusters({
      projectId: run.projectId,
      candidates,
      decisions: list(unification.decisions),
      previousEntities: list(current?.entities)
    });
    if (entityResolution.conflicts.length) {
      run.blockingGaps.push(...entityResolution.conflicts.map((item) => `${item.leftId} / ${item.rightId}：${item.reason}`));
      throw new Error("主要实体存在互相矛盾的合并判断，未发布不可靠图谱。");
    }
    const pairs = this.relationPairs(extracts);
    const storylines = list(navigator.storylines);
    const hooks = extracts.flatMap((result) => list(result.hooks));
    await this.setStage(run, "tracks");
    const [characterStates, relationTracks, storylineTracks, hookTracks, styleResults, knowledgeTracks] = await Promise.all([
      Promise.all(candidates.map((target) => {
          const events = eventsForTarget(rawEvents, target);
          return this.runBoundedTrackRole(run, {
            nodeId: "character_states", roleId: "R06", goal: "整理单个人物的状态轨。",
            target, events, timeline: timelineForEvents(timeline, events)
          });
      })),
      Promise.all(pairs.map((target) => {
          const events = eventsForPair(rawEvents, target);
          return this.runBoundedTrackRole(run, {
            nodeId: "relations", roleId: "R07", goal: "按事件整理人物对的关系阶段。",
            target, events, timeline: timelineForEvents(timeline, events)
          });
      })),
      storylines.length ? Promise.all(storylines.map((target) => this.runBoundedTrackRole(run, {
        nodeId: "storylines", roleId: "R08", goal: "还原已有故事线。",
        target, events: eventsForNarrativeTarget(rawEvents, target)
      }))) : Promise.resolve([]),
      hooks.length ? Promise.all(hooks.map((target) => this.runBoundedTrackRole(run, {
        nodeId: "hooks", roleId: "R09", goal: "判断伏笔、暗示、谜团与回收状态。",
        target, events: eventsForNarrativeTarget(rawEvents, target), required: false
      }))).then((items) => items.filter(Boolean)) : Promise.resolve([]),
      this.runStyleAnalysis(run, extracts.flatMap((item) => list(item.styleSamples))),
      Promise.all(candidates.map((target) => {
          const keys = targetKeys(target);
          return this.runBoundedTrackRole(run, {
            nodeId: "knowledge", roleId: "R11", goal: "整理单个人物的认知边界。",
            target,
            events: eventsForTarget(rawEvents, target),
            assertions: extracts.flatMap((item) => list(item.assertions)).filter((assertion) =>
              !assertion.holderId || keys.has(String(assertion.holderId)) || assertion.scope === "WORLD"
            )
          });
      }))
    ]);

    await this.setStage(run, "checking");
    const checks = await this.runImportConsistencyChecks(run, {
      extracts,
      characterStates,
      relationTracks,
      storylineTracks,
      hookTracks,
      styleResults,
      knowledgeTracks
    });
    const criticalIssues = checks.flatMap((item) => list(item.issues)).filter((item) => item.blocking || ["critical", "严重"].includes(item.severity));
    if (criticalIssues.length) {
      run.blockingGaps.push(...criticalIssues.map((item) => item.message || item.reason || item.title || "存在关键一致性问题"));
      throw new Error("全书检查仍存在关键缺口，未发布不完整图谱。");
    }

    await this.setStage(run, "merging");
    let merged = this.mergeImportResults(run, {
      navigator, extracts, unification, timeline, candidates, entityResolution, characterStates, relationTracks,
      storylineTracks, hookTracks, styleResults, knowledgeTracks, checks
    });
    let previousMaterials = {};
    if (incremental && current) {
      merged = this.mergeIncrementalGeneration(run, current, merged);
      previousMaterials = await this.readCurrentMaterials(current);
    }
    await this.setStage(run, "materials");
    const materialResult = await this.runImportMaterialGeneration(run, {
      merged,
      timeline,
      characterStates,
      storylineTracks,
      hookTracks,
      styleResults
    });
    const generatedMaterials = this.materialsFromResult(merged, materialResult, { storylineTracks, hookTracks, styleResults });
    const materials = incremental && current
      ? this.mergeIncrementalMaterials(run, current, previousMaterials, generatedMaterials, merged)
      : generatedMaterials;
    await this.setStage(run, "publishing");
    const published = await this.graphStore.publishGeneration(run.workspaceRoot, {
      generationId: `generation-${Date.now()}-${this.randomUUID().slice(0, 8)}`,
      projectFormatVersion: 5,
      graphFormatVersion: 1,
      entities: merged.entities,
      events: merged.events,
      assertions: merged.assertions,
      relations: merged.relations,
      overrides: merged.overrides,
      materials,
      dependencies: merged.dependencies,
      chapters: incremental ? list(run.input.allChapters) : run.chapters,
      gaps: { critical: run.blockingGaps, nonCritical: run.nonBlockingGaps },
      manifest: {
        model: run.settings?.model || "",
        roleVersions: Object.fromEntries(this.roleRegistry.list().map((role) => [role.id, role.version])),
        workflow: { id: run.workflow.id, version: run.workflow.version }
      }
    });
    run.generationId = published.generationId;
    run.result = { generationId: published.generationId };
  }

  async runDeletionOnlyIncremental(run, current) {
    await this.setStage(run, "impact");
    const merged = this.mergeIncrementalGeneration(run, current, {
      entities: [], events: [], assertions: [], relations: [], overrides: [], dependencies: {}
    });
    await this.setStage(run, "checking");
    const checks = await this.runImportConsistencyChecks(run, {
      extracts: [{
        _chapterId: "remaining-graph",
        mentions: merged.entities,
        events: merged.events,
        assertions: merged.assertions,
        relationChanges: merged.relations,
        hooks: [],
        styleSamples: []
      }],
      characterStates: [], relationTracks: [], storylineTracks: [], hookTracks: [], styleResults: [], knowledgeTracks: []
    });
    const blocking = checks.flatMap((item) => list(item.issues))
      .filter((item) => item.blocking || ["critical", "严重"].includes(item.severity));
    if (blocking.length) {
      run.blockingGaps.push(...blocking.map((item) => item.message || item.reason || item.title || "删除章节后存在关键一致性问题"));
      throw new Error("删除章节后的图谱仍有关键缺口，未发布不完整结果。");
    }

    await this.setStage(run, "materials");
    const materialResult = await this.runImportMaterialGeneration(run, {
      merged,
      timeline: { events: [], uncertainties: [] },
      characterStates: [], storylineTracks: [], hookTracks: [], styleResults: []
    });
    const previousMaterials = await this.readCurrentMaterials(current);
    const generatedMaterials = this.materialsFromResult(merged, materialResult, {
      storylineTracks: [], hookTracks: [], styleResults: []
    });
    const materials = this.mergeIncrementalMaterials(run, current, previousMaterials, generatedMaterials, merged);

    await this.setStage(run, "publishing");
    const published = await this.graphStore.publishGeneration(run.workspaceRoot, {
      generationId: `generation-${Date.now()}-${this.randomUUID().slice(0, 8)}`,
      projectFormatVersion: 5,
      graphFormatVersion: 1,
      entities: merged.entities,
      events: merged.events,
      assertions: merged.assertions,
      relations: merged.relations,
      overrides: merged.overrides,
      materials,
      dependencies: merged.dependencies,
      chapters: list(run.input.allChapters),
      gaps: { critical: run.blockingGaps, nonCritical: run.nonBlockingGaps },
      manifest: {
        model: run.settings?.model || "",
        roleVersions: Object.fromEntries(this.roleRegistry.list().map((role) => [role.id, role.version])),
        workflow: { id: run.workflow.id, version: run.workflow.version }
      }
    });
    run.generationId = published.generationId;
    run.result = { generationId: published.generationId };
  }

  entityCandidates(navigator, extracts, unification) {
    const source = [
      ...list(unification.entities),
      ...list(navigator.entityCandidates),
      ...extracts.flatMap((result) => list(result.mentions))
    ];
    const map = new Map();
    for (const item of source) {
      const id = recordIdentifier(item);
      const name = String(item.canonicalName || item.name || item.label || id).trim();
      if (!id && !name) continue;
      const key = String(item.candidateId || item.entityId || name).toLowerCase();
      const previous = map.get(key) || {};
      map.set(key, {
        ...previous,
        ...item,
        id: String(item.candidateId || item.entityId || previous.id || key),
        title: name,
        canonicalName: name,
        type: item.type || previous.type || "character",
        evidenceRefs: [...list(previous.evidenceRefs), ...list(item.evidenceRefs)]
      });
    }
    return Array.from(map.values());
  }

  relationPairs(extracts) {
    const map = new Map();
    for (const relation of extracts.flatMap((result) => list(result.relationChanges))) {
      const subjectId = String(relation.subjectId || relation.subject || "");
      const objectId = String(relation.objectId || relation.object || "");
      if (!subjectId || !objectId || subjectId === objectId) continue;
      const key = [subjectId, objectId].sort().join("::");
      if (!map.has(key)) map.set(key, { id: key, title: `${subjectId}—${objectId}`, subjectId, objectId });
    }
    return Array.from(map.values());
  }

  mergeImportResults(run, data) {
    const entities = data.entityResolution.entities.filter((entity) => list(entity.evidenceRefs).length > 0);
    const entityMap = new Map(data.entityResolution.aliasMap);
    const formalEntityIds = new Set(entities.map((entity) => entity.id));
    for (const entity of entities) {
      entityMap.set(entity.id, entity.id);
      entityMap.set(entity.canonicalName, entity.id);
      list(entity.aliases).forEach((alias) => entityMap.set(alias, entity.id));
    }
    const resolveEntity = (value) => entityMap.get(String(value || "")) || String(value || "");
    const events = [];
    const eventMap = new Map();
    const timelineEvents = list(data.timeline?.events);
    let eventIndex = 0;
    data.extracts.forEach((extract, extractIndex) => {
      const extractChapter = run.chapters.find((chapter) =>
        String(chapter.id || chapter.chapterId || "") === String(extract._chapterId || "")
      ) || run.chapters[extractIndex];
      list(extract.events).forEach((raw, index) => {
        eventIndex += 1;
        const chapterId = raw.chapterId || raw.evidenceRefs?.[0]?.chapterId || extract._chapterId || extractChapter?.id || "chapter";
        const baseKey = raw.candidateId || raw.id || `${raw.type}|${raw.summary || raw.action}|${index}`;
        const timelineEvent = timelineEvents.find((item) =>
          String(item.eventId || item.id || item.candidateId || "") === String(raw.id || raw.candidateId || baseKey)
        );
        const id = `event-${safeFileName(chapterId)}-${sha256(baseKey).slice(0, 12)}-${index + 1}`;
        const event = {
          ...raw,
          id,
          eventId: id,
          type: raw.type || "event",
          chapterId,
          sceneId: raw.sceneId || "",
          storyTime: raw.storyTime || timelineEvent?.storyTime || null,
          narrativeOrder: timelineEvent?.narrativeOrder ?? raw.narrativeOrder ?? extract._chapterIndex ?? extractChapter?.index ?? null,
          narrativeIndex: extract._chapterIndex ?? extractChapter?.index ?? timelineEvent?.narrativeOrder ?? null,
          flashback: Boolean(timelineEvent?.flashback ?? raw.flashback),
          timeUncertain: Boolean(timelineEvent?.uncertain ?? raw.timeUncertain),
          participantIds: list(raw.participantIds || raw.participants).map(resolveEntity).filter((value) => formalEntityIds.has(value)),
          locationId: resolveEntity(raw.locationId),
          cause: raw.cause || "",
          action: raw.action || raw.summary || "",
          result: raw.result || "",
          impacts: raw.impacts || {},
          confidence: raw.confidence || "explicit",
          evidenceRefs: list(raw.evidenceRefs)
        };
        events.push(event);
        for (const key of [raw.id, raw.candidateId, baseKey]) if (key) eventMap.set(String(key), id);
      });
    });
    for (const track of list(data.characterStates)) {
      const entityId = resolveEntity(track.characterId || track.entityId || track.id);
      const entity = entities.find((item) => item.id === entityId);
      if (!entity) continue;
      entity.states = list(track.states).map((state) => ({
        ...state,
        sourceEventIds: list(state.sourceEventIds).map((eventId) => eventMap.get(String(eventId)) || String(eventId))
      }));
      entity.currentState = [...entity.states].reverse().find((state) => !state.validTo) || entity.states.at(-1) || null;
    }
    const addDerivedEntity = (raw, type, fallbackName) => {
      const canonicalName = String(raw.title || raw.name || raw.storylineId || raw.id || fallbackName);
      const id = `${type}-${sha256(`${run.projectId}|${canonicalName}`).slice(0, 20)}`;
      const eventEvidence = list(raw.events || raw.sourceEventIds)
        .map((eventId) => events.find((event) => event.id === (eventMap.get(String(eventId)) || eventId)))
        .flatMap((event) => list(event?.evidenceRefs));
      const evidenceRefs = [...list(raw.evidenceRefs), ...eventEvidence];
      if (!evidenceRefs.length) return;
      if (entities.some((entity) => entity.id === id)) return;
      entities.push({
        id,
        type,
        canonicalName,
        aliases: [],
        firstSeen: evidenceRefs[0]?.chapterId || "",
        lastSeen: evidenceRefs.at(-1)?.chapterId || "",
        status: raw.status || (type === "storyline" ? "active" : "open"),
        confidence: raw.confidence || "inferred",
        summary: raw.currentState || raw.summary || "",
        evidenceRefs
      });
      entityMap.set(String(raw.id || raw.storylineId || canonicalName), id);
      entityMap.set(canonicalName, id);
    };
    data.storylineTracks.forEach((raw, index) => {
      const navigation = list(data.navigator.storylines).find((item) =>
        String(item.id || item.storylineId) === String(raw.id || raw.storylineId)
      );
      addDerivedEntity({ ...raw, title: raw.title || navigation?.title }, "storyline", `故事线 ${index + 1}`);
    });
    data.hookTracks.flatMap((raw) => list(raw.hooks).length ? list(raw.hooks) : [raw])
      .forEach((raw, index) => addDerivedEntity(raw, "hook", `伏笔 ${index + 1}`));
    const assertionMap = new Map();
    const rawAssertions = [
      ...data.extracts.flatMap((result) => list(result.assertions)).map((raw) => ({ raw, priority: 1 })),
      ...data.knowledgeTracks.flatMap((result) => list(result.assertions)).map((raw) => ({ raw, priority: 2 }))
    ];
    const explicitTruth = (value) => {
      const normalized = String(value || "").trim().toLowerCase();
      return ["true", "false", "known_true", "known_false", "真", "假", "是", "否"].includes(normalized)
        ? normalized
        : "";
    };
    const mergeEvidenceRefs = (left, right) => {
      const seen = new Set();
      return [...list(left), ...list(right)].filter((ref) => {
        const key = [ref?.type, ref?.overrideId, ref?.chapterId, ref?.sourcePath, ref?.paragraphHash, ref?.occurrenceIndex ?? 0]
          .map((item) => String(item || "")).join("|");
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    rawAssertions.forEach(({ raw, priority }) => {
      const proposition = raw.proposition || raw.content || raw.statement || "";
      const rawPropositionId = String(raw.propositionId || "");
      const propositionId = rawPropositionId
        ? rawPropositionId.split("::").at(-1)
        : `proposition-${sha256(proposition).slice(0, 20)}`;
      const scope = raw.scope || "WORLD";
      const holderId = scope === "WORLD" ? null : resolveEntity(raw.holderId);
      const validFrom = raw.validFrom || raw.evidenceRefs?.[0]?.chapterId || null;
      const key = [propositionId || String(proposition).trim().replace(/\s+/g, " "), scope, holderId || "WORLD", validFrom || ""]
        .map(String).join("|");
      const normalized = {
        ...raw,
        id: raw.id || `assertion-${sha256(key).slice(0, 20)}`,
        propositionId,
        proposition,
        scope,
        holderId,
        validFrom,
        validTo: raw.validTo || null,
        acquiredByEventId: eventMap.get(String(raw.acquiredByEventId || "")) || raw.acquiredByEventId || null,
        invalidatedByEventId: eventMap.get(String(raw.invalidatedByEventId || "")) || raw.invalidatedByEventId || null,
        truthStatus: raw.truthStatus || (scope === "WORLD" ? "true" : "unknown"),
        evidenceRefs: list(raw.evidenceRefs),
        _sourcePriority: priority
      };
      const previous = assertionMap.get(key);
      if (!previous) {
        assertionMap.set(key, normalized);
        return;
      }
      const previousTruth = explicitTruth(previous.truthStatus);
      const nextTruth = explicitTruth(normalized.truthStatus);
      if (previousTruth && nextTruth && previousTruth !== nextTruth) {
        throw new Error(`同一人物认知命题存在真值冲突：${proposition || propositionId}`);
      }
      const preferred = priority >= previous._sourcePriority ? normalized : previous;
      assertionMap.set(key, {
        ...previous,
        ...preferred,
        evidenceRefs: mergeEvidenceRefs(previous.evidenceRefs, normalized.evidenceRefs),
        _sourcePriority: Math.max(previous._sourcePriority, priority)
      });
    });
    const assertions = [...assertionMap.values()].map(({ _sourcePriority, ...assertion }) => assertion);
    const relationSources = data.relationTracks.length
      ? data.relationTracks.flatMap((track) => list(track.stages).map((stage) => ({ ...stage, subjectId: track.subjectId, objectId: track.objectId })))
      : data.extracts.flatMap((result) => list(result.relationChanges));
    const relations = relationSources.map((raw, index) => {
      const subjectId = resolveEntity(raw.subjectId || raw.subject);
      const objectId = resolveEntity(raw.objectId || raw.object);
      const sourceEventIds = list(raw.sourceEventIds).map((id) => eventMap.get(String(id)) || String(id));
      return {
        ...raw,
        id: raw.id || `relation-${sha256(`${subjectId}|${objectId}|${raw.type}|${raw.validFrom || ""}|${index}`).slice(0, 20)}`,
        relationId: raw.relationId || raw.id || `relation-${sha256(`${subjectId}|${objectId}|${raw.type}|${raw.validFrom || ""}|${index}`).slice(0, 20)}`,
        subjectId,
        objectId,
        type: raw.type || "related",
        baseCategory: raw.baseCategory || "action",
        validFrom: raw.validFrom || raw.evidenceRefs?.[0]?.chapterId || null,
        validTo: raw.validTo ?? null,
        storyTimeFrom: raw.storyTimeFrom || null,
        storyTimeTo: raw.storyTimeTo || null,
        narrativeFrom: raw.narrativeFrom || raw.validFrom || null,
        narrativeTo: raw.narrativeTo || raw.validTo || null,
        status: raw.status || "active",
        strength: ["弱", "一般", "强"].includes(raw.strength) ? raw.strength : null,
        scope: raw.scope || "WORLD",
        holderId: raw.holderId ? resolveEntity(raw.holderId) : null,
        sourceEventIds,
        evidenceRefs: list(raw.evidenceRefs)
      };
    }).filter((item) => entities.some((entity) => entity.id === item.subjectId) && entities.some((entity) => entity.id === item.objectId));
    const dependencies = {};
    for (const chapter of run.chapters) {
      dependencies[chapter.id] = {
        sourcePath: chapter.path,
        eventIds: events.filter((item) => item.chapterId === chapter.id).map((item) => item.id),
        entityIds: Array.from(new Set(events.filter((item) => item.chapterId === chapter.id).flatMap((item) => item.participantIds))),
        relationIds: relations.filter((item) => item.evidenceRefs.some((ref) => ref.chapterId === chapter.id)).map((item) => item.id),
        assertionIds: assertions.filter((item) => item.evidenceRefs.some((ref) => ref.chapterId === chapter.id)).map((item) => item.id)
      };
    }
    return { entities, events, assertions, relations, overrides: [], dependencies };
  }

  materialsFromResult(merged, result, extras) {
    const materials = { ...(result?.materials || {}) };
    if (!materials["STYLE.md"]) {
      const style = extras.styleResults?.[0]?.style;
      materials["STYLE.md"] = `# 文风\n\n${typeof style === "string" ? style : style?.summary || "尚未整理。"}\n`;
    }
    if (!materials["outline/stages/current.md"]) {
      const last = merged.events.at(-1);
      materials["outline/stages/current.md"] = `# 当前阶段\n\n${last?.summary || last?.action || "尚未整理。"}\n`;
    }
    if (!materials["memory/hooks.md"]) materials["memory/hooks.md"] = "# 伏笔与未决事项\n\n尚未整理。\n";
    for (const entity of merged.entities.filter((item) => item.type === "character" || item.type === "人物")) {
      const file = `characters/${safeFileName(entity.canonicalName, entity.id)}.md`;
      const currentState = entity.currentState || list(entity.states).at(-1);
      const details = currentState
        ? [currentState.location && `- 所在位置：${currentState.location}`, currentState.physical && `- 身体状态：${currentState.physical}`, currentState.emotional && `- 情绪状态：${currentState.emotional}`, currentState.goal && `- 当前目标：${currentState.goal}`].filter(Boolean).join("\n")
        : "";
      if (!materials[file]) materials[file] = `# ${entity.canonicalName}\n\n- 当前状态：${entity.status}\n${details ? `${details}\n` : ""}`;
    }
    list(extras.storylineTracks).forEach((line, index) => {
      const name = line.title || line.storylineId || `故事线-${index + 1}`;
      const file = `outline/storylines/${safeFileName(name)}.md`;
      if (!materials[file]) materials[file] = `# ${name}\n\n${line.currentState || "尚未整理。"}\n`;
    });
    return materials;
  }

  incrementalChapterIds(run, current) {
    const chapterIds = new Set(run.chapters.map((chapter) => String(chapter.id || chapter.chapterId || "")).filter(Boolean));
    const covered = list(current?.manifest?.coveredChapters);
    const idForPath = new Map(covered.map((chapter) => [String(chapter.sourcePath || chapter.path || "").replace(/\\/g, "/"), String(chapter.chapterId || chapter.id || "")]));
    for (const raw of list(run.input?.deletedChapters)) {
      const directId = raw && typeof raw === "object" ? raw.chapterId || raw.id : "";
      const rawPath = raw && typeof raw === "object" ? raw.sourcePath || raw.path : raw;
      const chapterId = String(directId || idForPath.get(String(rawPath || "").replace(/\\/g, "/")) || "").trim();
      if (chapterId) chapterIds.add(chapterId);
    }
    for (const rawPath of list(run.input?.changedPaths)) {
      const normalized = String(rawPath || "").replace(/\\/g, "/");
      const chapterId = idForPath.get(normalized);
      if (chapterId) chapterIds.add(chapterId);
    }
    return chapterIds;
  }

  prepareIncrementalReplay(run, current) {
    const allChapters = list(run.input?.allChapters)
      .filter((chapter) => chapter && typeof chapter === "object")
      .map((chapter) => ({
        ...chapter,
        id: String(chapter.id || chapter.chapterId || ""),
        path: String(chapter.path || chapter.sourcePath || "").replace(/\\/g, "/")
      }));
    if (!allChapters.length) return;

    const covered = list(current?.manifest?.coveredChapters).map((chapter) => ({
      ...chapter,
      id: String(chapter.chapterId || chapter.id || ""),
      path: String(chapter.sourcePath || chapter.path || "").replace(/\\/g, "/")
    }));
    const numericIndex = (chapter, fallback) => {
      const value = Number(chapter?.index);
      return Number.isFinite(value) ? value : fallback;
    };
    const positions = [];
    const allById = new Map(allChapters.map((chapter, index) => [chapter.id, numericIndex(chapter, index + 1)]));
    const allByPath = new Map(allChapters.map((chapter, index) => [chapter.path, numericIndex(chapter, index + 1)]));
    const coveredById = new Map(covered.map((chapter, index) => [chapter.id, numericIndex(chapter, index + 1)]));
    const coveredByPath = new Map(covered.map((chapter, index) => [chapter.path, numericIndex(chapter, index + 1)]));
    const addPosition = ({ id, path: chapterPath, index }) => {
      const explicit = Number(index);
      const position = Number.isFinite(explicit)
        ? explicit
        : allById.get(String(id || "")) ?? allByPath.get(String(chapterPath || "").replace(/\\/g, "/"))
          ?? coveredById.get(String(id || "")) ?? coveredByPath.get(String(chapterPath || "").replace(/\\/g, "/"));
      if (Number.isFinite(position)) positions.push(position);
    };
    run.chapters.forEach((chapter) => addPosition({
      id: chapter.id || chapter.chapterId,
      path: chapter.path || chapter.sourcePath,
      index: chapter.index
    }));
    list(run.input?.deletedChapters).forEach((chapter) => {
      if (chapter && typeof chapter === "object") addPosition({
        id: chapter.chapterId || chapter.id,
        path: chapter.sourcePath || chapter.path,
        index: chapter.index
      });
      else addPosition({ path: chapter });
    });
    list(run.input?.changedPaths).forEach((chapterPath) => addPosition({ path: chapterPath }));
    if (!positions.length) return;

    const replayFromChapterIndex = Math.min(...positions);
    const suppliedById = new Map(run.chapters.map((chapter) => [String(chapter.id || chapter.chapterId || ""), chapter]));
    const suppliedByPath = new Map(run.chapters.map((chapter) => [String(chapter.path || chapter.sourcePath || "").replace(/\\/g, "/"), chapter]));
    run.chapters = allChapters
      .filter((chapter, index) => numericIndex(chapter, index + 1) >= replayFromChapterIndex)
      .sort((left, right) => numericIndex(left, 0) - numericIndex(right, 0))
      .map((chapter) => ({
        ...chapter,
        ...(suppliedById.get(chapter.id) || suppliedByPath.get(chapter.path) || {})
      }));
    run.input.replayFromChapterIndex = replayFromChapterIndex;
  }

  mergeIncrementalGeneration(run, current, incoming) {
    const changedChapterIds = this.incrementalChapterIds(run, current);
    const touchesChangedChapter = (record) => list(record.evidenceRefs).some((ref) => changedChapterIds.has(ref.chapterId));
    const affectedDependencies = Array.from(changedChapterIds)
      .map((chapterId) => current.manifest.dependencies?.[chapterId])
      .filter(Boolean);
    const affectedEventIds = new Set(affectedDependencies.flatMap((item) => list(item.eventIds)));
    const affectedRelationIds = new Set(affectedDependencies.flatMap((item) => list(item.relationIds)));
    const affectedAssertionIds = new Set(affectedDependencies.flatMap((item) => list(item.assertionIds)));
    const mergeById = (previous, next) => {
      const map = new Map(previous.map((item) => [item.id || item.eventId || item.relationId, item]));
      next.forEach((item) => map.set(item.id || item.eventId || item.relationId, item));
      return Array.from(map.values());
    };
    const events = mergeById(current.events.filter((item) =>
      !affectedEventIds.has(item.id || item.eventId) &&
      !changedChapterIds.has(item.chapterId) &&
      !touchesChangedChapter(item)
    ), incoming.events);
    const assertions = mergeById(current.assertions.filter((item) =>
      !affectedAssertionIds.has(item.id || item.assertionId || item.propositionId) &&
      !affectedEventIds.has(item.acquiredByEventId) &&
      !affectedEventIds.has(item.invalidatedByEventId) &&
      !touchesChangedChapter(item)
    ), incoming.assertions);
    const relations = mergeById(current.relations.filter((item) =>
      !affectedRelationIds.has(item.id || item.relationId) &&
      !list(item.sourceEventIds).some((eventId) => affectedEventIds.has(eventId)) &&
      !touchesChangedChapter(item)
    ), incoming.relations);
    const affectedEntityIds = new Set([
      ...affectedDependencies.flatMap((item) => list(item.entityIds)),
      ...current.entities.filter(touchesChangedChapter).map((item) => item.id)
    ]);
    const incomingEntities = new Map(incoming.entities.map((item) => [item.id, item]));
    const referencedEntityIds = new Set([
      ...events.flatMap((item) => [...list(item.participantIds || item.participants), item.locationId].filter(Boolean)),
      ...relations.flatMap((item) => [item.subjectId, item.objectId, item.holderId].filter(Boolean)),
      ...assertions.flatMap((item) => [item.holderId, ...list(item.subjectIds)].filter(Boolean))
    ]);
    const entities = [];
    for (const previous of current.entities) {
      if (!affectedEntityIds.has(previous.id)) {
        entities.push(previous);
        continue;
      }
      const next = incomingEntities.get(previous.id);
      const previousEvidence = list(previous.evidenceRefs).filter((ref) => !changedChapterIds.has(ref.chapterId));
      const previousStates = list(previous.states).filter((state) =>
        !list(state.sourceEventIds).some((eventId) => affectedEventIds.has(eventId)) &&
        !touchesChangedChapter(state)
      );
      if (next) {
        const evidenceRefs = [...previousEvidence, ...list(next.evidenceRefs)];
        const states = [...previousStates, ...list(next.states)];
        entities.push({
          ...previous,
          ...next,
          aliases: uniqueStrings([...list(previous.aliases), ...list(next.aliases)]),
          evidenceRefs,
          ...(states.length ? { states, currentState: [...states].reverse().find((state) => !state.validTo) || states.at(-1) } : {})
        });
        incomingEntities.delete(previous.id);
        continue;
      }
      if (previousEvidence.length || referencedEntityIds.has(previous.id)) {
        const retained = { ...previous, evidenceRefs: previousEvidence };
        if (previousStates.length) {
          retained.states = previousStates;
          retained.currentState = [...previousStates].reverse().find((state) => !state.validTo) || previousStates.at(-1);
        } else {
          delete retained.states;
          delete retained.currentState;
        }
        entities.push(retained);
      }
    }
    entities.push(...incomingEntities.values());
    const dependencies = { ...(current.manifest.dependencies || {}) };
    changedChapterIds.forEach((chapterId) => delete dependencies[chapterId]);
    Object.assign(dependencies, incoming.dependencies);
    return {
      entities,
      events,
      assertions,
      relations,
      overrides: current.overrides,
      dependencies
    };
  }

  mergeIncrementalMaterials(run, current, previousMaterials, generatedMaterials, merged) {
    const changedChapterIds = this.incrementalChapterIds(run, current);
    const allowed = new Set(["outline/stages/current.md", "memory/hooks.md"]);
    for (const chapterId of changedChapterIds) {
      list(current.manifest.dependencies?.[chapterId]?.materialPaths).forEach((item) => allowed.add(String(item)));
    }
    for (const entity of merged.entities) {
      const affected = list(entity.evidenceRefs).some((ref) => changedChapterIds.has(ref.chapterId));
      if (!affected) continue;
      if (["character", "人物"].includes(entity.type)) {
        allowed.add(`characters/${safeFileName(entity.canonicalName, entity.id)}.md`);
      } else if (["storyline", "故事线"].includes(entity.type)) {
        allowed.add(`outline/storylines/${safeFileName(entity.canonicalName, entity.id)}.md`);
      } else if (["hook", "伏笔"].includes(entity.type)) {
        allowed.add("memory/hooks.md");
      }
    }
    const materials = { ...previousMaterials };
    allowed.forEach((relativePath) => delete materials[relativePath]);
    for (const [relativePath, content] of Object.entries(generatedMaterials)) {
      if (allowed.has(relativePath)) materials[relativePath] = content;
    }
    for (const chapterId of changedChapterIds) {
      const dependency = merged.dependencies?.[chapterId];
      if (dependency) dependency.materialPaths = Array.from(allowed).sort();
    }
    return materials;
  }

  correctionData(current) {
    return {
      entities: cloneValue(current.entities) || [],
      events: cloneValue(current.events) || [],
      assertions: cloneValue(current.assertions) || [],
      relations: cloneValue(current.relations) || [],
      dependencies: cloneValue(current.manifest?.dependencies) || {}
    };
  }

  effectiveCorrectionOverrides(overrides) {
    const records = list(overrides);
    const blocked = new Set(records
      .filter((item) => item.status === "revoked")
      .flatMap((item) => list(item.supersedes))
      .map(String));
    const effective = [];
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index];
      const id = String(record.overrideId || record.id || "");
      if (record.status !== "active" || !id || blocked.has(id)) continue;
      effective.unshift(record);
      list(record.supersedes).forEach((targetId) => blocked.add(String(targetId)));
    }
    return effective;
  }

  findCorrectionRecord(data, collection, recordId) {
    const source = list(data[collection]);
    const requested = String(recordId || "").trim();
    if (!requested) return null;
    return source.find((record) => graphRecordId(record, collection) === requested)
      || source.find((record) => String(record.canonicalName || record.name || "") === requested)
      || source.find((record) => list(record.aliases).map(String).includes(requested))
      || null;
  }

  captureRecordFields(record, fields) {
    const values = {};
    const absent = [];
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(record, field)) values[field] = cloneValue(record[field]);
      else absent.push(field);
    }
    return { values, absent };
  }

  restoreRecordFields(record, snapshot) {
    for (const [field, value] of Object.entries(snapshot?.values || {})) record[field] = cloneValue(value);
    for (const field of list(snapshot?.absent)) delete record[field];
  }

  addOverrideAuthority(record, overrideId) {
    const evidenceRef = {
      type: "author_override",
      sourcePath: "memory/graph/overrides.jsonl",
      overrideId
    };
    const bodyEvidence = list(record.evidenceRefs).some((ref) => (ref?.type || ref?.sourceType) !== "author_override");
    record.evidenceRefs = [
      evidenceRef,
      ...list(record.evidenceRefs).filter((ref) => !(ref?.type === "author_override" && ref.overrideId === overrideId))
    ];
    record.authorOverrideIds = uniqueStrings([...list(record.authorOverrideIds), overrideId]);
    record.authority = "author";
    if (bodyEvidence) record.bodyEvidenceConflict = true;
  }

  applyCorrectionOperation(data, operation, overrideId) {
    const collection = operation.collection;
    if (!Array.isArray(data[collection])) throw new Error(`作者修正使用了未知记录类型：${collection}`);
    if (operation.action === "create") {
      if (this.findCorrectionRecord(data, collection, operation.recordId)) {
        throw new Error(`作者修正试图重复创建记录：${operation.recordId}`);
      }
      const record = cloneValue(operation.record || {});
      this.addOverrideAuthority(record, overrideId);
      data[collection].push(record);
      return;
    }
    const record = this.findCorrectionRecord(data, collection, operation.recordId);
    if (!record) throw new Error(`作者修正目标不存在：${operation.recordId}`);
    Object.assign(record, cloneValue(operation.changes || {}));
    this.addOverrideAuthority(record, overrideId);
  }

  revertCorrectionOperation(data, operation) {
    const collection = operation.collection;
    if (!Array.isArray(data[collection])) return;
    if (operation.action === "create") {
      data[collection] = data[collection].filter((record) => graphRecordId(record, collection) !== operation.recordId);
      return;
    }
    const record = this.findCorrectionRecord(data, collection, operation.recordId);
    if (!record) return;
    this.restoreRecordFields(record, operation.before);
    this.restoreRecordFields(record, operation.metadataBefore);
  }

  restoreBodyEvidenceBaseline(current) {
    const data = this.correctionData(current);
    const effective = this.effectiveCorrectionOverrides(current.overrides);
    for (let overrideIndex = effective.length - 1; overrideIndex >= 0; overrideIndex -= 1) {
      const operations = list(effective[overrideIndex].operations);
      for (let operationIndex = operations.length - 1; operationIndex >= 0; operationIndex -= 1) {
        this.revertCorrectionOperation(data, operations[operationIndex]);
      }
    }
    return data;
  }

  applyEffectiveOverrides(data, overrides) {
    for (const override of this.effectiveCorrectionOverrides(overrides)) {
      const overrideId = String(override.overrideId || override.id || "");
      list(override.operations).forEach((operation) => this.applyCorrectionOperation(data, operation, overrideId));
    }
    return data;
  }

  descriptorsFromAffected(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return [];
    const descriptors = [];
    const fields = {
      entityIds: "entity", entities: "entity", characterIds: "entity", characters: "entity",
      eventIds: "event", events: "event",
      assertionIds: "assertion", assertions: "assertion", knowledgeIds: "assertion",
      relationIds: "relation", relations: "relation",
      storylineIds: "storyline", storylines: "storyline",
      hookIds: "hook", hooks: "hook"
    };
    for (const [field, kind] of Object.entries(fields)) {
      const records = Array.isArray(value[field]) ? value[field] : (value[field] == null ? [] : [value[field]]);
      for (const record of records) {
        descriptors.push(record && typeof record === "object" ? { kind, ...record } : { kind, id: record });
      }
    }
    return descriptors;
  }

  correctionPlan(run, identification) {
    const affected = [
      ...this.descriptorsFromAffected(identification.affected),
      ...this.descriptorsFromAffected(run.input.affected)
    ];
    const candidates = [
      ...list(identification.operations),
      ...list(identification.updates),
      ...list(run.input.operations),
      ...list(run.input.updates),
      ...affected.filter((item) => item && typeof item === "object" && (item.changes || item.patch || item.fields || item.record || item.operation))
    ];
    if (run.input.target && typeof run.input.target === "object") {
      candidates.push({ ...run.input.target, changes: run.input.changes || run.input.patch || run.input.target.changes });
    }
    const seen = new Set();
    const updates = candidates.filter((item) => {
      if (!item || typeof item !== "object") return false;
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return {
      correctionType: normalizeCorrectionKind(
        run.input.correctionType || identification.correctionType || identification.taskType || "author_correction"
      ),
      updates,
      affected
    };
  }

  collectionForCorrectionDescriptor(descriptor, data) {
    const rawKind = descriptor.kind || descriptor.recordType || descriptor.type || descriptor.targetType || "";
    const kind = normalizeCorrectionKind(rawKind);
    if (["entities", "events", "assertions", "relations"].includes(kind)) return { collection: kind, kind };
    if (["storylines", "hooks"].includes(kind)) return { collection: "entities", kind };
    if (kind === "style") return { collection: "", kind };
    const recordId = descriptor.id || descriptor.recordId || descriptor.targetId || descriptor.entityId
      || descriptor.eventId || descriptor.assertionId || descriptor.relationId;
    for (const collection of ["entities", "events", "assertions", "relations"]) {
      if (this.findCorrectionRecord(data, collection, recordId)) return { collection, kind: collection };
    }
    return { collection: "", kind };
  }

  buildCorrectionOperations(data, descriptors, overrideId) {
    const operations = [];
    const protectedFields = new Set([
      "id", "entityId", "eventId", "assertionId", "relationId", "evidenceRefs",
      "authorOverrideIds", "authority", "bodyEvidenceConflict"
    ]);
    for (const descriptor of descriptors) {
      const { collection, kind } = this.collectionForCorrectionDescriptor(descriptor, data);
      if (kind === "style") continue;
      if (!collection) throw new Error("无法确定作者修正指向哪类正式记录。");
      const action = String(descriptor.operation || descriptor.action || "patch").toLowerCase();
      const recordId = String(descriptor.id || descriptor.recordId || descriptor.targetId || descriptor.entityId
        || descriptor.eventId || descriptor.assertionId || descriptor.relationId || "").trim();
      if (action === "create") {
        const record = cloneValue(descriptor.record || descriptor.value || descriptor.changes || descriptor.patch || {});
        const createdId = graphRecordId(record, collection) || recordId;
        if (!createdId) throw new Error("作者修正新增记录缺少稳定编号。");
        if (!graphRecordId(record, collection)) record.id = createdId;
        const operation = { action: "create", collection, kind, recordId: createdId, record };
        this.applyCorrectionOperation(data, operation, overrideId);
        operations.push(operation);
        continue;
      }
      const record = this.findCorrectionRecord(data, collection, recordId);
      if (!record) throw new Error(`无法确定作者修正目标：${recordId || "未提供编号"}`);
      let changes = descriptor.changes || descriptor.patch || descriptor.fields;
      if (!changes && descriptor.field) changes = { [descriptor.field]: descriptor.value };
      changes = changes && typeof changes === "object" && !Array.isArray(changes) ? cloneValue(changes) : {};
      protectedFields.forEach((field) => { delete changes[field]; });
      if (action === "invalidate" && !("status" in changes)) changes.status = "invalidated";
      const changeFields = Object.keys(changes);
      if (!changeFields.length) continue;
      const metadataFields = ["evidenceRefs", "authorOverrideIds", "authority", "bodyEvidenceConflict"];
      const operation = {
        action: "patch",
        collection,
        kind,
        recordId: graphRecordId(record, collection),
        changes,
        before: this.captureRecordFields(record, changeFields),
        metadataBefore: this.captureRecordFields(record, metadataFields)
      };
      this.applyCorrectionOperation(data, operation, overrideId);
      operations.push(operation);
    }
    return operations;
  }

  correctionImpact(data, plan, operations, revokedOverrides = []) {
    const impact = {
      entityIds: new Set(), eventIds: new Set(), assertionIds: new Set(), relationIds: new Set(),
      storylineIds: new Set(), hookIds: new Set(), chapterIds: new Set(), tracks: new Set()
    };
    const addRecord = (collection, record) => {
      if (!record) return;
      const id = graphRecordId(record, collection);
      if (collection === "entities") {
        const type = normalizeCorrectionKind(record.type);
        if (type === "storylines") impact.storylineIds.add(id);
        else if (type === "hooks") impact.hookIds.add(id);
        else impact.entityIds.add(id);
      } else if (collection === "events") impact.eventIds.add(id);
      else if (collection === "assertions") impact.assertionIds.add(id);
      else if (collection === "relations") impact.relationIds.add(id);
      list(record.evidenceRefs).forEach((ref) => { if (ref?.chapterId) impact.chapterIds.add(String(ref.chapterId)); });
    };
    const addDescriptor = (descriptor) => {
      if (typeof descriptor === "string") {
        for (const collection of ["entities", "events", "assertions", "relations"]) {
          const found = this.findCorrectionRecord(data, collection, descriptor);
          if (found) addRecord(collection, found);
        }
        return;
      }
      if (!descriptor || typeof descriptor !== "object") return;
      const { collection, kind } = this.collectionForCorrectionDescriptor(descriptor, data);
      if (kind === "style") impact.tracks.add("style");
      const recordId = descriptor.id || descriptor.recordId || descriptor.targetId || descriptor.entityId
        || descriptor.eventId || descriptor.assertionId || descriptor.relationId;
      if (collection) addRecord(collection, this.findCorrectionRecord(data, collection, recordId));
    };
    list(plan.affected).forEach(addDescriptor);
    list(operations).forEach((operation) => addRecord(operation.collection, this.findCorrectionRecord(data, operation.collection, operation.recordId)));
    list(revokedOverrides).flatMap((override) => list(override.operations)).forEach((operation) => {
      addRecord(operation.collection, this.findCorrectionRecord(data, operation.collection, operation.recordId));
    });

    for (const relation of data.relations) {
      const relationId = graphRecordId(relation, "relations");
      if (impact.relationIds.has(relationId) || impact.entityIds.has(String(relation.subjectId)) || impact.entityIds.has(String(relation.objectId))
        || list(relation.sourceEventIds).some((id) => impact.eventIds.has(String(id)))) {
        impact.relationIds.add(relationId);
        impact.entityIds.add(String(relation.subjectId));
        impact.entityIds.add(String(relation.objectId));
        list(relation.sourceEventIds).forEach((id) => impact.eventIds.add(String(id)));
        list(relation.evidenceRefs).forEach((ref) => { if (ref?.chapterId) impact.chapterIds.add(String(ref.chapterId)); });
      }
    }
    for (const event of data.events) {
      const eventId = graphRecordId(event, "events");
      if (impact.eventIds.has(eventId) || list(event.participantIds).some((id) => impact.entityIds.has(String(id)))) {
        impact.eventIds.add(eventId);
        list(event.participantIds).forEach((id) => impact.entityIds.add(String(id)));
        list(event.evidenceRefs).forEach((ref) => { if (ref?.chapterId) impact.chapterIds.add(String(ref.chapterId)); });
      }
    }
    for (const assertion of data.assertions) {
      const assertionId = graphRecordId(assertion, "assertions");
      if (impact.assertionIds.has(assertionId) || impact.entityIds.has(String(assertion.holderId || ""))
        || impact.eventIds.has(String(assertion.acquiredByEventId || "")) || impact.eventIds.has(String(assertion.invalidatedByEventId || ""))) {
        impact.assertionIds.add(assertionId);
        if (assertion.holderId) impact.entityIds.add(String(assertion.holderId));
        list(assertion.evidenceRefs).forEach((ref) => { if (ref?.chapterId) impact.chapterIds.add(String(ref.chapterId)); });
      }
    }
    for (const [chapterId, dependency] of Object.entries(data.dependencies || {})) {
      const dependencyIds = [
        ...list(dependency.entityIds), ...list(dependency.eventIds), ...list(dependency.assertionIds), ...list(dependency.relationIds)
      ].map(String);
      const affectedIds = new Set([
        ...impact.entityIds, ...impact.eventIds, ...impact.assertionIds, ...impact.relationIds,
        ...impact.storylineIds, ...impact.hookIds
      ]);
      if (dependencyIds.some((id) => affectedIds.has(id))) impact.chapterIds.add(chapterId);
    }
    if (impact.entityIds.size) impact.tracks.add("characters");
    if (impact.eventIds.size) impact.tracks.add("time_status");
    if (impact.relationIds.size) impact.tracks.add("relationships");
    if (impact.assertionIds.size) impact.tracks.add("knowledge");
    if (impact.storylineIds.size) impact.tracks.add("storylines");
    if (impact.hookIds.size) impact.tracks.add("hooks");
    if (plan.correctionType === "style") impact.tracks.add("style");
    return Object.fromEntries(Object.entries(impact).map(([key, value]) => [key, [...value]]));
  }

  correctionReviewTargets(impact) {
    const titles = {
      characters: "人物身份与状态", time_status: "时间、事件结果与人物状态", relationships: "人物行为和关系",
      knowledge: "人物认知边界", storylines: "故事线", hooks: "故事线和伏笔", style: "语言风格"
    };
    return list(impact.tracks).filter((track) => track !== "style").map((track) => ({ id: track, title: titles[track] || track }));
  }

  correctionSubgraph(data, impact) {
    const entityIds = new Set(list(impact.entityIds).map(String));
    const eventIds = new Set(list(impact.eventIds).map(String));
    const assertionIds = new Set(list(impact.assertionIds).map(String));
    const relationIds = new Set(list(impact.relationIds).map(String));
    const storylineIds = new Set(list(impact.storylineIds).map(String));
    const hookIds = new Set(list(impact.hookIds).map(String));
    return {
      entities: list(data.entities).filter((record) => {
        const id = graphRecordId(record, "entities");
        return entityIds.has(id) || storylineIds.has(id) || hookIds.has(id);
      }),
      events: list(data.events).filter((record) => eventIds.has(graphRecordId(record, "events"))),
      assertions: list(data.assertions).filter((record) => assertionIds.has(graphRecordId(record, "assertions"))),
      relations: list(data.relations).filter((record) => relationIds.has(graphRecordId(record, "relations"))),
      overrides: list(data.overrides),
      dependencies: data.dependencies || {}
    };
  }

  correctionMaterialPaths(data, impact) {
    const paths = new Set();
    if (list(impact.tracks).includes("style")) paths.add("STYLE.md");
    if (list(impact.tracks).some((track) => ["characters", "time_status", "relationships", "knowledge", "storylines", "hooks"].includes(track))) {
      paths.add("outline/stages/current.md");
    }
    for (const entity of data.entities) {
      if (list(impact.entityIds).includes(graphRecordId(entity, "entities"))) {
        paths.add(`characters/${safeFileName(entity.canonicalName, entity.id)}.md`);
      }
      if (list(impact.storylineIds).includes(graphRecordId(entity, "entities"))) {
        paths.add(`outline/storylines/${safeFileName(entity.canonicalName, entity.id)}.md`);
      }
    }
    if (list(impact.hookIds).length || list(impact.tracks).includes("hooks")) paths.add("memory/hooks.md");
    return paths;
  }

  async identifyCorrection(run, current, correction) {
    const records = [
      ...current.entities.map((value) => ({ kind: "entities", value: {
        id: value.id,
        type: value.type,
        name: truncateToTokenBudget(value.canonicalName, 64),
        aliases: list(value.aliases).slice(0, 16).map((alias) => truncateToTokenBudget(alias, 48))
      }, source: value })),
      ...current.events.map((value) => ({ kind: "events", value: {
        id: value.id || value.eventId,
        type: value.type,
        participantIds: list(value.participantIds),
        action: truncateToTokenBudget(value.action || value.summary, 128),
        result: truncateToTokenBudget(value.result, 96)
      }, source: value })),
      ...current.assertions.map((value) => ({ kind: "assertions", value: {
        id: value.id || value.assertionId,
        scope: value.scope,
        holderId: value.holderId,
        proposition: truncateToTokenBudget(value.proposition, 144),
        truthStatus: value.truthStatus
      }, source: value })),
      ...current.relations.map((value) => ({ kind: "relations", value: {
        id: value.id || value.relationId,
        subjectId: value.subjectId,
        objectId: value.objectId,
        holderId: value.holderId,
        type: value.type,
        status: value.status
      }, source: value }))
    ];
    const requestedText = `${correction}\n${JSON.stringify(run.input.target || {})}\n${JSON.stringify(run.input.affected || {})}`;
    const matchedEntityIds = new Set(records.filter((record) => record.kind === "entities" &&
      [record.value.id, record.value.name, ...list(record.value.aliases)].some((name) =>
        String(name || "").length >= 2 && requestedText.includes(String(name))
      )
    ).map((record) => String(record.value.id)));
    let selected = records.filter((record) => {
      const recordId = String(record.value.id || "");
      if (recordId && requestedText.includes(recordId)) return true;
      if (record.kind === "entities") return matchedEntityIds.has(String(record.value.id));
      if (record.kind === "events") return list(record.value.participantIds).some((id) => matchedEntityIds.has(String(id)));
      if (record.kind === "assertions") return matchedEntityIds.has(String(record.value.holderId || ""));
      if (record.kind === "relations") return [record.value.subjectId, record.value.objectId, record.value.holderId]
        .some((id) => matchedEntityIds.has(String(id || "")));
      return false;
    });
    if (!selected.length || /撤销|作废|取消.+修正/.test(correction)) selected = records;
    const budget = extractionPayloadBudget(
      run.settings?.contextWindow,
      roleExecutionSettings(run.settings, "R01").maxOutputTokens || 2048
    );
    const batches = partitionByTokenBudget(selected, Math.max(256, Math.floor(budget * 0.68)), (record) => record.value);
    const results = await Promise.all(batches.map((batch, index) => {
      const currentRecordIndex = { entities: [], events: [], assertions: [], relations: [] };
      batch.forEach((record) => currentRecordIndex[record.kind].push(record.value));
      return this.roleJob(run, {
        nodeId: batches.length > 1 ? `identify_${index + 1}` : "identify",
        roleId: "R01",
        required: true,
        target: { id: `correction-index-${index + 1}`, title: batches.length > 1 ? `修正目标索引 ${index + 1}/${batches.length}` : "修正目标" },
        goal: [
          "识别作者修正的精确目标和字段。",
          "除必填字段外，提供 correctionType，并在 affected 或 updates 中用 {kind,id,changes} 描述每个要修改的正式记录。",
          "不得编造正文证据，不得改变稳定编号；无法确定目标时在 risks 中明确说明。"
        ].join(""),
        input: {
          correction,
          requestedTarget: run.input.target || null,
          requestedAffected: run.input.affected || null,
          indexPart: index + 1,
          indexPartCount: batches.length,
          currentRecordIndex
        },
        materials: [{ id: "author-correction", title: "作者原话", content: correction }]
      });
    }));
    const mergeUniqueObjects = (values) => {
      const seen = new Set();
      return values.filter((value) => {
        const key = JSON.stringify(value);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    return {
      taskType: results.find((result) => result.taskType)?.taskType || "author_correction",
      workflowId: "WF03",
      correctionType: results.find((result) => result.correctionType)?.correctionType,
      affected: mergeUniqueObjects(results.flatMap((result) => this.descriptorsFromAffected(result.affected))),
      risks: uniqueStrings(results.flatMap((result) => list(result.risks))),
      operations: mergeUniqueObjects(results.flatMap((result) => list(result.operations))),
      updates: mergeUniqueObjects(results.flatMap((result) => list(result.updates))),
      supersedes: uniqueStrings(results.flatMap((result) => list(result.supersedes))),
      target: results.find((result) => result.target)?.target
    };
  }

  async runCorrectionWorkflow(run) {
    const current = await this.graphStore.readCurrentGeneration(run.workspaceRoot);
    if (!current) throw new Error("项目还没有可修正的正式图谱。");
    const correction = String(run.input.correction || run.input.instruction || "").trim();
    if (!correction) throw new Error("作者修正内容不能为空。");

    await this.setStage(run, "identifying_correction");
    const identification = await this.identifyCorrection(run, current, correction);
    const plan = this.correctionPlan(run, identification);
    const overrideId = `override-${this.randomUUID()}`;
    const revoking = run.input.status === "revoked"
      || normalizeCorrectionKind(identification.correctionType || identification.taskType) === "revoke"
      || /撤销|作废|取消.+修正/.test(correction);
    const activeOverrides = this.effectiveCorrectionOverrides(current.overrides);
    const latestActiveOverride = activeOverrides.at(-1);
    const supersedes = uniqueStrings([
      ...list(run.input.supersedes),
      ...list(identification.supersedes)
    ]);
    if (revoking && !supersedes.length && latestActiveOverride) {
      supersedes.push(latestActiveOverride.overrideId || latestActiveOverride.id);
    }
    if (revoking && !supersedes.length) throw new Error("没有找到可以撤销的作者修正。");
    const override = {
      id: overrideId,
      overrideId,
      target: run.input.target || identification.target || {},
      correctionType: plan.correctionType,
      content: correction,
      supersedes,
      status: revoking ? "revoked" : "active",
      originalText: correction,
      affected: {},
      createdAt: this.timestamp(),
      operations: [],
      evidenceRefs: [{ type: "author_override", sourcePath: "memory/graph/overrides.jsonl", overrideId }]
    };

    await this.setStage(run, "recalculating_correction");
    const baseline = this.restoreBodyEvidenceBaseline(current);
    const nextOverrides = [...cloneValue(current.overrides), override];
    const recalculated = this.applyEffectiveOverrides(baseline, nextOverrides);
    if (!revoking) {
      override.operations = this.buildCorrectionOperations(recalculated, plan.updates, overrideId);
      const styleOnly = plan.correctionType === "style" || plan.updates.some((item) => normalizeCorrectionKind(item.kind || item.type) === "style");
      if (!override.operations.length && !styleOnly) {
        throw new Error("无法确定作者修正要改变的正式记录和字段。");
      }
    }
    const revokedOverrides = current.overrides.filter((item) => supersedes.includes(String(item.overrideId || item.id || "")));
    const impact = this.correctionImpact(recalculated, plan, override.operations, revokedOverrides);
    override.affected = impact;
    const affectedSubgraph = this.correctionSubgraph({ ...recalculated, overrides: nextOverrides }, impact);

    const reviewTargets = this.correctionReviewTargets(impact);
    let checks = [];
    if (reviewTargets.length) {
      await this.setStage(run, "checking_correction", reviewTargets.map((item) => item.title));
      checks = await this.runImportConsistencyChecks(run, {
        extracts: [{
          _chapterId: "author-correction",
          mentions: affectedSubgraph.entities,
          events: affectedSubgraph.events,
          assertions: affectedSubgraph.assertions,
          relationChanges: affectedSubgraph.relations,
          hooks: [], styleSamples: []
        }],
        characterStates: [], relationTracks: [], storylineTracks: [], hookTracks: [], styleResults: [], knowledgeTracks: [],
        reviewContext: {
          correction: truncateToTokenBudget(correction, 256),
          overrideId,
          authorCorrectionPriority: true,
          affectedCounts: Object.fromEntries(Object.entries(impact).map(([key, value]) => [key, list(value).length]))
        }
      }, reviewTargets);
    }
    const issues = checks.flatMap((item) => list(item.issues));
    run.nonBlockingGaps.push(...issues.map((item) =>
      `作者修正冲突：${item.reason || item.message || item.title || item.location || "相关旧正文需要复核"}`
    ));
    override.conflicts = issues;

    await this.setStage(run, "materials");
    const previousMaterials = await this.readCurrentMaterials(current);
    const allowedMaterialPaths = this.correctionMaterialPaths(recalculated, impact);
    const compactPreviousMaterials = Object.fromEntries([...allowedMaterialPaths]
      .filter((relativePath) => previousMaterials[relativePath] != null)
      .map((relativePath) => [relativePath, truncateToTokenBudget(previousMaterials[relativePath], 384)]));
    const materialResult = await this.runImportMaterialGeneration(run, {
      merged: affectedSubgraph,
      timeline: { events: [], uncertainties: [] },
      characterStates: [], storylineTracks: [], hookTracks: [], styleResults: [],
      nodeId: "correction_materials",
      goal: "只根据作者修正后的受影响正式记录，重新生成受影响的可读材料；作者修正优先于旧正文分析结论。",
      context: {
        correction: truncateToTokenBudget(correction, 256),
        revoking,
        authorCorrectionPriority: true,
        affectedCounts: Object.fromEntries(Object.entries(impact).map(([key, value]) => [key, list(value).length])),
        previousMaterials: compactPreviousMaterials
      }
    });
    const generatedMaterials = Object.fromEntries(Object.entries(materialResult.materials || {})
      .filter(([relativePath]) => allowedMaterialPaths.has(relativePath)));
    if (allowedMaterialPaths.size && !Object.keys(generatedMaterials).length) {
      throw new Error("作者修正后没有生成任何受影响的可读材料。");
    }
    const materials = { ...previousMaterials, ...generatedMaterials };

    await this.setStage(run, "publishing");
    const published = await this.graphStore.publishGeneration(run.workspaceRoot, {
      generationId: `generation-${Date.now()}-${this.randomUUID().slice(0, 8)}`,
      projectFormatVersion: 5,
      graphFormatVersion: 1,
      entities: recalculated.entities,
      events: recalculated.events,
      assertions: recalculated.assertions,
      relations: recalculated.relations,
      overrides: nextOverrides,
      materials,
      dependencies: current.manifest.dependencies,
      gaps: {
        critical: list(current.manifest.gaps?.critical),
        nonCritical: [...list(current.manifest.gaps?.nonCritical), ...run.nonBlockingGaps]
      },
      manifest: {
        workflow: { id: run.workflow.id, version: run.workflow.version },
        model: run.settings?.model || "",
        roleVersions: Object.fromEntries(this.roleRegistry.list().map((role) => [role.id, role.version]))
      }
    });
    run.generationId = published.generationId;
    run.result = { override, affected: impact, generationId: published.generationId };
  }

  async readCurrentMaterials(current) {
    const materials = {};
    for (const relativePath of Object.keys(current.manifest.files || {})) {
      if (relativePath === "manifest.json" || relativePath.startsWith("memory/graph/")) continue;
      materials[relativePath] = await fs.readFile(path.join(current.materialsRoot, relativePath), "utf8");
    }
    return materials;
  }

  creativeMaterials(run) {
    return list(run.input.materials)
      .filter((item) => item && typeof item === "object" && String(item.id || "").trim())
      .map((item) => ({ id: String(item.id), title: String(item.title || item.id), content: String(item.content || "") }));
  }

  async selectCreativeMaterials(run, goal) {
    const available = this.creativeMaterials(run);
    await this.setStage(run, "selecting_materials", [run.input.instruction || goal]);
    const selection = await this.roleJob(run, {
      nodeId: "select", roleId: "R14", required: true, goal,
      input: {
        instruction: run.input.instruction || "",
        target: run.input.target || null,
        materialDirectory: available.map((item) => ({ id: item.id, title: item.title }))
      },
      materials: available
    });
    const availableIds = new Set(available.map((item) => item.id));
    const requestedRequired = list(run.input.contextSelection?.materialIds).map(String).filter((id) => availableIds.has(id));
    if (availableIds.has("analysis:writing-context") && !requestedRequired.includes("analysis:writing-context")) {
      requestedRequired.unshift("analysis:writing-context");
    }
    const contextWindow = Math.max(1, Number(run.settings?.contextWindow) || 128000);
    const selected = selectWorkflowMaterials(available, selection, {
      requiredIds: requestedRequired,
      tokenBudget: run.input.contextSelection?.tokenBudget || Math.min(120000, Math.floor(contextWindow * 0.4))
    });
    run.creativeContextSelection = {
      ...(run.input.contextSelection || {}),
      tokenBudget: selected.tokenBudget,
      estimatedTokens: selected.estimatedTokens,
      materialIds: selected.materialIds
    };
    return { selection, ...selected };
  }

  async verifiedQueryCitations(run, citations, selectedMaterialIds) {
    let currentLoaded = false;
    let current = null;
    const loadCurrent = async () => {
      if (currentLoaded) return current;
      currentLoaded = true;
      try { current = await this.graphStore.readCurrentGeneration?.(run.workspaceRoot); }
      catch { current = null; }
      return current;
    };
    const verified = [];
    for (const citation of list(citations)) {
      if (!citation || !selectedMaterialIds.includes(String(citation.materialId || "")) || !isLocatableCitation(citation)) continue;
      try {
        const evidenceRef = citation.evidenceRef && typeof citation.evidenceRef === "object"
          ? citation.evidenceRef
          : null;
        if (evidenceRef?.refId || evidenceRef?.overrideId) {
          const resolved = await this.graphStore.resolveEvidence?.(run.workspaceRoot, evidenceRef.refId || evidenceRef);
          if (!resolved || !["current", "relocated"].includes(resolved.status)) continue;
          verified.push(citation);
          continue;
        }

        const active = await loadCurrent();
        const chapterId = String(evidenceRef?.chapterId || citation.chapterId || "").trim();
        let sourcePath = String(evidenceRef?.sourcePath || citation.sourcePath || "").trim();
        const excerpt = String(evidenceRef?.excerpt || citation.excerpt || "").trim();
        if (active && chapterId) {
          const chapter = list(active.manifest?.coveredChapters).find((item) =>
            String(item.chapterId || item.id || "") === chapterId
          );
          if (!chapter) continue;
          const declaredPath = String(chapter.sourcePath || chapter.path || "").replace(/\\/g, "/");
          if (sourcePath && safeCitationSourcePath(sourcePath) !== declaredPath) continue;
          sourcePath = sourcePath || declaredPath;
        }
        if (!sourcePath || !excerpt || !(await excerptExistsInWorkspace(run.workspaceRoot, sourcePath, excerpt))) continue;
        verified.push(citation);
      } catch {
        // An unresolvable citation is excluded; at least one real location is required below.
      }
    }
    return verified;
  }

  async runCrossBatchPerspectiveReview(run, { perspective, perspectiveIndex, findings, tokenBudget }) {
    const budget = Math.max(512, Math.floor(Number(tokenBudget) || 2000));
    const normalizeFindings = (source) => list(source).flatMap((finding, findingIndex) => {
      const records = [
        ...list(finding?.issues).map((record) => compactReviewRecord(record, "issue")),
        ...list(finding?.observations).map((record) => compactReviewRecord(record, "observation"))
      ];
      const chunks = partitionByTokenBudget(records, Math.max(192, Math.floor(budget * 0.34)), (item) => item);
      return chunks.map((chunk, chunkIndex) => ({
        batchIndex: finding?.batchIndex ?? findingIndex + 1,
        findingPart: chunkIndex + 1,
        materialIds: list(finding?.materialIds).slice(0, 64),
        issues: chunk.filter((item) => item.kind === "issue").map((item) => item.value),
        observations: chunk.filter((item) => item.kind === "observation").map((item) => item.value)
      }));
    });

    let current = normalizeFindings(findings);
    const checks = [];
    for (let level = 1; level <= 12; level += 1) {
      let groups = partitionByTokenBudget(current, Math.max(384, Math.floor(budget * 0.72)), (item) => item);
      if (groups.length >= current.length && current.length > 1) {
        groups = Array.from({ length: Math.ceil(current.length / 2) }, (_, index) => current.slice(index * 2, index * 2 + 2));
      }
      const results = await Promise.all(groups.map((group, groupIndex) => this.roleJob(run, {
        nodeId: `cross_batch_check_${perspectiveIndex + 1}_${level}_${groupIndex + 1}`,
        roleId: "R12",
        required: true,
        target: {
          id: `cross-review-${perspectiveIndex + 1}-${level}-${groupIndex + 1}`,
          title: `${perspective} · 跨分区第 ${level} 层 ${groupIndex + 1}/${groups.length}`
        },
        goal: groups.length === 1
          ? "对本视角的全部分区摘要做最终比较，报告跨分区矛盾；保留已有问题和可核对来源。"
          : "比较本组分区摘要，保留已有问题并在 observations 中输出更短的事实摘要，供下一层继续比较。",
        input: {
          mode: "cross_batch_synthesis",
          level,
          perspective,
          groupIndex: groupIndex + 1,
          groupCount: groups.length,
          batchFindings: group
        }
      })));
      checks.push(...results);
      if (groups.length === 1) return checks;
      for (const result of results) {
        if (!Array.isArray(result.observations)) {
          throw new Error(`跨分区一致性检查缺少事实摘要：${perspective}`);
        }
      }
      current = normalizeFindings(results.map((result, index) => ({
        batchIndex: `level-${level}-${index + 1}`,
        materialIds: groups[index].flatMap((item) => list(item.materialIds)),
        issues: result.issues,
        observations: result.observations
      })));
    }
    throw new Error(`跨分区一致性检查层级过深：${perspective}`);
  }

  async runQueryWorkflow(run) {
    const selected = await this.selectCreativeMaterials(run, "选择回答作者问题所需的最少正式材料。只返回白名单中的材料编号。");
    await this.setStage(run, "answering", selected.materialIds);
    const answered = await this.roleJob(run, {
      nodeId: "answer", roleId: "R16", required: true,
      goal: "只根据选中的正式材料回答作者问题；结论必须能对应到材料编号，不得补写资料中没有的事实。",
      input: {
        question: run.input.instruction || "",
        selectedMaterialIds: selected.materialIds,
        mode: "grounded_answer"
      },
      materials: selected.materials
    });
    const citations = await this.verifiedQueryCitations(run, answered.citations, selected.materialIds);
    if (!citations.length) throw new Error("项目回答缺少可以核对的章节或材料依据。");
    run.result = {
      kind: "answer",
      answer: String(answered.content || "").trim(),
      sources: citations,
      contextSelection: run.creativeContextSelection
    };
  }

  async runReviewWorkflow(run) {
    const selected = await this.selectCreativeMaterials(run, "选择一致性检查所需的正式正文、图谱和作者设定材料。");
    const available = this.creativeMaterials(run);
    const selectedOrder = new Map(selected.materialIds.map((id, index) => [id, index]));
    const ordered = [...available].sort((left, right) =>
      (selectedOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (selectedOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    );
    const batches = batchWorkflowMaterials(ordered, selected.tokenBudget);
    await this.setStage(run, "reviewing", CONSISTENCY_PERSPECTIVES);
    const jobs = [];
    for (let perspectiveIndex = 0; perspectiveIndex < CONSISTENCY_PERSPECTIVES.length; perspectiveIndex += 1) {
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const perspective = CONSISTENCY_PERSPECTIVES[perspectiveIndex];
        jobs.push(this.roleJob(run, {
          nodeId: `checks_${perspectiveIndex + 1}_${batchIndex + 1}`,
          roleId: "R12",
          required: true,
          target: { id: `review-${perspectiveIndex + 1}-${batchIndex + 1}`, title: `${perspective} · ${batchIndex + 1}/${batches.length}` },
          goal: "只报告指定视角和材料分区内有正式资料依据的一致性问题，不修改正文；同时提炼可供跨分区比对的简短事实观察。",
          input: {
            instruction: run.input.instruction || "",
            perspective,
            batchIndex: batchIndex + 1,
            batchCount: batches.length,
            materialIds: batches[batchIndex].map((item) => item.sourceMaterialId || item.id)
          },
          materials: batches[batchIndex]
        }).then((result) => ({
          perspective,
          batchIndex: batchIndex + 1,
          batchCount: batches.length,
          materialIds: batches[batchIndex].map((item) => item.sourceMaterialId || item.id),
          result
        })));
      }
    }
    const partitionFindings = await Promise.all(jobs);
    await this.waitIfPaused(run);
    const checks = partitionFindings.map((item) => item.result);
    let crossBatchChecks = [];
    if (batches.length > 1) {
      for (const finding of partitionFindings) {
        if (!Array.isArray(finding.result?.observations)) {
          throw new Error(`分区一致性检查缺少事实摘要：${finding.perspective} · ${finding.batchIndex}/${finding.batchCount}`);
        }
      }
      await this.setStage(run, "cross_batch_review", CONSISTENCY_PERSPECTIVES);
      const crossBatchBudget = extractionPayloadBudget(
        run.settings?.contextWindow,
        roleExecutionSettings(run.settings, "R12").maxOutputTokens || 4096
      );
      const perspectiveChecks = await Promise.all(CONSISTENCY_PERSPECTIVES.map((perspective, perspectiveIndex) => {
        const findings = partitionFindings
          .filter((item) => item.perspective === perspective)
          .map((item) => ({
            batchIndex: item.batchIndex,
            materialIds: item.materialIds,
            issues: list(item.result?.issues),
            observations: list(item.result?.observations)
          }));
        return this.runCrossBatchPerspectiveReview(run, {
          perspective,
          perspectiveIndex,
          findings,
          tokenBudget: crossBatchBudget
        });
      }));
      crossBatchChecks = perspectiveChecks.flat();
      await this.waitIfPaused(run);
    }
    const programIssues = [];
    if (typeof this.graphStore.auditCurrentGeneration === "function") {
      try {
        await this.graphStore.auditCurrentGeneration(run.workspaceRoot);
      } catch (error) {
        programIssues.push({
          severity: "critical",
          blocking: true,
          perspective: "图谱引用完整性",
          location: "当前关系图谱",
          reason: safeError(error),
          suggestion: "重新分析受影响章节并补齐失效引用。"
        });
      }
    }
    const issues = dedupeIssues([...checks, ...crossBatchChecks, { issues: programIssues }]);
    run.creativeContextSelection = {
      ...(run.creativeContextSelection || {}),
      materialIds: available.map((item) => item.id),
      partitionCount: batches.length
    };
    run.result = {
      kind: "review",
      summary: issues.length ? `发现 ${issues.length} 个需要处理的问题。` : "未发现有正式资料依据的一致性问题。",
      issues: issues.map(taskReviewIssue),
      sources: selected.materialIds,
      contextSelection: run.creativeContextSelection
    };
  }

  async reviewCreativeOutput(run, { nodeId, valueField, value, selected, perspectives = REVIEW_PERSPECTIVES }) {
    const contextWindow = Math.max(8000, Number(run.settings?.contextWindow) || 128000);
    const valueText = typeof value === "string" ? value : JSON.stringify(value);
    const chunkChars = Math.max(2000, Math.floor(contextWindow * 0.3 * 2));
    const chunks = typeof value === "string" && valueText.length > chunkChars
      ? Array.from({ length: Math.ceil(valueText.length / chunkChars) }, (_, index) => valueText.slice(index * chunkChars, (index + 1) * chunkChars))
      : [value];
    const reviews = [];
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const chunk = chunks[chunkIndex];
      const valueTokens = Math.ceil((typeof chunk === "string" ? chunk.length : JSON.stringify(chunk).length) / 2);
      const materialBudget = Math.max(1000, Math.min(
        selected.tokenBudget,
        contextWindow - 4096 - valueTokens - 4000
      ));
      const reviewMaterials = selectWorkflowMaterials(selected.materials, {
        materials: selected.materialIds.map((id, index) => ({ id, priority: index + 1 }))
      }, { tokenBudget: materialBudget });
      if (!reviewMaterials.materials.length && selected.materials.length) {
        throw new Error("候选内容与必要资料超过模型上下文，无法可靠审稿。");
      }
      const chunkReviews = await Promise.all(perspectives.map((title, index) => this.roleJob(run, {
        nodeId: `${nodeId}_${chunkIndex + 1}_${index + 1}`,
        roleId: "R17",
        required: true,
        target: { id: `${nodeId}-${chunkIndex + 1}-${index + 1}`, title },
        goal: "从指定视角检查候选内容，只报告可以定向修改的问题。",
        input: {
          instruction: run.input.instruction || "",
          perspective: title,
          chunkIndex: chunkIndex + 1,
          chunkCount: chunks.length,
          [valueField]: chunk,
          selectedMaterialIds: reviewMaterials.materialIds
        },
        materials: reviewMaterials.materials
      })));
      reviews.push(...chunkReviews);
    }
    await this.waitIfPaused(run);
    return dedupeIssues(reviews);
  }

  creativeChapterIndex(run) {
    const explicit = Number(run.input.target?.chapterIndex);
    if (Number.isInteger(explicit) && explicit > 0) return explicit;
    const recent = list(run.input.recentChapters).map((item) => Number(item?.index)).filter((value) => Number.isInteger(value));
    if (recent.length) return Math.max(...recent) + 1;
    const matched = String(run.input.target?.filePath || "").match(/^chapters\/(\d+)\.md$/);
    if (matched) return Number(matched[1]) + 1;
    return 1;
  }

  async candidateAction(run, relativePath) {
    return await exists(path.join(run.workspaceRoot, ...relativePath.split("/"))) ? "update" : "create";
  }

  async runPlanningWorkflow(run) {
    const selected = await this.selectCreativeMaterials(run, "选择规划下一章所需的人物状态、关系、认知、故事线、伏笔、相邻正文和文风材料。");
    await this.setStage(run, "planning_chapter", selected.materialIds);
    let planned = await this.roleJob(run, {
      nodeId: "plan", roleId: "R15", required: true,
      goal: "生成可直接执行的章节计划，不突破作者设定和人物认知边界。",
      input: { instruction: run.input.instruction || "", target: run.input.target || null, selectedMaterialIds: selected.materialIds },
      materials: selected.materials
    });
    let plan = planned.plan;
    await this.setStage(run, "reviewing_plan", REVIEW_PERSPECTIVES);
    let issues = await this.reviewCreativeOutput(run, { nodeId: "review_plan", valueField: "plan", value: plan, selected });
    if (criticalIssues(issues).length) {
      await this.setStage(run, "revising_plan", ["定向修订"]);
      planned = await this.roleJob(run, {
        nodeId: "revise_plan", roleId: "R15", required: true,
        goal: "只针对审稿指出的严重问题定向修订章节计划一次。",
        input: { instruction: run.input.instruction || "", plan, issues: criticalIssues(issues), selectedMaterialIds: selected.materialIds },
        materials: selected.materials
      });
      plan = planned.plan;
      issues = await this.reviewCreativeOutput(run, { nodeId: "review_revised_plan", valueField: "plan", value: plan, selected });
    }
    const blockers = criticalIssues(issues);
    if (blockers.length) {
      run.result = {
        kind: "conflict",
        title: "章节计划仍有关键冲突",
        conflict: blockers.map((item) => `${item.location || "计划"}：${item.reason}`).join("；"),
        options: ["调整本章目标", "补充作者设定", "缩小本章推进范围"],
        contextSelection: run.creativeContextSelection
      };
      return;
    }
    const chapterIndex = this.creativeChapterIndex(run);
    const relativePath = safeCreativePath(`outline/chapters/${String(chapterIndex).padStart(4, "0")}.md`);
    const content = renderPlanMarkdown(plan, run.input.target?.chapterTitle || `第 ${chapterIndex} 章`);
    run.result = {
      kind: "candidate",
      title: plan.title || `第 ${chapterIndex} 章计划`,
      summary: issues.length ? `计划已通过检查，另有 ${issues.length} 个非关键建议。` : "章节计划已通过多角度检查。",
      changes: [{ path: relativePath, action: await this.candidateAction(run, relativePath), content, reason: "动态章节规划流程生成" }],
      impact: ["章节计划"],
      contextSelection: run.creativeContextSelection
    };
  }

  async runWritingWorkflow(run) {
    const selected = await this.selectCreativeMaterials(run, "选择续写所需的人物状态、关系、认知、故事线、伏笔、相邻正文和文风材料。");
    await this.setStage(run, "planning_chapter", selected.materialIds);
    const planned = await this.roleJob(run, {
      nodeId: "plan", roleId: "R15", required: true,
      goal: "先形成受正式资料约束的本章计划。",
      input: { instruction: run.input.instruction || "", target: run.input.target || null, selectedMaterialIds: selected.materialIds },
      materials: selected.materials
    });
    await this.setStage(run, "writing_chapter", [planned.plan.title || "正文"]);
    let drafted = await this.roleJob(run, {
      nodeId: "write", roleId: "R16", required: true,
      goal: "按章节计划写出可直接保存的完整正文，不修改图谱。",
      input: { instruction: run.input.instruction || "", plan: planned.plan, selectedMaterialIds: selected.materialIds },
      materials: selected.materials
    });
    let content = String(drafted.content || "").trim();
    let issues = [];
    for (let round = 0; round <= 2; round += 1) {
      await this.setStage(run, "reviewing_chapter", REVIEW_PERSPECTIVES);
      issues = await this.reviewCreativeOutput(run, {
        nodeId: `review_chapter_${round}`,
        valueField: "content",
        value: content,
        selected
      });
      const blockers = criticalIssues(issues);
      if (!blockers.length) break;
      if (round === 2) {
        run.result = {
          kind: "conflict",
          title: "正文仍有关键冲突",
          conflict: blockers.map((item) => `${item.location || "正文"}：${item.reason}`).join("；"),
          options: ["调整章节计划后重试", "补充作者设定后重试", "取消本次续写"],
          contextSelection: run.creativeContextSelection
        };
        return;
      }
      await this.setStage(run, "revising_chapter", [`第 ${round + 1} 轮定向修订`]);
      drafted = await this.roleJob(run, {
        nodeId: `revise_chapter_${round + 1}`, roleId: "R16", required: true,
        goal: "只修正上一轮报告的关键问题，保持其余正文不变。",
        input: { instruction: run.input.instruction || "", plan: planned.plan, content, issues: blockers, selectedMaterialIds: selected.materialIds },
        materials: selected.materials
      });
      content = String(drafted.content || "").trim();
    }
    const chapterIndex = this.creativeChapterIndex(run);
    const targetPath = run.input.target?.chapterIndex && /^chapters\/.+\.md$/.test(String(run.input.target?.filePath || ""))
      ? run.input.target.filePath
      : `chapters/${String(chapterIndex).padStart(4, "0")}.md`;
    const relativePath = safeCreativePath(targetPath);
    const chapterTitle = String(planned.plan.title || run.input.target?.chapterTitle || `第 ${chapterIndex} 章`);
    const finalContent = /^#\s+/.test(content) ? `${content}\n` : `# ${chapterTitle}\n\n${content}\n`;
    run.result = {
      kind: "candidate",
      title: chapterTitle,
      summary: issues.length ? `正文已通过检查，另有 ${issues.length} 个非关键建议。` : "正文已通过五个视角检查。",
      changes: [{ path: relativePath, action: await this.candidateAction(run, relativePath), content: finalContent, reason: "动态续写流程生成" }],
      impact: ["正式正文", "写入后自动局部更新图谱"],
      contextSelection: run.creativeContextSelection
    };
  }

  async runLinearWorkflow(run) {
    let previous = run.input;
    for (const node of run.workflow.nodes) {
      if (node.type === "program") continue;
      await this.setStage(run, node.id);
      const targets = node.expand
        ? REVIEW_PERSPECTIVES.map((title, index) => ({ id: `${node.expand}-${index + 1}`, title }))
        : [{ id: node.id, title: node.id }];
      const results = await this.roleBatch(run, {
        nodeId: node.id,
        roleId: node.role,
        required: node.required !== false,
        goal: `执行 ${run.workflow.id} 的 ${node.id} 节点。`,
        input: { previous, request: run.input },
        materials: list(run.input.materials)
      }, targets);
      previous = results.length === 1 ? results[0] : results;
    }
    run.result = previous;
  }

  async pause(runId) {
    const run = this.runs.get(runId);
    if (!run || run.status !== "analyzing") throw new Error("当前分析不能暂停。");
    run.pauseRequested = true;
    await run.pool.pause();
    run.status = "paused";
    await this.persistRun(run);
    return this.publicRun(run);
  }

  async resume(runId) {
    const run = this.runs.get(runId);
    if (!run || run.status !== "paused") throw new Error("当前分析不能继续。");
    run.pauseRequested = false;
    run.status = "analyzing";
    run.pool.resume();
    run.resumeResolver?.();
    await this.persistRun(run);
    await this.event(run, { type: "run_resumed" });
    return this.publicRun(run);
  }

  async cancel(runId) {
    const run = this.runs.get(runId);
    if (!run || TERMINAL.has(run.status)) return run ? this.publicRun(run) : null;
    run.cancelRequested = true;
    run.pauseRequested = false;
    run.resumeResolver?.();
    for (const job of run.jobs.values()) run.pool.cancel(job.id);
    run.status = "cancelled";
    run.stage = "cancelled";
    run.currentItems.clear();
    run.finishedAt = this.timestamp();
    await this.persistRun(run);
    await this.event(run, { type: "run_cancelled" });
    return this.publicRun(run);
  }

  setConcurrency(runId, value) {
    const run = this.runs.get(runId);
    if (!run || TERMINAL.has(run.status)) throw new Error("当前分析不能调整并发。");
    run.maxConcurrency = run.pool.setMaxConcurrency(value).maxConcurrency;
    void this.persistRun(run);
    return this.publicRun(run);
  }
}

module.exports = { AnalysisOrchestrator, REVIEW_PERSPECTIVES, TERMINAL };
