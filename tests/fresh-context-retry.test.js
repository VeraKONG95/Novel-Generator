const { shouldRetryWithFreshContext } = require("../services/fresh-context-retry");

describe("fresh context retry", () => {
  it("retries a dynamic task once when its target file changed", () => {
    expect(shouldRetryWithFreshContext({
      conflicts: [{ path: "chapters/0002.md", contextChanged: false }],
      workflowRunId: "run-1",
      contextRetryCount: 0,
      analysisActive: false
    })).toBe(true);
  });

  it("retries a dynamic task once when a context material changed", () => {
    expect(shouldRetryWithFreshContext({
      conflicts: [{ path: "knowledge/current/characters/lin-mo.md", contextChanged: true }],
      workflowRunId: "run-1",
      contextRetryCount: 0,
      analysisActive: false
    })).toBe(true);
  });

  it("does not retry again after the fresh-context retry also conflicts", () => {
    expect(shouldRetryWithFreshContext({
      conflicts: [
        { path: "chapters/0002.md", contextChanged: false },
        { path: "chapters/0001.md", contextChanged: true }
      ],
      workflowRunId: "run-2",
      contextRetryCount: 1,
      analysisActive: false
    })).toBe(false);
  });
});
