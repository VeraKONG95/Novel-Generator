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
  const mainPlot = `${protagonistName}从边城遗迹中获得能力后，一边逃亡，一边追查灭门案和旧神复苏之间的联系，最终撕开权力结构最上层的真相。`;
  const subPlots = [
    "主角与引路人之间从互相利用到建立脆弱同盟。",
    "宿敌视角不断推进，形成压迫式追捕线。",
    "主角的能力反噬让每次胜利都带有代价。"
  ];
  const characters = [
    {
      id: "char-1",
      name: protagonistName,
      role: "主角",
      identity: "被宗门放逐的少年",
      personality: "冷静、能忍、对真相有病态执念",
      goal: "查清家族旧案并活下来",
      conflict: "能力越强，反噬越重",
      traits: ["高压下判断快", "对盟友不轻易信任"],
      relationships: ["与引路人互相利用", "与宿敌彼此映照"],
      desire: "查清家族灭门真相，并证明自己不是被命运随意处置的人。",
      fear: "真相证明家族覆灭与自己有关。",
      wound: "被宗门放逐与家族旧案共同造成的羞辱感。",
      secret: "能力来源可能与旧神遗迹存在血脉级联系。",
      ability: "看见因果裂痕，并短暂利用裂痕改写战斗判断。",
      limitation: "每次使用能力都会带来身体反噬和身份暴露风险。",
      relationEdges: [
        {
          id: "rel-1-2",
          targetCharacterId: "char-2",
          targetCharacterName: "沈照微",
          type: "互相利用",
          dynamic: "她给出线索，他提供进入遗迹的钥匙。"
        },
        {
          id: "rel-1-3",
          targetCharacterId: "char-3",
          targetCharacterName: "顾沉霄",
          type: "宿敌",
          dynamic: "顾沉霄越想维持秩序，越把他推向秩序的反面。"
        }
      ],
      arc: [
        {
          id: "arc-1-1",
          stage: "求生",
          change: "从被动逃亡转向主动寻找线索。",
          trigger: "边城遗迹中的第一次能力觉醒。",
          payoff: "愿意为真相承受能力代价。"
        },
        {
          id: "arc-1-2",
          stage: "反攻",
          change: "从只追求复仇转向重写压迫自己的秩序。",
          trigger: "发现灭门案只是旧神复苏计划的一环。",
          payoff: "把个人命运与王朝暗流绑在一起。"
        }
      ]
    },
    {
      id: "char-2",
      name: "沈照微",
      role: "引路人",
      identity: "掌握遗迹情报的神秘协作者",
      personality: "温和外表下极度现实",
      goal: "借主角进入遗迹核心",
      conflict: "必须在利用和保护主角之间做选择",
      traits: ["善于布局", "有隐藏身份"],
      relationships: [`对${protagonistName}半真半假地提供帮助`],
      desire: "拿到遗迹核心里的旧账证据。",
      fear: "自己真正效忠的势力提前暴露。",
      wound: "曾因一次错误判断害死同伴。",
      secret: "她接近主角并非偶然。",
      ability: "情报整合、伪装身份、提前布置退路。",
      limitation: "不能公开背叛原有势力。",
      relationEdges: [
        {
          id: "rel-2-1",
          targetCharacterId: "char-1",
          targetCharacterName: protagonistName,
          type: "危险同盟",
          dynamic: "越了解主角，越难把他只当作工具。"
        }
      ],
      arc: [
        {
          id: "arc-2-1",
          stage: "利用",
          change: "从控制主角路线到承认局势失控。",
          trigger: "主角做出不符合她计划的选择。",
          payoff: "在关键节点交出真正情报。"
        }
      ]
    },
    {
      id: "char-3",
      name: "顾沉霄",
      role: "宿敌",
      identity: "旧秩序的高位执行者",
      personality: "傲慢、强大、极端相信秩序",
      goal: "在旧神复苏前清除一切不稳定因素",
      conflict: "越想镇压乱局，越把主角推向自己的对立面",
      traits: ["强控制欲", "执行力极高"],
      relationships: [`与${protagonistName}注定长期对抗`],
      desire: "维持王朝与宗门共同认可的秩序。",
      fear: "秩序崩塌后自己过去的牺牲变得毫无意义。",
      wound: "曾亲眼见过失控力量毁掉一座城。",
      secret: "他知道灭门案的部分真相，但认为隐瞒更能维持稳定。",
      ability: "调动追捕体系、正面压制、制度性封锁。",
      limitation: "无法理解被秩序牺牲者的立场。",
      relationEdges: [
        {
          id: "rel-3-1",
          targetCharacterId: "char-1",
          targetCharacterName: protagonistName,
          type: "秩序对立",
          dynamic: "他越追杀主角，越证明主角追查方向正确。"
        }
      ],
      arc: [
        {
          id: "arc-3-1",
          stage: "压制",
          change: "从蔑视主角到承认主角是秩序级威胁。",
          trigger: "主角连续破解追捕布局。",
          payoff: "亲自下场，抬高主线压力。"
        }
      ]
    }
  ];
  const plotlines = [
    {
      id: "plot-main",
      type: "main",
      title: "灭门案与旧神复苏主线",
      goal: mainPlot,
      ownerCharacterIds: ["char-1"],
      dependencies: [],
      reveals: ["灭门案不是孤立仇杀", "旧神遗迹正在借人间秩序复苏"],
      foreshadows: ["因果裂痕会指向更高层权力结构", "主角能力来源不干净"],
      payoff: "主角撕开真相，并把个人复仇升级成秩序重写。",
      status: "planned",
      beats: Array.from({ length: 10 }, (_, index) => ({
        id: `beat-main-${index + 1}`,
        title: chapterTitle(index + 1, protagonistName),
        summary: chapterGoal(index + 1, protagonistName, conflict),
        type: index === 0 ? "inciting" : index === 9 ? "turning_point" : "event",
        chapterIndex: index + 1,
        sectionId: "",
        ownerCharacterIds: ["char-1"],
        participantCharacterIds: index >= 5 ? ["char-1", "char-2", "char-3"] : ["char-1"],
        dependencyBeatIds: index > 0 ? [`beat-main-${index}`] : [],
        reveals: index % 3 === 0 ? ["旧案线索出现新解释"] : [],
        foreshadows: [chapterTwist(index + 1)],
        payoff: index === 9 ? "进入更大舞台" : "推动下一章压力升级",
        status: "planned"
      }))
    },
    {
      id: "plot-alliance",
      type: "relationship",
      title: "主角与沈照微的危险同盟",
      goal: subPlots[0],
      ownerCharacterIds: ["char-1", "char-2"],
      dependencies: ["plot-main"],
      reveals: ["沈照微有隐藏身份"],
      foreshadows: ["她的帮助自带代价"],
      payoff: "同盟在关键节点从交易变成选择。",
      status: "planned",
      beats: []
    },
    {
      id: "plot-rival",
      type: "rivalry",
      title: "顾沉霄追捕线",
      goal: subPlots[1],
      ownerCharacterIds: ["char-3"],
      dependencies: ["plot-main"],
      reveals: ["旧秩序知道更多真相"],
      foreshadows: ["宿敌并非单纯反派"],
      payoff: "宿敌亲自下场，把主线压力推高。",
      status: "planned",
      beats: []
    }
  ];

  return {
    titleOptions: [
      `${titleBase}裂痕录`,
      "边城因果师",
      `${genreSeed}：${titleBase}逆命`
    ],
    hook: `${protagonistName}得到禁忌能力后，被迫在更大的阴谋苏醒前抢先成长。`,
    synopsis: `${setup.premise}。故事从一次失控事件开始，主角被推入更残酷的秩序边缘，并在追查真相的过程中不断抬升冲突规模。`,
    worldSetting: `${setup.worldBackground}。力量体系围绕“代价换取能力”展开，每次提升都必须付出实际后果。`,
    storyBible: {
      theme: "人在被秩序牺牲后，是否仍能选择自己的代价。",
      narrativeStyle: setup.tone || "热血、悬疑、升级感强",
      timelineRules: "以主角行动线顺序推进，重大回忆必须由现实线索触发。",
      taboos: ["不要让角色无动机转向", "不要用纯解释替代场景冲突"],
      continuityRules: toStringList(String(setup.extraConstraints || "").split(/[；;]/))
    },
    characters,
    mainPlot,
    subPlots,
    plotlines,
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
      turningPoint: chapterTwist(index + 1),
      plotBeatIds: [`beat-main-${index + 1}`],
      characterArcIds: index < 5 ? ["arc-1-1"] : ["arc-1-2"],
      tensionCurve: index % 3 === 0 ? "开场高压，中段误判，结尾反转" : "开场入局，中段升级，结尾留钩",
      sections: [
        {
          id: `chapter-${index + 1}-section-1`,
          index: 1,
          title: "入场",
          sceneGoal: "迅速把角色放进本章核心压力。",
          pov: protagonistName,
          location: "边城或遗迹相关场景",
          participants: [protagonistName],
          conflict: "外部追压与内部反噬同时出现。",
          outcome: "主角被迫做出选择。",
          hooks: [],
          plotBeatIds: [`beat-main-${index + 1}`],
          characterArcIds: index < 5 ? ["arc-1-1"] : ["arc-1-2"],
          status: "planned"
        },
        {
          id: `chapter-${index + 1}-section-2`,
          index: 2,
          title: "对抗",
          sceneGoal: "用行动推进线索，不用说明堆背景。",
          pov: protagonistName,
          location: "冲突发生地",
          participants: index >= 5 ? [protagonistName, "沈照微"] : [protagonistName],
          conflict: "角色目标与即时危险发生冲突。",
          outcome: "拿到信息，同时付出代价。",
          hooks: [],
          plotBeatIds: [`beat-main-${index + 1}`],
          characterArcIds: index < 5 ? ["arc-1-1"] : ["arc-1-2"],
          status: "planned"
        },
        {
          id: `chapter-${index + 1}-section-3`,
          index: 3,
          title: "钩子",
          sceneGoal: "回收本章冲突，并抛出下一章必须处理的问题。",
          pov: protagonistName,
          location: "本章结尾场景",
          participants: index >= 2 ? [protagonistName, "顾沉霄"] : [protagonistName],
          conflict: "胜利结果暴露更深风险。",
          outcome: chapterTwist(index + 1),
          hooks: [chapterTwist(index + 1)],
          plotBeatIds: [`beat-main-${index + 1}`],
          characterArcIds: index < 5 ? ["arc-1-1"] : ["arc-1-2"],
          status: "planned"
        }
      ]
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
    rewrite_chapter: "重写整章",
    tension: "加强张力",
    pacing: "加快节奏",
    voice: "突出人物口吻",
    ending_hook: "强化结尾钩子"
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

function fallbackTensionText(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return "";
  return [
    normalized,
    "他很清楚，局势已经不再给他留下从容试错的余地，任何一个判断失误都会立刻引爆更大的后果。"
  ].join("\n\n");
}

function fallbackPacingText(text) {
  return String(text || "")
    .replace(/然后/g, "随即")
    .replace(/于是/g, "立刻")
    .replace(/他开始/g, "他立刻")
    .replace(/他想了想/g, "他没有犹豫")
    .trim();
}

function fallbackVoiceText(text, context) {
  const protagonist =
    context?.project?.blueprint?.characters?.[0]?.name ||
    context?.project?.setup?.protagonist?.split(/[，,。；\s]/)[0] ||
    "主角";

  return [
    `${protagonist}第一反应不是退，而是先确认眼前这一步值不值得赌。`,
    String(text || "").trim()
  ]
    .filter(Boolean)
    .join("\n\n");
}

function fallbackEndingHookText(text, context) {
  const turningPoint =
    context?.project?.blueprint?.chapterPlans?.find(
      (item) => item.index === context?.chapter?.index
    )?.turningPoint || context?.chapter?.summary;
  const normalized = String(text || "").trim().replace(/[。？！\s]+$/g, "");
  return [
    normalized,
    turningPoint
      ? `可真正让他心口发紧的，不是眼前这一幕，而是他忽然意识到：${turningPoint}`
      : "可他不知道的是，这一刻推开的门，只是更大危险的前奏。"
  ]
    .filter(Boolean)
    .join("。");
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
  } else if (mode === "tension") {
    content = fallbackTensionText(baseText);
  } else if (mode === "pacing") {
    content = fallbackPacingText(baseText);
  } else if (mode === "voice") {
    content = fallbackVoiceText(baseText, { project, chapter });
  } else if (mode === "ending_hook") {
    content = fallbackEndingHookText(baseText, { project, chapter });
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

function normalizeRelationEdge(item, index, fallbackEdge) {
  const source = item && typeof item === "object" ? item : {};
  const fallback = fallbackEdge || {};
  return {
    id: String(source.id || fallback.id || `rel-ai-${index + 1}`),
    targetCharacterId: String(source.targetCharacterId || fallback.targetCharacterId || ""),
    targetCharacterName: String(source.targetCharacterName || source.name || fallback.targetCharacterName || ""),
    type: String(source.type || source.relationship || fallback.type || "未定义关系"),
    dynamic: String(source.dynamic || source.content || fallback.dynamic || "待补充")
  };
}

function normalizeCharacterArc(item, index, fallbackArc) {
  const source = item && typeof item === "object" ? item : {};
  const fallback = fallbackArc || {};
  return {
    id: String(source.id || fallback.id || `arc-ai-${index + 1}`),
    stage: String(source.stage || source.name || fallback.stage || `阶段 ${index + 1}`),
    change: String(source.change || source.content || fallback.change || "待补充"),
    trigger: String(source.trigger || fallback.trigger || "待补充"),
    payoff: String(source.payoff || fallback.payoff || "待补充")
  };
}

function normalizeCharacter(item, index, fallbackCharacter) {
  const source = item && typeof item === "object" ? item : {};
  const fallback = fallbackCharacter || {};
  const goal = String(source.goal || fallback.goal || "待补充");
  const conflict = String(source.conflict || fallback.conflict || "待补充");
  const relationships = toStringList(source.relationships, fallback.relationships || []);
  return {
    id: String(source.id || fallback.id || `char-ai-${index + 1}`),
    name: String(source.name || fallback.name || `角色${index + 1}`),
    role: String(source.role || fallback.role || "角色"),
    identity: String(source.identity || fallback.identity || source.role || fallback.role || "角色"),
    personality: String(source.personality || fallback.personality || "待补充"),
    goal,
    conflict,
    traits: toStringList(source.traits, fallback.traits || []),
    relationships,
    desire: String(source.desire || fallback.desire || goal),
    fear: String(source.fear || fallback.fear || "待补充"),
    wound: String(source.wound || fallback.wound || "待补充"),
    secret: String(source.secret || fallback.secret || "待补充"),
    ability: String(source.ability || fallback.ability || "待补充"),
    limitation: String(source.limitation || fallback.limitation || conflict),
    relationEdges: Array.isArray(source.relationEdges) && source.relationEdges.length
      ? source.relationEdges.map((edge, edgeIndex) =>
          normalizeRelationEdge(edge, edgeIndex, fallback.relationEdges?.[edgeIndex])
        )
      : (fallback.relationEdges || relationships.map((dynamic) => ({ dynamic }))).map(
          (edge, edgeIndex) => normalizeRelationEdge(edge, edgeIndex)
        ),
    arc: Array.isArray(source.arc) && source.arc.length
      ? source.arc.map((arc, arcIndex) =>
          normalizeCharacterArc(arc, arcIndex, fallback.arc?.[arcIndex])
        )
      : (fallback.arc || []).map((arc, arcIndex) => normalizeCharacterArc(arc, arcIndex))
  };
}

function normalizeStoryBible(source, fallback) {
  const raw = source && typeof source === "object" ? source : {};
  const base = fallback || {};
  return {
    theme: String(raw.theme || base.theme || "待补充"),
    narrativeStyle: String(raw.narrativeStyle || base.narrativeStyle || "待补充"),
    timelineRules: String(raw.timelineRules || base.timelineRules || "待补充"),
    taboos: toStringList(raw.taboos, base.taboos || []),
    continuityRules: toStringList(raw.continuityRules, base.continuityRules || [])
  };
}

function normalizePlotBeat(item, index, fallbackBeat) {
  const source = item && typeof item === "object" ? item : {};
  const fallback = fallbackBeat || {};
  return {
    id: String(source.id || fallback.id || `beat-ai-${index + 1}`),
    title: String(source.title || source.name || fallback.title || `剧情节点 ${index + 1}`),
    summary: String(source.summary || source.content || fallback.summary || "待补充"),
    type: String(source.type || fallback.type || "event"),
    chapterIndex: Number(source.chapterIndex || fallback.chapterIndex) || undefined,
    sectionId: String(source.sectionId || fallback.sectionId || ""),
    ownerCharacterIds: toStringList(source.ownerCharacterIds, fallback.ownerCharacterIds || []),
    participantCharacterIds: toStringList(
      source.participantCharacterIds,
      fallback.participantCharacterIds || []
    ),
    dependencyBeatIds: toStringList(
      source.dependencyBeatIds || source.dependencies,
      fallback.dependencyBeatIds || []
    ),
    reveals: toStringList(source.reveals, fallback.reveals || []),
    foreshadows: toStringList(source.foreshadows, fallback.foreshadows || []),
    payoff: String(source.payoff || fallback.payoff || "待补充"),
    status: String(source.status || fallback.status || "planned")
  };
}

function normalizePlotline(item, index, fallbackPlotline) {
  const source = item && typeof item === "object" ? item : {};
  const fallback = fallbackPlotline || {};
  const sourceBeats = Array.isArray(source.beats) && source.beats.length
    ? source.beats
    : fallback.beats || [];
  return {
    id: String(source.id || fallback.id || `plotline-ai-${index + 1}`),
    type: String(source.type || fallback.type || (index === 0 ? "main" : "subplot")),
    title: String(source.title || source.name || fallback.title || (index === 0 ? "主线" : `支线 ${index}`)),
    goal: String(source.goal || source.summary || source.content || fallback.goal || "待补充"),
    ownerCharacterIds: toStringList(source.ownerCharacterIds || source.owners, fallback.ownerCharacterIds || []),
    dependencies: toStringList(source.dependencies, fallback.dependencies || []),
    reveals: toStringList(source.reveals, fallback.reveals || []),
    foreshadows: toStringList(source.foreshadows, fallback.foreshadows || []),
    payoff: String(source.payoff || fallback.payoff || "待补充"),
    status: String(source.status || fallback.status || "planned"),
    beats: sourceBeats.map((beat, beatIndex) =>
      normalizePlotBeat(beat, beatIndex, fallback.beats?.[beatIndex])
    )
  };
}

function normalizeChapterSectionPlan(item, index, fallbackSection) {
  const source = item && typeof item === "object" ? item : {};
  const fallback = fallbackSection || {};
  return {
    id: String(source.id || fallback.id || `section-plan-ai-${index + 1}`),
    index: Number(source.index || fallback.index) || index + 1,
    title: String(source.title || fallback.title || `第 ${index + 1} 节`),
    sceneGoal: String(source.sceneGoal || source.goal || fallback.sceneGoal || "待补充"),
    pov: String(source.pov || fallback.pov || ""),
    location: String(source.location || fallback.location || ""),
    participants: toStringList(source.participants, fallback.participants || []),
    conflict: String(source.conflict || fallback.conflict || "待补充"),
    outcome: String(source.outcome || fallback.outcome || "待补充"),
    hooks: toStringList(source.hooks, fallback.hooks || []),
    plotBeatIds: toStringList(source.plotBeatIds, fallback.plotBeatIds || []),
    characterArcIds: toStringList(source.characterArcIds, fallback.characterArcIds || []),
    status: String(source.status || fallback.status || "planned")
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
        ),
        plotBeatIds: toStringList(item?.plotBeatIds, fallback.chapterPlans[index]?.plotBeatIds || []),
        characterArcIds: toStringList(
          item?.characterArcIds,
          fallback.chapterPlans[index]?.characterArcIds || []
        ),
        tensionCurve: String(item?.tensionCurve || fallback.chapterPlans[index]?.tensionCurve || "开场入局，中段升级，结尾留钩"),
        sections: Array.isArray(item?.sections) && item.sections.length
          ? item.sections.map((section, sectionIndex) =>
              normalizeChapterSectionPlan(
                section,
                sectionIndex,
                fallback.chapterPlans[index]?.sections?.[sectionIndex]
              )
            )
          : (fallback.chapterPlans[index]?.sections || []).map(normalizeChapterSectionPlan)
      }))
    : fallback.chapterPlans;

  const plotlines = Array.isArray(source.plotlines) && source.plotlines.length
    ? source.plotlines.map((item, index) =>
        normalizePlotline(item, index, fallback.plotlines[index])
      )
    : fallback.plotlines;

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
    storyBible: normalizeStoryBible(source.storyBible, fallback.storyBible),
    characters,
    mainPlot: String(source.mainPlot || fallback.mainPlot),
    subPlots: toStringList(source.subPlots, fallback.subPlots),
    plotlines,
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
            storyBible: {
              theme: "string",
              narrativeStyle: "string",
              timelineRules: "string",
              taboos: ["string"],
              continuityRules: ["string"]
            },
            characters: [
              {
                id: "string",
                name: "string",
                role: "string",
                identity: "string",
                personality: "string",
                goal: "string",
                conflict: "string",
                traits: ["string"],
                relationships: ["string"],
                desire: "string",
                fear: "string",
                wound: "string",
                secret: "string",
                ability: "string",
                limitation: "string",
                relationEdges: [
                  {
                    id: "string",
                    targetCharacterId: "string",
                    targetCharacterName: "string",
                    type: "string",
                    dynamic: "string"
                  }
                ],
                arc: [
                  {
                    id: "string",
                    stage: "string",
                    change: "string",
                    trigger: "string",
                    payoff: "string"
                  }
                ]
              }
            ],
            mainPlot: "string",
            subPlots: ["string"],
            plotlines: [
              {
                id: "string",
                type: "main | subplot | relationship | rivalry | mystery",
                title: "string",
                goal: "string",
                ownerCharacterIds: ["string"],
                dependencies: ["string"],
                reveals: ["string"],
                foreshadows: ["string"],
                payoff: "string",
                status: "planned",
                beats: [
                  {
                    id: "string",
                    title: "string",
                    summary: "string",
                    type: "string",
                    chapterIndex: 1,
                    sectionId: "string",
                    ownerCharacterIds: ["string"],
                    participantCharacterIds: ["string"],
                    dependencyBeatIds: ["string"],
                    reveals: ["string"],
                    foreshadows: ["string"],
                    payoff: "string",
                    status: "planned"
                  }
                ]
              }
            ],
            volumes: [{ title: "string", summary: "string" }],
            chapterPlans: [
              {
                index: 1,
                title: "string",
                goal: "string",
                turningPoint: "string",
                plotBeatIds: ["string"],
                characterArcIds: ["string"],
                tensionCurve: "string",
                sections: [
                  {
                    id: "string",
                    index: 1,
                    title: "string",
                    sceneGoal: "string",
                    pov: "string",
                    location: "string",
                    participants: ["string"],
                    conflict: "string",
                    outcome: "string",
                    hooks: ["string"],
                    plotBeatIds: ["string"],
                    characterArcIds: ["string"],
                    status: "planned"
                  }
                ]
              }
            ]
          },
          constraints: [
            "必须是中文",
            "适合长篇连载",
            "角色必须包含动机、恐惧、创伤、秘密、能力、限制、关系边和成长轨迹",
            "plotlines 必须把主线、关键支线和角色线拆成可追踪事件节点",
            "chapterPlans.sections 每章至少 2 到 4 节，每节必须有场景目标、冲突、结果和钩子",
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
  const targetOrigin = String(payload?.targetOrigin || target);
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
            mode === "tension"
              ? "强化危险感、压迫感和后果预期，但不要无端拔高设定"
              : "",
            mode === "pacing"
              ? "减少拖沓说明，让动作和信息推进更利落"
              : "",
            mode === "voice"
              ? "突出人物口吻、判断方式和情绪惯性，让文字更像该角色自己在经历"
              : "",
            mode === "ending_hook"
              ? "重点强化悬念、反转感或推动读者继续往下读的钩子"
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
          targetOrigin,
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
