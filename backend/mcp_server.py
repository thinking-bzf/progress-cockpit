"""MCP stdio server for progress-cockpit.

Thin wrapper over the local FastAPI backend. Spawned by an MCP-aware client
(e.g. Claude Code) and talks to http://127.0.0.1:3458 by default. Override
with PROGRESS_COCKPIT_URL env var.

The progress-cockpit HTTP server must be running for tools to succeed —
errors surface as `RuntimeError` with the underlying status + detail.

Tool layout (18 total):
    Discovery: list_projects, resolve_project_for_path, register_project
    Read:      list_cards (compact, preferred), get_card (single full),
               get_state (full state — large; rarely the right tool)
    Mutate:    create_card / update_card / delete_card
               create_subtask / update_subtask / delete_subtask
               create_reference / update_reference / delete_reference
               create_finding / update_finding / delete_finding

Read pattern recommended for agents: list_cards → get_card. get_state can
exceed MCP tool-result token limits on mature projects (90k+ chars).
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Literal

import httpx
from mcp.server.fastmcp import FastMCP

BASE_URL = os.environ.get("PROGRESS_COCKPIT_URL", "http://127.0.0.1:3458").rstrip("/")
_client = httpx.Client(base_url=BASE_URL, timeout=10.0)

mcp = FastMCP("progress-cockpit")

Status = Literal["pending", "in_progress", "completed"]


def _api(method: str, path: str, *, json: dict | None = None) -> Any:
    try:
        r = _client.request(method, path, json=json)
    except httpx.ConnectError as e:
        raise RuntimeError(
            f"cannot reach progress-cockpit at {BASE_URL} — is the server running? ({e})"
        ) from e
    if r.status_code >= 400:
        try:
            detail = r.json().get("detail", r.text)
        except Exception:
            detail = r.text
        raise RuntimeError(f"{method} {path} → HTTP {r.status_code}: {detail}")
    if not r.content:
        return None
    return r.json()


def _drop_none(d: dict) -> dict:
    return {k: v for k, v in d.items() if v is not None}


# ---- meta -------------------------------------------------------------------

@mcp.tool()
def list_projects() -> list[dict]:
    """List all registered projects with card counts.

    Returns sessions: id, name, project (path), taskCount, completed/inProgress/pending/blocked.
    Use the `id` as `project_id` for other tools.
    """
    return _api("GET", "/api/sessions")


@mcp.tool()
def resolve_project_for_path(path: str) -> dict | None:
    """Find the registered project whose path is `path` or one of its ancestors.

    Useful when an agent knows its CWD but not the project_id. Returns
    {id, path} or None if no match.
    """
    target = Path(path).expanduser().resolve()
    projects = _api("GET", "/api/projects/registry") or []
    best: dict | None = None
    for pr in projects:
        try:
            base = Path(pr["path"]).resolve()
        except (OSError, KeyError):
            continue
        try:
            target.relative_to(base)
        except ValueError:
            continue
        if best is None or len(str(base)) > len(str(Path(best["path"]).resolve())):
            best = pr
    return best


@mcp.tool()
def register_project(path: str, id: str | None = None) -> dict:
    """Register a directory (must already contain `.claude-progress/`)."""
    return _api("POST", "/api/projects/registry", json=_drop_none({"path": path, "id": id}))


@mcp.tool()
def get_state(project_id: str) -> dict:
    """Full structured state of a project — cards with all subtasks/references/findings.

    WARNING: can be very large (90k+ chars) for mature projects and may exceed the
    MCP tool-result limit. Prefer `list_cards` for an index, then `get_card` for
    drill-down. Only call this when you genuinely need everything in one shot.
    """
    return _api("GET", f"/api/projects/{project_id}/state")


@mcp.tool()
def list_cards(project_id: str, status: Status | None = None) -> list[dict]:
    """Compact index of cards: id, status, title, section, blocked, tags, priority,
    plus counts (subtasks/references/findings + done subtasks) and timestamps.

    Drops all body / nested-array content. Use this first to see what's on the board,
    then `get_card(project_id, card_id)` to drill down on one. Optional `status`
    filter narrows to one column.
    """
    state = _api("GET", f"/api/projects/{project_id}/state")
    out: list[dict] = []
    for c in state.get("cards", []):
        if status is not None and c.get("status") != status:
            continue
        subs = c.get("subtasks") or []
        out.append({
            "id": c["id"],
            "status": c.get("status"),
            "title": c.get("title"),
            "section": c.get("section") or "",
            "blocked": bool(c.get("blocked")),
            "tags": c.get("tags") or [],
            "priority": c.get("priority"),
            "subtaskCount": len(subs),
            "subtaskDoneCount": sum(1 for s in subs if s.get("done")),
            "referenceCount": len(c.get("references") or []),
            "findingCount": len(c.get("findings") or []),
            "createdAt": c.get("createdAt"),
            "updatedAt": c.get("updatedAt"),
        })
    return out


@mcp.tool()
def get_card(project_id: str, card_id: str) -> dict:
    """Full detail of a single card: body + all subtasks / references / findings.

    Use after `list_cards` when you need to inspect or modify one specific card.
    Errors if card_id isn't found in the project.
    """
    state = _api("GET", f"/api/projects/{project_id}/state")
    for c in state.get("cards", []):
        if c.get("id") == card_id:
            return c
    raise RuntimeError(f"card {card_id} not found in project {project_id}")


# ---- cards ------------------------------------------------------------------

@mcp.tool()
def create_card(
    project_id: str,
    title: str,
    body: str | None = None,
    status: Status | None = None,
    section: str | None = None,
    blocked: bool | None = None,
    tags: list[str] | None = None,
    priority: int | None = None,
) -> dict:
    """Create a new requirement card on a project."""
    payload = _drop_none({
        "title": title, "body": body, "status": status, "section": section,
        "blocked": blocked, "tags": tags, "priority": priority,
    })
    return _api("POST", f"/api/projects/{project_id}/cards", json=payload)


@mcp.tool()
def update_card(
    project_id: str,
    card_id: str,
    title: str | None = None,
    body: str | None = None,
    status: Status | None = None,
    section: str | None = None,
    blocked: bool | None = None,
    tags: list[str] | None = None,
    priority: int | None = None,
) -> dict:
    """Patch a card. Only fields you pass are changed."""
    payload = _drop_none({
        "title": title, "body": body, "status": status, "section": section,
        "blocked": blocked, "tags": tags, "priority": priority,
    })
    return _api("PUT", f"/api/projects/{project_id}/cards/{card_id}", json=payload)


@mcp.tool()
def delete_card(project_id: str, card_id: str) -> dict:
    """Delete a card. Subtasks/references/findings on it are deleted with it."""
    return _api("DELETE", f"/api/projects/{project_id}/cards/{card_id}")


# ---- subtasks ---------------------------------------------------------------

@mcp.tool()
def create_subtask(
    project_id: str,
    card_id: str,
    title: str,
    body: str | None = None,
    done: bool | None = None,
    blockedBy: list[str] | None = None,
) -> dict:
    """Add an actionable subtask to a card. `blockedBy` lists sibling subtask ids."""
    payload = _drop_none({"title": title, "body": body, "done": done, "blockedBy": blockedBy})
    return _api("POST", f"/api/projects/{project_id}/cards/{card_id}/subtasks", json=payload)


@mcp.tool()
def update_subtask(
    project_id: str,
    card_id: str,
    subtask_id: str,
    title: str | None = None,
    body: str | None = None,
    done: bool | None = None,
    blockedBy: list[str] | None = None,
) -> dict:
    """Patch a subtask. Pass `done=true` to check it off."""
    payload = _drop_none({"title": title, "body": body, "done": done, "blockedBy": blockedBy})
    return _api("PUT", f"/api/projects/{project_id}/cards/{card_id}/subtasks/{subtask_id}", json=payload)


@mcp.tool()
def delete_subtask(project_id: str, card_id: str, subtask_id: str) -> dict:
    """Delete a subtask. Its id is auto-stripped from any sibling's blockedBy."""
    return _api("DELETE", f"/api/projects/{project_id}/cards/{card_id}/subtasks/{subtask_id}")


# ---- references -------------------------------------------------------------

@mcp.tool()
def create_reference(
    project_id: str,
    card_id: str,
    title: str,
    url: str | None = None,
    note: str | None = None,
) -> dict:
    """Attach an external reference (link, doc, design file) to a card."""
    payload = _drop_none({"title": title, "url": url, "note": note})
    return _api("POST", f"/api/projects/{project_id}/cards/{card_id}/references", json=payload)


@mcp.tool()
def update_reference(
    project_id: str,
    card_id: str,
    reference_id: str,
    title: str | None = None,
    url: str | None = None,
    note: str | None = None,
) -> dict:
    """Patch a reference."""
    payload = _drop_none({"title": title, "url": url, "note": note})
    return _api("PUT", f"/api/projects/{project_id}/cards/{card_id}/references/{reference_id}", json=payload)


@mcp.tool()
def delete_reference(project_id: str, card_id: str, reference_id: str) -> dict:
    """Delete a reference."""
    return _api("DELETE", f"/api/projects/{project_id}/cards/{card_id}/references/{reference_id}")


# ---- findings ---------------------------------------------------------------

@mcp.tool()
def create_finding(
    project_id: str,
    card_id: str,
    body: str,
    title: str | None = None,
) -> dict:
    """Log a research finding (read X doc → conclusion Y; explored code → discovered Z).

    `body` is required; `title` is an optional one-line summary.
    """
    payload = _drop_none({"body": body, "title": title})
    return _api("POST", f"/api/projects/{project_id}/cards/{card_id}/findings", json=payload)


@mcp.tool()
def update_finding(
    project_id: str,
    card_id: str,
    finding_id: str,
    body: str | None = None,
    title: str | None = None,
) -> dict:
    """Patch a finding."""
    payload = _drop_none({"body": body, "title": title})
    return _api("PUT", f"/api/projects/{project_id}/cards/{card_id}/findings/{finding_id}", json=payload)


@mcp.tool()
def delete_finding(project_id: str, card_id: str, finding_id: str) -> dict:
    """Delete a finding."""
    return _api("DELETE", f"/api/projects/{project_id}/cards/{card_id}/findings/{finding_id}")


def run() -> None:
    mcp.run()


if __name__ == "__main__":
    run()
