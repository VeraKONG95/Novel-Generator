const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AnalysisOrchestrator } = require("../services/analysis-orchestrator");
const { readCurrentGeneration } = require("../services/analysis/graph-store");
const { estimateConservativeTokens } = require("../services/analysis/chapter-segmentation");

const cleanup = [];

afterEach(async () => {
  while (cleanup.length) await fs.rm(cleanup.pop(), { recursive: true, force: true });
});

function hash(value) {
  return crypto.createHash("sha256").update(String(value).trim().replace(/\s+/g, " ")).digest("hex");
}

describe("budgeted long-book pipeline", () => {
  it("keeps every downstream analysis role bounded while a repeated main character crosses many chapters", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "noval-budgeted-book-"));
    cleanup.push(root);
    await fs.mkdir(path.join(root, "chapters"), { recursive: true });
    const chapters = [];
    const chapterText = new Map();
    for (let index = 1; index <= 12; index += 1) {
      const text = `林默在第${index}章继续追查灯塔。${`第${index}章的线索与行动细节。`.repeat(55)}`;
      const fileName = `${String(index).padStart(4, "0")}.md`;
      await fs.writeFile(path.join(root, "chapters", fileName), `# 第 ${index} 章\n\n${text}\n`, "utf8");
      const chapter = { id: `chapter-${index}`, index, title: `第 ${index} 章`, path: `chapters/${fileName}` };
      chapters.push(chapter);
      chapterText.set(chapter.id, text);
    }

    const callsByRole = new Map();
    const recordCall = (job) => {
      const tokens = estimateConservativeTokens(job.task.input) +
        job.task.materials.reduce((total, material) => total + estimateConservativeTokens(material.content), 0);
      callsByRole.set(job.role.id, [...(callsByRole.get(job.role.id) || []), tokens]);
    };
    const executeJob = async (job) => {
      recordCall(job);
      if (job.role.id === "R02") return {
        entityCandidates: [{ candidateId: "lin", name: "林默", type: "character" }],
        aliasCandidates: [],
        timeStructure: { note: "顺叙", detail: "时间结构摘要。".repeat(180) },
        storylines: [], keyChapters: [], styleSamples: []
      };
      if (job.role.id === "R03") {
        const chapterId = job.task.input.chapterId;
        const evidence = {
          ...job.task.input.evidenceIndex.find((item) => item.paragraphStart === 2),
          chapterId,
          sourcePath: job.task.input.sourcePath
        };
        return {
          mentions: [{ candidateId: "lin", canonicalName: "林默", type: "character", evidenceRefs: [evidence] }],
          events: [{ candidateId: `event-${chapterId}`, type: "investigation", summary: chapterText.get(chapterId), participantIds: ["lin"], evidenceRefs: [evidence] }],
          assertions: [], relationChanges: [], hooks: [], styleSamples: []
        };
      }
      if (job.role.id === "R04") return { decisions: [] };
      if (job.role.id === "R05") return {
        events: job.task.input.events.map((event, index) => ({
          eventId: event.eventId || event.candidateId || event.id,
          narrativeOrder: event.narrativeOrder ?? index + 1,
          storyTime: `第${event.chapterId || index + 1}天`
        })),
        uncertainties: []
      };
      if (job.role.id === "R06") return {
        characterId: job.task.input.target.id,
        states: job.task.input.events.map((event) => ({
          validFrom: event.chapterId,
          goal: "继续追查灯塔",
          sourceEventIds: [event.eventId || event.candidateId || event.id],
          evidenceRefs: event.evidenceRefs
        }))
      };
      if (job.role.id === "R10") return { style: { summary: "克制、连续" } };
      if (job.role.id === "R11") return { characterId: job.task.input.target.id, assertions: [] };
      if (job.role.id === "R12") return { issues: [], observations: [] };
      if (job.role.id === "R13") {
        const positions = (job.task.input.records || []).map((record) => Number(record.narrativePosition) || 0);
        const maxPosition = Math.max(0, ...positions);
        return { materials: {
          "characters/林默.md": "# 林默\n\n当前目标：继续追查灯塔。\n",
          "outline/stages/current.md": maxPosition >= 12
            ? "# 当前阶段\n\n最终：林默已经追到灯塔。\n"
            : "# 当前阶段\n\n早期：林默仍在很远的街巷中反复寻找线索，这段早期说明故意比最终说明更长。\n"
        } };
      }
      throw new Error(`unexpected role ${job.role.id}`);
    };

    const orchestrator = new AnalysisOrchestrator({ executeJob });
    const started = await orchestrator.start({
      workspaceRoot: root,
      projectId: "budgeted-book",
      workflowId: "WF01",
      settings: { model: "fake", contextWindow: 8000, maxOutputTokens: 4096 },
      maxConcurrency: 4,
      chapters
    });
    const completed = await orchestrator.wait(started.runId);
    const current = await readCurrentGeneration(root);

    expect(completed.status).toBe("ready");
    expect(completed.counts.failed).toBe(0);
    expect(current.events).toHaveLength(12);
    expect(current.entities).toHaveLength(1);
    expect(await fs.readFile(path.join(current.materialsRoot, "outline", "stages", "current.md"), "utf8"))
      .toContain("最终：林默已经追到灯塔");
    for (const roleId of ["R04", "R05", "R06", "R11", "R12", "R13"]) {
      expect(callsByRole.get(roleId)?.length).toBeGreaterThan(0);
      expect(Math.max(...callsByRole.get(roleId))).toBeLessThan(4000);
    }
    expect(callsByRole.get("R06").length).toBeGreaterThan(1);
    expect(callsByRole.get("R11").length).toBeGreaterThan(1);
    expect(callsByRole.get("R12").length).toBeGreaterThan(5);
  }, 15000);
});
