---
name: progress-tracker
description: >
  Track requirements / subtasks / research / references in a per-repo
  `.claude-progress/` directory, optionally synced via git for cross-device.
  Maintains: state.json (structured cards with subtasks / references / findings,
  editable via the progress-cockpit MCP tools, REST API, or UI), JOURNAL.md
  (append-only timeline), CONTEXT.md (slow-moving long-term notes), archive/
  (history).
  Triggers on slash commands `/progress-tracker`, `/progress-tracker load`,
  `/progress-tracker update`, `/progress-tracker status`, `/progress-tracker init`,
  or natural-language phrases like "log this requirement", "record findings",
  "load project context", "update progress".
  Also: when the user/AI mentions any "new requirement / read X doc / explored
  code / made a decision / found a reference", this skill should proactively
  log it into the appropriate field (card.body / findings / references /
  subtasks) without waiting to be asked explicitly.
---

# progress-tracker

Per-repo project context kept in `<repo>/.claude-progress/`. Pairs with the
**progress-cockpit** local web app for visual editing, but works standalone
via plain file edits.

## Layout

| File | Purpose | Update style |
|---|---|---|
| `.claude-progress/state.json` | Current snapshot (structured cards) | Prefer **progress-cockpit MCP tools**; fall back to **REST API** (http://127.0.0.1:3458) when MCP unavailable; last resort is direct file edit |
| `.claude-progress/JOURNAL.md` | Timeline (completions, decisions, gotchas) | **Append**, newest at top |
| `.claude-progress/CONTEXT.md` | Long-term context (architecture, conventions) | **Slow** — only stable facts |
| `.claude-progress/archive/*.md` | Historical (e.g. legacy STATE.md after migration) | Read-only |

### state.json schema (schemaVersion = 2)

```json
{
  "schemaVersion": 2,
  "project": "<repo name>",
  "updatedAt": "<UTC ISO-8601>",
  "cards": [
    {
      "id": "c_<10 hex>",
      "status": "pending | in_progress | completed",
      "blocked": false,
      "title": "Requirement-level title",
      "body": "What this requirement is about (description, NOT research notes)",
      "section": "optional grouping label",
      "tags": [],
      "priority": null,
      "subtasks": [
        {
          "id": "s_<10 hex>",
          "title": "actionable step",
          "done": false,
          "body": "details in markdown",
          "blockedBy": ["s_xxx"],
          "createdAt": "...",
          "updatedAt": "..."
        }
      ],
      "references": [
        { "id": "r_<10 hex>", "title": "...", "url": "...", "note": "..." }
      ],
      "findings": [
        {
          "id": "f_<10 hex>",
          "title": "one-line summary (optional)",
          "body": "research / exploration result (read X doc → conclusion Y; explored code → discovered Z)",
          "createdAt": "...",
          "updatedAt": "..."
        }
      ],
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

### Field semantics (do not mix)

| Field | Holds |
|---|---|
| `body` | What the requirement *is* — written once, mostly stable |
| `subtasks[]` | Actionable steps to complete this requirement (with intra-card `blockedBy` deps) |
| `references[]` | External material to consult while working (links, docs, design files) |
| `findings[]` | Mid-stream research output: doc conclusions, code exploration facts, design decisions |
| `blocked: true` | The whole card is waiting on an external condition (different from subtask `blockedBy`) |

`subtasks[].blockedBy` references **sibling subtask ids only** (intra-card; not cross-card).

## Write strategy: MCP → API → file

Three tiers, in order of preference. **Pick the highest tier available and
stick with it for the whole task** — don't silently fall back on per-call
errors; surface them to the user.

### Tier selection (decide once per session)

1. **MCP available?** If your tool list includes `progress-cockpit` tools
   (e.g. `create_card`, `get_state`, `list_projects`), use **Path A**.
2. **API up?** Probe once:
   ```bash
   curl -sf -m 1 -o /dev/null http://127.0.0.1:3458/api/sources
   ```
   Exit `0` → use **Path B**.
3. Otherwise → use **Path C** (direct file edit).

`{repo}` = the registered project id, usually the current repo's directory
basename. With MCP, call `resolve_project_for_path` if unsure. With API/file,
use `basename $(git rev-parse --show-toplevel)`.

### Path A — MCP tools (preferred)

Use the `progress-cockpit` MCP server tools directly. Typed args, no JSON
construction. Tools available:

| Op | Tool | required args |
|---|---|---|
| List projects | `list_projects` | – |
| Resolve cwd → project | `resolve_project_for_path` | `path` |
| Register project | `register_project` | `path` |
| **Index cards (preferred read)** | `list_cards` | `project_id`, `status?` |
| **Read one card in full** | `get_card` | `project_id`, `card_id` |
| Read full state — large, rare | `get_state` | `project_id` |
| Create / patch / delete card | `create_card` / `update_card` / `delete_card` | `project_id`, `title` (create) or `card_id` |
| Subtask CRUD | `create_subtask` / `update_subtask` / `delete_subtask` | + `card_id`, `title` (create) or `subtask_id` |
| Reference CRUD | `create_reference` / `update_reference` / `delete_reference` | + `card_id`, `title` (create) or `reference_id` |
| Finding CRUD | `create_finding` / `update_finding` / `delete_finding` | + `card_id`, `body` (create) or `finding_id` |

**Read pattern**: always start with `list_cards` (compact index — id, title,
status, section, blocked, counts). Only call `get_card` for the specific
card(s) you need to inspect or modify. **Avoid `get_state`** — it dumps every
card's body + all nested arrays and routinely blows the MCP tool-result limit
on mature projects.

`update_*` patches are partial — pass only the fields you want to change.
The server auto-bumps `updatedAt`. Deleting a subtask auto-strips its id
from any sibling's `blockedBy`.

Errors come back as tool errors — **surface them, don't fall back** to a
lower tier mid-task. Common: wrong `project_id`, unknown `card_id`, missing
required field.

### Path B — REST API (when MCP unavailable)

Same operations over plain HTTP at `http://127.0.0.1:3458`.

**Card-level CRUD**

| Op | Method + path | body |
|---|---|---|
| List projects | `GET /api/sessions` | – |
| Read full state | `GET /api/projects/{repo}/state` | – |
| Create card | `POST /api/projects/{repo}/cards` | `{title, status?, body?, section?, blocked?, tags?, priority?}` |
| Patch card | `PUT /api/projects/{repo}/cards/{cardId}` | any subset |
| Delete card | `DELETE /api/projects/{repo}/cards/{cardId}` | – |

**Nested CRUD** — `{kind}` ∈ `subtasks` / `references` / `findings`:

| Op | Method + path | body |
|---|---|---|
| Create | `POST /api/projects/{repo}/cards/{cardId}/{kind}` | subtask: `{title, done?, body?, blockedBy?}` ／ reference: `{title, url?, note?}` ／ finding: `{body, title?}` |
| Patch | `PUT  /api/projects/{repo}/cards/{cardId}/{kind}/{itemId}` | any subset |
| Delete | `DELETE /api/projects/{repo}/cards/{cardId}/{kind}/{itemId}` | – |

ID prefixes: subtask `s_`, reference `r_`, finding `f_`. The API auto-updates
`state.updatedAt` and item `updatedAt` — **do not compute timestamps yourself**.

Examples:

```bash
# Move a card to completed and rename it
curl -sf -X PUT http://127.0.0.1:3458/api/projects/myproject/cards/c_a1b2c3d4e5 \
  -H 'Content-Type: application/json' \
  -d '{"status":"completed","title":"Phase A done"}'

# Create a new in_progress card
curl -sf -X POST http://127.0.0.1:3458/api/projects/myproject/cards \
  -H 'Content-Type: application/json' \
  -d '{"title":"Wire auth middleware","status":"in_progress","section":"backend"}'

# Log a research finding on a card
curl -sf -X POST http://127.0.0.1:3458/api/projects/myproject/cards/c_xxx/findings \
  -H 'Content-Type: application/json' \
  -d '{"title":"Service is process-global singleton","body":"`service.py:177-182` reads yaml on boot; no runtime mutation API."}'

# Mark a subtask done
curl -sf -X PUT http://127.0.0.1:3458/api/projects/myproject/cards/c_xxx/subtasks/s_aaa \
  -H 'Content-Type: application/json' -d '{"done":true}'
```

If the API returns 4xx/5xx, **do not silently fall back** — surface the error
to the user. Common causes: wrong `{repo}` name, unknown `cardId`, invalid
payload field.

### Path C — direct file edit (offline fallback)

When neither MCP nor the API is reachable, edit
`<repo>/.claude-progress/state.json` with Read + Edit:

1. **Read** the whole file.
2. By case:
   - **Patch a card field**: `Edit` to swap `"status": "old"` → `"status": "new"`; also bump that card's `"updatedAt"` to current UTC ISO.
   - **Add a card**: insert a new object after `"cards": [` (or after the last card's `},`). Generate `id` via `python3 -c 'import uuid;print("c_"+uuid.uuid4().hex[:10])'`. Set `createdAt` / `updatedAt` to now.
   - **Delete a card**: remove the entire object (and its preceding/trailing comma to keep JSON valid).
3. Bump the top-level `"updatedAt"` too.

After editing, validate with `python3 -m json.tool < state.json` to catch broken JSON before saving in production.

## Repo root resolution

Walk up from `$(pwd)` until you find `.git/`; treat that directory as the repo root. `.claude-progress/` lives there.

## Subcommands

### `load` (default with no args)

1. Read the card index. Path A: `list_cards(project_id)` (preferred; compact). Path B: `GET /api/projects/{repo}/state` (full, fine for small projects). Path C: read `.claude-progress/state.json` directly. Also read `JOURNAL.md` + `CONTEXT.md`. If state.json is missing but a legacy `STATE.md` exists, hint the user to start progress-cockpit (which auto-migrates), or run `/progress-tracker init`.
2. Report in this order:
   - **Current state** — group cards by status (in_progress / pending / completed); flag `blocked: true` ones. Show titles + counts; do **not** dump bodies. If the user asks about a specific card, use `get_card` to fetch its detail.
   - **Recent log** — top 3 dated sections of JOURNAL.md.
   - **Long-term context** — summarize CONTEXT.md (don't dump unless asked).
3. End with: "Run `/progress-tracker update` to update, or edit in progress-cockpit (http://127.0.0.1:3458)."

### `update`

Interactive. Ask one question at a time, **in order**:

1. **What did you just finish?** (optional) → append a line to JOURNAL.md under today; if it implies moving an `in_progress` card to `completed`, also patch that card's `status`.
2. **What are you working on now?** → set the matching card's `status` to `in_progress` (create one if it doesn't exist).
3. **What's next?** → create or update `pending` cards.
4. **Anything blocked / pending confirmation?** (skippable) → set `blocked: true` on the relevant pending card; write reason in `body`.
5. **Any long-term constraints / architectural decisions to record?** (usually skip) → append to CONTEXT.md.

Writes follow the tier strategy above (MCP → API → file). Card IDs are stable — never overwrite the whole file.

The user can answer "skip" or "none" — that section stays unchanged.

**Before writing**: show a `diff`-style preview, get the user's OK, then write.

**Timestamps**: absolute dates `YYYY-MM-DD`, times `HH:MM` (24h). No "today" / "yesterday".

### `status`

Read state.json only and print a compact summary grouped by status. Do not read JOURNAL / CONTEXT.

### `init`

1. Check if `.claude-progress/` already exists. If so, list its files and ask whether to overwrite (default no).
2. Otherwise create the directory plus `state.json` + `JOURNAL.md` + `CONTEXT.md` from the templates below.
3. Remind the user: `git add .claude-progress/ && git commit` to enable cross-device sync.

## Templates

### state.json

```json
{
  "schemaVersion": 2,
  "project": "<repo name>",
  "updatedAt": "<UTC ISO>",
  "cards": []
}
```

### JOURNAL.md

```markdown
# Project log

> Newest at top. Group by date.

## YYYY-MM-DD
- **created**: initialized progress tracking.
```

### CONTEXT.md

```markdown
# Long-term context

## Architecture conventions
- (empty)

## Key decisions
- (empty)

## Cross-session must-knows
- (empty)
```

## Behavior rules

- **Don't copy auto memory into CONTEXT.md.** Auto memory is device-local user-profile material; CONTEXT.md is the team-/cross-device-shared *project* fact base. If something is both (e.g. "project uses a four-layer agent model"), restate it briefly in CONTEXT.md but stick to project facts, not user preferences.
- **JOURNAL.md entries are short**: one line each, prefixed with `**done**` / `**decided**` / `**hit**` / `**changed**` (or any consistent set).
- **state.json doesn't accumulate done history**: keep `completed` cards only while they're contextually relevant; once stale, delete the card and leave a one-line trace in JOURNAL.md.
- **IDs are never reused**: once a `c_xxx` / `s_xxx` / `r_xxx` / `f_xxx` is deleted, that id is dead.
- **Conflict handling**: if any file is in git merge-conflict state (has `<<<<<<<` markers), stop and tell the user to resolve first.
- **Don't auto-commit**: remind the user to `git add / git commit` when appropriate, but don't run those commands unless asked.
