const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

function assertRunId(runId) {
  const value = String(runId || "");
  if (!/^run-[A-Za-z0-9._-]+$/.test(value)) throw new Error("分析运行编号无效。");
  return value;
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /^(?:api[-_]?key|access[-_]?token|secret|password)$/i.test(key) ? "[REDACTED]" : redactSecrets(item)
  ]));
}

function chapterMetadata(chapter) {
  const content = String(chapter?.content || chapter?.sourceContent || "");
  return {
    id: String(chapter?.id || ""),
    index: Number(chapter?.index) || 0,
    title: String(chapter?.title || ""),
    path: String(chapter?.path || "").replace(/\\/g, "/"),
    ...(content ? { contentFingerprint: crypto.createHash("sha256").update(content).digest("hex") } : {})
  };
}

function persistedInput(input, category) {
  const clean = redactSecrets(input && typeof input === "object" ? structuredClone(input) : {});
  if (category === "creative_task" && Array.isArray(clean.materials)) {
    clean.materials = clean.materials.map((item) => ({ id: item?.id, title: item?.title }));
  }
  return clean;
}

function buildRunRequest(run) {
  return {
    runId: assertRunId(run.id || run.runId),
    projectId: String(run.projectId || ""),
    workflowId: String(run.workflow?.id || run.workflowId || ""),
    workflowVersion: String(run.workflow?.version || run.workflowVersion || ""),
    category: String(run.category || "project_analysis"),
    ownerTaskId: String(run.ownerTaskId || ""),
    maxConcurrency: Math.max(1, Math.min(8, Number(run.maxConcurrency) || 4)),
    input: persistedInput(run.input, run.category),
    chapters: (Array.isArray(run.chapters) ? run.chapters : []).map(chapterMetadata),
    createdAt: String(run.createdAt || new Date().toISOString())
  };
}

function requestPath(workspaceRoot, runId) {
  return path.join(path.resolve(workspaceRoot), ".noval", "analysis", assertRunId(runId), "request.json");
}

async function writeRunRequest(workspaceRoot, request) {
  const filePath = requestPath(workspaceRoot, request.runId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, `${JSON.stringify(request, null, 2)}\n`, "utf8");
    await fs.rename(temp, filePath);
  } finally {
    await fs.rm(temp, { force: true });
  }
  return request;
}

async function readRunRequest(workspaceRoot, runId) {
  const filePath = requestPath(workspaceRoot, runId);
  const request = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (request.runId !== assertRunId(runId)) throw new Error("分析恢复信息与运行编号不一致。");
  return request;
}

module.exports = { buildRunRequest, readRunRequest, redactSecrets, writeRunRequest };
