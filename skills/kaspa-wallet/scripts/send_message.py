#!/usr/bin/env python3
"""
Kaspa Message TX - 透過 Kaspa 交易 payload 發送/接收訊息

用法：
  # 發送訊息（自己給自己）
  python send_message.py send --text "Hello from Nami!"
  
  # 發送訊息到指定地址
  python send_message.py send --to kaspatest:qq... --text "Hello!"
  
  # 讀取地址的最近訊息
  python send_message.py read
  
  # 讀取指定 TX 的 payload
  python send_message.py read --txid abc123...

原理：
  Kaspa 交易有原生 payload 欄位（不是 OP_RETURN），
  可以直接嵌入任意 bytes。Kasia 協議就是用這個機制。
  我們用 create_transaction() 的 payload 參數來嵌入 JSON 訊息。
"""

import asyncio
import argparse
import json
import time
import sys
import os

# 確保能 import kaspa SDK
from kaspa import (
    RpcClient,
    PrivateKey,
    Address,
    PaymentOutput,
    create_transaction,
    sign_transaction,
)

# ═══════════════════════════════════════════════════════════════════════════════
# 配置
# ═══════════════════════════════════════════════════════════════════════════════

DEFAULT_NODE = "ws://127.0.0.1:17210"
SECRETS_PATH = os.path.expanduser("~/.secrets/testnet-wallet.json")
# 在 clawd 環境也檢查
SECRETS_PATH_ALT = os.path.expanduser("~/clawd/.secrets/testnet-wallet.json")

MAX_PAYLOAD_SIZE = 1000  # bytes
DEFAULT_FEE = 5000  # sompi (需足夠覆蓋 payload 帶來的額外 mass)


def load_wallet():
    """載入錢包私鑰和地址"""
    for path in [SECRETS_PATH, SECRETS_PATH_ALT]:
        if os.path.exists(path):
            with open(path) as f:
                w = json.load(f)
            return w["private_key"], w["address"]
    raise FileNotFoundError(f"找不到錢包: {SECRETS_PATH}")


def build_message_payload(text: str, sender: str = "nami") -> bytes:
    """建構訊息 payload（JSON 格式）"""
    msg = {
        "from": sender,
        "text": text,
        "ts": int(time.time()),
    }
    payload = json.dumps(msg, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(payload) > MAX_PAYLOAD_SIZE:
        raise ValueError(f"Payload 太大: {len(payload)} bytes (max {MAX_PAYLOAD_SIZE})")
    return payload


def parse_message_payload(payload_hex: str) -> dict | None:
    """解析交易 payload 為訊息"""
    try:
        raw = bytes.fromhex(payload_hex)
        msg = json.loads(raw.decode("utf-8"))
        if isinstance(msg, dict) and "text" in msg:
            return msg
    except Exception:
        pass
    return None


# ═══════════════════════════════════════════════════════════════════════════════
# 發送訊息
# ═══════════════════════════════════════════════════════════════════════════════

async def send_message(text: str, to_address: str = None, sender: str = "nami"):
    """發送帶訊息 payload 的交易"""
    private_key_hex, my_address = load_wallet()
    pk = PrivateKey(private_key_hex)
    dest_address = to_address or my_address

    payload_bytes = build_message_payload(text, sender)
    print(f"📝 訊息: {text}")
    print(f"📦 Payload: {len(payload_bytes)} bytes")
    print(f"📤 從: {my_address[:20]}...")
    print(f"📥 到: {dest_address[:20]}...")

    # 連接 RPC
    rpc = RpcClient(
        resolver=None,
        url=DEFAULT_NODE,
        network_id="testnet-10",
    )
    await rpc.connect()
    print("✅ 已連接節點")

    try:
        # 取得 UTXOs
        result = await rpc.get_utxos_by_addresses(request={"addresses": [my_address]})
        entries = result.get("entries", [])
        if not entries:
            print("❌ 沒有 UTXO")
            return None

        # 選最大的 UTXO（避免 storage mass 問題）
        entries.sort(key=lambda e: e["utxoEntry"]["amount"], reverse=True)
        entry = entries[0]
        amount = entry["utxoEntry"]["amount"]
        print(f"💰 使用 UTXO: {amount / 1e8:.4f} KAS ({amount} sompi)")

        # 建構交易：自己 → 目標地址（扣手續費）
        dest_addr = Address(dest_address)
        change_addr = Address(my_address)
        
        if dest_address == my_address:
            # 自發自收：單一 output
            outputs = [PaymentOutput(dest_addr, amount - DEFAULT_FEE)]
        else:
            # 發給別人：小額給對方，剩餘找零回自己
            send_amount = 20_000_000  # 0.2 KAS (避免 storage mass 限制)
            change_amount = amount - send_amount - DEFAULT_FEE
            if change_amount < 0:
                print(f"❌ 餘額不足")
                return None
            outputs = [PaymentOutput(dest_addr, send_amount)]
            if change_amount > 0:
                outputs.append(PaymentOutput(change_addr, change_amount))

        tx = create_transaction(
            utxo_entry_source=[entry],
            outputs=outputs,
            priority_fee=0,
            payload=payload_bytes,
        )

        signed_tx = sign_transaction(tx, [pk], False)

        # 提交
        result = await rpc.submit_transaction(
            request={"transaction": signed_tx, "allow_orphan": False}
        )
        tx_id = result.get("transactionId", str(result))
        print(f"✅ TX 已發送: {tx_id}")
        return tx_id

    finally:
        await rpc.disconnect()


# ═══════════════════════════════════════════════════════════════════════════════
# 讀取訊息
# ═══════════════════════════════════════════════════════════════════════════════

async def read_messages(address: str = None, txid: str = None):
    """讀取地址相關交易的 payload 訊息"""
    if not address and not txid:
        _, address = load_wallet()

    rpc = RpcClient(
        resolver=None,
        url=DEFAULT_NODE,
        network_id="testnet-10",
    )
    await rpc.connect()
    print("✅ 已連接節點")

    try:
        if txid:
            # 查詢特定交易 - 需要用 explorer API
            print(f"🔍 查詢 TX: {txid}")
            print("⚠️  本地節點不支援按 TX ID 查詢 payload")
            print(f"   請到 explorer 查看: https://explorer-tn10.kaspa.org/txs/{txid}")
            return

        # 查詢 UTXO（只能看到未花費的，歷史需要 indexer）
        print(f"🔍 查詢地址: {address[:30]}...")
        print("ℹ️  本地節點只能查 UTXO，無法查歷史交易 payload")
        print("   完整訊息歷史需要 Kaspa indexer/explorer")
        
        result = await rpc.get_utxos_by_addresses(request={"addresses": [address]})
        entries = result.get("entries", [])
        print(f"📊 找到 {len(entries)} 個 UTXO")

    finally:
        await rpc.disconnect()


# ═══════════════════════════════════════════════════════════════════════════════
# 主程式
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Kaspa Message TX")
    sub = parser.add_subparsers(dest="command")

    # send
    send_p = sub.add_parser("send", help="發送訊息")
    send_p.add_argument("--text", "-t", required=True, help="訊息內容")
    send_p.add_argument("--to", help="目標地址（預設自己）")
    send_p.add_argument("--from-name", default="nami", help="發送者名稱")

    # read
    read_p = sub.add_parser("read", help="讀取訊息")
    read_p.add_argument("--address", "-a", help="地址")
    read_p.add_argument("--txid", help="交易 ID")

    args = parser.parse_args()

    if args.command == "send":
        tx_id = asyncio.run(send_message(args.text, args.to, args.from_name))
        if tx_id:
            print(f"\n🎉 成功！查看交易:")
            print(f"   https://explorer-tn10.kaspa.org/txs/{tx_id}")
    elif args.command == "read":
        asyncio.run(read_messages(getattr(args, "address", None), getattr(args, "txid", None)))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
