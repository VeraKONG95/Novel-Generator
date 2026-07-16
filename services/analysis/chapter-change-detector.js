const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

async function chapterFingerprint(root, relativePath) {
  try {
    const content = await fs.readFile(path.join(root, ...relativePath.split("/")));
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function detectChangedChapterPaths(root, currentGeneration, chapters) {
  if (!currentGeneration) return [];
  const covered = Array.isArray(currentGeneration.manifest?.coveredChapters)
    ? currentGeneration.manifest.coveredChapters
    : [];
  const currentChapters = Array.isArray(chapters) ? chapters : [];
  const coveredById = new Map(covered.map((item) => [String(item.chapterId || item.id || ""), item]));
  const currentPaths = new Set();
  const changed = new Set();
  for (const chapter of currentChapters) {
    const relativePath = String(chapter.path || chapter.sourcePath || "").replace(/\\/g, "/");
    if (!relativePath) continue;
    currentPaths.add(relativePath);
    const previous = coveredById.get(String(chapter.id || chapter.chapterId || "")) || covered.find((item) => item.sourcePath === relativePath);
    const fingerprint = await chapterFingerprint(root, relativePath);
    if (!previous || previous.sourcePath !== relativePath || fingerprint !== previous.contentFingerprint) changed.add(relativePath);
  }
  for (const previous of covered) {
    const relativePath = String(previous.sourcePath || previous.path || "").replace(/\\/g, "/");
    if (relativePath && !currentPaths.has(relativePath)) changed.add(relativePath);
  }
  return Array.from(changed).sort();
}

module.exports = { detectChangedChapterPaths };
