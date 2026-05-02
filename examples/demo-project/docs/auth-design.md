# Auth design — URL shortener

## Summary

Email + password sign-up, server-side sessions stored in Postgres, signed
cookies for session lookup. JWT was considered and dropped because we want
trivial revocation (logout = delete row).

## Components

1. **Users table** — id, email (unique, citext), password_hash, created_at.
2. **Sessions table** — id (random 192-bit), user_id, created_at, expires_at.
3. **Password hashing** — bcrypt, cost factor 12.
4. **Signup endpoint** `POST /auth/signup`:
   - Validates email format + uniqueness
   - Hashes password
   - Inserts user, returns `verification_token` for email link
5. **Email verification** `GET /auth/verify?token=...`
   - Single-use token, 24-hour expiry
6. **Login endpoint** `POST /auth/login`
   - Constant-time compare on hash
   - Issues session cookie (`HttpOnly`, `Secure`, `SameSite=Lax`)
7. **Session middleware**
   - Validates cookie, attaches `request.user` (or 401)
8. **Logout endpoint** `POST /auth/logout`
   - Deletes session row, clears cookie

## Decisions

- **Why server sessions over JWT** — revocation is trivial (one DELETE),
  no need to maintain a denylist. Slight cost: one DB lookup per
  authenticated request, mitigated by session cache.
- **Why bcrypt cost 12** — ~250ms on commodity hardware in 2026, balances
  user perception of login latency vs offline crack resistance.
- **Why 192-bit session ids** — overkill on purpose; cookie size is not a
  bottleneck and birthday collisions become a non-concern.

## Open questions

- Rate limiting on `/auth/login` — implement at gateway (nginx) or app level?
- Should we expose `/auth/me`? Useful for SPA, but couples API to UI.
