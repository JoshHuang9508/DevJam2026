# DevJam2026 — 安家

台灣選址房仲 agent。前端在 repo 根目錄（Next.js），推薦後端在 `backend/`（Fastify）。

| 目錄 | 內容 |
| --- | --- |
| `app/`、`lib/`、`components/` | Next.js 前端 |
| `backend/` | 推薦後端：deterministic ranking engine、多輪 agent、typed SSE |
| `docs/superpowers/specs/` | 前端設計規格 |
| `docs/backend-integration.md` | 前端 ↔ 後端整合說明 |

## 跑起來

```bash
# 推薦後端 → http://localhost:3001（Swagger UI 在 /docs）
cd backend && pnpm install && pnpm dev

# 物件種子資料（物件卡片需要）
pnpm install && pnpm db:push && pnpm db:seed

# 前端 → http://localhost:3000
pnpm dev
```

| 路徑 | 內容 |
| --- | --- |
| `/` | 主畫面：對話（後端 agent 選行政區）、權重面板、選區、地圖、物件卡片 |
| `/classic` | 只有權重面板的原始畫面，無對話層，方便單獨驗證 scoring engine |

後端預設 `REPOSITORY_MODE=memory`（見 `backend/.env`），不需要 PostgreSQL 或 Docker。
細節與已知落差見 [`docs/backend-integration.md`](docs/backend-integration.md) 與 [`backend/README.md`](backend/README.md)。
