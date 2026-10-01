#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
compose=(docker compose --project-name devjam2026 --project-directory "$APP_DIR")
if [[ -f /home/e0pwr/.config/devjam2026/env ]]; then
  compose+=(--env-file /home/e0pwr/.config/devjam2026/env)
fi
compose+=(-f "$APP_DIR/docker-compose.prod.yml" --profile tools)

cd "$APP_DIR"
"${compose[@]}" build data-refresh
"${compose[@]}" run --rm data-refresh
