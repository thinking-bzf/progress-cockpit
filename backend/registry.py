"""Explicit project registry — `progress-cockpit/.config/projects.json`.

The registry is the source of truth for which directories progress-cockpit
shows. On first run (file absent), bootstrap from the legacy
PROGRESS_PROJECTS_ROOT directory. After that, add/remove via the registry API.

Each entry: {id, path}. `id` is what shows up in API URLs; defaults to the
directory basename. Conflicts are auto-suffixed `-2`, `-3`, ...
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from .store import has_progress

PROJECT_ROOT = Path(__file__).resolve().parent.parent
REGISTRY_PATH = PROJECT_ROOT / ".config" / "projects.json"
DEFAULT_BOOTSTRAP_ROOT = Path(
    os.environ.get("PROGRESS_PROJECTS_ROOT", Path.home() / "workspace/projects")
)


def _read_raw() -> dict:
    if not REGISTRY_PATH.is_file():
        return {"projects": []}
    try:
        return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"projects": []}


def _write_raw(data: dict) -> None:
    REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY_PATH.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def _bootstrap() -> list[dict]:
    """Initial scan of DEFAULT_BOOTSTRAP_ROOT to seed the registry."""
    out: list[dict] = []
    if not DEFAULT_BOOTSTRAP_ROOT.is_dir():
        return out
    for child in sorted(DEFAULT_BOOTSTRAP_ROOT.iterdir()):
        if child.is_dir() and has_progress(child):
            out.append({"id": child.name, "path": str(child.resolve())})
    return out


def list_projects() -> list[dict]:
    """Return all registered projects. Bootstraps on first call."""
    if not REGISTRY_PATH.is_file():
        projects = _bootstrap()
        _write_raw({"projects": projects})
        return projects
    return _read_raw().get("projects", [])


def _unique_id(base: str, existing: set[str]) -> str:
    if base not in existing:
        return base
    i = 2
    while f"{base}-{i}" in existing:
        i += 1
    return f"{base}-{i}"


def register(path: str | Path, id: str | None = None) -> dict:
    """Validate + add a project. Idempotent on path: returns existing entry if path matches."""
    p = Path(path).expanduser().resolve()
    if not p.is_dir():
        raise ValueError(f"path does not exist or is not a directory: {p}")
    if not has_progress(p):
        raise ValueError(
            f".claude-progress/ not found at {p}; "
            "run `/progress-tracker init` in that repo first"
        )

    projects = list_projects()
    for pr in projects:
        if pr["path"] == str(p):
            return pr  # already registered

    existing_ids = {pr["id"] for pr in projects}
    final_id = _unique_id(id or p.name, existing_ids)
    entry = {"id": final_id, "path": str(p)}
    projects.append(entry)
    _write_raw({"projects": projects})
    return entry


def unregister(id: str) -> bool:
    projects = list_projects()
    remaining = [pr for pr in projects if pr["id"] != id]
    if len(remaining) == len(projects):
        return False
    _write_raw({"projects": remaining})
    return True


def scan(root: str | Path | None = None) -> list[dict]:
    """Re-scan a directory; register any unregistered children with .claude-progress/."""
    target = Path(root).expanduser().resolve() if root else DEFAULT_BOOTSTRAP_ROOT
    if not target.is_dir():
        return []
    existing_paths = {pr["path"] for pr in list_projects()}
    added: list[dict] = []
    for child in sorted(target.iterdir()):
        if not (child.is_dir() and has_progress(child)):
            continue
        cp = str(child.resolve())
        if cp in existing_paths:
            continue
        try:
            added.append(register(cp))
        except ValueError:
            continue
    return added


def find_by_id(id: str) -> dict | None:
    for pr in list_projects():
        if pr["id"] == id:
            return pr
    return None
