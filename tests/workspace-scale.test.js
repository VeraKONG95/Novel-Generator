const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { createDefaultProject } = require("../services/project-schema");
const { createWorkspace, loadWorkspace, searchWorkspace } = require("../services/workspace-service");

describe("large workspace", () => {
  it("opens and searches a 300 chapter, roughly 1.5 million character novel within the delivery budget", async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "noval-scale-"));
    try {
      const project = createDefaultProject();
      project.title = "长篇压力测试";
      project.chapters = Array.from({ length: 300 }, (_, index) => ({
        id: `chapter-${index + 1}`,
        index: index + 1,
        title: `航标 ${index + 1}`,
        goal: "推进长篇故事",
        summary: `第 ${index + 1} 章摘要`,
        content: `${"海风吹过旧码头。".repeat(555)}${index === 299 ? "唯一检索标记白鲸钟声" : ""}`,
        instruction: "",
        status: "confirmed",
        sections: [],
        updatedAt: new Date().toISOString()
      }));
      const created = await createWorkspace(parent, project);
      const openStarted = performance.now();
      const loaded = await loadWorkspace(created.root);
      const openMs = performance.now() - openStarted;
      expect(loaded.data.chapters).toHaveLength(300);
      expect(openMs).toBeLessThan(5000);

      const searchStarted = performance.now();
      const results = await searchWorkspace(created.root, "白鲸钟声");
      const searchMs = performance.now() - searchStarted;
      expect(results.some((item) => item.path === "chapters/0300.md")).toBe(true);
      expect(searchMs).toBeLessThan(2000);
    } finally {
      await fs.rm(parent, { recursive: true, force: true });
    }
  }, 30000);
});
