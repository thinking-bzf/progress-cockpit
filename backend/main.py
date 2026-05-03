"""FastAPI app: read API matches L1AD/claude-task-viewer; write API operates on state.json."""
from __future__ import annotations

import asyncio
import json
import mimetypes
import os
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .sources import ClaudeProgressSource, build_sources
from . import registry
from .store import context_md_path, journal_md_path, state_json_path

DOC_PATHS = {"journal": journal_md_path, "context": context_md_path}

DEFAULT_SOURCE = os.environ.get("PROGRESS_SOURCE", "claude-progress")
PROJECT_ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = PROJECT_ROOT / "frontend" / "dist"


def create_app() -> FastAPI:
    app = FastAPI(title="progress-cockpit", docs_url="/api/docs", redoc_url=None)
    sources = build_sources()

    def pick(name: str | None):
        key = name or DEFAULT_SOURCE
        if key not in sources:
            raise HTTPException(404, f"unknown source '{key}', available: {list(sources)}")
        return sources[key]

    # ---- meta -----------------------------------------------------------
    @app.get("/api/sources")
    def list_sources():
        return [{"name": s.name, "active": s.name == DEFAULT_SOURCE} for s in sources.values()]

    # ---- registry (claude-progress source only) -------------------------
    @app.get("/api/projects/registry")
    def list_registry():
        return registry.list_projects()

    @app.post("/api/projects/registry", status_code=201)
    def add_to_registry(payload: dict = Body(...)):
        path = payload.get("path")
        if not path:
            raise HTTPException(400, "path is required")
        try:
            return registry.register(path, payload.get("id"))
        except ValueError as e:
            raise HTTPException(400, str(e))

    @app.delete("/api/projects/registry/{project_id}")
    def remove_from_registry(project_id: str):
        if not registry.unregister(project_id):
            raise HTTPException(404, f"no project with id={project_id}")
        return {"removed": project_id}

    @app.post("/api/projects/registry/scan")
    def scan_for_projects(payload: dict = Body(default={})):
        added = registry.scan(payload.get("root"))
        return {"added": added}

    # ---- legacy read API consumed by the existing L1AD UI ---------------
    @app.get("/api/sessions")
    def list_sessions(limit: str | int = Query("20"), source: str | None = None):
        items = pick(source).list_sessions()
        if limit != "all":
            try:
                items = items[: max(int(limit), 0)]
            except ValueError:
                pass
        resp = JSONResponse(items)
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.get("/api/sessions/{session_id}")
    def get_session_tasks(session_id: str, source: str | None = None):
        return pick(source).get_tasks(session_id)

    @app.get("/api/tasks/all")
    def all_tasks(source: str | None = None):
        return pick(source).all_tasks()

    @app.post("/api/tasks/{session_id}/{task_id}/note")
    def add_note(session_id: str, task_id: str, payload: dict = Body(...), source: str | None = None):
        src = pick(source)
        if not isinstance(src, ClaudeProgressSource):
            raise HTTPException(400, "writes only supported on claude-progress")
        note = (payload.get("note") or "").strip()
        if not note:
            raise HTTPException(400, "note cannot be empty")
        state = src.get_state(session_id)
        if state is None:
            raise HTTPException(404, "session not found")
        card = state.find(task_id)
        if card is None:
            raise HTTPException(404, "task not found")
        appended = (card.body + "\n\n---\n\n#### [Note]\n\n" + note).strip() if card.body else note
        updated = src.update_card(session_id, task_id, {"body": appended})
        return {"success": True, "card": updated}

    @app.delete("/api/tasks/{session_id}/{task_id}")
    def delete_task(session_id: str, task_id: str, source: str | None = None):
        src = pick(source)
        if not src.delete_card(session_id, task_id):
            raise HTTPException(404, "task not found")
        return {"success": True, "taskId": task_id}

    # ---- structured state API (new) -------------------------------------
    @app.get("/api/projects/{session_id}/state")
    def get_state(session_id: str, source: str | None = None):
        src = pick(source)
        state = src.get_state(session_id)
        if state is None:
            raise HTTPException(404, "session not found or unsupported source")
        return state.model_dump(mode="json")

    # ---- project doc fetch (JOURNAL.md / CONTEXT.md) --------------------
    @app.get("/api/projects/{session_id}/doc/{kind}")
    def get_project_doc(session_id: str, kind: str):
        if kind not in DOC_PATHS:
            raise HTTPException(404, f"unknown doc kind '{kind}'")
        pr = registry.find_by_id(session_id)
        if pr is None:
            raise HTTPException(404, "project not found")
        target = DOC_PATHS[kind](Path(pr["path"]))
        if not target.is_file():
            return {"exists": False, "content": "", "mtime": None, "path": str(target)}
        try:
            content = target.read_text(encoding="utf-8")
        except OSError as e:
            raise HTTPException(500, f"read failed: {e}")
        return {
            "exists": True,
            "content": content,
            "mtime": target.stat().st_mtime,
            "path": str(target),
        }

    # ---- project-local file fetch (for relative reference URLs) ---------
    @app.get("/api/projects/{session_id}/file")
    def get_project_file(session_id: str, path: str = Query(..., min_length=1)):
        """Serve a file from inside a registered project root.

        Used so reference URLs that are relative paths (e.g. `docs/rfc.md`) can
        be opened in the browser. Path is resolved under the project root and
        rejected if it escapes via symlink or `..`.
        """
        pr = registry.find_by_id(session_id)
        if pr is None:
            raise HTTPException(404, "project not found")
        root = Path(pr["path"]).resolve()
        if path.startswith("/") or path.startswith("\\"):
            raise HTTPException(400, "absolute paths not allowed")
        try:
            target = (root / path).resolve()
            target.relative_to(root)
        except (ValueError, OSError):
            raise HTTPException(403, "path escapes project root")
        if not target.is_file():
            raise HTTPException(404, f"file not found: {path}")
        # 10 MB ceiling — tracker references shouldn't be huge binaries
        if target.stat().st_size > 10 * 1024 * 1024:
            raise HTTPException(413, "file too large (>10 MB)")
        # Markdown / unknown text → text/plain so the browser displays inline
        # instead of triggering a download.
        ext = target.suffix.lower()
        if ext in {".md", ".markdown"}:
            media = "text/plain; charset=utf-8"
        else:
            guessed, _ = mimetypes.guess_type(target.name)
            if guessed is None:
                media = "text/plain; charset=utf-8"
            elif guessed.startswith("text/") and "charset" not in guessed:
                media = f"{guessed}; charset=utf-8"
            else:
                media = guessed
        return FileResponse(target, media_type=media)

    @app.post("/api/projects/{session_id}/cards", status_code=201)
    def create_card(session_id: str, payload: dict = Body(...), source: str | None = None):
        src = pick(source)
        try:
            card = src.create_card(session_id, payload)
        except ValueError as e:
            raise HTTPException(400, str(e))
        if card is None:
            raise HTTPException(404, "session not found or source is read-only")
        return card.model_dump(mode="json")

    @app.put("/api/projects/{session_id}/cards/{card_id}")
    def update_card(session_id: str, card_id: str, patch: dict = Body(...), source: str | None = None):
        src = pick(source)
        card = src.update_card(session_id, card_id, patch)
        if card is None:
            raise HTTPException(404, "card not found")
        return card.model_dump(mode="json")

    @app.delete("/api/projects/{session_id}/cards/{card_id}")
    def delete_card(session_id: str, card_id: str, source: str | None = None):
        src = pick(source)
        if not src.delete_card(session_id, card_id):
            raise HTTPException(404, "card not found")
        return {"deleted": card_id}

    # ---- nested CRUD: subtasks / references / findings -----------------
    @app.post("/api/projects/{session_id}/cards/{card_id}/subtasks", status_code=201)
    def _create_subtask(session_id: str, card_id: str, payload: dict = Body(...), source: str | None = None):
        src = pick(source)
        try:
            obj = src.create_subtask(session_id, card_id, payload)
        except ValueError as e:
            raise HTTPException(400, str(e))
        if obj is None:
            raise HTTPException(404, "card not found or source is read-only")
        return obj.model_dump(mode="json")

    @app.put("/api/projects/{session_id}/cards/{card_id}/subtasks/{sub_id}")
    def _update_subtask(session_id: str, card_id: str, sub_id: str, patch: dict = Body(...), source: str | None = None):
        src = pick(source)
        obj = src.update_subtask(session_id, card_id, sub_id, patch)
        if obj is None:
            raise HTTPException(404, "subtask not found")
        return obj.model_dump(mode="json")

    @app.delete("/api/projects/{session_id}/cards/{card_id}/subtasks/{sub_id}")
    def _delete_subtask(session_id: str, card_id: str, sub_id: str, source: str | None = None):
        src = pick(source)
        if not src.delete_subtask(session_id, card_id, sub_id):
            raise HTTPException(404, "subtask not found")
        return {"deleted": sub_id}

    @app.post("/api/projects/{session_id}/cards/{card_id}/references", status_code=201)
    def _create_reference(session_id: str, card_id: str, payload: dict = Body(...), source: str | None = None):
        src = pick(source)
        try:
            obj = src.create_reference(session_id, card_id, payload)
        except ValueError as e:
            raise HTTPException(400, str(e))
        if obj is None:
            raise HTTPException(404, "card not found or source is read-only")
        return obj.model_dump(mode="json")

    @app.put("/api/projects/{session_id}/cards/{card_id}/references/{ref_id}")
    def _update_reference(session_id: str, card_id: str, ref_id: str, patch: dict = Body(...), source: str | None = None):
        src = pick(source)
        obj = src.update_reference(session_id, card_id, ref_id, patch)
        if obj is None:
            raise HTTPException(404, "reference not found")
        return obj.model_dump(mode="json")

    @app.delete("/api/projects/{session_id}/cards/{card_id}/references/{ref_id}")
    def _delete_reference(session_id: str, card_id: str, ref_id: str, source: str | None = None):
        src = pick(source)
        if not src.delete_reference(session_id, card_id, ref_id):
            raise HTTPException(404, "reference not found")
        return {"deleted": ref_id}

    @app.post("/api/projects/{session_id}/cards/{card_id}/findings", status_code=201)
    def _create_finding(session_id: str, card_id: str, payload: dict = Body(...), source: str | None = None):
        src = pick(source)
        try:
            obj = src.create_finding(session_id, card_id, payload)
        except ValueError as e:
            raise HTTPException(400, str(e))
        if obj is None:
            raise HTTPException(404, "card not found or source is read-only")
        return obj.model_dump(mode="json")

    @app.put("/api/projects/{session_id}/cards/{card_id}/findings/{fid}")
    def _update_finding(session_id: str, card_id: str, fid: str, patch: dict = Body(...), source: str | None = None):
        src = pick(source)
        obj = src.update_finding(session_id, card_id, fid, patch)
        if obj is None:
            raise HTTPException(404, "finding not found")
        return obj.model_dump(mode="json")

    @app.delete("/api/projects/{session_id}/cards/{card_id}/findings/{fid}")
    def _delete_finding(session_id: str, card_id: str, fid: str, source: str | None = None):
        src = pick(source)
        if not src.delete_finding(session_id, card_id, fid):
            raise HTTPException(404, "finding not found")
        return {"deleted": fid}

    # ---- SSE: live updates by polling state.json mtimes ----------------
    @app.get("/api/events")
    async def events():
        async def gen():
            yield "event: connected\ndata: {}\n\n"
            seen: dict[str, float] = {}
            seen_docs: dict[tuple[str, str], float] = {}
            registry_mtime: float | None = None
            # Seed without emitting — only changes after this point produce events.
            for pr in registry.list_projects():
                root = Path(pr["path"])
                try:
                    seen[pr["id"]] = state_json_path(root).stat().st_mtime
                except OSError:
                    pass
                for kind, getter in DOC_PATHS.items():
                    try:
                        seen_docs[(pr["id"], kind)] = getter(root).stat().st_mtime
                    except OSError:
                        pass
            try:
                registry_mtime = registry.REGISTRY_PATH.stat().st_mtime
            except OSError:
                pass
            heartbeat = 0
            while True:
                # Detect registry add/remove so the sidebar refreshes.
                try:
                    cur_reg = registry.REGISTRY_PATH.stat().st_mtime
                except OSError:
                    cur_reg = None
                if cur_reg != registry_mtime:
                    registry_mtime = cur_reg
                    yield "event: sessions\ndata: {}\n\n"

                for pr in registry.list_projects():
                    root = Path(pr["path"])
                    pid = pr["id"]
                    try:
                        mt = state_json_path(root).stat().st_mtime
                    except OSError:
                        mt = None
                    if mt is not None and seen.get(pid) != mt:
                        seen[pid] = mt
                        payload = json.dumps({"projectId": pid})
                        yield f"event: state\ndata: {payload}\n\n"
                    for kind, getter in DOC_PATHS.items():
                        try:
                            dmt = getter(root).stat().st_mtime
                        except OSError:
                            dmt = None
                        key = (pid, kind)
                        prev = seen_docs.get(key)
                        if dmt != prev:
                            seen_docs[key] = dmt  # type: ignore[assignment]
                            payload = json.dumps({"projectId": pid, "doc": kind})
                            yield f"event: doc\ndata: {payload}\n\n"

                heartbeat += 1
                if heartbeat >= 15:
                    heartbeat = 0
                    yield ": hb\n\n"
                await asyncio.sleep(1.0)

        return StreamingResponse(
            gen(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # ---- static frontend ------------------------------------------------
    if STATIC_DIR.is_dir():
        # Vite ships hashed assets under /assets; mount the whole tree so they
        # resolve. /assets is the standard Vite output prefix; the old vanilla
        # build had no asset prefix so this is harmless for it.
        if (STATIC_DIR / "assets").is_dir():
            app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

        @app.get("/")
        def index():
            return FileResponse(STATIC_DIR / "index.html")

    return app


app = create_app()


def run() -> None:
    import uvicorn

    port = int(os.environ.get("PORT", "3458"))
    uvicorn.run("backend.main:app", host="127.0.0.1", port=port, reload=False)


if __name__ == "__main__":
    run()
