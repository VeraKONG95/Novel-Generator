const path = require("node:path");
const { RoleRegistry } = require("../services/analysis/role-registry");
const { WorkflowRegistry } = require("../services/analysis/workflow-registry");

describe("analysis registries", () => {
  it("loads the fixed role and workflow allowlists used by dynamic analysis", async () => {
    const roles = new RoleRegistry({
      rolesDir: path.join(__dirname, "..", "resources", "pi", "roles")
    });
    const workflows = new WorkflowRegistry({
      workflowsDir: path.join(__dirname, "..", "resources", "pi", "workflows"),
      roleRegistry: roles
    });

    await roles.load();
    await workflows.load();

    expect(roles.list().map((item) => item.id)).toEqual(
      Array.from({ length: 17 }, (_, index) => `R${String(index + 1).padStart(2, "0")}`)
    );
    expect(workflows.list().map((item) => item.id)).toEqual(
      Array.from({ length: 8 }, (_, index) => `WF${String(index + 1).padStart(2, "0")}`)
    );
    expect(workflows.get("WF01").nodes.some((node) => node.role === "R03" && node.expand === "chapters")).toBe(true);
    expect(workflows.route({ action: "import_novel" }).id).toBe("WF01");
    expect(workflows.route({ action: "continue_chapter" }).id).toBe("WF07");
  });

  it("rejects role output that omits evidence-bearing records", async () => {
    const roles = new RoleRegistry({
      rolesDir: path.join(__dirname, "..", "resources", "pi", "roles")
    });
    await roles.load();

    expect(() => roles.validateResult("R03", { events: [{}] })).toThrow("mentions");
    expect(() => roles.validateResult("R03", {
      mentions: [],
      events: [],
      assertions: [],
      relationChanges: [],
      hooks: [],
      styleSamples: []
    })).not.toThrow();
  });

  it("rejects malformed creative role results before they can become files", async () => {
    const roles = new RoleRegistry({ rolesDir: path.join(__dirname, "..", "resources", "pi", "roles") });
    await roles.load();

    expect(() => roles.validateResult("R14", { materials: "all" })).toThrow("必须是数组");
    expect(() => roles.validateResult("R15", { plan: { scenes: "one" } })).toThrow("scenes");
    expect(() => roles.validateResult("R16", { content: "" })).toThrow("非空");
    expect(() => roles.validateResult("R17", { issues: [{ severity: "high", location: "第一章", reason: "跳变", suggestion: "补场景" }] }))
      .toThrow("severity");
  });
});
