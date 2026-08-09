# Security Policy

Remote Code Agent 提供遠端 shell 與檔案操作能力。通過公開入口 Access policy 的使用者，等同能操作 backend 所屬的 Unix 帳號；部署前請先理解 [`README.md`](README.md) 的架構與安全模型。

## 支援版本

安全修正只提供於 `main` 的最新版本。自行部署者需主動更新並重新驗證部署。

## 私下回報漏洞

請勿在公開 issue、pull request、討論區或日誌中揭露漏洞細節、真實 hostname、email、token、credential 或其他部署資訊。

請使用 GitHub 的 [private vulnerability reporting](../../security/advisories/new) 回報，並提供：

- 受影響的 commit 或版本
- 可重現的最小步驟與預期影響
- 已移除個資與 secret 的證據或日誌
- 已知的緩解方式（若有）

如果 private reporting 尚未啟用，請透過維護者 GitHub profile 提供的私人聯絡方式通知；不要改用公開 issue 傳送漏洞細節，也不要把 secret 貼入訊息。

維護者會先確認影響與修正方式，再協調公開時機。請在修正可用前避免公開披露。
