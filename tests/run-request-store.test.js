const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { buildRunRequest, readRunRequest, writeRunRequest } = require("../services/analysis/run-request-store");

describe("analysis run request store", () => {
  it("persists resumable inputs and chapter fingerprints without secrets or full creative materials", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "noval-run-request-"));
    try {
      const request = buildRunRequest({
        id: "run-1",
        projectId: "project-1",
        workflow: { id: "WF04", version: "1.1.0" },
        category: "creative_task",
        ownerTaskId: "task-1",
        maxConcurrency: 4,
        input: {
          instruction: "为什么？",
          apiKey: "never-store",
          materials: [{ id: "chapter-1", title: "第一章", content: "很长的正文" }]
        },
        chapters: [{ id: "chapter-1", index: 1, title: "开端", path: "chapters/0001.md", content: "正文" }],
        createdAt: "2026-07-16T00:00:00.000Z"
      });
      await writeRunRequest(root, request);
      const stored = await readRunRequest(root, "run-1");

      expect(stored.input.apiKey).toBe("[REDACTED]");
      expect(stored.input.materials).toEqual([{ id: "chapter-1", title: "第一章" }]);
      expect(stored.chapters[0].contentFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(stored)).not.toContain("never-store");
      expect(JSON.stringify(stored)).not.toContain("很长的正文");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
