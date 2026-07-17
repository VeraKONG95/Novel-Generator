const path = require("node:path");

class ChapterAnalysisQueue {
  constructor({ isBlocked, start }) {
    if (typeof isBlocked !== "function" || typeof start !== "function") {
      throw new TypeError("章节分析队列需要阻塞检查和启动函数。");
    }
    this.isBlocked = isBlocked;
    this.start = start;
    this.pending = new Map();
    this.draining = new Set();
  }

  root(value) {
    return path.resolve(String(value || ""));
  }

  enqueue(root, paths) {
    const normalizedRoot = this.root(root);
    const queued = this.pending.get(normalizedRoot) || new Set();
    for (const item of Array.isArray(paths) ? paths : []) {
      const relativePath = String(item || "").replace(/\\/g, "/");
      if (/^chapters\/[^/]+\.md$/i.test(relativePath)) queued.add(relativePath);
    }
    if (queued.size) this.pending.set(normalizedRoot, queued);
    return Array.from(queued);
  }

  async drain(root) {
    const normalizedRoot = this.root(root);
    const queued = this.pending.get(normalizedRoot);
    if (!queued?.size || this.draining.has(normalizedRoot) || await this.isBlocked(normalizedRoot)) return null;
    const paths = Array.from(queued);
    this.pending.delete(normalizedRoot);
    this.draining.add(normalizedRoot);
    try {
      return await this.start(normalizedRoot, paths);
    } catch {
      this.enqueue(normalizedRoot, paths);
      return null;
    } finally {
      this.draining.delete(normalizedRoot);
    }
  }
}

module.exports = { ChapterAnalysisQueue };
