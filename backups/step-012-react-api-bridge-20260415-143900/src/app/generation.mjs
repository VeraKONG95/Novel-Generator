import {
  chapterGoal,
  chapterTitle,
  chapterTwist,
  extractName
} from "./utils.mjs";

export function buildBlueprintFromSetup(setup) {
  const protagonistName = extractName(setup.protagonist) || "主角";
  const genreSeed = setup.genre || "长篇网文";
  const conflict = setup.conflict || setup.premise || "在危险世界中挣扎求生";
  const titleBase = protagonistName.replace(/\s+/g, "") || "无名者";

  return {
    titleOptions: [
      `${titleBase}裂痕录`,
      "边城因果师",
      `${genreSeed}：${titleBase}逆命`
    ],
    hook: `${protagonistName}得到禁忌能力后，被迫在更大的阴谋苏醒前抢先成长。`,
    synopsis: `${setup.premise}。故事从一次失控事件开始，主角被推入更残酷的秩序边缘，并在追查真相的过程中不断抬升冲突规模。`,
    worldSetting: `${setup.worldBackground}。力量体系围绕“代价换取能力”展开，每次提升都必须付出实际后果。`,
    characters: [
      {
        id: "char-1",
        name: protagonistName,
        role: "主角",
        personality: "冷静、能忍、对真相有病态执念",
        goal: "查清家族旧案并活下来",
        conflict: "能力越强，反噬越重",
        traits: ["高压下判断快", "对盟友不轻易信任"],
        relationships: ["与引路人互相利用", "与宿敌彼此映照"]
      },
      {
        id: "char-2",
        name: "沈照微",
        role: "引路人",
        personality: "温和外表下极度现实",
        goal: "借主角进入遗迹核心",
        conflict: "必须在利用和保护主角之间做选择",
        traits: ["善于布局", "有隐藏身份"],
        relationships: [`对${protagonistName}半真半假地提供帮助`]
      },
      {
        id: "char-3",
        name: "顾沉霄",
        role: "宿敌",
        personality: "傲慢、强大、极端相信秩序",
        goal: "在旧神复苏前清除一切不稳定因素",
        conflict: "越想镇压乱局，越把主角推向自己的对立面",
        traits: ["强控制欲", "执行力极高"],
        relationships: [`与${protagonistName}注定长期对抗`]
      }
    ],
    mainPlot: `${protagonistName}从边城遗迹中获得能力后，一边逃亡，一边追查灭门案和旧神复苏之间的联系，最终撕开权力结构最上层的真相。`,
    subPlots: [
      "主角与引路人之间从互相利用到建立脆弱同盟。",
      "宿敌视角不断推进，形成压迫式追捕线。",
      "主角的能力反噬让每次胜利都带有代价。"
    ],
    volumes: [
      {
        title: "边城裂痕",
        summary: "主角得到能力，被迫逃离旧秩序，并第一次触碰真相入口。"
      },
      {
        title: "王朝暗流",
        summary: "主角进入更大舞台，发现宗门、朝廷和旧神遗迹的连接。"
      },
      {
        title: "逆命之战",
        summary: "主角主动反攻，把个人复仇升级为秩序重写。"
      }
    ],
    chapterPlans: Array.from({ length: 10 }, (_, index) => ({
      index: index + 1,
      title: chapterTitle(index + 1, protagonistName),
      goal: chapterGoal(index + 1, protagonistName, conflict),
      turningPoint: chapterTwist(index + 1)
    }))
  };
}

export function buildChapterContent({ chapter, state, plan, isContinuation }) {
  const protagonist = state.project.blueprint.characters[0]?.name || "主角";
  const instruction = chapter.instruction ? `本章额外要求：${chapter.instruction}` : "";
  const memoryHint = state.project.memory.events
    .slice(-2)
    .map((item) => item.content)
    .join("；");

  const paragraphs = isContinuation
    ? [
        `夜色压到城墙残砖上，${protagonist}没有立刻离开。他知道自己刚刚赢下的，不过是一点喘息的时间，而不是安全。`,
        "沿着风声里残留的血腥气，他在黑巷尽头发现了新的痕迹。那不像寻常追兵留下的脚印，更像某种被强行唤醒的禁制在地面上拖出的灼痕。",
        `这意味着局势已经变了。追杀他的人不再只想抓住他，而是准备借他把更深的东西逼出来。${instruction}`,
        "当他抬头看向城外遗迹时，远处忽然亮起一线冷白色光芒，像有人提前替他推开了下一道门。"
      ]
    : [
        `${protagonist}站在边城废井旁，指尖还残留着裂痕般的寒意。今夜之前，他只是被逐出的无名少年；今夜之后，所有看见那道光的人都会记住他。`,
        `按照蓝图推进，这一章的核心任务是：${plan?.goal || chapter.summary || "建立冲突并抛出主线入口"}。所以开场必须直接让危险落在主角头顶，而不是先解释世界。`,
        `追兵来得比预想更快。巷口的铜铃没有风却自行作响，意味着有人用秘法锁定了他的气息。${protagonist}强压住胸口翻涌的反噬，逼自己在三息之内做出判断。`,
        `他没有逃向人群，而是反向闯进封禁多年的旧宅。因为只有在那里，他才能确认一件事：当年灭门案留下的东西，到底是证据，还是故意给他看的陷阱。`,
        `门开的一瞬间，积尘之下传来低沉呢喃，像有什么存在正借他的到来重新苏醒。${instruction} ${memoryHint ? `前文记忆提示：${memoryHint}。` : ""}`
      ];

  return isContinuation
    ? [chapter.content.trim(), paragraphs.join("\n\n")].filter(Boolean).join("\n\n")
    : paragraphs.join("\n\n");
}
