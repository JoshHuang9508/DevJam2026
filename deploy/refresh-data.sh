#!/usr/bin/env bash
#
# 資料抓取 pipeline 的 cron 包裝。**cronjob 目前刻意沒有安裝**，要裝的話見檔案末尾。
#
#   /opt/anjia/deploy/refresh-data.sh              # 本期實價登錄 + POI + 捷運 + 災害
#   /opt/anjia/deploy/refresh-data.sh --seasons=115S2,115S1
#
# 做的事：確認 schema 存在 → 跑 pipeline → 記錄結果。
# 金鑰從 /opt/anjia/.env 讀（compose 會自動載入）。
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/anjia}"
COMPOSE="docker compose -f ${APP_DIR}/docker-compose.prod.yml"
LOG_DIR="${APP_DIR}/logs"
LOG_FILE="${LOG_DIR}/refresh-$(date +%Y%m%d-%H%M%S).log"

cd "$APP_DIR"
mkdir -p "$LOG_DIR"

# cron 的 PATH 很窄，通常沒有 /usr/local/bin，docker 會直接找不到
export PATH="/usr/local/bin:/usr/bin:/bin:${PATH}"

exec > >(tee -a "$LOG_FILE") 2>&1
echo "==> $(date -Is) 開始更新資料"

# --build 是必要的：data-refresh 有 profiles: ["tools"]，部署時的
# `up -d --build` 會整個跳過它，所以它的映像檔不會跟著程式碼更新。
# 少了這個旗標，pipeline 會拿舊版程式跑出舊結果，而且看起來完全成功。
# --no-deps：這是批次工作，不需要（也不該）把 backend 拉起來
$COMPOSE build data-refresh

if ! $COMPOSE run --rm --no-deps --entrypoint sh data-refresh -c 'test -f /app/data/app.db'; then
  echo "==> app.db 不存在，先建立 schema 與示範資料"
  $COMPOSE run --rm --no-deps data-refresh pnpm db:push
  $COMPOSE run --rm --no-deps data-refresh pnpm db:seed
fi

echo "==> 跑 pipeline"
$COMPOSE run --rm --no-deps data-refresh pnpm fetch:data "$@"

echo "==> 現有資料量"
$COMPOSE run --rm --no-deps --entrypoint node data-refresh -e \
  "const D=require('better-sqlite3');const db=new D('/app/data/app.db',{readonly:true});
   console.log(db.prepare('SELECT mode, COUNT(*) n FROM listings GROUP BY mode').all());"

# 日誌留 30 天就好，正式機的磁碟不大
find "$LOG_DIR" -name 'refresh-*.log' -mtime +30 -delete 2>/dev/null || true

echo "==> $(date -Is) 完成"

# ---------------------------------------------------------------------------
# 要啟用定時更新時再執行下面這行（現在刻意沒裝）：
#
#   crontab -l 2>/dev/null | { cat; echo "30 4 * * * /opt/anjia/deploy/refresh-data.sh"; } | crontab -
#
# 排在 04:30 是因為實價登錄本期檔每月 1/11/21 更新，凌晨跑不會撞到白天的使用；
# 每天跑但來源有快取（實價登錄 12 小時、POI 7 天、氣候 30 天），
# 不會真的每天去重抓幾百 MB。
#
# 停用：crontab -e 把該行刪掉。
# ---------------------------------------------------------------------------
