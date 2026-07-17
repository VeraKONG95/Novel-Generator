const {
  PROJECT_SCHEMA_VERSION,
  createDefaultProject,
  normalizeProject
} = require("../services/project-schema");

describe("project schema", () => {
  it("upgrades projects to the analysis-aware version without starting old projects automatically", () => {
    const legacy = createDefaultProject();
    legacy.schemaVersion = 4;
    delete legacy.analysis;
    delete legacy.analysisSettings;

    const normalized = normalizeProject(legacy);

    expect(PROJECT_SCHEMA_VERSION).toBe(5);
    expect(normalized.project.schemaVersion).toBe(5);
    expect(normalized.project.analysis).toEqual({
      status: "uninitialized",
      runId: "",
      generationId: "",
      workflowId: "",
      blockingGaps: [],
      nonBlockingGaps: [],
      updatedAt: ""
    });
    expect(normalized.project.analysisSettings).toEqual({ maxConcurrency: 4 });
    expect(normalized.meta).toMatchObject({ migrated: true, migratedFrom: 4 });
  });
});
