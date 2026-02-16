#!/usr/bin/env python3
"""
Kaspa Telecom — Build, sign TX, output as JSON (no broadcast).

Agent uses this to prepare a signed TX locally,
then submits it to /api/broadcast for relay.

Usage:
  python3 build_and_sign.py \
    --to kaspatest:qq... \
    --text "Hello!" \
    --key <private_key_hex> \
    --from-address kaspatest:qq... \
    --network testnet

Output: JSON with signed TX dict ready for broadcast API.
"""

import argparse
import asyncio
import json
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from encode_message import encode

try:
    from kaspa import (
        RpcClient, Resolver, Generator, PaymentOutput,
        Address, PrivateKey
    )
except ImportError:
    print(json.dumps({"success": False, "error": "kaspa SDK not installed"}))
    sys.exit(1)


async def build_and_sign(
    private_key_hex: str,
    sender_address: str,
    recipient_address: str,
    msg_type: str = "msg",
    data: str = "",
    additional: dict | None = None,
    network: str = "testnet",
    amount_kas: float = 0.01,
) -> dict:
    """Build and sign a TX with Protocol v1 payload. Does NOT broadcast."""

    payload = encode(msg_type, data, additional)
    payload_bytes = payload.encode("utf-8")

    print(f"📦 Payload ({len(payload_bytes)} bytes): {payload}", file=sys.stderr)

    net_map = {"testnet": "testnet-10", "mainnet": "mainnet"}
    net_id = net_map.get(network, network)

    amount_sompi = int(amount_kas * 100_000_000)
    private_key = PrivateKey(private_key_hex)

    # Safety check: verify private key matches from-address
    derived_address = str(private_key.to_public_key().to_address(network))
    if sender_address and sender_address != derived_address:
        raise ValueError(
            f"❌ Private key mismatch!\n"
            f"  Key derives:   {derived_address}\n"
            f"  from-address:  {sender_address}\n"
            f"  Fix: use --from-address {derived_address}"
        )

    # If no from-address provided, auto-derive from key
    if not sender_address:
        sender_address = derived_address
        print(f"📍 Auto-derived address: {sender_address}", file=sys.stderr)

    sender = Address(sender_address)
    recipient = Address(recipient_address)

    # Connect to get UTXOs (or use /api/utxos in the future)
    client = RpcClient(resolver=Resolver(), network_id=net_id)
    await client.connect()

    try:
        utxos = await client.get_utxos_by_addresses({
            "addresses": [sender_address]
        })

        if not utxos["entries"]:
            raise ValueError("No UTXOs found")

        generator = Generator(
            network_id=net_id,
            entries=utxos["entries"],
            change_address=sender,
            outputs=[PaymentOutput(recipient, amount_sompi)],
            sig_op_count=1,
            priority_fee=0,
            payload=payload_bytes,
        )

        signed_txs = []
        for pending_tx in generator:
            # Sign all inputs — create a fresh PrivateKey for each input
            tx_inputs = pending_tx.transaction.serialize_to_dict().get("inputs", [])
            keys = [PrivateKey(private_key_hex) for _ in tx_inputs] or [PrivateKey(private_key_hex)]
            pending_tx.sign(keys)
            tx = pending_tx.transaction
            tx_dict = tx.serialize_to_dict()
            signed_txs.append(tx_dict)

        if not signed_txs:
            raise ValueError("No transaction generated")

        return {
            "success": True,
            "signed_txs": signed_txs,
            "count": len(signed_txs),
            "payload": payload,
            "payload_bytes": len(payload_bytes),
            "recipient": recipient_address,
            "network": network,
        }

    finally:
        await client.disconnect()


def main():
    parser = argparse.ArgumentParser(description="Build & sign TX (no broadcast)")
    parser.add_argument("--to", required=True, help="Recipient address")
    parser.add_argument("--text", help="Message text")
    parser.add_argument("--type", "-t", default="msg")
    parser.add_argument("--data", "-d", help="Message data")
    parser.add_argument("--additional", "-a", default="{}")
    parser.add_argument("--key", required=True, help="Private key hex")
    parser.add_argument("--from-address", dest="sender", default="",
                        help="Sender address (auto-derived from key if omitted)")
    parser.add_argument("--network", choices=["mainnet", "testnet"], default="testnet")
    parser.add_argument("--amount", type=float, default=0.01)
    args = parser.parse_args()

    msg_type = args.type
    data = args.data or args.text or ""
    if args.text and not args.data:
        msg_type = "msg"
        data = args.text

    try:
        additional = json.loads(args.additional)
    except json.JSONDecodeError as e:
        print(json.dumps({"success": False, "error": f"Invalid JSON: {e}"}))
        sys.exit(1)

    try:
        result = asyncio.run(build_and_sign(
            private_key_hex=args.key,
            sender_address=args.sender,
            recipient_address=args.to,
            msg_type=msg_type,
            data=data,
            additional=additional,
            network=args.network,
            amount_kas=args.amount,
        ))
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
