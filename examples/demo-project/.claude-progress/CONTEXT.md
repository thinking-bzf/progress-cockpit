# Long-term context

> Stable facts that should always be visible. Update only when the underlying decision changes.

## Architecture conventions

- **Stack**: FastAPI (3.12) on the backend, React + Vite on the frontend, Postgres for primary store, Redis for ephemeral counters.
- **Layering**: HTTP routers under `app/routers/` are thin; business logic lives in `app/services/`; only services touch the DB. Routers may not import from `app/db/` directly.
- **Migrations**: alembic, one file per schema change, numbered `NNN_short_name.sql`. Never edit a merged migration — write a new one.
- **Sessions over JWT**: server-side session cookies (`sid`, HttpOnly, SameSite=Lax). Revocation = single DELETE. JWT was considered and rejected (see JOURNAL 2026-04-12).
- **Async tasks**: anything that can fail without breaking the request (click counters, email sends) goes through Redis + a worker — never block the response path.

## Key decisions

- **bcrypt cost = 12** — ~250ms on a 2024 MBP. Cost 14 was tested but visibly slow on signup. Re-evaluate if hardware budget changes.
- **Short codes = base62, 7 chars** (3.5T addressable). 6 chars (56B) felt borderline; we picked 7 for headroom.
- **Email verification is mandatory** before login is permitted. Single-use 24h token. We do not allow "verify later".
- **No password reset in MVP** — magic-link login is on the roadmap and will subsume it.

## Cross-session must-knows

- **Local dev**: `docker compose up` brings up Postgres + Redis on `localhost:5432` / `localhost:6379`. Test DB is `demo_test`, recreated by the test runner.
- **Secrets**: `.env.example` is committed; `.env` is git-ignored. Never put real secrets in `.env.example`.
- **CI gate**: `pytest` + `ruff check` + `mypy --strict app/` must all pass. Frontend has no CI gate yet (open todo).
- **Deploy target** (when we get there): single VM, systemd-managed gunicorn + nginx reverse proxy. Not k8s — overkill for current scale.
