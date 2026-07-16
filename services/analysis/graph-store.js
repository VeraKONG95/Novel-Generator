const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const GRAPH_DIR = "memory/graph";
const GRAPH_FILES = {
  entities: `${GRAPH_DIR}/entities.json`,
  events: `${GRAPH_DIR}/events.jsonl`,
  assertions: `${GRAPH_DIR}/assertions.jsonl`,
  relations: `${GRAPH_DIR}/relations.jsonl`,
  overrides: `${GRAPH_DIR}/overrides.jsonl`,
  graph: `${GRAPH_DIR}/graph.json`
};
const RESERVED_GENERATION_FILES = new Set(["manifest.json", ...Object.values(GRAPH_FILES)]);

function list(value) {
  return Array.isArray(value) ? value : [];
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function jsonContent(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function jsonlContent(value) {
  const records = list(value);
  return records.length ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "";
}

function safeRelativePath(value, label = "文件路径") {
  const source = String(value || "").replace(/\\/g, "/");
  if (!source || source.includes("\0") || path.posix.isAbsolute(source)) {
    throw new Error(`${label}必须是代次目录内的相对路径。`);
  }
  const parts = source.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label}不能越过代次目录。`);
  }
  return parts.join("/");
}

function assertGenerationId(value) {
  const generationId = String(value || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(generationId) || generationId === "." || generationId === "..") {
    throw new Error("代次编号只能包含字母、数字、点、下划线和连字符。");
  }
  return generationId;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function managedDirectory(root, relativePath, { create = false } = {}) {
  const safePath = safeRelativePath(relativePath, "受管目录路径");
  const realRoot = await fs.realpath(root);
  let current = realRoot;
  for (const part of safePath.split("/")) {
    current = path.join(current, part);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      if (!create) return null;
      try {
        await fs.mkdir(current);
      } catch (mkdirError) {
        if (mkdirError?.code !== "EEXIST") throw mkdirError;
      }
      stat = await fs.lstat(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`受管目录不能是文件或链接：${safePath}`);
    }
    const realCurrent = await fs.realpath(current);
    if (realCurrent !== realRoot && !realCurrent.startsWith(`${realRoot}${path.sep}`)) {
      throw new Error(`受管目录越过项目边界：${safePath}`);
    }
  }
  return current;
}

async function writeFileTree(root, relativePath, content) {
  const safePath = safeRelativePath(relativePath);
  const destination = path.join(root, ...safePath.split("/"));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, content, { encoding: "utf8", flag: "wx" });
}

async function readGenerationFile(generationRoot, relativePath) {
  const safePath = safeRelativePath(relativePath, "代次文件路径");
  const rootStat = await fs.lstat(generationRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("当前代次目录不是独立的真实目录。");
  }
  const realGenerationRoot = await fs.realpath(generationRoot);
  const candidate = path.join(generationRoot, ...safePath.split("/"));
  const candidateStat = await fs.lstat(candidate);
  if (candidateStat.isSymbolicLink()) {
    throw new Error(`正式文件越过当前代次目录：${safePath}`);
  }
  const realCandidate = await fs.realpath(candidate);
  if (!realCandidate.startsWith(`${realGenerationRoot}${path.sep}`)) {
    throw new Error(`正式文件越过当前代次目录：${safePath}`);
  }
  if (!candidateStat.isFile()) throw new Error(`正式代次条目不是文件：${safePath}`);
  return await fs.readFile(realCandidate);
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EBADF"].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

async function atomicReplaceFile(destination, content) {
  const directory = path.dirname(destination);
  const tempPath = path.join(directory, `.${path.basename(destination)}-${crypto.randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(tempPath, "wx");
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tempPath, destination);
    await syncDirectory(directory);
  } finally {
    await handle?.close();
    await fs.rm(tempPath, { force: true });
  }
}

function normalizeMaterials(payload) {
  const source = payload.materials ?? payload.readableFiles ?? payload.files ?? {};
  const entries = Array.isArray(source)
    ? source.map((item) => [item?.path, item?.content])
    : Object.entries(source && typeof source === "object" ? source : {});
  const materials = new Map();
  entries.forEach(([rawPath, rawContent]) => {
    const materialPath = safeRelativePath(rawPath, "可读材料路径");
    if (RESERVED_GENERATION_FILES.has(materialPath)) {
      throw new Error(`可读材料不能覆盖系统图谱文件：${materialPath}`);
    }
    const content = rawContent && typeof rawContent === "object" && !Buffer.isBuffer(rawContent)
      ? rawContent.content
      : rawContent;
    materials.set(materialPath, String(content ?? ""));
  });
  if (!materials.has("STYLE.md")) materials.set("STYLE.md", "# 文风\n\n尚未整理。\n");
  if (!materials.has("outline/stages/current.md")) {
    materials.set("outline/stages/current.md", "# 当前阶段\n\n尚未整理。\n");
  }
  if (!materials.has("memory/hooks.md")) materials.set("memory/hooks.md", "# 伏笔与未决事项\n\n尚未整理。\n");
  return materials;
}

function providedRecordId(record, kind) {
  const direct = record?.id || record?.[`${kind}Id`];
  if (direct) return direct;
  if (kind === "assertion" && record?.propositionId) {
    const scope = String(record.scope || "WORLD");
    const holderId = String(record.holderId || "");
    return scope === "WORLD" && !holderId
      ? record.propositionId
      : `${record.propositionId}:${scope}:${holderId || "public"}`;
  }
  return "";
}

function recordId(record, kind, index) {
  return String(providedRecordId(record, kind) || `${kind}-${index + 1}`);
}

function explicitRecordId(record, kind, index) {
  const value = providedRecordId(record, kind);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${kind} 第 ${index + 1} 条记录缺少稳定编号。`);
  }
  return value;
}

function uniqueIds(records, kind) {
  const ids = new Set();
  records.forEach((record, index) => {
    const id = explicitRecordId(record, kind, index);
    if (ids.has(id)) throw new Error(`${kind} 稳定编号重复：${id}`);
    ids.add(id);
  });
  return ids;
}

function validateGraphData(records) {
  const entityIds = uniqueIds(records.entities, "entity");
  const eventIds = uniqueIds(records.events, "event");
  uniqueIds(records.assertions, "assertion");
  uniqueIds(records.relations, "relation");
  uniqueIds(records.overrides, "override");
  records.entities.forEach((entity, index) => {
    const entityId = explicitRecordId(entity, "entity", index);
    if (!Array.isArray(entity.evidenceRefs) || entity.evidenceRefs.length === 0) {
      throw new Error(`正式实体缺少证据：${entityId}`);
    }
    const hasAuthorEvidence = list(entity.evidenceRefs).some((ref) => (ref?.type || ref?.sourceType) === "author_override");
    list(entity.states).forEach((state, stateIndex) => {
      if ((!Array.isArray(state.evidenceRefs) || state.evidenceRefs.length === 0) && !hasAuthorEvidence) {
        throw new Error(`正式人物状态缺少证据：${entityId} #${stateIndex + 1}`);
      }
      const missingEventId = list(state.sourceEventIds).find((eventId) => !eventIds.has(eventId));
      if (missingEventId) throw new Error(`人物状态来源事件不存在：${entityId} -> ${missingEventId}`);
    });
  });
  records.events.forEach((event, index) => {
    const eventId = explicitRecordId(event, "event", index);
    if (!Array.isArray(event.evidenceRefs) || event.evidenceRefs.length === 0) {
      throw new Error(`正式事件缺少证据：${eventId}`);
    }
  });
  records.assertions.forEach((assertion, index) => {
    const assertionId = explicitRecordId(assertion, "assertion", index);
    if (!Array.isArray(assertion.evidenceRefs) || assertion.evidenceRefs.length === 0) {
      throw new Error(`正式认知记录缺少证据：${assertionId}`);
    }
    if (String(assertion.scope || "WORLD").toUpperCase() !== "WORLD") {
      const holderId = String(assertion.holderId || "").trim();
      if (!holderId) throw new Error(`人物认知记录缺少认知持有人：${assertionId}`);
      if (!entityIds.has(holderId)) throw new Error(`人物认知持有人不存在：${assertionId} -> ${holderId}`);
    }
  });
  records.relations.forEach((relation, index) => {
    const relationId = explicitRecordId(relation, "relation", index);
    if (!entityIds.has(relation.subjectId) || !entityIds.has(relation.objectId)) {
      throw new Error(`关系端点不存在：${relationId}`);
    }
    if (!Array.isArray(relation.evidenceRefs) || relation.evidenceRefs.length === 0) {
      throw new Error(`正式关系缺少证据：${relationId}`);
    }
    if (String(relation.scope || "WORLD").toUpperCase() !== "WORLD") {
      const holderId = String(relation.holderId || "").trim();
      if (!holderId) throw new Error(`人物认知关系缺少认知持有人：${relationId}`);
      if (!entityIds.has(holderId)) throw new Error(`人物认知关系持有人不存在：${relationId} -> ${holderId}`);
    }
    const sourceEventIds = list(relation.sourceEventIds);
    if (relation.origin !== "pre_story" && sourceEventIds.length === 0) {
      throw new Error(`正式关系缺少来源事件：${relationId}`);
    }
    const missingEventId = sourceEventIds.find((eventId) => !eventIds.has(eventId));
    if (missingEventId) throw new Error(`关系来源事件不存在：${relationId} -> ${missingEventId}`);
  });
}

function normalizeParagraph(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function paragraphsIn(content) {
  return String(content || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

async function readChapterEvidenceSource(root, sourcePath) {
  const safePath = safeRelativePath(sourcePath, "证据路径");
  if (!safePath.startsWith("chapters/")) throw new Error(`证据路径必须指向正式正文：${safePath}`);
  const resolvedRoot = await fs.realpath(root);
  const candidate = path.resolve(root, ...safePath.split("/"));
  const lexicalPrefix = `${path.resolve(root)}${path.sep}`;
  if (!candidate.startsWith(lexicalPrefix)) throw new Error(`证据路径越过项目目录：${safePath}`);
  let realCandidate;
  try {
    realCandidate = await fs.realpath(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`证据文件不存在：${safePath}`);
    throw error;
  }
  if (!realCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`证据路径越过项目目录：${safePath}`);
  }
  const stat = await fs.stat(realCandidate);
  if (!stat.isFile()) throw new Error(`证据路径不是文件：${safePath}`);
  return { sourcePath: safePath, content: await fs.readFile(realCandidate, "utf8") };
}

async function validateEvidence(root, records) {
  const sourceCache = new Map();
  const chapterById = new Map();
  const chapterIdByPath = new Map();
  const overrideIds = new Set(records.overrides.map((record, index) => explicitRecordId(record, "override", index)));
  const collections = [
    ["entity", records.entities],
    ["state", records.entities.flatMap((entity, entityIndex) => list(entity.states)
      .filter((state) => list(state.evidenceRefs).length)
      .map((state, stateIndex) => ({
        ...state,
        id: `${explicitRecordId(entity, "entity", entityIndex)}:state:${stateIndex + 1}`
      })))],
    ["event", records.events],
    ["assertion", records.assertions],
    ["relation", records.relations],
    ["override", records.overrides]
  ];

  for (const [kind, collection] of collections) {
    for (let recordIndex = 0; recordIndex < collection.length; recordIndex += 1) {
      const record = collection[recordIndex];
      const id = explicitRecordId(record, kind, recordIndex);
      for (let evidenceIndex = 0; evidenceIndex < list(record.evidenceRefs).length; evidenceIndex += 1) {
        const ref = record.evidenceRefs[evidenceIndex];
        if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
          throw new Error(`证据格式无效：${kind} ${id}`);
        }
        const evidenceType = ref.type || ref.sourceType;
        if (evidenceType === "author_override") {
          const overrideId = String(ref.overrideId || "");
          const overridePath = safeRelativePath(ref.sourcePath || GRAPH_FILES.overrides, "证据路径");
          if (overridePath !== GRAPH_FILES.overrides || !overrideIds.has(overrideId)) {
            throw new Error(`作者修正证据不存在：${overrideId || id}`);
          }
          continue;
        }

        const chapterId = String(ref.chapterId || "").trim();
        if (!chapterId) throw new Error(`正文证据缺少章节编号：${kind} ${id}`);
        if (!/^[a-f0-9]{64}$/i.test(String(ref.paragraphHash || ""))) {
          throw new Error(`正文证据缺少有效段落指纹：${kind} ${id}`);
        }
        const excerpt = String(ref.excerpt || "").trim();
        if (!excerpt) throw new Error(`正文证据缺少核对摘录：${kind} ${id}`);
        const occurrenceIndex = ref.occurrenceIndex == null ? 0 : Number(ref.occurrenceIndex);
        if (!Number.isInteger(occurrenceIndex) || occurrenceIndex < 0) {
          throw new Error(`正文证据出现次数无效：${kind} ${id}`);
        }

        const safeSourcePath = safeRelativePath(ref.sourcePath, "证据路径");
        let source = sourceCache.get(safeSourcePath);
        if (!source) {
          source = await readChapterEvidenceSource(root, safeSourcePath);
          sourceCache.set(safeSourcePath, source);
        }
        const paragraphs = paragraphsIn(source.content);
        const matchingHashes = paragraphs
          .map((paragraph, index) => ({ paragraph, index }))
          .filter(({ paragraph }) => sha256(normalizeParagraph(paragraph)) === String(ref.paragraphHash).toLowerCase());
        const hashMatch = matchingHashes[occurrenceIndex];
        const excerptMatch = paragraphs.findIndex((paragraph) => paragraph.includes(excerpt));
        if (!hashMatch && excerptMatch < 0) {
          throw new Error(`正文证据已经无法定位：${kind} ${id}`);
        }

        const existingChapter = chapterById.get(chapterId);
        if (existingChapter && existingChapter.sourcePath !== safeSourcePath) {
          throw new Error(`同一章节编号指向多个正文文件：${chapterId}`);
        }
        const existingChapterId = chapterIdByPath.get(safeSourcePath);
        if (existingChapterId && existingChapterId !== chapterId) {
          throw new Error(`同一正文文件使用了多个章节编号：${safeSourcePath}`);
        }
        chapterIdByPath.set(safeSourcePath, chapterId);
        chapterById.set(chapterId, {
          chapterId,
          sourcePath: safeSourcePath,
          contentFingerprint: sha256(source.content)
        });
      }
    }
  }
  return [...chapterById.values()];
}

async function completeCoveredChapters(root, declaredChapters, evidenceChapters) {
  const result = [];
  const byId = new Map();
  const idByPath = new Map();

  const add = (chapter) => {
    const existing = byId.get(chapter.chapterId);
    if (existing) {
      if (existing.sourcePath !== chapter.sourcePath || existing.contentFingerprint !== chapter.contentFingerprint) {
        throw new Error(`章节清单与证据不一致：${chapter.chapterId}`);
      }
      return;
    }
    const existingId = idByPath.get(chapter.sourcePath);
    if (existingId && existingId !== chapter.chapterId) {
      throw new Error(`同一正文文件使用了多个章节编号：${chapter.sourcePath}`);
    }
    byId.set(chapter.chapterId, chapter);
    idByPath.set(chapter.sourcePath, chapter.chapterId);
    result.push(chapter);
  };

  for (const declared of list(declaredChapters)) {
    const chapterId = String(declared?.chapterId || declared?.id || "").trim();
    if (!chapterId) throw new Error("覆盖章节缺少稳定编号。");
    const sourcePath = safeRelativePath(declared?.sourcePath || declared?.path, "章节路径");
    const source = await readChapterEvidenceSource(root, sourcePath);
    const contentFingerprint = sha256(source.content);
    const declaredFingerprint = declared?.contentFingerprint || declared?.fingerprint || declared?.sha256;
    if (declaredFingerprint && declaredFingerprint !== contentFingerprint) {
      throw new Error(`章节内容指纹不匹配：${chapterId}`);
    }
    add({
      ...(declared.index == null ? {} : { index: declared.index }),
      ...(declared.title == null ? {} : { title: declared.title }),
      chapterId,
      sourcePath,
      contentFingerprint
    });
  }
  evidenceChapters.forEach(add);
  return result;
}

function buildGraph(data = {}) {
  const entities = list(data.entities);
  const events = list(data.events);
  const assertions = list(data.assertions);
  const relations = list(data.relations);
  const overrides = list(data.overrides);
  const chapterIndex = {};
  const evidenceIndex = {};
  const chapterPositions = new Map();

  list(data.coveredChapters).forEach((chapter, insertionIndex) => {
    const chapterId = String(chapter?.chapterId || chapter?.id || "").trim();
    if (!chapterId) return;
    const chapterNumber = Number(chapter.index);
    const title = String(chapter.title || "").trim();
    chapterIndex[chapterId] = {
      chapterId,
      ...(Number.isFinite(chapterNumber) ? { index: chapterNumber } : {}),
      ...(title ? { title } : {}),
      sourcePath: String(chapter.sourcePath || chapter.path || ""),
      entityIds: [],
      eventIds: [],
      assertionIds: [],
      relationIds: []
    };
    chapterPositions.set(chapterId, Number.isFinite(chapterNumber) ? chapterNumber : insertionIndex + 1);
  });

  const addEvidence = (recordType, id, refs) => {
    list(refs).forEach((ref, index) => {
      const refId = `${recordType}:${id}:${index}`;
      evidenceIndex[refId] = { refId, recordType, recordId: id, ...ref };
      if (!ref?.chapterId) return;
      const chapter = chapterIndex[ref.chapterId] ||= {
        chapterId: ref.chapterId,
        sourcePath: ref.sourcePath || "",
        entityIds: [],
        eventIds: [],
        assertionIds: [],
        relationIds: []
      };
      const key = `${recordType}Ids`;
      if (chapter[key] && !chapter[key].includes(id)) chapter[key].push(id);
    });
  };

  entities.forEach((entity, index) => addEvidence(
    "entity",
    recordId(entity, "entity", index),
    [...list(entity.evidenceRefs), ...list(entity.states).flatMap((state) => list(state.evidenceRefs))]
  ));
  events.forEach((event, index) => addEvidence("event", recordId(event, "event", index), event.evidenceRefs));
  assertions.forEach((assertion, index) => addEvidence("assertion", recordId(assertion, "assertion", index), assertion.evidenceRefs));
  relations.forEach((relation, index) => addEvidence("relation", recordId(relation, "relation", index), relation.evidenceRefs));
  overrides.forEach((override, index) => addEvidence("override", recordId(override, "override", index), override.evidenceRefs));

  const evidenceBounds = (refs) => {
    const chapterIds = list(refs).map((ref) => String(ref?.chapterId || ""))
      .filter((chapterId) => chapterPositions.has(chapterId));
    if (!chapterIds.length) return {};
    chapterIds.sort((left, right) => chapterPositions.get(left) - chapterPositions.get(right));
    return { firstSeen: chapterIds[0], lastSeen: chapterIds.at(-1) };
  };

  return {
    graphFormatVersion: 1,
    nodes: entities.map((entity, index) => {
      const bounds = evidenceBounds(entity.evidenceRefs);
      return {
        ...entity,
        ...(!entity.firstSeen && bounds.firstSeen ? { firstSeen: bounds.firstSeen } : {}),
        ...(!entity.lastSeen && bounds.lastSeen ? { lastSeen: bounds.lastSeen } : {}),
        id: recordId(entity, "entity", index),
        label: entity.canonicalName || entity.name || recordId(entity, "entity", index)
      };
    }),
    edges: relations.map((relation, index) => ({
      ...relation,
      id: recordId(relation, "relation", index),
      source: relation.subjectId,
      target: relation.objectId
    })),
    chapterIndex,
    evidenceIndex
  };
}

async function verifyGenerationDirectory(generationRoot, manifest) {
  if (!manifest?.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) {
    throw new Error("代次清单缺少文件指纹。");
  }
  for (const requiredPath of Object.values(GRAPH_FILES)) {
    if (!manifest.files[requiredPath]) throw new Error(`代次清单缺少正式图谱文件：${requiredPath}`);
  }
  for (const [relativePath, fingerprint] of Object.entries(manifest.files)) {
    const safePath = safeRelativePath(relativePath, "清单文件路径");
    const content = await readGenerationFile(generationRoot, safePath);
    if (sha256(content) !== fingerprint?.sha256 || content.byteLength !== fingerprint?.bytes) {
      throw new Error(`正式文件指纹不匹配：${safePath}`);
    }
  }
}

async function readPointer(root) {
  const knowledgeRoot = await managedDirectory(root, "knowledge");
  if (!knowledgeRoot) return null;
  const pointerPath = path.join(knowledgeRoot, "CURRENT.json");
  let content;
  try {
    const stat = await fs.lstat(pointerPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("当前图谱指针不能是目录或链接。");
    content = await fs.readFile(pointerPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  let pointer;
  try {
    pointer = JSON.parse(content.toString("utf8"));
  } catch {
    throw new Error("当前图谱指针已损坏。");
  }
  const generationId = assertGenerationId(pointer?.generationId);
  const expectedManifestPath = `knowledge/generations/${generationId}/manifest.json`;
  if (pointer.manifestPath !== expectedManifestPath || !/^[a-f0-9]{64}$/.test(String(pointer.manifestFingerprint || ""))) {
    throw new Error("当前图谱指针包含无效路径或指纹。");
  }
  return { ...pointer, generationId };
}

async function readCurrentGeneration(root) {
  const requestedRoot = path.resolve(root);
  const resolvedRoot = await fs.realpath(requestedRoot);
  const pointer = await readPointer(resolvedRoot);
  if (!pointer) return null;
  const generationsRoot = await managedDirectory(resolvedRoot, "knowledge/generations");
  if (!generationsRoot) throw new Error("当前图谱指向的代次目录不存在。");
  const generationRoot = path.join(generationsRoot, pointer.generationId);
  const manifestContent = await readGenerationFile(generationRoot, "manifest.json");
  if (sha256(manifestContent) !== pointer.manifestFingerprint) {
    throw new Error("当前代次清单指纹不匹配。");
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestContent.toString("utf8"));
  } catch {
    throw new Error("当前代次清单已损坏。");
  }
  if (manifest.generationId !== pointer.generationId) throw new Error("当前代次编号与清单不一致。");
  await verifyGenerationDirectory(generationRoot, manifest);

  const readJson = async (relativePath) => JSON.parse(
    (await readGenerationFile(generationRoot, relativePath)).toString("utf8")
  );
  const readJsonl = async (relativePath) => {
    const content = (await readGenerationFile(generationRoot, relativePath)).toString("utf8");
    return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  };
  return {
    generationId: pointer.generationId,
    pointer,
    manifest,
    entities: await readJson(GRAPH_FILES.entities),
    events: await readJsonl(GRAPH_FILES.events),
    assertions: await readJsonl(GRAPH_FILES.assertions),
    relations: await readJsonl(GRAPH_FILES.relations),
    overrides: await readJsonl(GRAPH_FILES.overrides),
    graph: await readJson(GRAPH_FILES.graph),
    materialsRoot: path.join(requestedRoot, "knowledge", "generations", pointer.generationId)
  };
}

async function readGraph(root) {
  const current = await readCurrentGeneration(root);
  if (!current) return null;
  return { generationId: current.generationId, ...current.graph };
}

async function auditCurrentGeneration(root) {
  const current = await readCurrentGeneration(root);
  if (!current) return { generationId: "", records: 0, evidenceChapters: 0 };
  const records = {
    entities: current.entities,
    events: current.events,
    assertions: current.assertions,
    relations: current.relations,
    overrides: current.overrides
  };
  validateGraphData(records);
  const evidenceChapters = await validateEvidence(path.resolve(root), records);
  return {
    generationId: current.generationId,
    records: records.entities.length + records.events.length + records.assertions.length + records.relations.length,
    evidenceChapters: evidenceChapters.length
  };
}

async function resolveEvidence(root, ref) {
  const current = await readCurrentGeneration(root);
  if (!current) throw new Error("项目还没有正式图谱代次。");
  const graphRef = typeof ref === "string"
    ? current.graph.evidenceIndex?.[ref]
    : (ref?.refId && current.graph.evidenceIndex?.[ref.refId]) || ref;
  if (!graphRef || typeof graphRef !== "object") throw new Error("图谱证据引用不存在。");

  const evidenceType = graphRef.type || graphRef.sourceType;
  if (evidenceType === "author_override") {
    const override = current.overrides.find((record) => (record.overrideId || record.id) === graphRef.overrideId);
    if (!override) throw new Error(`作者修正证据不存在：${graphRef.overrideId || "未知"}`);
    return {
      status: "current",
      generationId: current.generationId,
      sourcePath: GRAPH_FILES.overrides,
      overrideId: graphRef.overrideId,
      content: override
    };
  }

  const chapter = current.manifest.coveredChapters?.find((item) => item.chapterId === graphRef.chapterId);
  const safeSourcePath = safeRelativePath(graphRef.sourcePath, "证据路径");
  if (!chapter || chapter.sourcePath !== safeSourcePath) {
    throw new Error(`证据章节与当前代次清单不一致：${graphRef.chapterId || safeSourcePath}`);
  }
  const source = await readChapterEvidenceSource(path.resolve(root), safeSourcePath);
  const paragraphs = paragraphsIn(source.content);
  const occurrenceIndex = graphRef.occurrenceIndex == null ? 0 : Number(graphRef.occurrenceIndex);
  const hashMatches = paragraphs
    .map((paragraph, index) => ({ paragraph, index }))
    .filter(({ paragraph }) => sha256(normalizeParagraph(paragraph)) === String(graphRef.paragraphHash || "").toLowerCase());
  const hashMatch = hashMatches[occurrenceIndex];
  if (hashMatch) {
    return {
      status: "current",
      generationId: current.generationId,
      sourcePath: safeSourcePath,
      absolutePath: path.join(path.resolve(root), ...safeSourcePath.split("/")),
      chapterId: graphRef.chapterId,
      paragraphStart: hashMatch.index + 1,
      paragraphEnd: hashMatch.index + 1,
      content: hashMatch.paragraph,
      ref: graphRef
    };
  }

  const excerpt = String(graphRef.excerpt || "").trim();
  const excerptIndex = excerpt ? paragraphs.findIndex((paragraph) => paragraph.includes(excerpt)) : -1;
  if (excerptIndex >= 0) {
    return {
      status: "relocated",
      generationId: current.generationId,
      sourcePath: safeSourcePath,
      absolutePath: path.join(path.resolve(root), ...safeSourcePath.split("/")),
      chapterId: graphRef.chapterId,
      paragraphStart: excerptIndex + 1,
      paragraphEnd: excerptIndex + 1,
      content: paragraphs[excerptIndex],
      ref: graphRef
    };
  }
  return {
    status: "stale",
    generationId: current.generationId,
    sourcePath: safeSourcePath,
    absolutePath: path.join(path.resolve(root), ...safeSourcePath.split("/")),
    chapterId: graphRef.chapterId,
    ref: graphRef
  };
}

async function publishGeneration(root, payload = {}, options = {}) {
  const requestedRoot = path.resolve(root);
  const resolvedRoot = await fs.realpath(requestedRoot);
  const generationId = assertGenerationId(
    payload.generationId || `generation-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`
  );
  const current = await readCurrentGeneration(resolvedRoot);
  const knowledgeRoot = await managedDirectory(resolvedRoot, "knowledge", { create: true });
  const generationsRoot = await managedDirectory(resolvedRoot, "knowledge/generations", { create: true });
  const destination = path.join(generationsRoot, generationId);
  if (await fileExists(destination)) throw new Error(`代次已经存在，不能覆盖：${generationId}`);

  const publishId = `publish-${crypto.randomUUID()}`;
  const analysisRoot = await managedDirectory(resolvedRoot, ".noval/analysis", { create: true });
  const runRoot = path.join(analysisRoot, publishId);
  const stagedGeneration = path.join(runRoot, "staging", generationId);
  const records = {
    entities: list(payload.entities),
    events: list(payload.events),
    assertions: list(payload.assertions),
    relations: list(payload.relations),
    overrides: list(payload.overrides)
  };
  validateGraphData(records);
  const evidenceChapters = await validateEvidence(resolvedRoot, records);
  const coveredChapters = await completeCoveredChapters(
    resolvedRoot,
    payload.chapters ?? payload.manifest?.coveredChapters ?? current?.manifest.coveredChapters,
    evidenceChapters
  );
  const graph = buildGraph({ ...records, coveredChapters });
  const materials = normalizeMaterials(payload);
  const contents = new Map([
    [GRAPH_FILES.entities, jsonContent(records.entities)],
    [GRAPH_FILES.events, jsonlContent(records.events)],
    [GRAPH_FILES.assertions, jsonlContent(records.assertions)],
    [GRAPH_FILES.relations, jsonlContent(records.relations)],
    [GRAPH_FILES.overrides, jsonlContent(records.overrides)],
    [GRAPH_FILES.graph, jsonContent(graph)],
    ...materials
  ]);

  try {
    await fs.mkdir(stagedGeneration, { recursive: true });
    for (const [relativePath, content] of contents) {
      await writeFileTree(stagedGeneration, relativePath, content);
    }
    const files = {};
    for (const [relativePath, content] of contents) {
      const bytes = Buffer.byteLength(content);
      files[relativePath] = { sha256: sha256(content), bytes };
    }
    const fileFingerprints = Object.fromEntries(
      Object.entries(files).map(([relativePath, fingerprint]) => [relativePath, fingerprint.sha256])
    );
    const workflowSource = payload.workflow ?? payload.manifest?.workflow;
    const workflow = workflowSource && typeof workflowSource === "object" ? workflowSource : {};
    const manifest = {
      ...(payload.manifest && typeof payload.manifest === "object" ? payload.manifest : {}),
      projectFormatVersion: Number(payload.projectFormatVersion || payload.manifest?.projectFormatVersion || 5),
      graphFormatVersion: Number(payload.graphFormatVersion || payload.manifest?.graphFormatVersion || 1),
      generationId,
      createdAt: String(payload.createdAt || new Date().toISOString()),
      model: payload.model ?? payload.manifest?.model ?? null,
      roleVersions: payload.roleVersions || payload.manifest?.roleVersions || {},
      workflowId: payload.workflowId || workflow.id || payload.manifest?.workflowId || null,
      workflowVersion: payload.workflowVersion || workflow.version || payload.manifest?.workflowVersion || null,
      previousGenerationId: current?.generationId || null,
      coveredChapters,
      dependencies: payload.dependencies || payload.manifest?.dependencies || {},
      gaps: payload.gaps || payload.manifest?.gaps || { critical: [], nonCritical: [] },
      files,
      fileFingerprints
    };
    const manifestContent = jsonContent(manifest);
    await writeFileTree(stagedGeneration, "manifest.json", manifestContent);
    await verifyGenerationDirectory(stagedGeneration, manifest);

    await fs.mkdir(generationsRoot, { recursive: true });
    await fs.rename(stagedGeneration, destination);
    await verifyGenerationDirectory(destination, manifest);
    await syncDirectory(generationsRoot);

    if (typeof options.beforeCurrentSwitch === "function") {
      await options.beforeCurrentSwitch({
        root: resolvedRoot,
        generationId,
        generationRoot: destination,
        previousGenerationId: current?.generationId || null
      });
    }

    const pointer = {
      generationId,
      manifestPath: `knowledge/generations/${generationId}/manifest.json`,
      manifestFingerprint: sha256(manifestContent),
      publishedAt: new Date().toISOString()
    };
    await atomicReplaceFile(path.join(knowledgeRoot, "CURRENT.json"), jsonContent(pointer));
    return await readCurrentGeneration(requestedRoot);
  } finally {
    await fs.rm(runRoot, { recursive: true, force: true });
  }
}

module.exports = { auditCurrentGeneration, buildGraph, publishGeneration, readCurrentGeneration, readGraph, resolveEvidence };
