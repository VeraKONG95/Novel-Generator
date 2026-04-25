# Noval

一个面向长篇创作流程的桌面小说生成器 MVP。目标不是做“聊天框套壳”，而是围绕长篇小说的真实工作流，把设定、蓝图、章节、记忆和导出串成一条完整链路。

## 当前能力

- 新建、打开、保存本地项目 JSON
- 项目设定页
- 蓝图生成页
- 写作页三栏布局
- 章节生成与续写
- 记忆库展示与刷新
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

## 下一步建议

1. 为蓝图和章节增加更严格的 schema 校验
2. 增加自动摘要与记忆提取服务
3. 增加局部改写、重写某段、扩写/压缩功能
4. 增加自动保存与崩溃恢复
5. 逐步把项目文件格式版本化，方便后续迁移
