#!/usr/bin/env bash
# 正式機一次性初始化。在伺服器上以能 sudo 的使用者執行：
#
#   curl -fsSL https://raw.githubusercontent.com/JoshHuang9508/DevJam2026/main/deploy/bootstrap.sh | bash
#
# 或 clone 之後 bash deploy/bootstrap.sh
#
# 冪等：重複執行不會壞。
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/anjia}"
REPO="${REPO:-https://github.com/JoshHuang9508/DevJam2026.git}"

log() { printf '\n==> %s\n' "$1"; }

log "檢查 docker"
if ! command -v docker >/dev/null 2>&1; then
  log "安裝 docker"
  curl -fsSL https://get.docker.com | sudo sh
else
  echo "docker 已存在：$(docker --version)"
fi

log "檢查 docker compose plugin"
if ! docker compose version >/dev/null 2>&1; then
  echo "!! docker compose plugin 不存在。Debian/Ubuntu 可裝："
  echo "   sudo apt-get update && sudo apt-get install -y docker-compose-plugin"
  exit 1
fi
echo "$(docker compose version)"

log "讓目前使用者不必 sudo 也能用 docker"
if ! id -nG "$USER" | tr ' ' '\n' | grep -qx docker; then
  sudo usermod -aG docker "$USER"
  echo "已加入 docker group —— 需要重新登入才生效"
  NEED_RELOGIN=1
fi

log "準備 $APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  sudo mkdir -p "$APP_DIR"
  sudo chown "$USER:$USER" "$APP_DIR"
  git clone "$REPO" "$APP_DIR"
else
  echo "已經是 git repo，略過 clone"
fi
cd "$APP_DIR"
git fetch --prune origin
git checkout main 2>/dev/null || git checkout -b main origin/main
git reset --hard origin/main

log "建立 .env.prod（若不存在）"
if [ ! -f .env.prod ]; then
  cat > .env.prod <<'ENVFILE'
# 對外的來源，供後端 CORS 與煙霧測試使用
PUBLIC_ORIGIN=http://35.236.161.192

# ── 模型供應商 ────────────────────────────────────────────────
# 全部留空 = 後端跑 deterministic-fallback（規則式解析）。
# 服務不會壞，但 agent 不會真的理解自然語言。
AGENT_MODE=auto
PI_PROVIDER=google
PI_MODEL=gemini-2.5-flash
GEMINI_API_KEY=

# 若要接自架的 OpenAI 相容端點，改成：
#   PI_PROVIDER=custom-openai
#   PI_MODEL=你的模型 id
#   CUSTOM_OPENAI_BASE_URL=http://127.0.0.1:8080/v1
#   CUSTOM_OPENAI_API_KEY=
# 注意：容器內的 127.0.0.1 是容器自己，不是主機。
# 要打到主機上的服務請用 host.docker.internal 或主機內網 IP。
CUSTOM_OPENAI_BASE_URL=
CUSTOM_OPENAI_API_KEY=
CUSTOM_OPENAI_MODEL_NAME=Custom OpenAI-compatible model

# ── 安全 ──────────────────────────────────────────────────────
# /api/backend/* 是後端的無驗證全方法代理。正式環境維持 false。
ENABLE_BACKEND_PROXY=false
RATE_LIMIT_MAX=60
LOG_LEVEL=info
ENVFILE
  chmod 600 .env.prod
  echo "已建立 .env.prod —— 需要接 LLM 的話請填入金鑰"
else
  echo ".env.prod 已存在，保留不動"
fi

log "第一次建置並啟動"
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

log "狀態"
docker compose -f docker-compose.prod.yml ps

cat <<'DONE'

初始化完成。

接下來要讓 GitHub Actions 能自動部署，在這台機器上執行：

  ssh-keygen -t ed25519 -C 'github-actions-deploy' -f ~/.ssh/deploy_key -N ''
  cat ~/.ssh/deploy_key.pub >> ~/.ssh/authorized_keys
  chmod 600 ~/.ssh/authorized_keys
  echo '--- 私鑰（設成 GitHub secret DEPLOY_SSH_KEY）---'
  cat ~/.ssh/deploy_key
  echo '--- 主機指紋（設成 DEPLOY_SSH_KNOWN_HOSTS）---'
  ssh-keyscan -H "$(curl -s ifconfig.me)" 2>/dev/null

然後在 repo 設定這些 secret（見 deploy/README.md）。
DONE

if [ "${NEED_RELOGIN:-}" = "1" ]; then
  echo
  echo "提醒：你被加進 docker group，請登出再登入，之後才不用 sudo。"
fi
