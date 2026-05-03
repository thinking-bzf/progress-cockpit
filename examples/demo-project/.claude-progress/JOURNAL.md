# Project log

> Newest at top. Group by date.

## 2026-04-26

- **decided**: rate limit `/auth/login` at 5/min/IP, 429 + `Retry-After`. Token bucket in Redis. New card `c_e5f6a7b8c9`.

## 2026-04-25

- **hit**: redirect handler `GET /:code` is slow under load — synchronous click increment was the culprit. Switched to async path via Redis queue (subtask `s_bb03000003` follows up).
- **changed**: custom-domain card `c_d4e5f6a7b8` is **blocked** pending legal review of TOS around domain ownership. Park, don't pull.

## 2026-04-23

- **done**: session middleware skeleton wired, but cookie rotation policy still TBD — leaving subtask `s_aa06000006` in_progress until we decide.

## 2026-04-22

- **done**: `POST /auth/login` ships. Constant-time compare, issues `sid` cookie. Cleared subtask `s_aa05000005`.

## 2026-04-20

- **created**: analytics dashboard card `c_c3d4e5f6a7` queued for next sprint. Read-only chart of clicks + referrers.

## 2026-04-18

- **done**: `POST /auth/signup` returns verification token. Email send wiring deferred to subtask `s_aa04000004`.

## 2026-04-14

- **decided**: bcrypt cost = 12. Cost 14 added 1+ second to signup which was visibly slow in the UI; cost 10 felt too cheap given GPU speeds in 2026. See finding `f_aa20000002`.

## 2026-04-12

- **decided**: server-side sessions over JWT. Revocation is one DELETE; a JWT denylist would re-introduce the DB state we wanted to avoid. Recorded as finding `f_aa20000001` on card `c_a1b2c3d4e5`.

## 2026-04-08

- **created**: URL shortening core card `c_b2c3d4e5f6`. Locked in 7-char base62 short codes — 6 chars (56B addressable) felt borderline.

## 2026-04-05

- **done**: `GET /health` returns 200 if DB and Redis are reachable. Card `c_b8c9d0e1f2` complete.

## 2026-04-04

- **done**: alembic wired, initial `links` table + indexes on `short_code` and `owner_id`. Card `c_a7b8c9d0e1` complete.

## 2026-04-01

- **created**: project bootstrap (FastAPI + React + Docker Compose for Postgres + Redis). Card `c_f6a7b8c9d0`.
