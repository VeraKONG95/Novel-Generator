const {
  batchWorkflowMaterials,
  criticalIssues,
  dedupeIssues,
  renderPlanMarkdown,
  selectWorkflowMaterials,
  taskReviewIssue
} = require("../services/analysis/creative-workflow-utils");

describe("creative workflow utilities", () => {
  it("accepts only whitelisted material IDs, keeps required context and obeys the budget", () => {
    const available = [
      { id: "required", title: "作者修正和当前状态", content: "重要".repeat(20) },
      { id: "recent", title: "相邻正文", content: "正文".repeat(20) },
      { id: "old", title: "旧事件", content: "历史".repeat(200) }
    ];
    const selected = selectWorkflowMaterials(available, {
      materials: [{ id: "old", priority: 3 }, { id: "recent", priority: 1 }]
    }, { requiredIds: ["required"], tokenBudget: 100 });

    expect(selected.materialIds).toEqual(["required", "recent"]);
    expect(selected.estimatedTokens).toBeLessThanOrEqual(100);
    expect(() => selectWorkflowMaterials(available, { materials: [{ id: "forged" }] }))
      .toThrow("不在本次白名单");
  });

  it("deduplicates review findings, identifies blockers and renders deterministic task output", () => {
    const issues = dedupeIssues([
      { issues: [{ severity: "important", location: "第一章", reason: "跳变", suggestion: "补过渡" }] },
      { issues: [{ severity: "critical", location: "第一章", reason: "跳变", suggestion: "补过渡" }] }
    ]);
    expect(issues).toHaveLength(1);
    expect(criticalIssues(issues)).toHaveLength(1);
    expect(taskReviewIssue(issues[0])).toMatchObject({ severity: "严重", location: "第一章" });
    expect(renderPlanMarkdown({ title: "灯塔", goal: "会面", scenes: [{ title: "门前", conflict: "试探" }] }))
      .toContain("### 1. 门前");
  });

  it("partitions every full-book material without dropping oversized files", () => {
    const materials = [
      { id: "one", title: "第一章", content: "甲".repeat(800) },
      { id: "two", title: "第二章", content: "乙".repeat(80) }
    ];
    const batches = batchWorkflowMaterials(materials, 256);
    const sourceIds = batches.flat().map((item) => item.sourceMaterialId || item.id);
    expect(sourceIds).toContain("one");
    expect(sourceIds).toContain("two");
    expect(batches.every((batch) => batch.reduce((sum, item) => sum + Math.ceil((item.title.length + item.content.length) / 2), 0) <= 256)).toBe(true);
  });
});
