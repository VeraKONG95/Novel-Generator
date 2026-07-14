const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createDefaultProject } = require("../services/project-schema");
const {
  assertInside,
  applyWorkspaceChanges,
  createWorkspace,
  createWorkspaceAtPath,
  importNovel,
  loadWorkspace,
  listWorkspaceFiles,
  recoverTransaction,
  saveWorkspace,
  searchWorkspace,
  splitImportedNovel
} = require("../services/workspace-service");

const cleanup = [];

afterEach(async () => {
  while (cleanup.length) await fs.rm(cleanup.pop(), { recursive: true, force: true });
});

async function tempParent() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "noval-workspace-"));
  cleanup.push(dir);
  return dir;
}

describe("workspace service", () => {
  it("creates and reloads an open folder workspace", async () => {
    const parent = await tempParent();
    const project = createDefaultProject();
    project.title = "雾港来信";
    project.agents = "# 创作章程\n\n正文优先。\n";
    project.chapters = [
      {
        id: "chapter-1",
        index: 1,
        title: "第一封信",
        goal: "建立谜团",
        summary: "",
        content: "雨夜里，第一封信抵达。",
        instruction: "",
        status: "confirmed",
        sections: [],
        updatedAt: new Date().toISOString()
      }
    ];

    const created = await createWorkspace(parent, project);
    expect(created.ok).toBe(true);
    expect(await fs.readFile(path.join(created.root, "AGENTS.md"), "utf8")).toContain("正文优先");
    expect(await fs.readFile(path.join(created.root, "chapters", "0001.md"), "utf8")).toContain("第一封信");

    const loaded = await loadWorkspace(created.root);
    expect(loaded.data.title).toBe("雾港来信");
    expect(loaded.data.chapters[0].content).toContain("第一封信抵达");
    expect(loaded.revisions["AGENTS.md"].hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("creates a project at the exact file address chosen by the user", async () => {
    const parent = await tempParent();
    const root = path.join(parent, "my-writing-folder");
    const project = createDefaultProject();
    project.title = "文件地址与作品名可以不同";

    const created = await createWorkspaceAtPath(root, project);

    expect(created.root).toBe(root);
    expect((await loadWorkspace(root)).data.title).toBe(project.title);
    await expect(fs.access(path.join(parent, project.title))).rejects.toThrow();
  });

  it("does not overwrite a non-empty folder when creating by file address", async () => {
    const parent = await tempParent();
    const root = path.join(parent, "already-used");
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, "keep.txt"), "不能覆盖", "utf8");

    await expect(createWorkspaceAtPath(root, createDefaultProject())).rejects.toThrow("不为空");
    expect(await fs.readFile(path.join(root, "keep.txt"), "utf8")).toBe("不能覆盖");
  });

  it("blocks silent overwrite after an external edit", async () => {
    const parent = await tempParent();
    const project = createDefaultProject();
    project.title = "冲突测试";
    const created = await createWorkspace(parent, project);
    const opened = await loadWorkspace(created.root);

    await fs.writeFile(path.join(created.root, "AGENTS.md"), "# 外部修改\n", "utf8");
    const nextProject = { ...opened.data, agents: "# 应用内修改\n" };
    const blocked = await saveWorkspace(created.root, nextProject, {
      expectedRevisions: opened.revisions
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.conflicts.map((item) => item.path)).toContain("AGENTS.md");
    expect(await fs.readFile(path.join(created.root, "AGENTS.md"), "utf8")).toContain("外部修改");

    const forced = await saveWorkspace(created.root, nextProject, {
      expectedRevisions: opened.revisions,
      force: true
    });
    expect(forced.ok).toBe(true);
    expect(await fs.readFile(path.join(created.root, "AGENTS.md"), "utf8")).toContain("应用内修改");
  });

  it("rolls back an interrupted transaction", async () => {
    const parent = await tempParent();
    const root = path.join(parent, "rollback");
    const noval = path.join(root, ".noval");
    await fs.mkdir(path.join(noval, ".backup-test"), { recursive: true });
    await fs.mkdir(path.join(noval, ".stage-test"), { recursive: true });
    await fs.writeFile(path.join(root, "AGENTS.md"), "new", "utf8");
    await fs.writeFile(path.join(noval, ".backup-test", "AGENTS.md"), "old", "utf8");
    await fs.writeFile(
      path.join(noval, "transaction.json"),
      JSON.stringify({ stageDir: ".noval/.stage-test", backupDir: ".noval/.backup-test", completed: ["AGENTS.md"] }),
      "utf8"
    );
    await recoverTransaction(root);
    expect(await fs.readFile(path.join(root, "AGENTS.md"), "utf8")).toBe("old");
  });

  it("rejects paths outside the active workspace", async () => {
    const parent = await tempParent();
    expect(() => assertInside(path.join(parent, "project"), path.join(parent, "secret.txt"))).toThrow(
      "创作空间之外"
    );
  });

  it("splits imported Chinese chapter headings without losing text", () => {
    const chapters = splitImportedNovel("第一段前言\n\n第一章 雨夜\n内容一\n## 第二章 来信\n内容二");
    expect(chapters).toHaveLength(3);
    expect(chapters[1].title).toContain("第一章");
    expect(chapters[2].lines.join("\n")).toContain("内容二");
  });

  it("adopts external edits across formal documents and rebuilds a damaged index", async () => {
    const parent = await tempParent();
    const project = createDefaultProject();
    project.title = "外部编辑";
    project.documents.stagePlan = "# 原阶段\n";
    project.chapters = [{
      id: "chapter-1", index: 1, title: "旧标题", goal: "", summary: "", content: "旧正文", instruction: "",
      status: "confirmed", sections: [], updatedAt: new Date().toISOString()
    }];
    const created = await createWorkspace(parent, project);
    await fs.writeFile(path.join(created.root, "outline", "stages", "current.md"), "# 外部阶段计划\n\n新的阶段转折。\n", "utf8");
    await fs.writeFile(path.join(created.root, "chapters", "0001.md"), "# 第 1 章 新标题\n\n外部正文包含蓝色灯塔。\n", "utf8");
    await fs.writeFile(path.join(created.root, ".noval", "index.json"), "not-json", "utf8");
    const loaded = await loadWorkspace(created.root);
    expect(loaded.data.documents.stagePlan).toContain("外部阶段计划");
    expect(loaded.data.chapters[0]).toMatchObject({ title: "新标题", content: "外部正文包含蓝色灯塔。" });
    const results = await searchWorkspace(created.root, "蓝色灯塔");
    expect(results.some((item) => item.path === "chapters/0001.md")).toBe(true);
  });

  it("records traceable memory changes without erasing earlier history", async () => {
    const parent = await tempParent();
    const project = createDefaultProject();
    project.title = "记忆记录";
    const created = await createWorkspace(parent, project);
    const opened = await loadWorkspace(created.root);
    opened.data.memory.events.push({
      id: "event-1", name: "抵达灯塔", content: "主角抵达灯塔", sourceChapter: 1,
      sourceExcerpt: "灯塔的光掠过海面", updatedAt: new Date().toISOString(), status: "add"
    });
    await saveWorkspace(created.root, opened.data, { expectedRevisions: opened.revisions });
    const log = await fs.readFile(path.join(created.root, "memory", "change-log.jsonl"), "utf8");
    expect(log).toContain("event-1");
    expect(log).toContain("灯塔的光掠过海面");
  });

  it("imports an existing novel as formal chapters and blocks continuation until archive confirmation", async () => {
    const parent = await tempParent();
    const sourcePath = path.join(parent, "已有小说.md");
    await fs.writeFile(sourcePath, "# 第一章 雨夜\n第一章正文\n\n# 第二章 来信\n第二章正文", "utf8");
    const seed = createDefaultProject();
    seed.title = "导入验收";
    const imported = await importNovel(parent, sourcePath, seed);
    const loaded = await loadWorkspace(imported.root);
    expect(loaded.data.importStatus).toBe("needs_archive_confirmation");
    expect(loaded.data.chapters).toHaveLength(2);
    expect(loaded.data.chapters[1].content).toContain("第二章正文");
    expect(await fs.readFile(sourcePath, "utf8")).toContain("第一章正文");
  });

  it("keeps creative content out of the internal manifest and exposes only visible files", async () => {
    const parent = await tempParent();
    const project = createDefaultProject();
    project.title = "文件唯一依据";
    project.blueprint.mainPlot = "主角追查消失的灯塔。";
    const created = await createWorkspace(parent, project);
    const manifest = JSON.parse(await fs.readFile(path.join(created.root, ".noval", "project.json"), "utf8"));
    expect(manifest.project).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toContain("消失的灯塔");
    const files = await listWorkspaceFiles(created.root);
    expect(files.some((item) => item.path === "AGENTS.md")).toBe(true);
    expect(files.some((item) => item.path.startsWith(".noval/"))).toBe(false);
    expect(await fs.readFile(path.join(created.root, "AGENTS.md"), "utf8")).toContain("项目资料索引");
  });

  it("applies multi-file candidates atomically and blocks stale candidates", async () => {
    const parent = await tempParent();
    const created = await createWorkspace(parent, createDefaultProject());
    const opened = await loadWorkspace(created.root);
    const changes = [
      { path: "STYLE.md", action: "create", content: "# 文风\n\n克制、短句。\n" },
      { path: "outline/book.md", action: "update", content: "# 新蓝图\n\n## 主线\n\n灯塔之谜。\n" }
    ];
    const applied = await applyWorkspaceChanges(created.root, changes, { expectedRevisions: opened.revisions });
    expect(applied.ok).toBe(true);
    expect(await fs.readFile(path.join(created.root, "STYLE.md"), "utf8")).toContain("短句");
    expect(await fs.readFile(path.join(created.root, "outline", "book.md"), "utf8")).toContain("灯塔之谜");

    const staleBase = applied.revisions;
    await fs.writeFile(path.join(created.root, "STYLE.md"), "# 外部文风\n", "utf8");
    const blocked = await applyWorkspaceChanges(created.root, [
      { path: "STYLE.md", action: "update", content: "# AI 文风\n" },
      { path: "outline/book.md", action: "update", content: "# 不应写入\n" }
    ], { expectedRevisions: staleBase });
    expect(blocked.ok).toBe(false);
    expect(await fs.readFile(path.join(created.root, "STYLE.md"), "utf8")).toContain("外部文风");
    expect(await fs.readFile(path.join(created.root, "outline", "book.md"), "utf8")).toContain("灯塔之谜");
  });

  it("migrates a legacy manifest without overwriting newer ordinary files", async () => {
    const parent = await tempParent();
    const project = createDefaultProject();
    project.title = "旧项目";
    project.blueprint.mainPlot = "旧副本的主线";
    const created = await createWorkspace(parent, project);
    await fs.writeFile(path.join(created.root, ".noval", "project.json"), JSON.stringify({ workspaceSchemaVersion: 1, project }, null, 2), "utf8");
    await fs.writeFile(path.join(created.root, "outline", "book.md"), "# 外部新蓝图\n\n## 主线\n\n普通文件优先。\n", "utf8");
    const loaded = await loadWorkspace(created.root);
    expect(loaded.data.blueprint.mainPlot).toContain("普通文件优先");
    expect(await fs.readFile(path.join(created.root, "outline", "book.md"), "utf8")).toContain("普通文件优先");
    const manifest = JSON.parse(await fs.readFile(path.join(created.root, ".noval", "project.json"), "utf8"));
    expect(manifest.workspaceSchemaVersion).toBe(2);
    expect(manifest.project).toBeUndefined();
  });
});
