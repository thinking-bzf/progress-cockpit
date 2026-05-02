"""Storage layer for `.claude-progress/state.json` with one-shot migration from STATE.md.

Layout:
    <project>/.claude-progress/
    ├── state.json                 (primary, structured)
    ├── archive/STATE-<ts>.md      (preserved markdown after migration)
    ├── JOURNAL.md                 (untouched)
    └── CONTEXT.md                 (untouched)
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from .parser import parse_state_md
from .schema import SCHEMA_VERSION, Card, ProgressState, gen_card_id, utcnow


def progress_dir(project_root: Path) -> Path:
    return project_root / ".claude-progress"


def state_json_path(project_root: Path) -> Path:
    return progress_dir(project_root) / "state.json"


def state_md_path(project_root: Path) -> Path:
    return progress_dir(project_root) / "STATE.md"


def archive_dir(project_root: Path) -> Path:
    return progress_dir(project_root) / "archive"


def has_progress(project_root: Path) -> bool:
    return state_json_path(project_root).is_file() or state_md_path(project_root).is_file()


def load_state(project_root: Path) -> ProgressState | None:
    p = state_json_path(project_root)
    if not p.is_file():
        return None
    state = ProgressState.model_validate_json(p.read_text(encoding="utf-8"))
    # Forward-migrate older schemas. Pydantic has already filled missing
    # `subtasks` / `references` with empty lists during parse, so for v1 → v2
    # the only thing left is bumping the version stamp and rewriting the file.
    if state.schemaVersion < SCHEMA_VERSION:
        state.schemaVersion = SCHEMA_VERSION
        save_state(project_root, state)
    return state


def save_state(project_root: Path, state: ProgressState) -> None:
    """Atomic write: tmp file → fsync → os.replace. Crash-safe; same-fs rename is atomic on POSIX."""
    progress_dir(project_root).mkdir(exist_ok=True)
    state.updatedAt = utcnow()
    target = state_json_path(project_root)
    tmp = target.with_suffix(target.suffix + ".tmp")
    payload = state.model_dump_json(indent=2, exclude_none=False)
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(payload)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, target)


def archive_md(project_root: Path) -> Path | None:
    md = state_md_path(project_root)
    if not md.is_file():
        return None
    archive_dir(project_root).mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = archive_dir(project_root) / f"STATE-{stamp}.md"
    md.rename(target)
    return target


def migrate_md_to_json(project_root: Path) -> ProgressState:
    """Parse existing STATE.md, write state.json, archive the markdown."""
    md = state_md_path(project_root)
    if not md.is_file():
        empty = ProgressState(project=project_root.name)
        save_state(project_root, empty)
        return empty

    raw_cards = parse_state_md(md.read_text(encoding="utf-8"))
    md_mtime = datetime.fromtimestamp(md.stat().st_mtime, tz=timezone.utc)

    cards: list[Card] = []
    for rc in raw_cards:
        cards.append(
            Card(
                id=gen_card_id(),
                status=rc["status"],
                blocked=rc.get("blocked", False),
                title=rc["subject"],
                body=rc.get("description", ""),
                section=rc.get("section", ""),
                createdAt=md_mtime,
                updatedAt=md_mtime,
            )
        )

    state = ProgressState(project=project_root.name, updatedAt=md_mtime, cards=cards)
    save_state(project_root, state)
    archive_md(project_root)
    return state


def get_or_migrate(project_root: Path) -> ProgressState:
    state = load_state(project_root)
    if state is not None:
        return state
    return migrate_md_to_json(project_root)
