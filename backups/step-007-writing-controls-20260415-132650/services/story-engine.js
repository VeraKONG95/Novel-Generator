function extractName(text) {
  return (text || "").split(/[，,。；\s]/)[0];
}

function protagonistNameOrDefault(name) {
  return name || "主角";
}

function chapterTitle(index, protagonistName) {
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

function chapterGoal(index, protagonistName, conflict) {
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

function chapterTwist(index) {
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

function summarizeChapter(content) {
  if (!content) return "暂无内容";
  return content.split("。").slice(0, 2).join("。").trim();
}

function stripCodeFence(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : text.trim();
}

function extractJSONObject(text) {
  const source = stripCodeFence(text);
  const directCandidates = [source];
  const firstBrace = source.indexOf("{");
  if (firstBrace >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = firstBrace; i < source.length; i += 1) {
      const char = source[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          directCandidates.push(source.slice(firstBrace, i + 1));
          break;
        }
      }
    }
  }

  for (const candidate of directCandidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try next candidate
    }
  }

  throw new Error("模型返回的内容不是可解析的 JSON。");
}

function toStringList(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function emptyMemoryBundle() {
  return {
    characters: [],
    locations: [],
    factions: [],
    rules: [],
    events: [],
    foreshadowing: []
  };
}

function memoryIdentityKey(type, item) {
  const sourceChapter = item?.sourceChapter ? `:${item.sourceChapter}` : "";
  return `${type}:${String(item?.name || "").trim().toLowerCase()}${sourceChapter}`;
}

function normalizeMemoryItem(type, item, index) {
  const source = item && typeof item === "object" ? item : {};
  const fallbackName = {
    characters: `人物${index + 1}`,
    locations: `地点${index + 1}`,
    factions: `势力${index + 1}`,
    rules: `规则${index + 1}`,
    events: `事件${index + 1}`,
    foreshadowing: `伏笔${index + 1}`
  };
  const normalized = {
    id: String(source.id || `${type}-${index + 1}`),
    name: String(source.name || fallbackName[type] || `条目${index + 1}`),
    content: String(source.content || source.summary || "待补充"),
    updatedAt: String(source.updatedAt || new Date().toISOString())
  };

  if (source.sourceChapter) {
    normalized.sourceChapter = Number(source.sourceChapter) || undefined;
  }

  return normalized;
}

function normalizeMemorySection(type, value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  return source
    .map((item, index) => normalizeMemoryItem(type, item, index))
    .filter((item) => item.name && item.content);
}

function normalizeMemoryBundle(raw, fallback = emptyMemoryBundle()) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    characters: normalizeMemorySection("characters", source.characters, fallback.characters),
    locations: normalizeMemorySection("locations", source.locations, fallback.locations),
    factions: normalizeMemorySection("factions", source.factions, fallback.factions),
    rules: normalizeMemorySection("rules", source.rules, fallback.rules),
    events: normalizeMemorySection("events", source.events, fallback.events),
    foreshadowing: normalizeMemorySection(
      "foreshadowing",
      source.foreshadowing,
      fallback.foreshadowing
    )
  };
}

function mergeMemoryBundle(baseMemory, incomingMemory) {
  const base = normalizeMemoryBundle(baseMemory);
  const incoming = normalizeMemoryBundle(incomingMemory);
  const merged = emptyMemoryBundle();

  Object.keys(merged).forEach((type) => {
    const items = [...base[type], ...incoming[type]];
    const map = new Map();
    items.forEach((item, index) => {
      const normalized = normalizeMemoryItem(type, item, index);
      map.set(memoryIdentityKey(type, normalized), normalized);
    });
    merged[type] = Array.from(map.values());
  });

  return merged;
}

function buildFallbackBlueprint(setup) {
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

function buildFallbackChapter({ project, chapter, isContinuation }) {
  const protagonist = project.blueprint.characters[0]?.name || "主角";
  const plan = project.blueprint.chapterPlans[(chapter.index || 1) - 1] || null;
  const instruction = chapter.instruction ? `本章额外要求：${chapter.instruction}` : "";
  const memoryHint = (project.memory.events || [])
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

  return {
    title: chapter.title || plan?.title || `第 ${chapter.index} 章`,
    summary: chapter.summary || plan?.goal || "推进主线并制造新的悬念。",
    content: isContinuation
      ? [chapter.content?.trim(), paragraphs.join("\n\n")].filter(Boolean).join("\n\n")
      : paragraphs.join("\n\n")
  };
}

function buildFallbackProjectMemory(project) {
  const blueprint = project?.blueprint || {};
  const chapters = Array.isArray(project?.chapters) ? project.chapters : [];
  const setup = project?.setup || {};
  const now = new Date().toISOString();

  return {
    characters: (blueprint.characters || []).map((character, index) => ({
      id: `memory-char-${index + 1}`,
      name: character.name,
      content: `${character.role}；目标：${character.goal}；冲突：${character.conflict}`,
      updatedAt: now
    })),
    locations: blueprint.worldSetting
      ? [
          {
            id: "loc-1",
            name: "边城遗迹",
            content: blueprint.worldSetting || setup.worldBackground || "待补充",
            updatedAt: now
          }
        ]
      : [],
    factions: blueprint.mainPlot
      ? [
          {
            id: "fac-1",
            name: "宗门与王朝势力",
            content: "表面维持秩序，实则围绕旧神遗迹与核心线索争夺控制权。",
            updatedAt: now
          }
        ]
      : [],
    rules: blueprint.worldSetting
      ? [
          {
            id: "rule-1",
            name: "能力代价",
            content: "每次动用核心能力都必须承受可见的反噬和后果。",
            updatedAt: now
          }
        ]
      : [],
    events: chapters.slice(-6).map((chapter) => ({
      id: `event-${chapter.index}`,
      name: `第 ${chapter.index} 章`,
      content: chapter.summary || summarizeChapter(chapter.content),
      sourceChapter: chapter.index,
      updatedAt: chapter.updatedAt || now
    })),
    foreshadowing: (blueprint.chapterPlans || []).slice(0, 6).map((plan) => ({
      id: `foreshadow-${plan.index}`,
      name: `第 ${plan.index} 章伏笔`,
      content: plan.turningPoint,
      sourceChapter: plan.index,
      updatedAt: now
    }))
  };
}

function buildFallbackChapterAnalysis(payload) {
  const chapter = payload?.chapter || {};
  const project = payload?.project || {};
  const plan = (project.blueprint?.chapterPlans || []).find(
    (item) => item.index === chapter.index
  );
  const summary = chapter.summary || summarizeChapter(chapter.content);
  const now = new Date().toISOString();

  return {
    summary,
    memory: normalizeMemoryBundle({
      characters: [],
      locations: [],
      factions: [],
      rules: [],
      events: summary
        ? [
            {
              id: `event-${chapter.index}`,
              name: `第 ${chapter.index} 章`,
              content: summary,
              sourceChapter: chapter.index,
              updatedAt: now
            }
          ]
        : [],
      foreshadowing: plan?.turningPoint
        ? [
            {
              id: `foreshadow-${chapter.index}`,
              name: `第 ${chapter.index} 章伏笔`,
              content: plan.turningPoint,
              sourceChapter: chapter.index,
              updatedAt: now
            }
          ]
        : []
    })
  };
}

function rewritePromptLabel(mode) {
  const labels = {
    polish: "润色改写",
    expand: "扩写细节",
    compress: "压缩提炼",
    rewrite: "重写保持情节",
    rewrite_chapter: "重写整章"
  };
  return labels[mode] || "改写";
}

function fallbackPolishText(text) {
  return text
    .replace(/很快/g, "迅速")
    .replace(/看到/g, "看见")
    .replace(/感觉/g, "察觉")
    .replace(/突然/g, "忽然")
    .trim();
}

function fallbackExpandText(text, context) {
  const planGoal =
    context?.project?.blueprint?.chapterPlans?.find(
      (item) => item.index === context?.chapter?.index
    )?.goal || context?.chapter?.goal;

  const addition = [
    planGoal ? `他心里很清楚，这一段真正要推进的是：${planGoal}` : "",
    "空气里的压迫感没有散去，反而因为这一瞬间的停顿被拉得更紧。",
    "他不得不重新确认自己的判断，因为任何一次迟疑都可能把局势推向更坏的方向。"
  ]
    .filter(Boolean)
    .join("");

  return [text.trim(), addition].filter(Boolean).join("\n\n");
}

function fallbackCompressText(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= 120) return normalized;
  return `${normalized.slice(0, 118).trim()}……`;
}

function buildFallbackRewriteResult(payload) {
  const mode = payload?.mode || "polish";
  const targetText = String(payload?.targetText || "").trim();
  const chapter = payload?.chapter || {};
  const project = payload?.project || {};
  const baseText = targetText || chapter.content || "";

  let content = baseText;

  if (mode === "expand") {
    content = fallbackExpandText(baseText, { project, chapter });
  } else if (mode === "compress") {
    content = fallbackCompressText(baseText);
  } else if (mode === "rewrite" || mode === "rewrite_chapter") {
    content = [
      `【${rewritePromptLabel(mode)}】`,
      fallbackPolishText(baseText)
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    content = fallbackPolishText(baseText);
  }

  return {
    content,
    operation: rewritePromptLabel(mode)
  };
}

function normalizeCharacter(item, index, fallbackCharacter) {
  const source = item && typeof item === "object" ? item : {};
  const fallback = fallbackCharacter || {};
  return {
    id: String(source.id || fallback.id || `char-ai-${index + 1}`),
    name: String(source.name || fallback.name || `角色${index + 1}`),
    role: String(source.role || fallback.role || "角色"),
    personality: String(source.personality || fallback.personality || "待补充"),
    goal: String(source.goal || fallback.goal || "待补充"),
    conflict: String(source.conflict || fallback.conflict || "待补充"),
    traits: toStringList(source.traits, fallback.traits || []),
    relationships: toStringList(source.relationships, fallback.relationships || [])
  };
}

function normalizeBlueprintResult(raw, setup, fallback = buildFallbackBlueprint(setup)) {
  const source = raw && typeof raw === "object" ? raw : {};
  const characters = Array.isArray(source.characters) && source.characters.length
    ? source.characters.map((item, index) =>
        normalizeCharacter(item, index, fallback.characters[index])
      )
    : fallback.characters;

  const chapterPlans = Array.isArray(source.chapterPlans) && source.chapterPlans.length
    ? source.chapterPlans.map((item, index) => ({
        index: Number(item?.index) || index + 1,
        title: String(item?.title || fallback.chapterPlans[index]?.title || `第${index + 1}章`),
        goal: String(item?.goal || fallback.chapterPlans[index]?.goal || "推进主线并制造悬念。"),
        turningPoint: String(
          item?.turningPoint ||
            fallback.chapterPlans[index]?.turningPoint ||
            "下一章将出现更大的外部压力。"
        )
      }))
    : fallback.chapterPlans;

  const volumes = Array.isArray(source.volumes) && source.volumes.length
    ? source.volumes.map((item, index) => ({
        title: String(item?.title || fallback.volumes[index]?.title || `第 ${index + 1} 卷`),
        summary: String(item?.summary || fallback.volumes[index]?.summary || "待补充")
      }))
    : fallback.volumes;

  return {
    titleOptions: toStringList(source.titleOptions, fallback.titleOptions),
    hook: String(source.hook || fallback.hook),
    synopsis: String(source.synopsis || fallback.synopsis),
    worldSetting: String(source.worldSetting || fallback.worldSetting),
    characters,
    mainPlot: String(source.mainPlot || fallback.mainPlot),
    subPlots: toStringList(source.subPlots, fallback.subPlots),
    volumes,
    chapterPlans
  };
}

function normalizeChapterResult(raw, request, fallback) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    title: String(source.title || fallback.title || request.chapter.title || `第 ${request.chapter.index} 章`),
    summary: String(source.summary || fallback.summary || request.chapter.summary || "推进主线"),
    content: String(source.content || fallback.content || request.chapter.content || "")
  };
}

function normalizeChapterAnalysisResult(
  raw,
  payload,
  fallback = buildFallbackChapterAnalysis(payload)
) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    summary: String(source.summary || fallback.summary || payload?.chapter?.summary || "推进主线"),
    memory: normalizeMemoryBundle(source.memory, fallback.memory)
  };
}

function normalizeMemoryRefreshResult(
  raw,
  payload,
  fallback = buildFallbackProjectMemory(payload?.project || {})
) {
  const source = raw && typeof raw === "object" ? raw : {};
  return normalizeMemoryBundle(source.memory || source, fallback);
}

function normalizeRewriteResult(raw, payload, fallback = buildFallbackRewriteResult(payload)) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    content: String(source.content || fallback.content || payload?.targetText || ""),
    operation: String(source.operation || fallback.operation || rewritePromptLabel(payload?.mode))
  };
}

function buildBlueprintMessages(payload) {
  const setup = payload.setup || {};
  return [
    {
      role: "system",
      content:
        "你是资深中文长篇网文策划编辑。请基于用户提供的设定，输出一个严格合法的 JSON 对象，不要输出任何额外解释、Markdown 或代码块。"
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          task: "生成长篇小说蓝图",
          outputSchema: {
            titleOptions: ["string", "string", "string"],
            hook: "string",
            synopsis: "string",
            worldSetting: "string",
            characters: [
              {
                id: "string",
                name: "string",
                role: "string",
                personality: "string",
                goal: "string",
                conflict: "string",
                traits: ["string"],
                relationships: ["string"]
              }
            ],
            mainPlot: "string",
            subPlots: ["string"],
            volumes: [{ title: "string", summary: "string" }],
            chapterPlans: [
              {
                index: 1,
                title: "string",
                goal: "string",
                turningPoint: "string"
              }
            ]
          },
          constraints: [
            "必须是中文",
            "适合长篇连载",
            "chapterPlans 至少给出 10 章",
            "volumes 给出 3 卷左右",
            "不要空字段"
          ],
          setup
        },
        null,
        2
      )
    }
  ];
}

function buildChapterMessages(payload) {
  const project = payload.project || {};
  const chapter = payload.chapter || {};
  const recentChapters = (project.chapters || [])
    .slice(-3)
    .map((item) => ({
      index: item.index,
      title: item.title,
      summary: item.summary,
      excerpt: String(item.content || "").slice(-600)
    }));

  const memory = project.memory || {};
  const compactMemory = {
    characters: (memory.characters || []).slice(0, 6),
    rules: (memory.rules || []).slice(0, 6),
    events: (memory.events || []).slice(-6),
    foreshadowing: (memory.foreshadowing || []).slice(0, 6)
  };

  return [
    {
      role: "system",
      content:
        "你是资深中文网络小说作者兼编辑。请根据已有设定、蓝图、章节目标和记忆信息，输出严格合法的 JSON 对象，不要输出任何额外解释、Markdown 或代码块。正文要求可直接进入小说文档。"
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          task: payload.isContinuation ? "续写当前章节" : "生成章节草稿",
          outputSchema: {
            title: "string",
            summary: "string",
            content: "string"
          },
          constraints: [
            "必须使用中文",
            "文风与用户设定保持一致",
            "不要写成分析报告",
            "正文必须是小说体，不要用条目",
            payload.isContinuation
              ? "续写时要衔接当前正文，不要重复已写内容"
              : "新生成时要尽快进入情节，不要长篇解释背景"
          ],
          projectSetup: project.setup,
          blueprint: {
            hook: project.blueprint?.hook,
            synopsis: project.blueprint?.synopsis,
            worldSetting: project.blueprint?.worldSetting,
            mainPlot: project.blueprint?.mainPlot,
            characters: project.blueprint?.characters || [],
            chapterPlan: (project.blueprint?.chapterPlans || []).find(
              (plan) => plan.index === chapter.index
            )
          },
          chapter,
          recentChapters,
          memory: compactMemory
        },
        null,
        2
      )
    }
  ];
}

function buildChapterAnalysisMessages(payload) {
  const project = payload?.project || {};
  const chapter = payload?.chapter || {};
  const recentChapters = (project.chapters || [])
    .slice(-3)
    .map((item) => ({
      index: item.index,
      title: item.title,
      summary: item.summary
    }));

  return [
    {
      role: "system",
      content:
        "你是中文长篇小说的剧情编辑。请阅读当前章节并输出严格合法的 JSON，不要输出任何额外解释、Markdown 或代码块。摘要要便于后续章节引用；记忆条目只记录稳定事实、关键事件和明确伏笔。"
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          task: "提炼当前章节摘要并抽取记忆增量",
          outputSchema: {
            summary: "string",
            memory: {
              characters: [{ name: "string", content: "string" }],
              locations: [{ name: "string", content: "string" }],
              factions: [{ name: "string", content: "string" }],
              rules: [{ name: "string", content: "string" }],
              events: [{ name: "string", content: "string", sourceChapter: 1 }],
              foreshadowing: [{ name: "string", content: "string", sourceChapter: 1 }]
            }
          },
          constraints: [
            "必须使用中文",
            "summary 控制在 80 字以内",
            "只记录当前章节新增或被确认的重要信息",
            "不要编造章节中不存在的设定",
            "如果某个分类没有新增信息，返回空数组"
          ],
          projectSetup: project.setup,
          blueprint: {
            synopsis: project.blueprint?.synopsis,
            worldSetting: project.blueprint?.worldSetting,
            characters: project.blueprint?.characters || [],
            chapterPlan: (project.blueprint?.chapterPlans || []).find(
              (plan) => plan.index === chapter.index
            )
          },
          recentChapters,
          chapter: {
            index: chapter.index,
            title: chapter.title,
            goal: chapter.goal,
            summary: chapter.summary,
            content: chapter.content
          }
        },
        null,
        2
      )
    }
  ];
}

function buildProjectMemoryRefreshMessages(payload) {
  const project = payload?.project || {};
  const existingMemory = normalizeMemoryBundle(project.memory);
  const recentChapters = (project.chapters || []).slice(-8).map((chapter) => ({
    index: chapter.index,
    title: chapter.title,
    summary: chapter.summary || summarizeChapter(chapter.content)
  }));

  return [
    {
      role: "system",
      content:
        "你是长篇网络小说项目的记忆编辑。请根据蓝图、章节摘要和现有记忆，整理出一份更干净的全局记忆库。输出必须是严格合法的 JSON，不要带解释、Markdown 或代码块。"
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          task: "刷新项目全局记忆库",
          outputSchema: {
            memory: {
              characters: [{ name: "string", content: "string" }],
              locations: [{ name: "string", content: "string" }],
              factions: [{ name: "string", content: "string" }],
              rules: [{ name: "string", content: "string" }],
              events: [{ name: "string", content: "string", sourceChapter: 1 }],
              foreshadowing: [{ name: "string", content: "string", sourceChapter: 1 }]
            }
          },
          constraints: [
            "必须使用中文",
            "按创作连续性整理，优先保留稳定设定",
            "避免重复条目，内容要适合直接注入后续 prompt",
            "每个分类控制在 8 条以内，没有内容可返回空数组"
          ],
          projectSetup: project.setup,
          blueprint: {
            hook: project.blueprint?.hook,
            synopsis: project.blueprint?.synopsis,
            worldSetting: project.blueprint?.worldSetting,
            mainPlot: project.blueprint?.mainPlot,
            characters: project.blueprint?.characters || [],
            chapterPlans: (project.blueprint?.chapterPlans || []).slice(0, 10)
          },
          recentChapters,
          existingMemory
        },
        null,
        2
      )
    }
  ];
}

function buildRewriteMessages(payload) {
  const project = payload?.project || {};
  const chapter = payload?.chapter || {};
  const mode = payload?.mode || "polish";
  const target = payload?.target || "selected";
  const targetText = String(payload?.targetText || "");
  const plan = (project.blueprint?.chapterPlans || []).find(
    (item) => item.index === chapter.index
  );

  return [
    {
      role: "system",
      content:
        "你是中文网络小说编辑。请按要求改写用户提供的文本，并输出严格合法的 JSON，不要输出解释、Markdown 或代码块。改写结果必须可以直接替换原文。"
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          task: rewritePromptLabel(mode),
          outputSchema: {
            content: "string",
            operation: "string"
          },
          constraints: [
            "必须使用中文",
            "保持人称、核心情节和设定一致",
            mode === "expand"
              ? "扩写时增加细节、动作或心理，但不要改剧情走向"
              : "",
            mode === "compress"
              ? "压缩时保留关键信息和情绪推进，删除重复描述"
              : "",
            mode === "rewrite_chapter"
              ? "重写整章时允许重组句子和段落，但不能脱离本章目标"
              : "如果是局部改写，只改写给定片段，不要输出章节外内容",
            "返回的 content 必须是最终改写后的正文"
          ].filter(Boolean),
          projectSetup: project.setup,
          blueprint: {
            synopsis: project.blueprint?.synopsis,
            worldSetting: project.blueprint?.worldSetting,
            chapterPlan: plan,
            characters: project.blueprint?.characters || []
          },
          chapter: {
            index: chapter.index,
            title: chapter.title,
            summary: chapter.summary,
            instruction: chapter.instruction
          },
          target,
          targetText
        },
        null,
        2
      )
    }
  ];
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

module.exports = {
  buildChapterAnalysisMessages,
  buildBlueprintMessages,
  buildChapterMessages,
  buildFallbackBlueprint,
  buildFallbackChapterAnalysis,
  buildFallbackChapter,
  buildFallbackProjectMemory,
  buildFallbackRewriteResult,
  buildProjectMemoryRefreshMessages,
  buildRewriteMessages,
  extractJSONObject,
  mergeMemoryBundle,
  normalizeBlueprintResult,
  normalizeChapterAnalysisResult,
  normalizeChapterResult,
  normalizeMemoryBundle,
  normalizeMemoryRefreshResult,
  normalizeRewriteResult,
  safeErrorMessage
};
