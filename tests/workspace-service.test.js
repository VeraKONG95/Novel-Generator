const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createDefaultProject } = require("../services/project-schema");
const { publishGeneration } = require("../services/analysis/graph-store");
const {
  assertInside,
  applyWorkspaceChanges,
  createWorkspace,
  createWorkspaceAtPath,
  extractPdfNovel,
  importNovel,
  loadWorkspace,
  listWorkspaceFiles,
  normalizePdfPages,
  readWorkspaceFile,
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

function simplePdf(text = "") {
  const escaped = String(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const stream = escaped ? `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET\n` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n`;
  output += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output);
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

  it("imports an existing novel with stable chapter ids and marks it ready for automatic analysis", async () => {
    const parent = await tempParent();
    const sourcePath = path.join(parent, "已有小说.md");
    await fs.writeFile(sourcePath, "# 第一章 雨夜\n第一章正文\n\n# 第二章 来信\n第二章正文", "utf8");
    const seed = createDefaultProject();
    seed.title = "导入验收";
    const imported = await importNovel(parent, sourcePath, seed);
    const loaded = await loadWorkspace(imported.root);
    expect(loaded.data.importStatus).toBe("raw_imported");
    expect(loaded.data.analysis.status).toBe("raw_imported");
    expect(loaded.data.chapters).toHaveLength(2);
    expect(loaded.data.chapters[1].content).toContain("第二章正文");
    expect(loaded.data.chapters.map((chapter) => chapter.id)).toEqual(
      imported.data.chapters.map((chapter) => chapter.id)
    );
    expect(loaded.data.chapters.every((chapter) => /^chapter-[a-f0-9-]{36}$/.test(chapter.id))).toBe(true);
    expect(await fs.readFile(sourcePath, "utf8")).toContain("第一章正文");
  });

  it("imports selectable text from a PDF and reports page progress", async () => {
    const parent = await tempParent();
    const sourcePath = path.join(parent, "Existing-Novel.pdf");
    await fs.writeFile(sourcePath, simplePdf("A long opening chapter imported from a PDF novel."));
    const progress = [];

    const imported = await importNovel(parent, sourcePath, createDefaultProject(), {
      onProgress: (item) => progress.push(item)
    });
    const loaded = await loadWorkspace(imported.root);

    expect(imported.sourceInfo.format).toBe("pdf");
    expect(imported.sourceInfo.pageCount).toBe(1);
    expect(loaded.data.importSource.pageCount).toBe(1);
    expect(loaded.data.importSource.pageMap[0]).toMatchObject({ pageNumber: 1 });
    expect(loaded.data.importSource.pageMap[0].chapterId).toBe(loaded.data.chapters[0].id);
    expect(loaded.data.title).toBe("Existing-Novel");
    expect(loaded.data.chapters[0].content).toContain("opening chapter imported from a PDF novel");
    expect(progress.some((item) => item.currentPage === 1 && item.totalPages === 1)).toBe(true);
    expect(progress.at(-1).percent).toBe(100);
  });

  it("rejects an image-only PDF instead of silently creating an empty novel", async () => {
    const parent = await tempParent();
    const sourcePath = path.join(parent, "Scanned-Novel.pdf");
    await fs.writeFile(sourcePath, simplePdf());

    await expect(extractPdfNovel(sourcePath)).rejects.toThrow("扫描图片");
  });

  it("removes repeated PDF furniture and keeps page-to-paragraph evidence mapping", () => {
    const normalized = normalizePdfPages([
      "雾港来信\n第一章 雨夜\n林默走到门前，\n1",
      "雾港来信\n却没有敲门。\n第二章 回声\n顾言听见潮声。\n2",
      "雾港来信\n第三章 灯塔\n灯塔熄灭了。\n3"
    ]);

    expect(normalized.content).not.toContain("雾港来信\n");
    expect(normalized.content).toContain("林默走到门前，却没有敲门。");
    expect(normalized.pageMap.some((item) => item.pageNumber === 1 && item.text.includes("林默走到门前"))).toBe(true);
    expect(normalized.pageMap.some((item) => item.pageNumber === 2 && item.text.includes("却没有敲门"))).toBe(true);
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
    expect(await fs.readFile(path.join(created.root, "AGENTS.md"), "utf8")).toContain("knowledge/CURRENT.json");
  });

  it("shows only the current analysis generation through stable logical paths", async () => {
    const parent = await tempParent();
    const created = await createWorkspace(parent, createDefaultProject());
    await publishGeneration(created.root, {
      generationId: "generation-current",
      entities: [], events: [], assertions: [], relations: [], overrides: [],
      materials: { "characters/林默.md": "# 林默\n\n当前状态：活跃。\n" }
    });

    const files = await listWorkspaceFiles(created.root);
    expect(files.some((item) => item.path === "knowledge/current/characters/林默.md")).toBe(true);
    expect(files.some((item) => item.path.includes("knowledge/generations/generation-current"))).toBe(false);
    await expect(readWorkspaceFile(created.root, "knowledge/current/characters/林默.md"))
      .resolves.toMatchObject({ content: expect.stringContaining("当前状态") });
    const loaded = await loadWorkspace(created.root);
    expect(loaded.data.analysis).toMatchObject({ status: "ready", generationId: "generation-current" });
    expect(loaded.data.blueprint.characters.map((item) => item.name)).toContain("林默");
    await expect(applyWorkspaceChanges(created.root, [{
      path: "knowledge/CURRENT.json", action: "update", content: "{}"
    }])).rejects.toThrow("分析结果");
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

  it("does not overwrite a file that appeared after a create candidate started", async () => {
    const parent = await tempParent();
    const created = await createWorkspace(parent, createDefaultProject());
    const opened = await loadWorkspace(created.root);
    const target = path.join(created.root, "chapters", "0002.md");
    await fs.writeFile(target, "# 作者新章\n\n作者刚刚写下的正文。\n", "utf8");

    const blocked = await applyWorkspaceChanges(created.root, [{
      path: "chapters/0002.md", action: "create", content: "# 模型新章\n\n模型候选。\n"
    }], { expectedRevisions: opened.revisions });

    expect(blocked.ok).toBe(false);
    expect(blocked.conflicts[0].path).toBe("chapters/0002.md");
    expect(await fs.readFile(target, "utf8")).toContain("作者刚刚写下");
  });

  it("blocks a candidate when a selected context file changed even if the target is new", async () => {
    const parent = await tempParent();
    const created = await createWorkspace(parent, createDefaultProject());
    const opened = await loadWorkspace(created.root);
    await fs.writeFile(path.join(created.root, "AGENTS.md"), "# 作者刚刚改过的创作章程\n", "utf8");

    const blocked = await applyWorkspaceChanges(created.root, [{
      path: "chapters/0002.md", action: "create", content: "# 旧设定生成的正文\n"
    }], { expectedRevisions: opened.revisions, guardPaths: ["AGENTS.md"] });

    expect(blocked.ok).toBe(false);
    expect(blocked.conflicts[0]).toMatchObject({ path: "AGENTS.md", contextChanged: true });
    await expect(fs.access(path.join(created.root, "chapters", "0002.md"))).rejects.toThrow();
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
