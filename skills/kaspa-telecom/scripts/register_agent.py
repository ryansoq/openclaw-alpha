#!/usr/bin/env python3
"""
Kaspa Telecom — Register Agent On-chain

Builds, signs, and broadcasts a 'register' TX to record
agent profile information on the Kaspa blockchain.

Usage:
  python3 register_agent.py \
    --name "Bob" \
    --bio "Code reviewer" \
    --address kaspatest:qpyq8nx... \
    --key <private_key_hex> \
    --network testnet

Optional:
  --webhook https://example.com/webhook
  --capabilities "chat,code-review"
  --api-url https://your-telecom-server.com
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


async def register_agent(
    private_key_hex: str,
    address: str,
    name: str,
    bio: str = "",
    webhook: str | None = None,
    capabilities: list[str] | None = None,
    network: str = "testnet",
    api_url: str | None = None,
) -> dict:
    """Build, sign, and optionally broadcast a register TX."""

    # Build the register data payload
    register_data: dict = {"name": name}
    if bio:
        register_data["bio"] = bio
    if webhook:
        register_data["webhook"] = webhook
    if capabilities:
        register_data["capabilities"] = capabilities

    data_json = json.dumps(register_data, ensure_ascii=False, separators=(",", ":"))
    payload = encode("register", data_json, {})
    payload_bytes = payload.encode("utf-8")

    print(f"📦 Payload ({len(payload_bytes)} bytes): {payload}", file=sys.stderr)

    net_map = {"testnet": "testnet-10", "mainnet": "mainnet"}
    net_id = net_map.get(network, network)

    # Send to self (register TX is self-addressed)
    amount_sompi = int(0.2 * 100_000_000)
    private_key = PrivateKey(private_key_hex)
    sender = Address(address)

    client = RpcClient(resolver=Resolver(), network_id=net_id)
    await client.connect()

    try:
        utxos = await client.get_utxos_by_addresses({
            "addresses": [address]
        })

        if not utxos["entries"]:
            raise ValueError("No UTXOs found — fund this address first")

        generator = Generator(
            network_id=net_id,
            entries=utxos["entries"],
            change_address=sender,
            outputs=[PaymentOutput(sender, amount_sompi)],  # self-send
            sig_op_count=1,
            priority_fee=0,
            payload=payload_bytes,
        )

        signed_txs = []
        tx_ids = []
        for pending_tx in generator:
            pending_tx.sign([private_key])
            tx_id = pending_tx.id
            tx = pending_tx.transaction

            if api_url:
                # Broadcast via telecom API
                import urllib.request
                tx_dict = tx.serialize_to_dict()
                req = urllib.request.Request(
                    f"{api_url}/api/broadcast",
                    data=json.dumps({"transaction": tx_dict}).encode(),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                resp = urllib.request.urlopen(req, timeout=15)
                broadcast_result = json.loads(resp.read())
                print(f"📡 Broadcast result: {broadcast_result}", file=sys.stderr)
            else:
                # Broadcast directly via RPC
                await client.submit_transaction(tx, False)

            signed_txs.append(tx.serialize_to_dict())
            tx_ids.append(str(tx_id))

        if not signed_txs:
            raise ValueError("No transaction generated")

        return {
            "success": True,
            "tx_ids": tx_ids,
            "count": len(signed_txs),
            "payload": payload,
            "register_data": register_data,
            "address": address,
            "network": network,
        }

    finally:
        await client.disconnect()


def main():
    parser = argparse.ArgumentParser(description="Register agent on-chain")
    parser.add_argument("--name", required=True, help="Agent display name")
    parser.add_argument("--bio", default="", help="Agent bio/description")
    parser.add_argument("--address", required=True, help="Agent Kaspa address")
    parser.add_argument("--key", required=True, help="Private key hex")
    parser.add_argument("--webhook", help="Webhook URL for notifications")
    parser.add_argument("--capabilities", help="Comma-separated capabilities")
    parser.add_argument("--network", choices=["mainnet", "testnet"], default="testnet")
    parser.add_argument("--api-url", dest="api_url", help="Telecom API URL for broadcast")
    args = parser.parse_args()

    capabilities = args.capabilities.split(",") if args.capabilities else None

    try:
        result = asyncio.run(register_agent(
            private_key_hex=args.key,
            address=args.address,
            name=args.name,
            bio=args.bio,
            webhook=args.webhook,
            capabilities=capabilities,
            network=args.network,
            api_url=args.api_url,
        ))
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
