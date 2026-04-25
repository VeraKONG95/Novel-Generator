# Noval

当前仓库是一个混合工程：

- Electron 主进程与本地能力层：项目保存、自动保存、模型调用、记忆整理、导出
- React + Vite 前端：从 `/Users/vera/Noval` 迁移进来的设计前端

这次迁移的目标不是保留两套互相独立的项目，而是把原先的设计前端真正并入当前 Electron 应用里。

## 当前结构

```text
noval/
├── main.js                  # Electron 主进程
├── preload.js               # 渲染层 API bridge
├── services/
│   ├── project-schema.js    # 项目 schema / 迁移
│   └── story-engine.js      # 生成、改写、记忆逻辑
├── src/
│   ├── main.tsx             # React 前端入口（迁移自 /Users/vera/Noval）
│   ├── app/                 # React 页面、组件、上下文、桥接工具
│   ├── styles/              # 设计样式
│   ├── app.mjs              # 旧版原生前端入口，作为迁移期保留
│   └── index.html           # 旧版 fallback 页面
├── index.html               # Vite / React 入口
├── vite.config.mjs
├── postcss.config.mjs
└── backups/                 # 每一步开发前的手工备份
```

## 启动

先安装依赖：

```bash
npm install
```

开发模式：

```bash
npm run dev
```

这会同时启动：

- Vite 开发服务器
- Electron 桌面壳

生产式本地启动：

```bash
npm start
```

这个命令会先执行 `vite build`，再让 Electron 加载 `dist/index.html`。

## Electron 加载规则

Electron 会按下面的顺序寻找前端入口：

1. 如果存在 `VITE_DEV_SERVER_URL`，加载开发服务器
2. 否则如果存在 `dist/index.html`，加载构建产物
3. 否则回退到旧版 `src/index.html`

## 迁移说明

Step 11 做了这次前端迁移：

- 把 `/Users/vera/Noval` 的 React/Vite 文件迁入当前仓库
- 保留现有 Electron 主进程与服务层
- 改为让 Electron 加载 React 前端
- 把 React 路由切到 hash 模式，兼容 Electron 的 `file://` 场景

备份目录：

`backups/step-011-react-frontend-migration-20260415-142230`

## 当前状态

代码层面已经完成：

- React/Vite 前端文件迁移进仓库
- Electron 与 React 前端加载链打通
- 现有本地服务层继续保留

但要说明清楚：

- 迁移后的 React 前端目前还是以原设计稿的页面和 mock 数据为主
- 我们之前在旧版原生前端里做好的那套完整写作工作流，还没有逐项迁进这套 React 界面

所以当前更准确的状态是：

- 前端设计迁进来了
- Electron 壳也能加载它
- 业务能力层还在
- 但“React 界面完全接管旧功能”还没做完

下一步合理方向是：

1. 先把 React 首页 / 项目页接上 `window.novalAPI`
2. 再逐步替换掉旧版 `app.mjs` 这套原生前端

## Step 12

Step 12 已经把 React 首页和项目页接上了当前 Electron 项目能力：

- 首页不再依赖 `MOCK_PROJECTS`，改为读取当前项目和最近项目列表
- 新建项目会创建真实的项目 schema，而不是只建一个前端卡片
- 支持通过文件对话框打开项目，也支持按最近项目路径直接打开
- 项目页已经接上真实的角色、世界观、大纲、章节数据
- 项目页支持保存项目、自动保存、导出全文
- “生成下一章”已经走现有的 Electron 生成与章节分析链路

这一轮新增的 React 侧关键文件：

- `src/app/context/ProjectContext.tsx`
- `src/app/lib/projectBridge.ts`
- `src/app/types/noval-api.d.ts`

备份目录：

`backups/step-012-react-api-bridge-20260415-143900`

## Step 13

Step 13 补上了 React 版项目页里最关键的蓝图入口：

- 右侧“大纲”区域新增“生成蓝图 / 重新生成蓝图”
- 直接复用现有 `generation:blueprint` IPC 和主进程生成服务
- 生成完成后会自动刷新当前项目的蓝图数据，并直接打开大纲文档
- 这样新建项目后，不需要回退旧版界面，也可以继续跑完整的“蓝图 -> 章节”链路

备份目录：

`backups/step-013-react-blueprint-generation-20260415-160727`

## Step 14

Step 14 把 React 版的连续写作链路又往前推了一截：

- 支持在当前章节基础上直接“续写当前章”
- 手动编辑章节后，Pin 回项目时会自动重做章节分析
- 自动把最新摘要和记忆项同步回项目 memory
- 新增手动“刷新记忆”入口，方便在批量修改后重新整理全局记忆

这一轮主要改动：

- `src/app/pages/ProjectPage.tsx`
- `src/app/components/project/RightPanel.tsx`
- `src/app/components/project/MiddlePanel.tsx`

备份目录：

`backups/step-014-react-continuation-memory-20260415-160959`

## Step 15

Step 15 修复了 `npm start` 时 Electron 生产构建白屏的问题：

- 根因是 `vite build` 产出的 `dist/index.html` 默认使用 `/assets/...` 绝对路径
- Electron 通过 `file://.../dist/index.html` 加载时，绝对路径会指向系统根目录，导致脚本和样式都加载失败
- 现在 `vite.config.mjs` 已设置 `base: "./"`，构建产物会改成相对资源路径

备份目录：

`backups/step-015-electron-blank-window-fix-20260415-161613`

## Step 16

Step 16 把 React 版缺失的“模型设置”界面补回来了：

- 首页和项目页都新增了“模型设置 / 配置 API”入口
- 支持查看和保存 `Provider / Base URL / Model / API Key`
- React 侧已经接上 `loadSettings` 和 `saveSettings`
- 设置保存在本机，不写入项目文件

这一轮新增和修改：

- `src/app/components/modals/SettingsModal.tsx`
- `src/app/context/ProjectContext.tsx`
- `src/app/pages/HomePage.tsx`
- `src/app/pages/ProjectPage.tsx`

备份目录：

`backups/step-016-react-settings-ui-20260415-164329`
