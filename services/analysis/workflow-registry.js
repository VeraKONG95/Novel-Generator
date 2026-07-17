const fs = require("node:fs/promises");
const path = require("node:path");

const ROUTES = {
  import_novel: "WF01",
  chapter_changed: "WF02",
  author_correction: "WF03",
  query: "WF04",
  consistency_check: "WF05",
  plan_chapter: "WF06",
  continue_chapter: "WF07",
  rebuild: "WF08"
};

function assertAcyclic(workflow) {
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new Error(`${workflow.id} 存在循环依赖：${id}`);
    if (visited.has(id)) return;
    const node = nodes.get(id);
    if (!node) throw new Error(`${workflow.id} 引用了不存在的节点：${id}`);
    visiting.add(id);
    for (const dependency of node.dependsOn || []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of nodes.keys()) visit(id);
}

class WorkflowRegistry {
  constructor({ workflowsDir, roleRegistry }) {
    this.workflowsDir = workflowsDir;
    this.roleRegistry = roleRegistry;
    this.workflows = new Map();
  }

  async load() {
    if (!this.roleRegistry.list().length) await this.roleRegistry.load();
    const names = (await fs.readdir(this.workflowsDir)).filter((name) => /^WF\d{2}\.json$/.test(name)).sort();
    const next = new Map();
    for (const name of names) {
      const workflow = JSON.parse(await fs.readFile(path.join(this.workflowsDir, name), "utf8"));
      if (workflow.id !== path.basename(name, ".json")) throw new Error(`流程编号与文件名不一致：${name}`);
      if (!Array.isArray(workflow.nodes) || !workflow.nodes.length) throw new Error(`${workflow.id} 没有任务节点。`);
      const ids = new Set();
      for (const node of workflow.nodes) {
        if (!node.id || ids.has(node.id)) throw new Error(`${workflow.id} 存在重复或空节点编号。`);
        ids.add(node.id);
        if (node.role) this.roleRegistry.get(node.role);
        if (!node.role && node.type !== "program") throw new Error(`${workflow.id}.${node.id} 不是允许的模型或程序节点。`);
      }
      assertAcyclic(workflow);
      next.set(workflow.id, workflow);
    }
    for (let index = 1; index <= 8; index += 1) {
      const id = `WF${String(index).padStart(2, "0")}`;
      if (!next.has(id)) throw new Error(`缺少工作流：${id}`);
    }
    this.workflows = next;
    return this.list();
  }

  list() {
    return Array.from(this.workflows.values()).sort((a, b) => a.id.localeCompare(b.id)).map((item) => structuredClone(item));
  }

  get(id) {
    const workflow = this.workflows.get(String(id || ""));
    if (!workflow) throw new Error(`工作流不在白名单中：${id}`);
    return structuredClone(workflow);
  }

  route({ action }) {
    const id = ROUTES[String(action || "")];
    if (!id) return null;
    return this.get(id);
  }
}

module.exports = { ROUTES, WorkflowRegistry };
