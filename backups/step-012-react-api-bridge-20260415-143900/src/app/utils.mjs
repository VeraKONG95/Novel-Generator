export function countWords(text) {
  if (!text.trim()) return 0;
  return text.trim().replace(/\s+/g, "").length;
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatDate(value) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function summarizeChapter(content) {
  if (!content) return "暂无内容";
  return content.split("。").slice(0, 2).join("。").trim();
}

export function extractName(text) {
  return (text || "").split(/[，,。；\s]/)[0];
}

function protagonistNameOrDefault(name) {
  return name || "主角";
}

export function chapterTitle(index, protagonistName) {
  const titles = [
    `${protagonistName}入局`,
    "旧宅异响",
    "追兵压城",
    "第一次反杀",
    "遗迹开启",
    "假盟友",
    "线索浮出",
    "代价显现",
    "身份暴露",
    "更大的局"
  ];
  return titles[index - 1] || `推进 ${index}`;
}

export function chapterGoal(index, protagonistName, conflict) {
  const goals = [
    `让${protagonistNameOrDefault(protagonistName)}在最短时间内陷入不可逆的危险，并抛出主线入口。`,
    "通过探索旧宅或遗迹，揭露过去事件的第一层异常。",
    "让追捕者正式登场，建立持续压迫感。",
    "安排一次付出代价的胜利，证明主角不能只靠运气。",
    "展示世界观的一角，同时让线索规模升级。",
    "引入不可信盟友，让局势更复杂。",
    "给出能推动长线剧情的关键信息。",
    `把“${conflict}”具体化成主角无法回避的问题。`,
    "让主角的身份或能力被更大范围注意到。",
    "在小高潮后抛出更大的目标。"
  ];
  return goals[index - 1] || "推进主线并制造新的悬念。";
}

export function chapterTwist(index) {
  const twists = [
    "主角以为自己找到线索，实则是有人故意留下的引路标记。",
    "旧宅中的异响并不是敌人，而是被封存的记忆回应。",
    "追兵里混入了本该已经死去的人。",
    "主角赢了眼前战斗，却因此暴露能力特征。",
    "遗迹真正开启的条件不是血脉，而是牺牲。",
    "盟友的帮助自带账单，而且价格很高。",
    "线索指向的真凶只是更大结构的一环。",
    "反噬开始侵蚀主角最重要的判断力。",
    "宿敌早就知道主角会走到这一步。",
    "当前阶段的目标，本身就是别人设计好的轨道。"
  ];
  return twists[index - 1] || "下一章将出现更大的外部压力。";
}
