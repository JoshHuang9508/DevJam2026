#!/usr/bin/env bash
#
# 資料抓取 pipeline 的 cron 包裝。**cronjob 目前刻意沒有安裝**，要裝的話見檔案末尾。
#
#   /opt/anjia/deploy/refresh-data.sh              # 本期實價登錄 + POI + 捷運 + 災害
#   /opt/anjia/deploy/refresh-data.sh --seasons=115S2,115S1
#
# 做的事：確認 schema 存在 → 跑 pipeline → 讓 web 重新讀資料庫 → 記錄結果。
# 金鑰從 /opt/anjia/.env 讀（compose 會自動載入）。
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/anjia}"
COMPOSE="docker compose -f ${APP_DIR}/docker-compose.prod.yml"
LOG_DIR="${APP_DIR}/data/logs"
LOG_FILE="${LOG_DIR}/refresh-$(date +%Y%m%d-%H%M%S).log"

cd "$APP_DIR"
mkdir -p "$LOG_DIR" "${APP_DIR}/data"

# cron 的 PATH 很窄，通常沒有 /usr/local/bin，docker 會直接找不到
export PATH="/usr/local/bin:/usr/bin:/bin:${PATH}"

exec > >(tee -a "$LOG_FILE") 2>&1
echo "==> $(date -Is) 開始更新資料"

# 資料庫是主機上的 bind mount，第一次跑或被刪掉時要先把 schema 建起來。
# drizzle-kit 在 tools 映像檔裡（prune 之前的那一層）。
if [ ! -f "${APP_DIR}/data/app.db" ]; then
  echo "==> data/app.db 不存在，先建 schema"
  $COMPOSE run --rm --no-deps data-refresh pnpm db:push
fi

echo "==> 跑 pipeline"
# --no-deps：這是批次工作，不需要（也不該）把 backend 拉起來
$COMPOSE run --rm --no-deps data-refresh pnpm fetch:data "$@"

# better-sqlite3 的連線在 Next 行程裡是快取的。pipeline 是就地改同一個 inode，
# 理論上讀得到新資料，但重啟只要幾秒而且能保證不會讀到舊的 page cache。
echo "==> 重啟 web"
$COMPOSE restart web

echo "==> 等待 healthy"
for i in $(seq 1 20); do
  # 用 template 而不是 --format json：json 的欄位是照字母排的，Health 排在 Service
  # 前面，所以 '"Service":"web".*"Health":"healthy"' 這種寫法永遠不會 match。
  if $COMPOSE ps --format '{{.Service}} {{.Status}}' | grep -q '^web .*healthy'; then
    echo "web healthy"
    break
  fi
  if [ "$i" = "20" ]; then
    echo "!! web 沒有回到 healthy，印出日誌"
    $COMPOSE logs --tail=40 web
    exit 1
  fi
  sleep 3
done

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
