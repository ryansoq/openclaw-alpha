#!/usr/bin/env python3
"""
Kaspa Whisper — Standalone Decoder 🔓

Fetch and decrypt a whisper transaction using only public APIs.
No local kaspad required.

Usage:
    python3 decode_whisper.py <tx_id> --key <private_key_hex>

Requirements:
    pip install eciespy httpx

Learn more: https://whisper.openclaw-alpha.com
"""

import argparse
import asyncio
import json
import sys
import time

KASPA_API = "https://api-tn10.kaspa.org"
EXPLORER  = "https://explorer-tn10.kaspa.org/txs"


async def fetch_transaction(tx_id: str) -> dict | None:
    """Fetch a transaction from the Kaspa public API."""
    import httpx
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(f"{KASPA_API}/transactions/{tx_id}")
        if resp.status_code == 200:
            return resp.json()
        print(f"❌ Failed to fetch TX: {resp.status_code}")
        return None


def decode_payload(tx: dict) -> dict | None:
    """Extract and parse the Whisper payload from a transaction."""
    payload_hex = tx.get("payload", "")
    if not payload_hex:
        print("❌ No payload in this transaction")
        return None

    try:
        payload = json.loads(bytes.fromhex(payload_hex))
    except Exception as e:
        print(f"❌ Failed to parse payload: {e}")
        return None

    if payload.get("v") != 1:
        print(f"❌ Unsupported payload version: {payload.get('v')}")
        return None

    msg_type = payload.get("t")
    if msg_type not in ("whisper", "message", "ack"):
        print(f"❌ Unsupported message type: {msg_type}")
        return None

    return payload


def decrypt_whisper(payload: dict, privkey_hex: str) -> str | None:
    """Decrypt an encrypted whisper using your private key."""
    from ecies import decrypt

    encrypted_hex = payload.get("d", "")
    if not encrypted_hex:
        print("❌ No encrypted data in payload")
        return None

    try:
        encrypted = bytes.fromhex(encrypted_hex)
        plaintext = decrypt(privkey_hex, encrypted).decode("utf-8")
        return plaintext
    except Exception as e:
        print(f"❌ Decryption failed: {e}")
        print("   Make sure you're using the correct private key.")
        return None


def display_message(tx: dict, payload: dict, content: str):
    """Pretty-print the decoded message."""
    sender = payload.get("a", {}).get("from", "unknown")
    msg_type = payload.get("t", "unknown")
    tx_id = tx.get("transaction_id", "unknown")

    # Timestamp from block_time (milliseconds)
    block_time = tx.get("block_time")
    if block_time:
        ts = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(block_time / 1000))
    else:
        ts = "pending"

    icon = {"whisper": "🔐", "message": "📨", "ack": "✅"}.get(msg_type, "📦")

    print()
    print(f"  ╔═══════════════════════════════════════╗")
    print(f"  ║  {icon} Kaspa Whisper — Decoded         ║")
    print(f"  ╚═══════════════════════════════════════╝")
    print()
    print(f"  Type:      {msg_type}")
    print(f"  From:      {sender}")
    print(f"  Time:      {ts}")
    print(f"  TX:        {EXPLORER}/{tx_id}")
    print()

    if msg_type == "ack":
        ref_tx = payload.get("d", "")
        print(f"  📋 Read receipt for TX: {ref_tx}")
    else:
        print(f"  💌 Message:")
        print(f"  ┌{'─' * 48}┐")
        for line in content.split("\n"):
            print(f"  │ {line:<46} │")
        print(f"  └{'─' * 48}┘")
    print()


async def send_ack_refund(tx: dict, payload: dict, privkey_hex: str):
    """Send a read receipt + refund 0.2 KAS to the sender."""
    sender_addr = payload.get("a", {}).get("from")
    if not sender_addr:
        print("  ⚠️  No sender address — cannot send ack/refund")
        return

    try:
        from kaspa import (
            PrivateKey, Address, PaymentOutput,
            create_transaction, sign_transaction,
            RpcClient, Resolver,
        )
        import httpx
    except ImportError:
        print("  ⚠️  Install 'kaspa' package for ack+refund: pip install kaspa")
        return

    REFUND_AMOUNT = 20_000_000  # 0.2 KAS
    TX_FEE = 50_000

    pk = PrivateKey(privkey_hex)
    my_addr = pk.to_public_key().to_address("testnet").to_string()
    tx_id = tx.get("transaction_id", "")

    # Fetch UTXOs
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{KASPA_API}/addresses/{my_addr}/utxos")
        if resp.status_code != 200:
            print(f"  ❌ Failed to fetch UTXOs: {resp.status_code}")
            return
        raw_utxos = resp.json()

    if not raw_utxos:
        print("  ❌ No UTXOs — insufficient balance for refund")
        return

    entries = []
    for u in raw_utxos:
        entries.append({
            "outpoint": {
                "transactionId": u["outpoint"]["transactionId"],
                "index": u["outpoint"]["index"],
            },
            "address": u.get("address", my_addr),
            "utxoEntry": {
                "amount": int(u["utxoEntry"]["amount"]),
                "scriptPublicKey": u["utxoEntry"]["scriptPublicKey"],
                "blockDaaScore": int(u["utxoEntry"].get("blockDaaScore", 0)),
                "isCoinbase": u["utxoEntry"].get("isCoinbase", False),
            },
        })

    entries.sort(key=lambda e: e["utxoEntry"]["amount"], reverse=True)
    selected, total = [], 0
    for e in entries:
        selected.append(e)
        total += e["utxoEntry"]["amount"]
        if total >= REFUND_AMOUNT + TX_FEE + 1000:
            break

    if total < REFUND_AMOUNT + TX_FEE:
        print(f"  ❌ Insufficient balance for refund: {total / 1e8:.4f} KAS")
        return

    change = total - REFUND_AMOUNT - TX_FEE
    outputs = [PaymentOutput(Address(sender_addr), REFUND_AMOUNT)]
    if change > 0:
        outputs.append(PaymentOutput(Address(my_addr), change))

    ack_payload = json.dumps({
        "v": 1, "t": "ack", "d": tx_id,
        "a": {"time": int(time.time())},
    }, separators=(",", ":")).encode()

    ack_tx = create_transaction(
        utxo_entry_source=selected,
        outputs=outputs,
        priority_fee=TX_FEE,
        payload=ack_payload,
    )
    signed = sign_transaction(ack_tx, [pk], False)

    # Submit via public RPC
    rpc = RpcClient(resolver=Resolver(), network_id="testnet-10")
    try:
        await rpc.connect()
        refund_tx_id = await rpc.submit_transaction(signed, allow_orphan=False)
        await rpc.disconnect()
    except Exception as e:
        print(f"  ❌ Ack broadcast failed: {e}")
        try:
            await rpc.disconnect()
        except Exception:
            pass
        return

    print(f"  ✅ Ack + refund sent! TX: {EXPLORER}/{refund_tx_id}")


async def main():
    parser = argparse.ArgumentParser(
        description="Kaspa Whisper — Decode a whisper transaction"
    )
    parser.add_argument("tx_id", help="Transaction ID to decode")
    parser.add_argument("--key", required=True, help="Your private key (hex)")
    parser.add_argument("--no-ack", action="store_true", help="Skip ack+refund prompt")
    args = parser.parse_args()

    # 1. Fetch transaction
    print(f"🔍 Fetching TX: {args.tx_id[:16]}...")
    tx = await fetch_transaction(args.tx_id)
    if not tx:
        sys.exit(1)

    # 2. Parse payload
    payload = decode_payload(tx)
    if not payload:
        sys.exit(1)

    msg_type = payload.get("t")

    # 3. Decode content
    if msg_type == "whisper":
        content = decrypt_whisper(payload, args.key)
        if content is None:
            sys.exit(1)
    elif msg_type == "message":
        content = payload.get("d", "")
    elif msg_type == "ack":
        content = ""
    else:
        print(f"❌ Unknown type: {msg_type}")
        sys.exit(1)

    # 4. Display
    display_message(tx, payload, content)

    # 5. Offer ack+refund
    if msg_type in ("whisper", "message") and not args.no_ack:
        answer = input("  Send read receipt + refund 0.2 KAS? [y/N] ").strip().lower()
        if answer == "y":
            await send_ack_refund(tx, payload, args.key)


if __name__ == "__main__":
    asyncio.run(main())
