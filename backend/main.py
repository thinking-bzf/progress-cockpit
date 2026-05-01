"""FastAPI app: read API matches L1AD/claude-task-viewer; write API operates on state.json."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .sources import ClaudeProgressSource, build_sources
from . import registry

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

    # ---- SSE placeholder (kept so the UI doesn't error) -----------------
    @app.get("/api/events")
    def events():
        return StreamingResponse(
            iter(['data: {"type":"connected"}\n\n']),
            media_type="text/event-stream",
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
