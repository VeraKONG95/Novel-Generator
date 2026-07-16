const { resolveEntityClusters } = require("../services/analysis/entity-resolver");

describe("entity resolver", () => {
  it("stops publication when merge transitivity contradicts a separation decision", () => {
    const resolved = resolveEntityClusters({
      projectId: "project-1",
      candidates: [{ id: "a", name: "林默" }, { id: "b", name: "阿默" }, { id: "c", name: "黑衣人" }],
      decisions: [
        { leftId: "a", rightId: "b", decision: "merge" },
        { leftId: "b", rightId: "c", decision: "merge" },
        { leftId: "a", rightId: "c", decision: "separate" }
      ]
    });

    expect(resolved.conflicts).toHaveLength(1);
    expect(resolved.entities).toHaveLength(0);
  });

  it("keeps stable entity ids for the same accepted cluster", () => {
    const input = {
      projectId: "project-1",
      candidates: [{ id: "a", name: "林默" }, { id: "b", name: "阿默" }],
      decisions: [{ leftId: "a", rightId: "b", decision: "merge" }]
    };
    const first = resolveEntityClusters(input);
    const second = resolveEntityClusters(input);

    expect(first.conflicts).toEqual([]);
    expect(first.entities).toHaveLength(1);
    expect(first.entities[0].id).toBe(second.entities[0].id);
    expect(first.aliasMap.get("b")).toBe(first.entities[0].id);
  });
});
