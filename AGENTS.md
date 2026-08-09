# Remote Code Agent：AI Agent 指引

本文件只給 AI Agent 使用。人類部署與操作說明以 [`README.md`](README.md) 為準。

## 適用範圍

在此 repo 進行程式修改、本機驗證、Cloudflare 部署、部署後驗收或故障診斷時，先遵守本文件，再讀取與任務相關的 README 章節。除非使用者明確要求，不要把「檢查」或「診斷」擴大成部署、建立外部資源或修改既有基礎設施。

本專案只使用 Cloudflare Workers、Static Assets、Tunnel 與 Access；不得建立 Firebase、Firestore 或其他資料庫資源。

## 閱讀順序

1. 讀取 README 的「架構與安全模型」及「機密與個資清單」。
2. 檢查 `wrangler.jsonc`、`.gitignore`、`package.json` 與任務涉及的 source files。
3. 部署 backend 前，依目標作業系統讀取對應 installer：
   - Linux：`scripts/install-user-service.sh`
   - macOS backend：`scripts/install-macos-service.sh`
   - macOS Tunnel：`scripts/install-macos-tunnel-service.sh`
4. 部署或驗收時，再依 README 的編號順序讀取「事前需求」至「8. 驗證完整路徑」。
5. 驗證實際使用行為時，讀取 README 的「手機操作」、「AI 程式助理模式」、「手機上傳檔案」與「多個持久化 session」。

## 開始部署前的必要資訊

部署前必須由使用者指定或確認以下資料，不得從範例值猜測：

- 目標 instance 與作業系統
- `PUBLIC_HOSTNAME`
- `ORIGIN_HOSTNAME`
- `ACCESS_TEAM_DOMAIN`
- 公開入口 Access application 的 `ACCESS_AUD`
- `WORKSPACE_DIR`
- Cloudflare account，以及要建立或沿用的 Tunnel 名稱
- 公開入口允許哪些 email、群組或 IdP identity

若任一選擇會改變資源歸屬、安全邊界或費用，而本機與 Cloudflare 現況無法安全判定，先說明缺少的資訊並請使用者決定。

## 一般開發與驗證

修改前先理解現有行為並檢查 worktree，保留使用者的既有變更。採用符合任務的最小修改，並執行最窄而有意義的驗證。

完整檢查：

```bash
npm ci
npm run check
```

本機開發需要兩個長時間執行的程序：

```bash
# Terminal 1
npm run dev

# Terminal 2
npm run dev:cloudflare
```

不得因 README 提供部署命令，就在未獲使用者部署要求時執行外部部署或建立 Cloudflare 資源。

## 部署工作流程

收到明確部署要求後，依序執行：

1. 列出預計建立或修改的 backend service、Tunnel、hostname、Access application、Worker 與 custom domain 名稱，讓使用者知道變更範圍。
2. 執行 `npm ci && npm run check`。
3. 安裝 backend，確認它只監聽 `127.0.0.1`，再驗證 loopback `/healthz`。
4. 建立或使用本次任務指定的專用 Tunnel；不得修改其他既有 Tunnel。
5. 由使用者完成需要身份判斷的兩個 Access applications 與最小權限 policies。
6. 從 `wrangler.jsonc` 建立已被 Git 忽略的 `wrangler.production.jsonc`，填入已確認的 production 設定。
7. 透過 `wrangler secret put` 的互動提示寫入 Worker secrets。
8. 執行 `npm run deploy:dry-run`；成功後才執行 `npm run deploy:cloudflare`。
9. 依序驗證 backend → Tunnel → origin Access → public Access → Worker → WebSocket → tmux reconnect。
10. 檢查 ignored files、staged diff 與 secret scan，確認沒有 private file 或 secret 進入 Git。

## 必須交回人類操作的步驟

遇到以下情況時停下來，清楚說明要使用者完成什麼，且不要要求使用者把 secret 貼進對話：

- Cloudflare、IdP、Claude Code 或 Codex 的登入及 MFA
- 一次性顯示的 Access Client Secret 或 Tunnel connector token
- `wrangler secret put` 的 secret 輸入
- Access allow policy 的 email、群組或 identity 選擇
- 需要系統管理員權限，或會影響任務範圍外既有資源的操作

可在使用者完成後繼續做不會揭露 secret 的狀態與行為驗證。

## 使用與驗收

部署完成不等於使用驗收完成。依 README「8. 驗證完整路徑」檢查：

1. instance 的 loopback health 成功。
2. origin 未帶 service token 時被拒絕，而不是回 backend `200`。
3. public hostname 未登入時導向 Access 或被拒絕。
4. Tunnel connector 狀態為 `Healthy`。
5. 使用者登入手機入口後，能執行 shell、啟動 Claude Code 或 Codex、操作控制鍵並開啟外部 URL。
6. 關閉頁面再連線後，原 tmux session 仍存在。
7. 若任務包含檔案上傳、多 session 或權限模式，分別驗證相關 README 行為。

需要使用者瀏覽器登入或親自操作的項目，請提供精確步驟並請使用者回報結果；不得在未驗證時宣稱成功。

## 成功條件

- backend 只監聽 `127.0.0.1`，instance 不開 inbound port。
- public hostname 由 Cloudflare Worker 提供前端，並受使用者 Access policy 保護。
- origin hostname 經 Cloudflare Tunnel，只接受 Worker 的 Service Auth token。
- 手機能操作真實 tmux PTY，重新連線後 session 仍存在。
- `npm run check` 與 `npm run deploy:dry-run` 成功。
- 沒有 secret、private production config 或可識別部署的資料進入 Git 或回覆內容。

## 安全限制

- 不得輸出、記錄、commit 或回傳 password、API token、Tunnel token、Access Client Secret、Claude/Codex credential、email、實際網域、account ID 或 AUD。
- production 值只能放在已被 `.gitignore` 排除的 `wrangler.production.jsonc`；不得用 `git add -f` 加入任何 private file。
- Worker secrets 只能透過 `wrangler secret put` 的互動提示輸入；不得把 secret 放進 command argument、shell history、文件或 source code。
- 不得修改任務範圍外既有的 Tunnel、DNS、Access policy、Worker、service 或使用者檔案。
- 不得放寬 backend 的 loopback binding、origin Service Auth 或 public Access policy 來排除連線問題。

提交或交付前至少檢查：

```bash
git status --short --ignored
git diff --cached
git grep --cached -n -I -E 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|[[:xdigit:]]{32}\.access|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}' -- .
```

最後一個命令沒有輸出才是預期結果。

## 回報格式

部署或驗收後只回報：

- 建立或修改的資源名稱，不包含 ID、實際 hostname 或 secret
- 各層驗證的成功、失敗或等待使用者操作狀態
- 實際執行的測試與結果
- 尚未驗證的風險與下一個必要動作

不得在回報中重現 production config 或敏感 CLI 輸出。
