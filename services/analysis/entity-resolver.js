const crypto = require("node:crypto");

function stableId(projectId, members) {
  const key = members.map((item) => String(item.id || item.candidateId || item.name || item.canonicalName)).sort().join("|");
  return `entity-${crypto.createHash("sha256").update(`${projectId}|${key}`).digest("hex").slice(0, 20)}`;
}

function resolveEntityClusters({ projectId = "", candidates = [], decisions = [], previousEntities = [] } = {}) {
  const byId = new Map();
  for (const candidate of candidates) {
    const id = String(candidate.id || candidate.candidateId || candidate.entityId || candidate.name || candidate.canonicalName || "");
    if (id) byId.set(id, { ...candidate, id });
  }
  const parent = new Map(Array.from(byId.keys()).map((id) => [id, id]));
  const find = (id) => {
    const current = parent.get(id);
    if (!current) return null;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot && rightRoot && leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  for (const decision of decisions) {
    if (decision.decision === "merge") union(String(decision.leftId), String(decision.rightId));
  }
  const conflicts = [];
  for (const decision of decisions) {
    if (decision.decision !== "separate") continue;
    const leftId = String(decision.leftId);
    const rightId = String(decision.rightId);
    if (find(leftId) && find(leftId) === find(rightId)) {
      conflicts.push({ leftId, rightId, reason: "合并传递关系与禁止合并约束冲突" });
    }
  }
  if (conflicts.length) return { entities: [], aliasMap: new Map(), conflicts };

  const groups = new Map();
  for (const candidate of byId.values()) {
    const root = find(candidate.id);
    groups.set(root, [...(groups.get(root) || []), candidate]);
  }
  const aliasMap = new Map();
  const entities = Array.from(groups.values()).map((members) => {
    const names = Array.from(new Set(members.flatMap((item) => [item.canonicalName, item.name, ...(item.aliases || [])]).filter(Boolean).map(String)));
    const previous = previousEntities.find((entity) =>
      [entity.canonicalName, ...(entity.aliases || [])].some((name) => names.includes(name))
    );
    const id = previous?.id || stableId(projectId, members);
    members.forEach((member) => {
      aliasMap.set(member.id, id);
      if (member.candidateId) aliasMap.set(String(member.candidateId), id);
      if (member.entityId) aliasMap.set(String(member.entityId), id);
    });
    names.forEach((name) => aliasMap.set(name, id));
    const canonicalName = String(members.find((item) => item.canonicalName)?.canonicalName || members[0].name || names[0] || id);
    return {
      id,
      type: members.find((item) => item.type)?.type || previous?.type || "character",
      canonicalName,
      aliases: names.filter((name) => name !== canonicalName),
      firstSeen: members.find((item) => item.firstSeen)?.firstSeen || previous?.firstSeen || "",
      lastSeen: [...members].reverse().find((item) => item.lastSeen)?.lastSeen || previous?.lastSeen || "",
      status: members.find((item) => item.status)?.status || previous?.status || "active",
      confidence: members.find((item) => item.confidence)?.confidence || "explicit",
      evidenceRefs: members.flatMap((item) => item.evidenceRefs || [])
    };
  });
  return { entities, aliasMap, conflicts };
}

module.exports = { resolveEntityClusters };
