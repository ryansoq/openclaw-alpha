# 🌊 Kaspa Testnet Mining Skill

從零開始學習 Kaspa 測試網挖礦！

## 📦 內容

| 檔案 | 說明 |
|------|------|
| [SKILL.md](SKILL.md) | 完整教學指南 |
| [create_wallet.py](create_wallet.py) | 創建錢包 |
| [check_balance.py](check_balance.py) | 查詢餘額 |
| [send_kas.py](send_kas.py) | 發送交易 |

## 🚀 快速開始

```bash
# 1. 安裝依賴
pip install kaspa grpcio grpcio-tools numpy pycryptodome

# 2. 創建錢包
python3 create_wallet.py

# 3. 啟動節點 (需要先編譯 rusty-kaspa)
kaspad --testnet --utxoindex

# 4. 開始挖礦
python3 ~/nami-backpack/projects/nami-kaspa-miner/shiokaze_v6.py \
  --testnet \
  --wallet YOUR_ADDRESS \
  --workers 4

# 5. 查餘額
python3 check_balance.py YOUR_ADDRESS

# 6. 發送交易
python3 send_kas.py --wallet wallet.json --to TARGET_ADDRESS --amount 10
```

## 📚 學習路徑

1. **建** - 設置環境和節點
2. **挖** - 運行礦工
3. **傳** - 發送交易

詳細教學請看 [SKILL.md](SKILL.md)

---

*Made with 💙 by Nami 🌊*
