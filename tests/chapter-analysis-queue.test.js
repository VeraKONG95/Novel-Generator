const { ChapterAnalysisQueue } = require("../services/analysis/chapter-analysis-queue");

describe("chapter analysis queue", () => {
  it("merges changed chapters, waits while creative work is active and starts them exactly once", async () => {
    let blocked = true;
    const starts = [];
    const queue = new ChapterAnalysisQueue({
      isBlocked: async () => blocked,
      start: async (root, paths) => { starts.push({ root, paths }); return { runId: "run-1" }; }
    });
    queue.enqueue("/tmp/noval", ["chapters\\0002.md", "notes.md"]);
    queue.enqueue("/tmp/noval", ["chapters/0002.md", "chapters/0003.md"]);

    expect(await queue.drain("/tmp/noval")).toBeNull();
    expect(starts).toEqual([]);
    blocked = false;
    await expect(queue.drain("/tmp/noval")).resolves.toEqual({ runId: "run-1" });
    expect(starts[0].paths).toEqual(["chapters/0002.md", "chapters/0003.md"]);
    expect(await queue.drain("/tmp/noval")).toBeNull();
  });

  it("keeps paths queued when starting analysis fails", async () => {
    let attempts = 0;
    const queue = new ChapterAnalysisQueue({
      isBlocked: async () => false,
      start: async () => { attempts += 1; if (attempts === 1) throw new Error("busy"); return { runId: "run-2" }; }
    });
    queue.enqueue("/tmp/noval-retry", ["chapters/0004.md"]);
    expect(await queue.drain("/tmp/noval-retry")).toBeNull();
    await expect(queue.drain("/tmp/noval-retry")).resolves.toEqual({ runId: "run-2" });
  });
});
