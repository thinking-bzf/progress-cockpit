# Progress Cockpit

[English](./README.md) · 中文

仓库本地的需求级看板。每张卡承载一个功能/需求,内含子任务、参考资料和过程中沉淀的调研发现 —— 全部以 JSON 形式存在仓库自身里。

搭配 **`progress-tracker`** Claude skill([`skill/`](./skill/) 目录),AI 助手可以在普通对话中替你登记需求、记录调研、追踪决策,无需切换工具。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/screenshot-board-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="./docs/screenshot-board-light.png">
  <img alt="看板" src="./docs/screenshot-board-light.png">
</picture>

## 为什么

主流看板要么活在仓库外(Linear / Jira),要么把每张卡当成一行 todo。这个工具反着来:进展数据**留在仓库里**(`.claude-progress/`,跟随 git),每张卡是一个**需求形态**的对象 —— 不是一行字而是一个结构:

- `body` —— 这个需求是什么
- `subtasks[]` —— 拆解的执行步骤,可勾选,卡内可设依赖
- `references[]` —— 完成时需要参考的外部资料
- `findings[]` —— 推进过程中累积的研究产物(看完 X 文档结论 Y、探完代码发现 Z)

看板渲染同一份数据,REST API 编辑同一份数据,Claude skill 让 AI 不离开对话也能维护它。

## 技术栈

- **后端**:Python 3.11+ / FastAPI / Pydantic v2 —— 一组小而紧的模块
- **前端**:React 18 + TypeScript + Vite + dnd-kit + react-query + react-markdown
- **存储**:每个项目一个 `.claude-progress/state.json`(纯 JSON,放在你自己的仓库里)
- **项目发现**:显式清单文件 `<install>/.config/projects.json`(首次启动从 `$PROGRESS_PROJECTS_ROOT` 或 `~/workspace/projects` 自动 bootstrap)

## 安装与运行

```bash
# 1. 后端
python3 -m venv .venv
.venv/bin/pip install -e .

# 2. 前端(一次性 build)
cd frontend
pnpm install
pnpm build
cd ..

# 3. 启动
.venv/bin/python -m backend.main
# → http://127.0.0.1:3458
```

前端开发(改 React 代码时用,带热重载):

```bash
# 终端 A —— 后端 API
.venv/bin/python -m backend.main

# 终端 B —— Vite dev server,/api 自动代理到 :3458
cd frontend && pnpm dev
# → http://127.0.0.1:5173
```

### 环境变量

| 变量 | 默认值 | 作用 |
|---|---|---|
| `PORT` | `3458` | HTTP 端口 |
| `PROGRESS_PROJECTS_ROOT` | `~/workspace/projects` | **仅**用于首次 bootstrap 和 `POST /api/projects/registry/scan`。一旦清单文件生成,它就是唯一权威 |
| `CLAUDE_DIR` | `~/.claude` | 备选只读数据源 `claude-tasks` 用 |
| `PROGRESS_SOURCE` | `claude-progress` | 默认数据源 |

## 添加项目

两种方式:

1. **从 UI**:点侧栏 `Projects` 旁的 `+`,填入已有 `.claude-progress/` 目录的绝对路径。如果还没初始化,先在那个仓库里跑 `/progress-tracker init`。
2. **走 API**:
   ```bash
   curl -X POST http://127.0.0.1:3458/api/projects/registry \
     -H 'Content-Type: application/json' \
     -d '{"path":"/abs/path/to/your/repo"}'
   ```

清单文件位于 `<install>/.config/projects.json`,已在 `.gitignore` —— 它是机器本地的状态。

## 一张卡里有什么

点开任意卡,右侧面板显示这个需求的全部附属信息:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/screenshot-detail-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="./docs/screenshot-detail-light.png">
  <img alt="卡片详情" src="./docs/screenshot-detail-light.png">
</picture>

四个数据桶 —— `body` / `subtasks[]` / `references[]` / `findings[]` —— 故意分开,各管各的:

- **`body`** 描述需求本身(是什么、为什么),立卡时写一次,稳定
- **`subtasks[]`** 是要做的步骤,可勾选 done,卡内可通过 `blockedBy` 标依赖关系
- **`references[]`** 是外部参考资料(链接、文档、设计稿)
- **`findings[]`** 在推进过程中累积 —— 调研结论、代码探索发现、决策。每条带时间戳,看得到认识是怎么演进的

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/screenshot-findings-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="./docs/screenshot-findings-light.png">
  <img alt="参考资料和调研发现" src="./docs/screenshot-findings-light.png">
</picture>

### 卡的存储结构

```jsonc
{
  "project": "myrepo",
  "cards": [
    {
      "id": "c_a1b2c3d4e5",
      "status": "pending | in_progress | completed",
      "blocked": false,
      "title": "接通 auth 中间件",
      "body": "这个需求是什么 —— 立卡时写一次。",
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
        { "id": "f_...", "title": "一行摘要", "body": "调研产出" }
      ]
    }
  ]
}
```

## REST API

| 操作 | Endpoint |
|---|---|
| 列项目 | `GET /api/sessions` |
| 读单项目完整 state | `GET /api/projects/{repo}/state` |
| 新建卡 | `POST /api/projects/{repo}/cards` |
| 改卡 | `PUT /api/projects/{repo}/cards/{cid}` |
| 删卡 | `DELETE /api/projects/{repo}/cards/{cid}` |
| 加 subtask / reference / finding | `POST /api/projects/{repo}/cards/{cid}/{kind}` |
| 改/删子项 | `PUT \| DELETE /api/projects/{repo}/cards/{cid}/{kind}/{itemId}` |
| 清单管理 | `GET / POST / DELETE /api/projects/registry[/{id} \| /scan]` |

`{kind}` ∈ `subtasks` / `references` / `findings`。

完整接口浏览器:`http://127.0.0.1:3458/api/docs`(FastAPI 自带的 Swagger UI)。

## Claude skill

`skill/SKILL.md` 是配套的 Claude Agent skill,会自动跟这个 server 通信(server 没起时降级到直接编辑 JSON 文件)。

安装到 [Claude Code](https://claude.com/claude-code):

```bash
mkdir -p ~/.claude/skills/progress-tracker
cp skill/SKILL.md ~/.claude/skills/progress-tracker/
```

skill 暴露的子命令:

- `/progress-tracker load` —— 读 state 并汇报当前状态 / 最近日志 / 长期背景
- `/progress-tracker update` —— 交互式更新(按顺序提问)
- `/progress-tracker status` —— 一行摘要
- `/progress-tracker init` —— 在当前仓库初始化 `.claude-progress/`

也会被自然语言触发,比如 "登记一下这个需求"、"我看了 X 文档,结论是 Y"、"探了下代码发现……"。

## 致谢

看板前端最早改自 **[L1AD/claude-task-viewer](https://github.com/L1AD/claude-task-viewer)** —— 一个为 `~/.claude/tasks/` 做的 Web 看板。Progress Cockpit 在它基础上长出来:可插拔数据源、不同的存储模型(需求卡 vs 任务列表)、结构化 schema 上的完整 CRUD、拖拽改状态、配套的 Claude skill。

## License

MIT —— 见 [LICENSE](./LICENSE)。
