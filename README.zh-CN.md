# Progress Cockpit

[English](./README.md) · 中文

仓库本地的需求级看板。每张卡承载一个功能/需求,内含子任务、参考资料和过程中沉淀的调研发现 —— 全部以 JSON 形式存在仓库自身里。

搭配 **`progress-tracker`** Claude skill([`skill/`](./skill/) 目录) 与 **MCP server** ([`backend/mcp_server.py`](./backend/mcp_server.py)),AI 助手可以在普通对话中替你登记需求、记录调研、追踪决策,无需切换工具。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/screenshot-board-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="./docs/screenshot-board-light.png">
  <img alt="board" src="./docs/screenshot-board-light.png">
</picture>

## 为什么造这个

主流看板要么独立于仓库(Linear、Jira),要么把每张卡当成一行 todo。这个工具把进度数据**放在仓库里**(`.claude-progress/`,跟着 git 走),并且把卡片设计成**需求形态**:

- `body` —— 这个需求是什么
- `subtasks[]` —— 拆分到可执行的步骤,带卡内依赖
- `references[]` —— 工作时要查阅的外部资料
- `findings[]` —— 工作过程中沉淀的研究结果(读了 X 文档 → 结论 Y;翻了代码 → 发现 Z)

看板渲染同一份数据,REST API 与 MCP server 编辑它,Claude skill 让 AI 替你维护它,你不用切窗口。

## 技术栈

- **后端**: Python 3.11+、FastAPI、Pydantic v2、MCP SDK
- **前端**: React 18 + TypeScript + Vite + dnd-kit + react-query + react-markdown
- **存储**: 每个项目一份 `.claude-progress/state.json`(纯 JSON,放在仓库内)
- **并发**: 每仓库 `threading.Lock` + 原子写(`tmp + fsync + os.replace`),并行 API 写也安全
- **项目发现**: 显式注册表 `<install>/.config/projects.json`(首次启动从 `$PROGRESS_PROJECTS_ROOT` 或 `~/workspace/projects` 引导)

## 安装与启动

一键启动脚本:

```bash
./start.sh              # 生产模式: 后端 :3458 同时托管前端构建产物
./start.sh --dev        # 后端 + Vite 热更新开发服 :5173
./start.sh --rebuild    # 启动前强制重新构建前端
./start.sh --setup      # 只创建 venv、装依赖、构建前端,不启动
```

脚本会自动创建 `.venv`,通过 `pip install -e .` 装 Python 依赖,优先用 `pnpm` (没有则回退 `npm`) 装前端依赖,并按需构建 `frontend/dist/`。首次跑完之后,`./start.sh` 单条命令即可。

如果想手动一步步来,见底部 [手动安装路径](#手动安装)。

### 配置(环境变量)

| 变量 | 默认值 | 作用 |
|---|---|---|
| `PORT` | `3458` | HTTP 端口 |
| `PROGRESS_PROJECTS_ROOT` | `~/workspace/projects` | **只**在首次引导和 `POST /api/projects/registry/scan` 时用,之后注册表文件就是真相源 |
| `CLAUDE_DIR` | `~/.claude` | 备用只读数据源 `claude-tasks` 用 |
| `PROGRESS_SOURCE` | `claude-progress` | 默认数据源 |

## 开机自启(macOS)

`scripts/` 目录下有 LaunchAgent 模板:

```bash
./scripts/launchd.sh install     # 拷贝 plist 到 ~/Library/LaunchAgents 并加载
./scripts/launchd.sh status      # 查看 launchctl print 输出
./scripts/launchd.sh logs        # tail stdout + stderr
./scripts/launchd.sh restart     # 改完代码后重启
./scripts/launchd.sh uninstall
```

日志去 `~/Library/Logs/progress-cockpit.{out,err}.log`。plist 配 `RunAtLoad=true` + `KeepAlive=true` + `ThrottleInterval=10`,登录即起、崩了 10 秒后自动拉,不会 hot-loop。

## 添加项目

两种方式:

1. **从 UI**: 点击侧边栏 Projects 旁的 `+`,填入一个**已有 `.claude-progress/`** 目录的绝对路径(在仓库里跑 `/progress-tracker init` 来初始化)
2. **从 API**:
   ```bash
   curl -X POST http://127.0.0.1:3458/api/projects/registry \
     -H 'Content-Type: application/json' \
     -d '{"path":"/abs/path/to/your/repo"}'
   ```

注册表存在 `<install>/.config/projects.json`,gitignored —— 这是单机状态。

仓库内的 [`examples/demo-project/`](./examples/demo-project) 是个填充好的示例(URL 短链项目: 8 张卡、7 步 DAG、一个 markdown reference) —— 注册这个目录就能看到下面截图里的效果。

## 排序与列视图

每个看板列都有独立的排序下拉菜单(默认序 / Updated · 最新 · 最旧 / Created · 最新 · 最旧 / Title A→Z),按列存 `localStorage`。**Completed 列默认 Updated · 最新**,最近完成的工作总是在最上;另两列默认按手动 / 插入顺序。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/screenshot-sort-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="./docs/screenshot-sort-light.png">
  <img alt="列排序" src="./docs/screenshot-sort-light.png">
</picture>

## 卡片里有什么

点击卡片打开右侧详情面板,这张卡的所有内容一览无遗:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/screenshot-detail-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="./docs/screenshot-detail-light.png">
  <img alt="卡片详情" src="./docs/screenshot-detail-light.png">
</picture>

四个字段 —— `body` / `subtasks[]` / `references[]` / `findings[]` —— 故意分开:

- **`body`** 描述需求(是什么 + 为什么),写一次就稳定下来
- **`subtasks[]`** 是可执行的步骤,带卡内 `blockedBy` 依赖,做完一个划掉一个
- **`references[]`** 是工作时要参考的外部资料(链接、文档、设计稿)
- **`findings[]`** 在工作过程中持续沉淀 —— 调研结果、代码探索发现、决策;每条带时间戳,能看出认知是怎么演进的

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/screenshot-findings-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="./docs/screenshot-findings-light.png">
  <img alt="参考资料和调研发现" src="./docs/screenshot-findings-light.png">
</picture>

### 子任务依赖图

当 subtasks 之间有 `blockedBy` 边时,子任务面板会出现 **List ↔ Graph** 切换。Graph 是分层 DAG: 深度=列,边连依赖,状态着色(绿=已完成 / 灰=待办 / 橙=被未完成项阻塞)。工具栏可缩放,点节点编辑。List 视图保留并用左缩进展示深度,顺序不动。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/screenshot-graph-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="./docs/screenshot-graph-light.png">
  <img alt="子任务 DAG 视图" src="./docs/screenshot-graph-light.png">
</picture>

### 参考资料预览

点击 URL 是相对路径(例 `docs/rfc.md`、`assets/design.png`)的 reference,会以 Mac 空格预览风格的覆盖层打开:Markdown 渲染、图片内嵌、其他文本原文显示。ESC 或点背景关闭,「↗ Open」在新 tab 打开。外部 `https://...` 链接保留默认开新 tab 行为。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/screenshot-preview-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="./docs/screenshot-preview-light.png">
  <img alt="markdown 预览覆盖层" src="./docs/screenshot-preview-light.png">
</picture>

### 长期背景与项目日志

每个项目除了看板外,还有两份自由格式的 markdown 伴侣文档:`.claude-progress/CONTEXT.md`(变动慢的长期事实:技术栈、约定、关键决策)和 `.claude-progress/JOURNAL.md`(按日期倒序的时间线:做完了什么、做了什么决策、踩了什么坑)。两者都以 tab 形式出现在项目头部,文件变动时通过 SSE 热刷新。文件不存在的 tab 会带一个小灰点提示,正文里也会给出该创建的精确路径。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/screenshot-context-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="./docs/screenshot-context-light.png">
  <img alt="长期背景 tab" src="./docs/screenshot-context-light.png">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/screenshot-journal-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="./docs/screenshot-journal-light.png">
  <img alt="项目日志 tab" src="./docs/screenshot-journal-light.png">
</picture>

### 卡片存储结构

```jsonc
{
  "project": "myrepo",
  "cards": [
    {
      "id": "c_a1b2c3d4e5",
      "status": "pending | in_progress | completed",
      "blocked": false,
      "title": "接入鉴权中间件",
      "body": "这个需求是什么 —— 写一次。",
      "section": "backend",
      "tags": [],
      "priority": null,
      "subtasks": [
        { "id": "s_...", "title": "...", "done": false, "body": "...", "blockedBy": ["s_..."] }
      ],
      "references": [
        { "id": "r_...", "title": "...", "url": "...", "note": "..." }
      ],
      "findings": [
        { "id": "f_...", "title": "一行总结", "body": "调研结果" }
      ]
    }
  ]
}
```

## REST API

| 操作 | 接口 |
|---|---|
| 列出项目 | `GET /api/sessions` |
| 读取项目完整状态 | `GET /api/projects/{repo}/state` |
| 创建卡片 | `POST /api/projects/{repo}/cards` |
| 修改卡片 | `PUT /api/projects/{repo}/cards/{cid}` |
| 删除卡片 | `DELETE /api/projects/{repo}/cards/{cid}` |
| 添加 subtask / reference / finding | `POST /api/projects/{repo}/cards/{cid}/{kind}` |
| 修改 / 删除嵌套项 | `PUT \| DELETE /api/projects/{repo}/cards/{cid}/{kind}/{itemId}` |
| 项目内文件(给相对路径 reference 用) | `GET /api/projects/{repo}/file?path=<rel>` |
| 注册表: 列 / 加 / 删 / 扫 | `GET / POST / DELETE /api/projects/registry[/{id}\|/scan]` |

`{kind}` ∈ `subtasks` / `references` / `findings`。`/file` 做了路径越界防护(`..`、绝对路径、符号链接逃逸根目录都会 4xx)。

完整接口文档: `http://127.0.0.1:3458/api/docs` (FastAPI Swagger UI)。

## MCP server

`backend/mcp_server.py` 把数据层包装成 stdio MCP server (`progress-cockpit-mcp`),走本地 FastAPI 进程。会说 MCP 的 agent 直接调用类型化工具,不用自己拼 `curl`。

在 [Claude Code](https://claude.com/claude-code) 里安装:

```bash
claude mcp add progress-cockpit \
  /abs/path/to/progress-cockpit/.venv/bin/progress-cockpit-mcp \
  --env PROGRESS_COCKPIT_URL=http://127.0.0.1:3458
```

或编辑 `~/.claude.json`:

```json
{
  "mcpServers": {
    "progress-cockpit": {
      "command": "/abs/path/to/progress-cockpit/.venv/bin/progress-cockpit-mcp",
      "env": { "PROGRESS_COCKPIT_URL": "http://127.0.0.1:3458" }
    }
  }
}
```

工具一览(共 18 个):

| 类别 | 工具 |
|---|---|
| 发现 | `list_projects` · `resolve_project_for_path` · `register_project` |
| 读取 | `list_cards` (紧凑索引,可选 `status` 过滤) · `get_card` (单卡详情) · `get_state` (全量,容量大,极少用) |
| 卡片 | `create_card` / `update_card` / `delete_card` |
| 子任务 | `create_subtask` / `update_subtask` / `delete_subtask` |
| 参考资料 | `create_reference` / `update_reference` / `delete_reference` |
| 调研发现 | `create_finding` / `update_finding` / `delete_finding` |

**读取惯例**: 优先用 `list_cards` 取索引,再用 `get_card` 钻入单卡。`get_state` 返回**所有**卡的 body + 全部嵌套数组,成熟项目下经常超过 MCP tool-result 的 token 上限。

## Claude skill

`skill/SKILL.md` 是 Claude Agent skill,采用三层写策略:

1. **MCP 工具** —— 如果 `progress-cockpit` MCP server 已连接(首选,类型化参数、无需拼 JSON)
2. **REST API** —— 否则走 HTTP(任何能跑 shell 的 agent)
3. **直接编辑 `state.json`** —— MCP 和 API 都不可达时(最后兜底)

安装到 Claude Code:

```bash
mkdir -p ~/.claude/skills/progress-tracker
cp skill/SKILL.md ~/.claude/skills/progress-tracker/
```

子命令:

- `/progress-tracker load` —— 读 state,汇报当前状态 / 最近日志 / 长期上下文
- `/progress-tracker update` —— 交互式更新流
- `/progress-tracker status` —— 紧凑状态摘要
- `/progress-tracker init` —— 在当前仓库初始化 `.claude-progress/`

也会在自然语言里被动触发(例:"登记一下这个需求"、"我读了 X 得出 Y"、"翻代码发现 ...")。

## 手动安装

不想用 `start.sh` 的话:

```bash
# 1. 后端
python3 -m venv .venv
.venv/bin/pip install -e .

# 2. 前端(一次性构建)
cd frontend
pnpm install
pnpm build
cd ..

# 3. 运行
.venv/bin/python -m backend.main
# → http://127.0.0.1:3458
```

开发态前端热更新: 一个 terminal 跑后端,另一个 `cd frontend && pnpm dev`(Vite 把 `/api` 代理到 `:3458`)。

## 致谢

看板前端最初改自 **[L1AD/claude-task-viewer](https://github.com/L1AD/claude-task-viewer)** —— 一个为 `~/.claude/tasks/` 准备的网页 Kanban。Progress Cockpit 在它基础上长出了:可插拔数据源、不同的存储模型(需求卡 vs. 任务列表)、结构化 schema 的全量 CRUD、拖拽改状态、子任务 DAG 视图、配套 Claude skill 与 MCP server。

## 许可

MIT —— 见 [LICENSE](./LICENSE)。
