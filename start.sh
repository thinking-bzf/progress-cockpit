#!/usr/bin/env bash
# progress-cockpit launcher.
#
# Usage:
#   ./start.sh              # prod-ish: backend serves built frontend on :3458
#   ./start.sh --dev        # backend on :3458 + vite dev server on :5173
#   ./start.sh --rebuild    # force-rebuild frontend dist before starting
#   ./start.sh --setup      # install deps + build frontend, then exit
#
# Env:
#   PORT                  backend port (default 3458)
#   PROGRESS_SOURCE       data source name (default claude-progress)
#   PROGRESS_PROJECTS_ROOT  bootstrap root for project discovery
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

MODE="prod"
REBUILD=0
SETUP_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --dev) MODE="dev" ;;
    --rebuild) REBUILD=1 ;;
    --setup) SETUP_ONLY=1 ;;
    -h|--help)
      sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '\033[1;36m[start]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[start]\033[0m %s\n' "$*" >&2; exit 1; }

# --- prerequisites ----------------------------------------------------------
command -v python3 >/dev/null || die "python3 not found"

PKG_MGR=""
if command -v pnpm >/dev/null; then PKG_MGR="pnpm"
elif command -v npm  >/dev/null; then PKG_MGR="npm"
else die "neither pnpm nor npm found — install one to manage the frontend"
fi

# --- backend setup ----------------------------------------------------------
if [ ! -x ".venv/bin/python" ]; then
  log "creating .venv"
  python3 -m venv .venv
fi

if [ ! -d ".venv/lib" ] || ! .venv/bin/python -c "import backend.main" 2>/dev/null; then
  log "installing backend (pip install -e .)"
  .venv/bin/pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet -e .
fi

# --- frontend setup ---------------------------------------------------------
if [ ! -d "frontend/node_modules" ]; then
  log "installing frontend deps with $PKG_MGR"
  ( cd frontend && $PKG_MGR install )
fi

needs_build=0
[ "$REBUILD" = "1" ] && needs_build=1
[ ! -f "frontend/dist/index.html" ] && needs_build=1

if [ "$MODE" = "prod" ] && [ "$needs_build" = "1" ]; then
  log "building frontend ($PKG_MGR build)"
  ( cd frontend && $PKG_MGR run build )
fi

if [ "$SETUP_ONLY" = "1" ]; then
  log "setup complete"
  exit 0
fi

# --- run --------------------------------------------------------------------
PORT="${PORT:-3458}"
export PORT

PIDS=()
cleanup() {
  trap - INT TERM EXIT
  for pid in "${PIDS[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

if [ "$MODE" = "dev" ]; then
  log "backend  → http://127.0.0.1:$PORT  (api)"
  log "frontend → http://127.0.0.1:5173  (vite, /api proxied to :$PORT)"
  .venv/bin/python -m backend.main &
  PIDS+=("$!")
  ( cd frontend && exec $PKG_MGR run dev ) &
  PIDS+=("$!")
  wait -n "${PIDS[@]}"
else
  log "serving on http://127.0.0.1:$PORT"
  exec .venv/bin/python -m backend.main
fi
