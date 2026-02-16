#!/usr/bin/env python3
"""
Kaspa Telecom — Broadcast a signed TX via kaspad RPC.

Accepts either:
  - signedTx: hex string
  - transaction: dict from serialize_to_dict()

Usage:
  # Hex format
  python3 broadcast_tx.py --tx <hex> --network testnet

  # Dict format (from build_and_sign.py output)
  echo '{"transaction": {...}}' | python3 broadcast_tx.py --network testnet

  # Full build_and_sign output (picks first signed_txs entry)
  python3 build_and_sign.py ... | python3 broadcast_tx.py --network testnet
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


async def broadcast(tx_data, network: str = "testnet") -> dict:
    """Broadcast a signed transaction. tx_data can be hex string or dict."""
    net_map = {"testnet": "testnet-10", "mainnet": "mainnet"}
    net_id = net_map.get(network, network)

    client = RpcClient(resolver=Resolver(), network_id=net_id)
    await client.connect()

    try:
        result = await client.submit_transaction({
            "transaction": tx_data,
            "allowOrphan": False,
        })
        return {
            "success": True,
            "tx_id": result if isinstance(result, str) else str(result),
            "network": network,
        }
    finally:
        await client.disconnect()


def parse_input(raw: str):
    """Parse input: hex string, transaction dict, or build_and_sign output."""
    raw = raw.strip()
    try:
        data = json.loads(raw)
        # build_and_sign.py output: {"signed_txs": [{...}], ...}
        if isinstance(data, dict) and "signed_txs" in data:
            return data["signed_txs"][0]
        # Direct transaction dict: {"transaction": {...}}
        if isinstance(data, dict) and "transaction" in data:
            return data["transaction"]
        # Direct tx dict (from serialize_to_dict)
        if isinstance(data, dict) and ("inputs" in data or "version" in data):
            return data
        # signedTx field
        if isinstance(data, dict) and "signedTx" in data:
            return data["signedTx"]
        # tx field
        if isinstance(data, dict) and "tx" in data:
            return data["tx"]
        return data
    except json.JSONDecodeError:
        # Assume hex string
        return raw


def main():
    parser = argparse.ArgumentParser(description="Broadcast signed TX to Kaspa network")
    parser.add_argument("--tx", help="Hex-encoded signed transaction")
    parser.add_argument("--network", choices=["mainnet", "testnet"], default="testnet")
    args = parser.parse_args()

    tx_data = None
    if args.tx:
        tx_data = args.tx
    else:
        stdin_data = sys.stdin.read().strip()
        if stdin_data:
            tx_data = parse_input(stdin_data)

    if not tx_data:
        print(json.dumps({"success": False, "error": "No TX provided. Use --tx or pipe JSON"}))
        sys.exit(1)

    try:
        result = asyncio.run(broadcast(tx_data, args.network))
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
