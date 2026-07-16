const fs = require("node:fs/promises");
const path = require("node:path");

const REQUIRED_FIELDS = {
  R01: ["taskType", "affected", "risks", "workflowId"],
  R02: ["entityCandidates", "aliasCandidates", "timeStructure", "storylines", "keyChapters", "styleSamples"],
  R03: ["mentions", "events", "assertions", "relationChanges", "hooks", "styleSamples"],
  R04: ["decisions"],
  R05: ["events", "uncertainties"],
  R06: ["characterId", "states"],
  R07: ["subjectId", "objectId", "stages"],
  R08: ["storylineId", "events", "currentState", "openQuestions"],
  R09: ["hooks"],
  R10: ["style"],
  R11: ["characterId", "assertions"],
  R12: ["issues"],
  R13: ["materials"],
  R14: ["materials"],
  R15: ["plan"],
  R16: ["content"],
  R17: ["issues"]
};

const RESULT_GUIDES = {
  R01: "{ taskType, affected: [], risks: [], workflowId }",
  R02: "{ entityCandidates:[{candidateId,name,type,aliases?}], aliasCandidates:[], timeStructure:{}, storylines:[{id,title}], keyChapters:[chapterId], styleSamples:[chapterId] }",
  R03: "{ mentions:[{candidateId,canonicalName,type,aliases?,evidenceRefs}], events:[{candidateId,type,summary,participantIds,cause?,action?,result?,impacts?,confidence,evidenceRefs}], assertions:[{scope,holderId?,proposition,truthStatus,evidenceRefs}], relationChanges:[{subjectId,objectId,type,strength?,sourceEventIds,evidenceRefs}], hooks:[{id,title,status,evidenceRefs}], styleSamples:[{excerpt,evidenceRefs}] }。evidenceRefs 每项包含 sourcePath、chapterId、paragraphHash(规范化段落 SHA-256)、occurrenceIndex、paragraphStart、paragraphEnd、excerpt。",
  R04: "{ decisions:[{leftId,rightId,decision:'merge'|'separate'|'uncertain',evidenceRefs?}], entities?:[{candidateId,canonicalName,type,aliases,evidenceRefs}] }",
  R05: "{ events:[{eventId,storyTime?,narrativeOrder,flashback?,uncertain?}], uncertainties:[] }",
  R06: "{ characterId, states:[{validFrom,validTo?,location?,physical?,emotional?,goal?,resources?,secrets?,sourceEventIds,evidenceRefs}] }",
  R07: "{ subjectId, objectId, stages:[{type,baseCategory?,validFrom,validTo?,status,strength?,scope?,holderId?,sourceEventIds,evidenceRefs}] }",
  R08: "{ storylineId, title?, events:[eventId], currentState, openQuestions:[] }",
  R09: "{ hooks:[{id,title,kind,status,setupEventIds?,payoffEventIds?,evidenceRefs}] }",
  R10: "{ style:{summary,perspective,rhythm,sentencePatterns,wordChoice,dialogue,description,transitions,taboos,examples} }",
  R11: "{ characterId, assertions:[{scope:'KNOWLEDGE'|'BELIEF'|'CLAIM'|'RUMOR'|'UNKNOWN',holderId,proposition,truthStatus,validFrom,validTo?,acquiredByEventId?,invalidatedByEventId?,evidenceRefs}] }",
  R12: "{ issues:[{severity:'critical'|'important'|'minor',blocking:boolean,location,reason,evidenceRefs?}], observations?:[{subject,key,value,chapterId?,sourcePath?,evidenceRefs?}] }。分区检查时 observations 应简短记录可供跨分区比较的身份、状态、时间、认知、关系、故事线和引用事实。",
  R13: "{ materials:{'STYLE.md':完整内容,'characters/人物.md':完整内容,'outline/stages/current.md':完整内容,'outline/storylines/故事线.md':完整内容,'memory/hooks.md':完整内容} }",
  R14: "{ materials:[{kind,id,reason,priority,estimatedTokens}], answer?, sources? }。查询任务还必须提供基于所选材料的 answer 和 sources。",
  R15: "{ plan:{title,goal,scenes,characters,conflicts,storylineProgress,hooks,endState} }",
  R16: "{ content, citations?:[{materialId,chapterId?,sourcePath?,excerpt?,evidenceRef?}] }。查询任务必须逐条给出 citations，正文任务不需要。",
  R17: "{ issues:[{perspective,severity,location,reason,suggestion}] }"
};

function roleSort(a, b) {
  return a.id.localeCompare(b.id);
}

class RoleRegistry {
  constructor({ rolesDir }) {
    this.rolesDir = rolesDir;
    this.roles = new Map();
  }

  async load() {
    const names = (await fs.readdir(this.rolesDir)).filter((name) => /^R\d{2}\.md$/.test(name)).sort();
    const next = new Map();
    for (const name of names) {
      const id = path.basename(name, ".md");
      const prompt = await fs.readFile(path.join(this.rolesDir, name), "utf8");
      const version = prompt.match(/^版本[：:]\s*(\S+)$/m)?.[1] || "1.0.0";
      const title = prompt.match(/^#\s+(.+)$/m)?.[1]?.trim() || id;
      next.set(id, {
        id,
        title,
        version,
        prompt,
        resultGuide: RESULT_GUIDES[id] || "{}",
        requiredFields: REQUIRED_FIELDS[id] || []
      });
    }
    for (const id of Object.keys(REQUIRED_FIELDS)) {
      if (!next.has(id)) throw new Error(`缺少分析角色：${id}`);
    }
    this.roles = next;
    return this.list();
  }

  list() {
    return Array.from(this.roles.values()).sort(roleSort).map((item) => ({ ...item }));
  }

  get(id) {
    const role = this.roles.get(String(id || ""));
    if (!role) throw new Error(`分析角色不在白名单中：${id}`);
    return { ...role };
  }

  validateResult(id, value) {
    const role = this.get(id);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${id} 结果必须是对象。`);
    }
    for (const field of role.requiredFields) {
      if (!(field in value)) throw new Error(`${id} 结果缺少字段：${field}`);
    }
    if (id === "R03") {
      for (const field of ["mentions", "events", "assertions", "relationChanges", "hooks", "styleSamples"]) {
        if (!Array.isArray(value[field])) throw new Error(`${id}.${field} 必须是数组。`);
      }
      for (const record of [...value.events, ...value.assertions, ...value.relationChanges]) {
        if (!Array.isArray(record.evidenceRefs) || !record.evidenceRefs.length) {
          throw new Error("R03 的正式候选必须包含 evidenceRefs。");
        }
      }
    }
    if (id === "R12" && !Array.isArray(value.issues)) throw new Error("R12.issues 必须是数组。");
    if (id === "R12" && value.observations != null && !Array.isArray(value.observations)) {
      throw new Error("R12.observations 必须是数组。");
    }
    if (id === "R14") {
      if (!Array.isArray(value.materials)) throw new Error("R14.materials 必须是数组。");
      for (const material of value.materials) {
        if (!material || typeof material !== "object" || !String(material.id || "").trim()) {
          throw new Error("R14.materials 每项必须包含材料编号。");
        }
      }
    }
    if (id === "R15") {
      if (!value.plan || typeof value.plan !== "object" || Array.isArray(value.plan)) {
        throw new Error("R15.plan 必须是对象。");
      }
      if (!Array.isArray(value.plan.scenes)) throw new Error("R15.plan.scenes 必须是数组。");
    }
    if (id === "R16" && !String(value.content || "").trim()) {
      throw new Error("R16.content 必须是非空正文或回答。");
    }
    if (id === "R16" && value.citations != null && !Array.isArray(value.citations)) {
      throw new Error("R16.citations 必须是数组。");
    }
    if (id === "R17") {
      if (!Array.isArray(value.issues)) throw new Error("R17.issues 必须是数组。");
      const allowedSeverity = new Set(["critical", "important", "minor"]);
      for (const issue of value.issues) {
        if (!allowedSeverity.has(issue?.severity)) throw new Error("R17.issue.severity 无效。");
        for (const field of ["location", "reason", "suggestion"]) {
          if (typeof issue[field] !== "string") throw new Error(`R17.issue.${field} 必须是字符串。`);
        }
      }
    }
    return value;
  }
}

module.exports = { REQUIRED_FIELDS, RESULT_GUIDES, RoleRegistry };
