const path = require("node:path");

function estimateMaterialTokens(material) {
  return Math.ceil((String(material?.title || "").length + String(material?.content || "").length) / 2);
}

function batchWorkflowMaterials(materials, tokenBudget) {
  const budget = Math.max(256, Math.floor(Number(tokenBudget) || 12000));
  const pieces = [];
  for (const material of Array.isArray(materials) ? materials : []) {
    const tokens = estimateMaterialTokens(material);
    if (tokens <= budget) {
      pieces.push(material);
      continue;
    }
    const content = String(material?.content || "");
    const charLimit = Math.max(128, budget * 2 - 128 - String(material?.title || "").length);
    for (let offset = 0, part = 1; offset < content.length; offset += charLimit, part += 1) {
      pieces.push({
        ...material,
        id: `${material.id}#part-${part}`,
        title: `${material.title || material.id}（第 ${part} 段）`,
        content: content.slice(offset, offset + charLimit),
        sourceMaterialId: material.id
      });
    }
  }
  const batches = [];
  let current = [];
  let used = 0;
  for (const material of pieces) {
    const tokens = estimateMaterialTokens(material);
    if (current.length && used + tokens > budget) {
      batches.push(current);
      current = [];
      used = 0;
    }
    current.push(material);
    used += tokens;
  }
  if (current.length) batches.push(current);
  return batches.length ? batches : [[]];
}

function selectWorkflowMaterials(available, selection, { requiredIds = [], tokenBudget = 51200 } = {}) {
  const source = Array.isArray(available) ? available : [];
  const byId = new Map(source.map((item) => [String(item?.id || ""), item]).filter(([id]) => id));
  const requested = Array.isArray(selection?.materials) ? selection.materials : [];
  for (const item of requested) {
    if (!byId.has(String(item?.id || ""))) throw new Error(`材料编号不在本次白名单中：${item?.id || "空"}`);
  }
  for (const id of requiredIds) {
    if (id && !byId.has(String(id))) throw new Error(`必需材料不存在：${id}`);
  }
  const orderedIds = [];
  const addId = (id) => {
    const value = String(id || "");
    if (value && byId.has(value) && !orderedIds.includes(value)) orderedIds.push(value);
  };
  requiredIds.forEach(addId);
  [...requested]
    .sort((left, right) => Number(left?.priority ?? 999) - Number(right?.priority ?? 999))
    .forEach((item) => addId(item.id));
  if (!orderedIds.length && source[0]?.id) addId(source[0].id);

  const required = new Set(requiredIds.map(String));
  const budget = Math.max(1, Math.min(120000, Math.floor(Number(tokenBudget) || 51200)));
  const selected = [];
  let used = 0;
  for (const id of orderedIds) {
    const material = byId.get(id);
    const tokens = estimateMaterialTokens(material);
    if (used + tokens > budget) {
      if (required.has(id)) throw new Error(`必需材料超过本次上下文上限：${id}`);
      continue;
    }
    selected.push(material);
    used += tokens;
  }
  return { materials: selected, materialIds: selected.map((item) => String(item.id)), estimatedTokens: used, tokenBudget: budget };
}

function issueKey(issue) {
  return [issue?.location, issue?.reason, issue?.suggestion].map((item) => String(item || "").trim()).join("|");
}

function dedupeIssues(results) {
  const map = new Map();
  for (const issue of (Array.isArray(results) ? results : []).flatMap((result) => Array.isArray(result?.issues) ? result.issues : [])) {
    const key = issueKey(issue);
    if (!key || key === "||") continue;
    const previous = map.get(key);
    const rank = (value) => ({ critical: 3, 严重: 3, important: 2, 重要: 2, minor: 1, 一般: 1 }[value] || 0);
    if (!previous || rank(issue.severity) > rank(previous.severity)) map.set(key, { ...issue });
  }
  return Array.from(map.values());
}

function criticalIssues(issues) {
  return (Array.isArray(issues) ? issues : []).filter((issue) =>
    issue?.blocking === true || ["critical", "严重"].includes(issue?.severity)
  );
}

function taskReviewIssue(issue) {
  const severity = ["critical", "严重"].includes(issue?.severity)
    ? "严重"
    : ["important", "重要"].includes(issue?.severity) ? "重要" : "一般";
  return {
    location: String(issue?.location || "未标明位置"),
    severity,
    rule: String(issue?.perspective || issue?.rule || "一致性要求"),
    reason: String(issue?.reason || ""),
    suggestion: String(issue?.suggestion || "请按正式资料修正。"),
    ...(issue?.downstreamImpact ? { downstreamImpact: String(issue.downstreamImpact) } : {})
  };
}

function renderPlanMarkdown(plan, fallbackTitle = "下一章") {
  const value = plan && typeof plan === "object" ? plan : {};
  const lines = [
    `# ${String(value.title || fallbackTitle)}`,
    "",
    `- 本章目标：${String(value.goal || "待明确")}`,
    `- 出场人物：${(Array.isArray(value.characters) ? value.characters : []).join("、") || "待明确"}`,
    `- 核心冲突：${(Array.isArray(value.conflicts) ? value.conflicts : []).join("；") || "待明确"}`,
    `- 章末状态：${String(value.endState || "待明确")}`,
    "",
    "## 场景安排",
    ""
  ];
  (Array.isArray(value.scenes) ? value.scenes : []).forEach((scene, index) => {
    lines.push(`### ${index + 1}. ${String(scene?.title || scene?.name || `场景 ${index + 1}`)}`, "");
    for (const [label, field] of [["地点", "location"], ["视角", "perspective"], ["冲突", "conflict"], ["结果", "result"]]) {
      if (scene?.[field]) lines.push(`- ${label}：${String(scene[field])}`);
    }
    lines.push("");
  });
  if (Array.isArray(value.storylineProgress) && value.storylineProgress.length) {
    lines.push("## 故事线推进", "", ...value.storylineProgress.map((item) => `- ${String(item)}`), "");
  }
  if (Array.isArray(value.hooks) && value.hooks.length) {
    lines.push("## 伏笔处理", "", ...value.hooks.map((item) => `- ${String(item)}`), "");
  }
  return `${lines.join("\n").trim()}\n`;
}

function safeCreativePath(value, fallback) {
  const normalized = String(value || fallback || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || path.posix.normalize(normalized) !== normalized || normalized.split("/").some((part) => !part || part === "..")) {
    throw new Error("创作候选文件路径无效。");
  }
  return normalized;
}

module.exports = {
  batchWorkflowMaterials,
  criticalIssues,
  dedupeIssues,
  estimateMaterialTokens,
  renderPlanMarkdown,
  safeCreativePath,
  selectWorkflowMaterials,
  taskReviewIssue
};
