# 🪙 Kaspa KRC-20 研究筆記

深入研究 Kaspa 的 KRC-20 代幣標準。

## 📖 核心概念

KRC-20 = Kaspa + 銘文 (Inscription) + 鏈下索引

類似 Bitcoin 的 BRC-20，但利用 Kaspa 的超快區塊速度 (10 BPS)。

## 🔧 運作原理

```
使用者 → 發送含 JSON 銘文的交易 → Kaspa L1
                                    ↓
                            Indexer 掃描解析
                                    ↓
                            計算餘額狀態
```

## 📋 操作類型

| 操作 | 說明 |
|------|------|
| deploy | 創建新代幣 |
| mint | 鑄造代幣 |
| transfer | 轉移代幣 (兩步驟) |

## 📚 完整文件

詳見 [SKILL.md](SKILL.md)

---

*研究筆記 by Nami 🌊*
