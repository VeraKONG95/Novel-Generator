const { BASE_SYSTEM_PROMPT, buildTaskPrompt, classifyTask } = require("../services/pi-prompts");

describe("Pi prompt policy", () => {
  it("routes natural language into controlled tasks", () => {
    expect(classifyTask("帮我生成全书大纲")).toBe("generate_blueprint");
    expect(classifyTask("继续写下一章")).toBe("write_chapter");
    expect(classifyTask("检查这一章有没有事实冲突")).toBe("review");
    expect(classifyTask("把这段写得更克制", "chapter")).toBe("rewrite");
    expect(classifyTask("重新规划近期三章")).toBe("plan_chapters");
  });

  it("keeps confirmation, truth and permission boundaries in every task", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("正式正文是事实的最终依据");
    expect(BASE_SYSTEM_PROMPT).toContain("等待作者确认");
    expect(BASE_SYSTEM_PROMPT).toContain("不能访问其他位置");
    expect(BASE_SYSTEM_PROMPT).toContain("不得用模板");
    const prompt = buildTaskPrompt({
      taskType: "write_chapter",
      instruction: "写下一章",
      context: { agents: "正文优先", materials: {}, memory: {}, recentChapters: [] }
    });
    expect(prompt).toContain("完整章节候选稿");
    expect(prompt).toContain("正文优先");
    expect(prompt).toContain("submit_candidate");
    expect(prompt.indexOf("【创作章程】")).toBeLessThan(prompt.indexOf("【当前任务资料】"));
    expect(prompt.indexOf("【最近章节】")).toBeLessThan(prompt.indexOf("【作者本次要求】"));
  });
});
