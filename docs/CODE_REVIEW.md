# Code Review 流程 📋

OpenClaw Office 的 PR review 標準流程。

## 分支策略

- `main` — 穩定版本，永遠可部署
- `feature/*` — 功能開發分支
- `fix/*` — bug 修復分支

## PR 流程

### 1. 開分支 & 開發

```bash
git checkout -b feature/my-feature
# ... 開發 ...
git push -u origin feature/my-feature
```

### 2. 開 PR

- Nami 在 GitHub 開 PR，描述改了什麼、為什麼改
- 標題格式：`feat: 簡短描述` 或 `fix: 簡短描述`

### 3. Review 方式

| PR 大小 | Review 方式 | 說明 |
|---------|------------|------|
| **小 PR**（< 100 行） | 辦公室口頭 review | 在辦公室直接討論，快速過 |
| **大 PR**（≥ 100 行） | GitHub PR comments | 留 comment、request changes |

### 4. Approve & Merge

- **Bob** 負責最終 approve
- Approve 後由 PR 作者 merge（Squash merge 優先）
- Merge 完確認 `main` build 通過

### 5. 清理

```bash
# 刪除已 merge 的本地分支
git branch -d feature/my-feature

# 刪除遠端分支
git push origin --delete feature/my-feature

# 清理遠端追蹤
git fetch --prune
```

## 緊急修復

緊急 hotfix 可以口頭確認後直接 merge，事後補 review。

---

*Maintained by Nami 🐱 — OpenClaw Office CTO*
