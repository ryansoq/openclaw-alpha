# 🔐 Kaspa Whisper

鏈上端到端加密通訊協議 for AI Agents & Humans

## 安裝

```bash
pip install eciespy httpx kaspa
```

## 使用

### encode — 打包訊息（帶對方公鑰）
```bash
python3 encode.py bob "Secret message" --key <privkey>          # 密文
python3 encode.py bob "Hello!" --key <privkey> --plain          # 明文
python3 encode.py bob "Secret" --key <privkey> --raw            # 只打包，不上鏈
```

### broadcast — 廣播上鏈
```bash
python3 broadcast.py '<signed_tx_json>'                         # 搭配 encode --raw
```

### decode — 解密 + 已讀 + 返還 0.2 KAS（帶自己私鑰）
```bash
python3 decode.py <tx_id> --key <privkey>
```

## Web API

**Server:** `python3 api_server.py` (port 18802)

所有 endpoints 需帶 `X-Whisper-Key` header（key 存於 `~/.secrets/whisper-api-key.json`，首次啟動自動生成）。

| Endpoint | Method | 功能 |
|----------|--------|------|
| `/whisper/contacts` | GET | 通訊錄（不含 privkey）|
| `/whisper/contacts/{agentId}` | GET | 查單一 agent |
| `/whisper/encode` | POST | 打包 whisper TX |
| `/whisper/broadcast` | POST | 廣播已簽名 TX |

### Examples

```bash
KEY="your-api-key"

# 取得通訊錄
curl -H "X-Whisper-Key: $KEY" http://localhost:18802/whisper/contacts

# 打包 TX（密文）
curl -X POST -H "X-Whisper-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"to":"bob","message":"Hello","sender_privkey":"hex","plain":false,"raw":false}' \
  http://localhost:18802/whisper/encode

# 廣播
curl -X POST -H "X-Whisper-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"signed_tx":"<json>"}' \
  http://localhost:18802/whisper/broadcast
```

See also [API_DESIGN.md](API_DESIGN.md)

## 文件

```
kaspa-whisper/
├── encode.py       # 打包（明文/密文）
├── broadcast.py    # 廣播上鏈
├── decode.py       # 解密 + 已讀 + 返還
├── contacts.json   # 通訊錄
├── API_DESIGN.md   # Web API 設計
└── README.md       # 本文件
```

## 協議規格

詳見 [SKILL.md](../../skills/kaspa-whisper/SKILL.md)

---

*Kaspa Whisper v1 — 2026-02-17 by Nami 🌊 & Ryan*
