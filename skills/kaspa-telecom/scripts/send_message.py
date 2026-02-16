#!/usr/bin/env python3
"""
Kaspa Telecom — Send Message (Protocol v1)

Send an on-chain message to another agent via Kaspa TX.

Usage:
  # Direct send (you have your own key)
  python3 send_message.py --to kaspatest:qq... --text "Hello!" --key <private_key> --network testnet

  # With message type
  python3 send_message.py --to kaspatest:qq... --type ack --data "txid_here" --key <key> --network testnet

The payload follows Protocol v1: {"v":1,"t":"msg","d":"Hello!","a":{}}
"""

import argparse
import asyncio
import json
import sys
import os

# Add parent paths for imports
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../kaspa-wallet/scripts"))

from encode_message import encode

try:
    from kaspa import (
        RpcClient, Resolver, Generator, PaymentOutput,
        Address, PrivateKey
    )
except ImportError:
    print("❌ 'kaspa' Python SDK not installed. Run: pip install kaspa", file=sys.stderr)
    sys.exit(1)


async def send_message(
    private_key_hex: str,
    sender_address: str,
    recipient_address: str,
    msg_type: str = "msg",
    data: str = "",
    additional: dict | None = None,
    network: str = "testnet",
    amount_kas: float = 0.2,
) -> dict:
    """Send a Protocol v1 message on-chain.

    Args:
        private_key_hex: Sender's private key (hex)
        sender_address: Sender's Kaspa address
        recipient_address: Recipient's Kaspa address
        msg_type: Message type (msg/ack/ping/card/grp)
        data: Message data (text, txid, etc)
        additional: Additional object (default: {})
        network: "mainnet" or "testnet"
        amount_kas: TX amount (min 0.2 for storage mass)

    Returns:
        dict with tx_id, payload, etc.
    """
    # Encode Protocol v1 payload
    payload = encode(msg_type, data, additional)
    payload_bytes = payload.encode("utf-8")

    print(f"📦 Payload ({len(payload_bytes)} bytes): {payload}", file=sys.stderr)

    amount_sompi = int(amount_kas * 100_000_000)

    private_key = PrivateKey(private_key_hex)
    sender = Address(sender_address)
    recipient = Address(recipient_address)

    # Map friendly names to network IDs
    net_map = {"testnet": "testnet-10", "mainnet": "mainnet"}
    net_id = net_map.get(network, network)
    client = RpcClient(resolver=Resolver(), network_id=net_id)
    await client.connect()

    try:
        # Get UTXOs
        utxos = await client.get_utxos_by_addresses({
            "addresses": [sender_address]
        })

        if not utxos["entries"]:
            raise ValueError("No UTXOs found - insufficient balance")

        # Create TX with payload
        generator = Generator(
            network_id=net_id,
            entries=utxos["entries"],
            change_address=sender,
            outputs=[PaymentOutput(recipient, amount_sompi)],
            sig_op_count=1,
            priority_fee=0,
            payload=payload_bytes,
        )

        tx_ids = []
        while True:
            try:
                pending_tx = next(generator)
            except StopIteration:
                break
            if not pending_tx:
                break
            pending_tx.sign([private_key])
            tx_id = await pending_tx.submit(client)
            tx_ids.append(tx_id)

        if not tx_ids:
            raise ValueError("No transaction generated")

        return {
            "success": True,
            "tx_ids": tx_ids,
            "payload": payload,
            "payload_bytes": len(payload_bytes),
            "amount_kas": amount_kas,
            "recipient": recipient_address,
            "network": network,
        }

    finally:
        await client.disconnect()


def main():
    parser = argparse.ArgumentParser(description="Kaspa Telecom — Send Protocol v1 Message")
    parser.add_argument("--to", required=True, help="Recipient Kaspa address")
    parser.add_argument("--text", help="Message text (shortcut for --type msg --data <text>)")
    parser.add_argument("--type", "-t", default="msg", help="Message type (default: msg)")
    parser.add_argument("--data", "-d", help="Message data")
    parser.add_argument("--additional", "-a", default="{}", help="Additional JSON object")
    parser.add_argument("--key", required=True, help="Sender private key (hex)")
    parser.add_argument("--from-address", dest="sender", required=True, help="Sender Kaspa address")
    parser.add_argument("--network", choices=["mainnet", "testnet"], default="testnet")
    parser.add_argument("--amount", type=float, default=0.2, help="TX amount in KAS (default: 0.2)")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    args = parser.parse_args()

    # --text is shortcut for --type msg --data <text>
    msg_type = args.type
    data = args.data or args.text or ""
    if args.text and not args.data:
        msg_type = "msg"
        data = args.text

    try:
        additional = json.loads(args.additional)
    except json.JSONDecodeError as e:
        print(f"❌ Invalid --additional JSON: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        result = asyncio.run(send_message(
            private_key_hex=args.key,
            sender_address=args.sender,
            recipient_address=args.to,
            msg_type=msg_type,
            data=data,
            additional=additional,
            network=args.network,
            amount_kas=args.amount,
        ))

        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(f"✅ Message sent on-chain!")
            print(f"   Type: {msg_type}")
            print(f"   Data: {data}")
            print(f"   To: {args.to}")
            print(f"   Amount: {result['amount_kas']} KAS")
            for tx_id in result["tx_ids"]:
                print(f"   TX ID: {tx_id}")

    except Exception as e:
        if args.json:
            print(json.dumps({"success": False, "error": str(e)}, indent=2))
        else:
            print(f"❌ Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
