const { BASE_SYSTEM_PROMPT, buildTaskPrompt, classifyTask } = require("../services/pi-prompts");

describe("Pi prompt policy", () => {
  it("routes natural language into controlled tasks", () => {
    expect(classifyTask("帮我生成全书大纲")).toBe("generate_blueprint");
    expect(classifyTask("继续写下一章")).toBe("write_chapter");
    expect(classifyTask("检查这一章有没有事实冲突")).toBe("review");
    expect(classifyTask("把这段写得更克制", "chapter")).toBe("rewrite");
    expect(classifyTask("重新规划近期三章")).toBe("plan_chapters");
  });

  it("keeps questions, reviews, planning and continuation on their workflows when a file is open", () => {
    expect(classifyTask("他们为什么会决裂？", "file")).toBe("query");
    expect(classifyTask("检查这里有没有认知泄漏", "file")).toBe("review");
    expect(classifyTask("规划接下来三章", "file")).toBe("plan_chapters");
    expect(classifyTask("规划下一章", "file")).toBe("plan_chapters");
    expect(classifyTask("计划下一章", "file")).toBe("plan_chapters");
    expect(classifyTask("续写下一章", "file")).toBe("write_chapter");
    expect(classifyTask("把这里润色得更克制", "file")).toBe("rewrite");
  });

  it("keeps truth, automatic-write and permission boundaries in every task", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("正式正文是事实的最终依据");
    expect(BASE_SYSTEM_PROMPT).toContain("系统会自动写入");
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
