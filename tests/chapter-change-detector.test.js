const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { detectChangedChapterPaths } = require("../services/analysis/chapter-change-detector");

describe("chapter change detector", () => {
  it("finds added, rewritten and deleted chapters after a missed watcher event", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "noval-chapter-change-"));
    try {
      await fs.mkdir(path.join(root, "chapters"), { recursive: true });
      await fs.writeFile(path.join(root, "chapters", "0001.md"), "改写后的第一章", "utf8");
      await fs.writeFile(path.join(root, "chapters", "0003.md"), "新增第三章", "utf8");
      const oldHash = crypto.createHash("sha256").update("旧第一章").digest("hex");
      const current = { manifest: { coveredChapters: [
        { chapterId: "chapter-1", sourcePath: "chapters/0001.md", contentFingerprint: oldHash },
        { chapterId: "chapter-2", sourcePath: "chapters/0002.md", contentFingerprint: "a".repeat(64) }
      ] } };
      const changed = await detectChangedChapterPaths(root, current, [
        { id: "chapter-1", path: "chapters/0001.md" },
        { id: "chapter-3", path: "chapters/0003.md" }
      ]);
      expect(changed).toEqual(["chapters/0001.md", "chapters/0002.md", "chapters/0003.md"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
