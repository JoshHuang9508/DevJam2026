# 部署

正式機：`devstar1219@35.236.161.192`（GCP）。對外只開一個 port —— 前端的 `80`。
後端只存在於 docker compose 的內部網段，主機上沒有發布它的 port。

```
                     :80
  網際網路 ──────────────────▶ web (next start :3000)
                                 │  BACKEND_URL=http://backend:3001
                                 ▼
                              backend (fastify :3001)   ← 沒有對外 port
```

## 先讀這個

`/api/chat`、`/api/rank`、`/api/agent/*` 都**沒有身分驗證、沒有速率限制、
沒有請求大小上限**。放在公開 IP 上代表任何人找到它就能用。`/api/chat` 每次
會呼叫 Gemini 兩次，等於任何人都能消耗你的額度。

`ENABLE_BACKEND_PROXY` 在正式環境維持 `false` —— 打開等於把整個後端
（含所有 REST 端點）無驗證公開。要看 Swagger 就臨時開、看完關掉。

只有 HTTP，沒有 TLS。GCP 的 IP 沒有網域，Let's Encrypt 無法簽發。
要 HTTPS 得先有網域，再加一層 caddy 或 nginx。

## 一次性初始化（在伺服器上）

```bash
curl -fsSL https://raw.githubusercontent.com/JoshHuang9508/DevJam2026/main/deploy/bootstrap.sh | bash
```

會做：裝 docker（若沒有）、clone 到 `/opt/anjia`、產生 `.env.prod`、建置並啟動。

GCP 防火牆要放行 tcp:80：

```bash
gcloud compute firewall-rules create allow-http-anjia \
  --allow tcp:80 --target-tags=http-server --description='anjia web'
# 並確認 VM 有 http-server tag
```

## 讓 CI/CD 能自動部署

在**伺服器上**產生一組專用 deploy key：

```bash
ssh-keygen -t ed25519 -C 'github-actions-deploy' -f ~/.ssh/deploy_key -N ''
cat ~/.ssh/deploy_key.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
cat ~/.ssh/deploy_key                                    # ← DEPLOY_SSH_KEY
ssh-keyscan -H 35.236.161.192                            # ← DEPLOY_SSH_KNOWN_HOSTS
```

在 repo 設定 secret（Settings → Secrets and variables → Actions），
或用 `gh`：

```bash
gh secret set DEPLOY_SSH_KEY < ~/.ssh/deploy_key         # 從伺服器複製過來
gh secret set DEPLOY_SSH_KNOWN_HOSTS                     # 貼上 ssh-keyscan 輸出
gh secret set DEPLOY_HOST      --body '35.236.161.192'
gh secret set DEPLOY_USER      --body 'devstar1219'
gh secret set DEPLOY_APP_DIR   --body '/opt/anjia'
gh secret set PUBLIC_ORIGIN    --body 'http://35.236.161.192'
```

| Secret | 用途 |
| --- | --- |
| `DEPLOY_SSH_KEY` | 私鑰，供 Actions 連進伺服器 |
| `DEPLOY_SSH_KNOWN_HOSTS` | 主機指紋，避免中間人 |
| `DEPLOY_HOST` / `DEPLOY_USER` | ssh 目標 |
| `DEPLOY_APP_DIR` | 選填，預設 `/opt/anjia` |
| `PUBLIC_ORIGIN` | 部署後煙霧測試打的網址 |

`deploy.yml` 用 `environment: production`。在 repo 建立這個 environment 並加上
required reviewer，就能讓每次上線都要人按一下核准。

## 流程

```
push main ─▶ CI（前端／後端 typecheck+test+build、e2e、docker build）
                │ 全綠
                ▼
             Deploy ─▶ ssh ─▶ git reset --hard origin/main
                              docker compose up -d --build
                              等健康檢查
                              docker image prune
                │
                ▼
             煙霧測試：/ 、/api/agent/session 、/classic
```

CI 失敗就不會部署 —— `deploy.yml` 會檢查 `workflow_run.conclusion == 'success'`。

## 手動操作

```bash
cd /opt/anjia

# 看狀態與日誌
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f --tail=100
docker compose -f docker-compose.prod.yml logs -f backend

# 重啟／重建
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# 回退到上一版
git log --oneline -5
git reset --hard <sha>
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

## 已知限制

- `REPOSITORY_MODE=memory`：session 存在記憶體，容器重啟就清空。要保留對話
  歷史得掛 PostgreSQL（`backend/docker-compose.yml` 有 PostGIS 服務可以搬過來）。
- 物件資料庫 `data/app.db` 是在**映像檔建置時**用 `scripts/seed.ts` 產生的，
  不是掛載的 volume。改種子資料要重新 build 才會生效。
- 沒有設模型金鑰時後端跑 `deterministic-fallback`，畫面左上角徽章會顯示。
