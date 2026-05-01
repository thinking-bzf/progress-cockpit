"""Pluggable data sources.

`claude-progress` is now backed by structured `state.json` (with one-shot migration
from the legacy STATE.md). It supports CRUD on cards.

`claude-tasks` mirrors the original L1AD/claude-task-viewer (read-only).

Both sources expose a uniform read API for the L1AD-style frontend; only
ClaudeProgressSource implements writes.
"""
from __future__ import annotations

import json
import os
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path

from .schema import Card, Finding, ProgressState, Reference, Subtask, utcnow
from .store import (
    archive_md,
    get_or_migrate,
    has_progress,
    load_state,
    save_state,
    state_json_path,
)


class DataSource(ABC):
    name: str

    @abstractmethod
    def list_sessions(self) -> list[dict]: ...

    @abstractmethod
    def get_tasks(self, session_id: str) -> list[dict]: ...

    def all_tasks(self) -> list[dict]:
        out: list[dict] = []
        for s in self.list_sessions():
            for t in self.get_tasks(s["id"]):
                out.append({**t, "sessionId": s["id"], "sessionName": s.get("name"), "project": s.get("project")})
        return out

    # Optional write hooks; default to read-only (404 from API)
    def get_state(self, session_id: str) -> ProgressState | None:
        return None

    def create_card(self, session_id: str, payload: dict) -> Card | None:
        return None

    def update_card(self, session_id: str, card_id: str, patch: dict) -> Card | None:
        return None

    def delete_card(self, session_id: str, card_id: str) -> bool:
        return False

    # Subtasks / references / findings (default unsupported)
    def create_subtask(self, session_id, card_id, payload): return None  # noqa: E704
    def update_subtask(self, session_id, card_id, sub_id, patch): return None  # noqa: E704
    def delete_subtask(self, session_id, card_id, sub_id): return False  # noqa: E704
    def create_reference(self, session_id, card_id, payload): return None  # noqa: E704
    def update_reference(self, session_id, card_id, ref_id, patch): return None  # noqa: E704
    def delete_reference(self, session_id, card_id, ref_id): return False  # noqa: E704
    def create_finding(self, session_id, card_id, payload): return None  # noqa: E704
    def update_finding(self, session_id, card_id, fid, patch): return None  # noqa: E704
    def delete_finding(self, session_id, card_id, fid): return False  # noqa: E704


def _card_to_legacy(c: Card) -> dict:
    """Adapt a structured Card to the L1AD task shape consumed by the existing UI.

    The legacy/Kanban renderer ignores the extra nested arrays; the detail panel
    consumes them.
    """
    return {
        "id": c.id,
        "status": c.status,
        "subject": c.title,
        "description": c.body,
        "section": c.section,
        "blocked": c.blocked,
        "tags": c.tags,
        "priority": c.priority,
        "subtasks": [s.model_dump(mode="json") for s in c.subtasks],
        "references": [r.model_dump(mode="json") for r in c.references],
        "findings": [f.model_dump(mode="json") for f in c.findings],
        "createdAt": c.createdAt.isoformat(),
        "updatedAt": c.updatedAt.isoformat(),
    }


# ---------------------------------------------------------------------------
# .claude-progress source
# ---------------------------------------------------------------------------
class ClaudeProgressSource(DataSource):
    """Reads from the explicit registry — see backend/registry.py."""

    name = "claude-progress"

    def _entries(self) -> list[tuple[str, Path]]:
        from .registry import list_projects

        out: list[tuple[str, Path]] = []
        for pr in list_projects():
            p = Path(pr["path"])
            if p.is_dir() and has_progress(p):
                out.append((pr["id"], p))
        return out

    def _resolve(self, session_id: str) -> Path | None:
        from .registry import find_by_id

        pr = find_by_id(session_id)
        if pr is None:
            return None
        p = Path(pr["path"])
        if p.is_dir() and has_progress(p):
            return p
        return None

    def list_sessions(self) -> list[dict]:
        sessions = []
        for sid, proj in self._entries():
            state = get_or_migrate(proj)
            counts = {"completed": 0, "inProgress": 0, "pending": 0, "blocked": 0}
            for c in state.cards:
                if c.status == "completed":
                    counts["completed"] += 1
                elif c.status == "in_progress":
                    counts["inProgress"] += 1
                else:
                    counts["pending"] += 1
                    if c.blocked:
                        counts["blocked"] += 1
            sessions.append({
                "id": sid,
                "name": sid,
                "slug": sid,
                "project": str(proj),
                "description": None,
                "gitBranch": None,
                "taskCount": len(state.cards),
                **counts,
                "createdAt": None,
                "modifiedAt": state.updatedAt.isoformat(),
            })
        sessions.sort(key=lambda s: s["modifiedAt"], reverse=True)
        return sessions

    def get_tasks(self, session_id: str) -> list[dict]:
        proj = self._resolve(session_id)
        if proj is None:
            return []
        return [_card_to_legacy(c) for c in get_or_migrate(proj).cards]

    def get_state(self, session_id: str) -> ProgressState | None:
        proj = self._resolve(session_id)
        if proj is None:
            return None
        return get_or_migrate(proj)

    def create_card(self, session_id: str, payload: dict) -> Card | None:
        proj = self._resolve(session_id)
        if proj is None:
            return None
        state = get_or_migrate(proj)
        # Title is the only required field
        if not payload.get("title"):
            raise ValueError("title is required")
        card = Card(**payload)
        state.cards.append(card)
        save_state(proj, state)
        return card

    def update_card(self, session_id: str, card_id: str, patch: dict) -> Card | None:
        proj = self._resolve(session_id)
        if proj is None:
            return None
        state = get_or_migrate(proj)
        card = state.find(card_id)
        if card is None:
            return None
        from .schema import utcnow

        protected = {"id", "createdAt"}
        for k, v in patch.items():
            if k in protected or not hasattr(card, k):
                continue
            setattr(card, k, v)
        card.updatedAt = utcnow()
        save_state(proj, state)
        return card

    def delete_card(self, session_id: str, card_id: str) -> bool:
        proj = self._resolve(session_id)
        if proj is None:
            return False
        state = get_or_migrate(proj)
        before = len(state.cards)
        state.cards = [c for c in state.cards if c.id != card_id]
        if len(state.cards) == before:
            return False
        save_state(proj, state)
        return True

    # ---- nested CRUD: subtasks / references / findings ------------------
    def _resolve_card(self, session_id: str, card_id: str):
        proj = self._resolve(session_id)
        if proj is None:
            return None, None, None
        state = get_or_migrate(proj)
        card = state.find(card_id)
        if card is None:
            return proj, state, None
        return proj, state, card

    def _save_after_card_change(self, proj, state, card):
        card.updatedAt = utcnow()
        save_state(proj, state)

    @staticmethod
    def _patch_model(obj, patch: dict, protected=("id", "createdAt")):
        for k, v in patch.items():
            if k in protected or not hasattr(obj, k):
                continue
            setattr(obj, k, v)
        if hasattr(obj, "updatedAt"):
            obj.updatedAt = utcnow()

    # --- subtasks --------------------------------------------------------
    def create_subtask(self, session_id, card_id, payload):
        proj, state, card = self._resolve_card(session_id, card_id)
        if card is None:
            return None
        if not payload.get("title"):
            raise ValueError("title is required")
        sub = Subtask(**payload)
        card.subtasks.append(sub)
        self._save_after_card_change(proj, state, card)
        return sub

    def update_subtask(self, session_id, card_id, sub_id, patch):
        proj, state, card = self._resolve_card(session_id, card_id)
        if card is None:
            return None
        sub = card.find_subtask(sub_id)
        if sub is None:
            return None
        self._patch_model(sub, patch)
        self._save_after_card_change(proj, state, card)
        return sub

    def delete_subtask(self, session_id, card_id, sub_id):
        proj, state, card = self._resolve_card(session_id, card_id)
        if card is None:
            return False
        before = len(card.subtasks)
        card.subtasks = [s for s in card.subtasks if s.id != sub_id]
        # also remove this id from any sibling's blockedBy
        for s in card.subtasks:
            s.blockedBy = [bid for bid in s.blockedBy if bid != sub_id]
        if len(card.subtasks) == before:
            return False
        self._save_after_card_change(proj, state, card)
        return True

    # --- references ------------------------------------------------------
    def create_reference(self, session_id, card_id, payload):
        proj, state, card = self._resolve_card(session_id, card_id)
        if card is None:
            return None
        if not payload.get("title"):
            raise ValueError("title is required")
        ref = Reference(**payload)
        card.references.append(ref)
        self._save_after_card_change(proj, state, card)
        return ref

    def update_reference(self, session_id, card_id, ref_id, patch):
        proj, state, card = self._resolve_card(session_id, card_id)
        if card is None:
            return None
        ref = card.find_reference(ref_id)
        if ref is None:
            return None
        self._patch_model(ref, patch)
        self._save_after_card_change(proj, state, card)
        return ref

    def delete_reference(self, session_id, card_id, ref_id):
        proj, state, card = self._resolve_card(session_id, card_id)
        if card is None:
            return False
        before = len(card.references)
        card.references = [r for r in card.references if r.id != ref_id]
        if len(card.references) == before:
            return False
        self._save_after_card_change(proj, state, card)
        return True

    # --- findings --------------------------------------------------------
    def create_finding(self, session_id, card_id, payload):
        proj, state, card = self._resolve_card(session_id, card_id)
        if card is None:
            return None
        if not (payload.get("body") or "").strip():
            raise ValueError("body is required")
        f = Finding(**payload)
        card.findings.append(f)
        self._save_after_card_change(proj, state, card)
        return f

    def update_finding(self, session_id, card_id, fid, patch):
        proj, state, card = self._resolve_card(session_id, card_id)
        if card is None:
            return None
        f = card.find_finding(fid)
        if f is None:
            return None
        self._patch_model(f, patch)
        self._save_after_card_change(proj, state, card)
        return f

    def delete_finding(self, session_id, card_id, fid):
        proj, state, card = self._resolve_card(session_id, card_id)
        if card is None:
            return False
        before = len(card.findings)
        card.findings = [f for f in card.findings if f.id != fid]
        if len(card.findings) == before:
            return False
        self._save_after_card_change(proj, state, card)
        return True


# ---------------------------------------------------------------------------
# ~/.claude/tasks source — parity with L1AD/claude-task-viewer (read-only)
# ---------------------------------------------------------------------------
class ClaudeTasksSource(DataSource):
    name = "claude-tasks"

    def __init__(self, claude_dir: Path):
        self.claude_dir = claude_dir.expanduser().resolve()
        self.tasks_dir = self.claude_dir / "tasks"

    def _load_tasks(self, dir_: Path) -> list[dict]:
        out = []
        for f in sorted(dir_.glob("*.json")):
            try:
                t = json.loads(f.read_text(encoding="utf-8"))
                t["_path"] = str(f)
                out.append(t)
            except (json.JSONDecodeError, OSError):
                continue
        out.sort(key=lambda t: int(t.get("id", 0)) if str(t.get("id", "")).isdigit() else 0)
        return out

    def list_sessions(self) -> list[dict]:
        if not self.tasks_dir.is_dir():
            return []
        sessions = []
        for d in sorted(self.tasks_dir.iterdir()):
            if not d.is_dir():
                continue
            tasks = self._load_tasks(d)
            counts = {"completed": 0, "inProgress": 0, "pending": 0}
            for t in tasks:
                if t.get("status") == "completed":
                    counts["completed"] += 1
                elif t.get("status") == "in_progress":
                    counts["inProgress"] += 1
                else:
                    counts["pending"] += 1
            mtime = max(
                (Path(t["_path"]).stat().st_mtime for t in tasks if "_path" in t),
                default=d.stat().st_mtime,
            )
            sessions.append({
                "id": d.name,
                "name": None,
                "slug": None,
                "project": None,
                "description": None,
                "gitBranch": None,
                "taskCount": len(tasks),
                **counts,
                "blocked": 0,
                "createdAt": None,
                "modifiedAt": datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat(),
            })
        sessions.sort(key=lambda s: s["modifiedAt"], reverse=True)
        return sessions

    def get_tasks(self, session_id: str) -> list[dict]:
        d = (self.tasks_dir / session_id).resolve()
        if d.parent != self.tasks_dir or not d.is_dir():
            return []
        tasks = self._load_tasks(d)
        for t in tasks:
            p = Path(t.pop("_path"))
            stat = p.stat()
            t.setdefault("createdAt", datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc).isoformat())
            t.setdefault("updatedAt", datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat())
        return tasks


def build_sources() -> dict[str, DataSource]:
    home = Path.home()
    claude_dir = Path(os.environ.get("CLAUDE_DIR", home / ".claude"))
    return {
        ClaudeProgressSource.name: ClaudeProgressSource(),
        ClaudeTasksSource.name: ClaudeTasksSource(claude_dir),
    }
