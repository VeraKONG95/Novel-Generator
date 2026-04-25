# Noval

一个面向长篇创作流程的桌面小说生成器 MVP。目标不是做“聊天框套壳”，而是围绕长篇小说的真实工作流，把设定、蓝图、章节、记忆和导出串成一条完整链路。

## 当前能力

- 新建、打开、保存本地项目 JSON
- 项目设定页
- 蓝图生成页
- 写作页三栏布局
- 章节生成与续写
- 章节自动摘要与记忆提取
- 记忆库展示与刷新
- 自动保存与崩溃恢复
- 局部改写、扩写、压缩、整章重写
- Markdown / TXT 导出
- 本地模型设置保存
- OpenAI-compatible 生成链路
- 无 API Key 或模型异常时自动回退到本地模板

## 技术栈

- 桌面层：`Electron`
- 前端：原生 `HTML / CSS / JS Modules`
- 存储：本地 `JSON`
- 生成：Electron 主进程调用 OpenAI-compatible `/chat/completions`

## 目录结构

```text
noval/
├── main.js                  # Electron 主进程，文件读写、设置、生成 IPC
├── preload.js               # 暴露安全 API 给渲染进程
├── services/
│   └── story-engine.js      # prompt 组装、fallback、结果规范化
├── src/
│   ├── index.html
│   ├── styles.css
│   ├── app.mjs              # 渲染进程入口
│   └── app/
│       ├── state.mjs
│       ├── views.mjs
│       ├── project-helpers.mjs
│       └── utils.mjs
├── backups/                 # 每一步开发前的手工备份
└── README.md
```

## 启动

先安装依赖：

```bash
npm install
```

再启动应用：

```bash
npm start
```

## 模型设置

当前先支持 OpenAI-compatible 配置：

- `Provider`
- `Base URL`
- `Model`
- `API Key`

默认值：

- Base URL: `https://api.openai.com/v1`
- Model: `gpt-4.1-mini`

如果没有填写 `API Key`，应用仍然可以运行，但蓝图和章节会走本地模板逻辑，便于先验证产品形态。

## 生成流程

### 蓝图生成

1. 渲染进程收集设定页输入
2. 通过 `preload` 调用 `generation:blueprint`
3. 主进程读取本地模型设置
4. 如果存在 API Key，则请求 OpenAI-compatible 接口
5. 要求模型返回严格 JSON
6. 主进程解析并规范化字段
7. 如果请求失败或未配置 API Key，则回退到本地模板蓝图

### 章节生成

1. 渲染进程提交当前项目、章节、蓝图和记忆信息
2. 主进程组装 prompt
3. 请求模型生成章节 JSON
4. 主进程解析后回传 `{ title, summary, content }`
5. 如果失败，自动回退到本地模板章节

### 章节分析与记忆刷新

1. 每次章节生成或续写完成后，渲染进程会继续调用 `analysis:chapter`
2. 主进程要求模型输出 `{ summary, memory }` JSON
3. 返回的记忆增量会合并到项目记忆库
4. 如果模型不可用，则回退到本地规则，至少更新章节摘要、事件和伏笔
5. 用户也可以在记忆页手动触发 `memory:refresh`，用模型或本地规则重整全局记忆

### 自动保存与恢复

1. 渲染进程在设定编辑、章节编辑、蓝图生成、记忆刷新后会延迟触发 `autosave:save`
2. 主进程把当前项目、路由、当前章节和原始保存路径写入用户目录下的恢复文件
3. 显式“保存项目”或“打开项目”时，会清理旧恢复文件
4. 下次启动时优先读取 `autosave:load`
5. 如果存在未清理的恢复快照，应用会直接恢复到上次中断前的工作状态

### 文本改写

1. 写作页支持 `润色`、`扩写`、`压缩`、`重写本章`
2. 如果正文中存在选中文本，润色/扩写/压缩会优先只处理选中片段
3. 如果没有选中内容，这三个动作会自动作用于整章
4. `重写本章` 始终作用于整章正文
5. 改写完成后会自动重新提炼摘要并同步记忆库

## 当前开发原则

- 先打通主链路：设定 -> 蓝图 -> 章节 -> 记忆 -> 导出
- 每一步开发前先备份改动文件
- 真实模型与本地 fallback 同时保留，避免开发过程中产品不可用
- 让主进程负责模型请求，减少渲染进程直接处理敏感调用

## 已完成步骤

### Step 1

- 把原来的单文件前端拆成模块
- 保持现有功能不变
- 备份目录：
  `backups/step-001-frontend-modularization-20260415-122623`

### Step 2

- 增加 `generation:blueprint` / `generation:chapter` IPC
- 接入 OpenAI-compatible `/chat/completions`
- 增加模型输出 JSON 解析和字段规范化
- 增加无 API Key / 失败时的本地 fallback
- 补齐本 README
- 备份目录：
  `backups/step-002-generation-service-20260415-123444`

### Step 3

- 增加 `analysis:chapter` / `memory:refresh` IPC
- 在章节生成后自动提炼摘要并抽取记忆增量
- 增加全局记忆刷新能力，保留模型与本地规则双通道
- 统一记忆结构规范化与合并逻辑
- 更新设置页与 README 文案
- 备份目录：
  `backups/step-003-memory-service-20260415-124002`

### Step 4

- 增加 `autosave:save` / `autosave:load` / `autosave:clear` IPC
- 支持编辑后的延迟自动保存
- 启动时自动恢复最近一次未清理的草稿快照
- 在显式保存、打开新项目、新建项目时清理旧恢复文件
- 更新界面和 README 文案
- 备份目录：
  `backups/step-004-autosave-recovery-20260415-125650`

### Step 5

- 增加 `rewrite:text` IPC
- 支持局部润色、扩写、压缩和整章重写
- 正文有选区时优先改写选中片段，未选中则自动作用于整章
- 改写后自动更新章节摘要与记忆
- 更新写作页和 README 文案
- 备份目录：
  `backups/step-005-rewrite-tools-20260415-131030`

## 下一步建议

1. 为蓝图、章节和记忆输出增加更严格的 schema 校验
2. 增加更细的改写模式，例如“加强张力”“加快节奏”“突出人物口吻”
3. 逐步把项目文件格式版本化，方便后续迁移
4. 增加更细的记忆锁定机制，避免关键设定被模型覆盖
5. 增加可见的自动保存状态、恢复确认 UI 和改写前后对比视图
