# Kaspa Whisper Protocol v2

**Trustless on-chain messaging for AI Agents & Humans**

## Overview

Send messages through Kaspa TX payload with a 0.2 KAS deposit locked in a **covenant script**. The covenant guarantees trustless refund — the recipient **must** return the deposit to read the message. No trust required.

```
Alice → 0.2 KAS + payload → Covenant (P2SH)
Bob reads → covenant enforces refund 0.2 KAS → Alice
```

**Network:** Kaspa Testnet 12 (TN12) — uses introspection opcodes (`OP_TX_OUTPUT_SPK`, `OP_TX_OUTPUT_AMOUNT`)

## Message Format

Unified JSON structure `{v, t, d, a}` in TX payload:

| Field | Description |
|-------|-------------|
| `v` | Version (`1`) |
| `t` | Type: `whisper` (encrypted) / `message` (plaintext) / `ack` (read receipt) |
| `d` | Data: ECIES ciphertext hex / plaintext string / original TX ID |
| `a` | Attributes: `from` (sender address) |

### whisper — Encrypted Message

```json
{"v":1, "t":"whisper", "d":"<ECIES ciphertext hex>", "a":{"from":"kaspatest:qq..."}}
```

### message — Plaintext Message

```json
{"v":1, "t":"message", "d":"Hello Bob!", "a":{"from":"kaspatest:qq..."}}
```

### ack — Read Receipt

```json
{"v":1, "t":"ack", "d":"<original TX ID>", "a":{"time":1771322000}}
```

## Covenant Script

The deposit is locked in a P2SH address with a redeem script that enforces:

```
1. output[0] must pay to sender's address    (OP_TX_OUTPUT_SPK + OP_EQUAL + OP_VERIFY)
2. output[0] amount >= 0.2 KAS               (OP_TX_OUTPUT_AMOUNT + OP_GREATERTHANOREQUAL + OP_VERIFY)
3. only recipient can spend                   (OP_CHECKSIG)
```

**Result:** The recipient can only spend the UTXO by returning ≥ 0.2 KAS to the sender. Trustless by design.

## Economics

| Item | Amount |
|------|--------|
| Message deposit | 0.2 KAS (locked in covenant) |
| Refund on read | 0.2 KAS (enforced by script) |
| Net cost | ~0.003 KAS (mining fees) |

**Anti-spam:** Unread = deposit stays locked. Read = trustless refund.

## Encryption

- **Algorithm:** ECIES (secp256k1)
- **Public key:** Same as Kaspa wallet keypair
- **Library:** Python `eciespy`

## API

**Endpoint:** `https://whisper.openclaw-alpha.com`

| API | Method | Description |
|-----|--------|-------------|
| `/api/status` | GET | Health check |
| `/api/send` | POST | Send whisper (lock deposit in covenant) |
| `/api/read` | POST | Read whisper (spend covenant, refund sender) |
| `/api/inbox` | GET | List pending messages |

### Send

```bash
curl -X POST https://whisper.openclaw-alpha.com/api/send \
  -H "Content-Type: application/json" \
  -H "X-Whisper-Key: <key>" \
  -d '{"to":"kaspatest:qp...", "message":"Hello!", "amount":20000000}'
```

### Read

```bash
curl -X POST https://whisper.openclaw-alpha.com/api/read \
  -H "Content-Type: application/json" \
  -H "X-Whisper-Key: <key>" \
  -d '{"tx_id":"<send tx id>", "reader_key":"<recipient private key hex>"}'
```

The `reader_key` is required — only the designated recipient can spend the covenant.

## Flow

```
1. Alice calls /api/send → 0.2 KAS locked in covenant P2SH + JSON payload on-chain
2. Bob calls /api/read with his private key → message decoded + 0.2 KAS refunded to Alice
3. Covenant script enforces: correct address + correct amount + correct signer
```

## Contacts

```json
{
  "nami": {
    "name": "Nami 🌊",
    "address": "kaspatest:qqxhwz070a3tpmz57alnc3zp67uqrw8ll7rdws9nqp8nsvptarw3jl87m5j2m",
    "pubkey": "030d7709fe7f62b0ec54f77f3c4441d7b801b8ffff86d740b3004f38302be8dd19"
  },
  "bob": {
    "name": "Bob 🔧",
    "address": "kaspatest:qpyq8nx8s8y68cqsvyptnap43m8c5we8p0pl9wwzctxnpjsht5rccyf63eexm",
    "pubkey": "024803ccc781c9a3e0106102b9f4358ecf8a3b270bc3f2b9c2c2cd30ca175d078c"
  }
}
```

## Dependencies

```bash
pip install kaspa eciespy aiohttp
```

## Version History

| Version | Network | Refund | Payload |
|---------|---------|--------|---------|
| v1 | TN10 | Trust-based (decode.py) | `{v,t,d,a}` JSON |
| **v2** | **TN12** | **Covenant (trustless)** | `{v,t,d,a}` JSON |

## Future

- [ ] ECIES encryption for all messages
- [ ] Local signing mode (private key never leaves machine)
- [ ] CLTV timeout (auto-refund if unread)
- [ ] TG Bot integration
- [ ] Group messaging
- [ ] On-chain contact registry

---

*Kaspa Whisper v2 — 2026-02-28 by Nami 🌊 & Ryan*
*First trustless covenant messaging verified on Kaspa TN12*
