#!/usr/bin/env bash
# Manage the progress-cockpit LaunchAgent.
#
# Usage:
#   scripts/launchd.sh install     # copy plist to ~/Library/LaunchAgents and load it
#   scripts/launchd.sh uninstall   # unload and remove plist
#   scripts/launchd.sh restart     # kickstart the running job
#   scripts/launchd.sh status      # show launchctl print output
#   scripts/launchd.sh logs        # tail both log files
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="local.$(id -un).progress-cockpit"
TEMPLATE="$REPO_ROOT/scripts/launchd.plist.template"
DST_PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs"
DOMAIN="gui/$(id -u)"

cmd="${1:-}"
case "$cmd" in
  install)
    [ -f "$TEMPLATE" ] || { echo "missing $TEMPLATE" >&2; exit 1; }
    mkdir -p "$LOG_DIR" "$(dirname "$DST_PLIST")"
    sed -e "s|@LABEL@|$LABEL|g" \
        -e "s|@REPO_ROOT@|$REPO_ROOT|g" \
        -e "s|@HOME@|$HOME|g" \
        "$TEMPLATE" > "$DST_PLIST"
    launchctl bootout  "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$DST_PLIST"
    launchctl enable    "$DOMAIN/$LABEL"
    echo "installed → $DST_PLIST"
    echo "label     → $LABEL"
    echo "logs      → $LOG_DIR/progress-cockpit.{out,err}.log"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$DST_PLIST"
    echo "uninstalled $LABEL"
    ;;
  restart)
    launchctl kickstart -k "$DOMAIN/$LABEL"
    echo "restarted $LABEL"
    ;;
  status)
    launchctl print "$DOMAIN/$LABEL" 2>/dev/null | sed -n '1,/^$/p' \
      || { echo "not loaded — run: $0 install" >&2; exit 1; }
    ;;
  logs)
    exec tail -F "$LOG_DIR/progress-cockpit.out.log" "$LOG_DIR/progress-cockpit.err.log"
    ;;
  ""|-h|--help)
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *)
    echo "unknown subcommand: $cmd" >&2
    exit 2
    ;;
esac
