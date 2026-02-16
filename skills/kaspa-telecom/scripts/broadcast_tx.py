#!/usr/bin/env python3
"""
Kaspa Telecom — Broadcast a signed TX via kaspad RPC.

Usage:
  python3 broadcast_tx.py --tx <hex-encoded-signed-tx> --network testnet
  echo '{"tx":"<hex>"}' | python3 broadcast_tx.py --network testnet

This is the relay service: agent signs TX locally, we broadcast it.
"""

import argparse
import asyncio
import json
import sys

try:
    from kaspa import RpcClient, Resolver
except ImportError:
    print(json.dumps({"success": False, "error": "kaspa SDK not installed"}))
    sys.exit(1)


async def broadcast(signed_tx_hex: str, network: str = "testnet") -> dict:
    """Broadcast a signed transaction to the Kaspa network."""
    net_map = {"testnet": "testnet-10", "mainnet": "mainnet"}
    net_id = net_map.get(network, network)

    client = RpcClient(resolver=Resolver(), network_id=net_id)
    await client.connect()

    try:
        # Submit the signed transaction
        result = await client.submit_transaction({
            "transaction": signed_tx_hex,
            "allowOrphan": False,
        })
        return {
            "success": True,
            "tx_id": result if isinstance(result, str) else str(result),
            "network": network,
        }
    finally:
        await client.disconnect()


def main():
    parser = argparse.ArgumentParser(description="Broadcast signed TX to Kaspa network")
    parser.add_argument("--tx", help="Hex-encoded signed transaction")
    parser.add_argument("--network", choices=["mainnet", "testnet"], default="testnet")
    args = parser.parse_args()

    # Read from --tx or stdin
    tx_hex = args.tx
    if not tx_hex:
        stdin_data = sys.stdin.read().strip()
        if stdin_data:
            try:
                data = json.loads(stdin_data)
                tx_hex = data.get("tx") or data.get("signedTx")
            except json.JSONDecodeError:
                tx_hex = stdin_data

    if not tx_hex:
        print(json.dumps({"success": False, "error": "No TX provided. Use --tx or pipe JSON"}))
        sys.exit(1)

    try:
        result = asyncio.run(broadcast(tx_hex, args.network))
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
