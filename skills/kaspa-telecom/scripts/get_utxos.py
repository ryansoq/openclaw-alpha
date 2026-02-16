#!/usr/bin/env python3
"""
Kaspa Telecom — Get UTXOs for an address.

Usage:
  python3 get_utxos.py kaspatest:qq... --network testnet
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


async def get_utxos(address: str, network: str = "testnet") -> dict:
    net_map = {"testnet": "testnet-10", "mainnet": "mainnet"}
    net_id = net_map.get(network, network)

    client = RpcClient(resolver=Resolver(), network_id=net_id)
    await client.connect()

    try:
        result = await client.get_utxos_by_addresses({
            "addresses": [address]
        })
        entries = result.get("entries", [])
        return {
            "success": True,
            "address": address,
            "utxo_count": len(entries),
            "entries": entries,
        }
    finally:
        await client.disconnect()


def main():
    parser = argparse.ArgumentParser(description="Get UTXOs for a Kaspa address")
    parser.add_argument("address", help="Kaspa address")
    parser.add_argument("--network", choices=["mainnet", "testnet"], default="testnet")
    args = parser.parse_args()

    try:
        result = asyncio.run(get_utxos(args.address, args.network))
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
