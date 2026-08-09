# Contributing

感謝你改善 Remote Code Agent。請保持變更範圍明確，並優先修正可重現的問題。

## 開始之前

- 安全漏洞請依 [`SECURITY.md`](SECURITY.md) 私下回報，不要建立公開 issue。
- 先搜尋現有 issue 與 pull request，避免重複工作。
- 較大的功能或會改變安全模型的提案，請先建立 issue 討論。

## 本機開發

需要 Node.js 22.20.0 以上、npm、`tmux` 與可編譯 `node-pty` 的工具鏈。

```bash
npm ci
npm run check
```

需要手動測試前後端時，分別執行：

```bash
npm run dev
npm run dev:cloudflare
```

更多設定與安全邊界請參考 [`README.md`](README.md) 和 [`AGENTS.md`](AGENTS.md)。測試只能使用範例或專用測試資料。

## Pull request

- 從最新的 `main` 建立分支，每個 PR 只處理一個主題。
- 說明問題、解法、風險與實際執行的驗證。
- 行為變更需更新測試與使用者文件。
- 不要提交 generated build output、local config、production hostname、email、token、credential 或其他可識別部署的資料。
- 確認 `npm run check` 通過，並完成 PR template 的檢查清單。

提交貢獻即表示你同意以本專案的 [MIT License](LICENSE) 授權該貢獻。
