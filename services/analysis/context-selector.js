function estimateTokens(value) {
  return Math.ceil(JSON.stringify(value || {}).length / 2);
}

function listValues(value) {
  return Array.isArray(value) ? value : [];
}

function numericPosition(value, resolver = {}) {
  if (value == null || value === "") return null;
  if (Number.isFinite(Number(value))) return Number(value);
  if (value && typeof value === "object") {
    if (Number.isFinite(Number(value.chapterIndex))) return Number(value.chapterIndex);
    if (Number.isFinite(Number(value.index))) return Number(value.index);
    for (const field of ["chapterId", "eventId", "id", "storyTime"]) {
      const position = numericPosition(value[field], resolver);
      if (position != null) return position;
    }
  }
  const key = String(value);
  for (const map of [resolver.chapterPositions, resolver.eventPositions, resolver.storyTimePositions]) {
    const position = map?.get(key);
    if (Number.isFinite(position)) return position;
  }
  return null;
}

function hasBoundary(value) {
  return value != null && value !== "";
}

function activeAt(record, chapterIndex, resolver = {}) {
  if (record.status === "ended" && record.validTo == null && record.narrativeTo == null) return false;
  const fromBoundary = record.narrativeFrom ?? record.validFrom ?? record.storyTimeFrom;
  const toBoundary = record.narrativeTo ?? record.validTo ?? record.storyTimeTo;
  const from = numericPosition(fromBoundary, resolver);
  const to = numericPosition(toBoundary, resolver);
  if (hasBoundary(fromBoundary) && from == null) return false;
  if (hasBoundary(toBoundary) && to == null) return false;
  if (from != null && from > chapterIndex) return false;
  if (to != null && to < chapterIndex) return false;
  return !["invalid", "revoked", "deleted"].includes(record.status);
}

function intersects(values, selected) {
  return (Array.isArray(values) ? values : []).some((value) => selected.has(value));
}

function trimToBudget(sections, budget) {
  const result = structuredClone(sections);
  const size = () => estimateTokens(result);
  const removeOldest = (key) => {
    if (!Array.isArray(result[key]) || !result[key].length) return false;
    result[key].pop();
    return true;
  };
  const trimOrder = ["events", "storylines", "hooks", "relationships", "knowledge", "characters"];
  while (size() > budget && trimOrder.some((key) => result[key]?.length)) {
    let changed = false;
    for (const key of trimOrder) {
      if (size() <= budget) break;
      const items = result[key];
      if (!Array.isArray(items) || !items.length) continue;
      const currentSize = size();
      const keep = Math.max(0, Math.min(items.length - 1, Math.floor(items.length * (budget / currentSize) * 0.92)));
      if (keep < items.length) {
        result[key] = items.slice(0, keep);
        changed = true;
      } else {
        changed = removeOldest(key) || changed;
      }
    }
    if (!changed) break;
  }
  while (size() > budget && result.adjacentChapters.length) result.adjacentChapters.shift();
  if (size() > budget && result.style) result.style = result.style.slice(0, Math.max(0, Math.floor(result.style.length / 2)));
  if (size() > budget && result.currentStage) result.currentStage = result.currentStage.slice(0, Math.max(0, Math.floor(result.currentStage.length / 2)));
  return result;
}

function buildPositionResolver(input) {
  const chapterPositions = new Map();
  for (const chapter of Array.isArray(input.chapters) ? input.chapters : []) {
    const index = Number(chapter?.index ?? chapter?.chapterIndex);
    if (!Number.isFinite(index)) continue;
    for (const key of [chapter?.id, chapter?.chapterId, chapter?.path, chapter?.sourcePath]) {
      if (key) chapterPositions.set(String(key), index);
    }
  }
  const eventPositions = new Map();
  const storyTimePositions = new Map();
  for (const event of Array.isArray(input.events) ? input.events : []) {
    let position = numericPosition(event?.narrativeIndex ?? event?.narrativeOrder ?? event?.chapterIndex, { chapterPositions });
    if (position == null) position = numericPosition(event?.chapterId ?? event?.evidenceRefs?.[0]?.chapterId, { chapterPositions });
    if (position == null) continue;
    for (const key of [event?.id, event?.eventId, event?.candidateId]) {
      if (key) eventPositions.set(String(key), position);
    }
    if (event?.storyTime) storyTimePositions.set(String(event.storyTime), position);
  }
  return { chapterPositions, eventPositions, storyTimePositions };
}

function eventPosition(event, resolver) {
  return numericPosition(
    event?.narrativeIndex ?? event?.narrativeOrder ?? event?.chapterIndex ?? event?.chapterId ?? event?.evidenceRefs?.[0]?.chapterId,
    resolver
  );
}

function selectWritingContext(input = {}) {
  const chapterIndex = Number(input.targetChapterIndex) || Number.MAX_SAFE_INTEGER;
  const contextWindow = Math.max(1, Number(input.contextWindow) || 128000);
  const tokenBudget = Math.min(120000, Math.floor(contextWindow * 0.4));
  const entities = Array.isArray(input.entities) ? input.entities : [];
  const resolver = buildPositionResolver(input);
  const relations = (Array.isArray(input.relations) ? input.relations : []).filter((item) => activeAt(item, chapterIndex, resolver));
  const assertions = (Array.isArray(input.assertions) ? input.assertions : []).filter((item) => activeAt(item, chapterIndex, resolver));
  const selected = new Set(Array.isArray(input.targetCharacterIds) ? input.targetCharacterIds : []);
  const goal = String(input.goal || "");
  const adjacentChapters = (Array.isArray(input.chapters) ? input.chapters : [])
    .filter((item) => Number(item.index) < chapterIndex)
    .sort((a, b) => Number(b.index) - Number(a.index))
    .slice(0, 2)
    .reverse();
  const storylines = (Array.isArray(input.storylines) ? input.storylines : []).filter((item) =>
    item.status === "active" || intersects(item.characterIds || item.participantIds, selected)
  );
  const contextText = [
    goal,
    String(input.currentStage || ""),
    ...adjacentChapters.flatMap((chapter) => [chapter.title, chapter.summary, chapter.content]),
    ...storylines.filter((item) => item.status === "active").slice(0, 6).flatMap((item) => [item.title, item.summary, item.currentState])
  ].filter(Boolean).join("\n");
  for (const entity of entities) {
    if (["character", "人物"].includes(entity.type) && entity.canonicalName && contextText.includes(entity.canonicalName)) selected.add(entity.id);
  }
  const eligibleEvents = (Array.isArray(input.events) ? input.events : [])
    .map((event) => ({ event, position: eventPosition(event, resolver) }))
    .filter(({ event, position }) => {
      const hasPosition = hasBoundary(event.narrativeIndex ?? event.narrativeOrder ?? event.chapterIndex ?? event.chapterId ?? event.evidenceRefs?.[0]?.chapterId);
      return (position != null && position <= chapterIndex) || (!hasPosition && position == null);
    })
    .sort((left, right) => (right.position ?? -1) - (left.position ?? -1));
  if (!selected.size) {
    for (const storyline of storylines.filter((item) => item.status === "active").slice(0, 3)) {
      listValues(storyline.characterIds || storyline.participantIds).forEach((id) => selected.add(id));
    }
    for (const { event } of eligibleEvents.slice(0, 8)) {
      listValues(event.participantIds || event.participants).forEach((id) => selected.add(id));
    }
  }
  if (!selected.size) {
    entities
      .filter((entity) => ["character", "人物"].includes(entity.type) && !["dead", "deleted", "invalid"].includes(entity.status))
      .sort((left, right) => (numericPosition(right.lastSeen, resolver) ?? -1) - (numericPosition(left.lastSeen, resolver) ?? -1))
      .slice(0, 4)
      .forEach((entity) => selected.add(entity.id));
  }
  for (const relation of relations) {
    if (selected.has(relation.subjectId)) selected.add(relation.objectId);
    if (selected.has(relation.objectId)) selected.add(relation.subjectId);
  }

  const selectedRelations = relations.filter((item) => selected.has(item.subjectId) && selected.has(item.objectId));
  const selectedKnowledge = assertions.filter((item) =>
    item.scope === "WORLD" || selected.has(item.holderId) || intersects(item.subjectIds, selected)
  );
  const selectedEvents = (Array.isArray(input.events) ? input.events : [])
    .filter((item) => intersects(item.participantIds || item.participants, selected))
    .filter((item) => {
      const position = eventPosition(item, resolver);
      const boundary = item.narrativeIndex ?? item.narrativeOrder ?? item.chapterIndex ?? item.chapterId ?? item.evidenceRefs?.[0]?.chapterId;
      return position != null ? position <= chapterIndex : !hasBoundary(boundary);
    })
    .sort((a, b) => (eventPosition(b, resolver) || 0) - (eventPosition(a, resolver) || 0));
  const hooks = (Array.isArray(input.hooks) ? input.hooks : []).filter((item) =>
    !["resolved", "closed", "invalid"].includes(item.status) &&
    (!item.characterIds || intersects(item.characterIds, selected))
  );
  const overrides = Array.isArray(input.overrides) ? input.overrides : [];
  const revokedOverrideIds = new Set(
    overrides
      .filter((item) => item.status === "revoked")
      .flatMap((item) => Array.isArray(item.supersedes) ? item.supersedes : [])
  );
  const authorOverrides = overrides.filter((item) =>
    item.status === "active" && !revokedOverrideIds.has(item.overrideId || item.id)
  );

  const sections = trimToBudget({
    authorGoal: goal,
    authorOverrides,
    currentStage: String(input.currentStage || ""),
    adjacentChapters,
    characters: entities.filter((item) => selected.has(item.id)),
    knowledge: selectedKnowledge,
    relationships: selectedRelations,
    storylines,
    hooks,
    events: selectedEvents,
    style: String(input.style || "")
  }, tokenBudget);
  return {
    tokenBudget,
    estimatedTokens: estimateTokens(sections),
    selectedEntityIds: Array.from(selected),
    sections
  };
}

module.exports = { activeAt, estimateTokens, selectWritingContext };
