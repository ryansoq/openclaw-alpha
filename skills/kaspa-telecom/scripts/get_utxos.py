#!/usr/bin/env python3
"""
Kaspa Telecom — Get UTXOs for an address.

Tries local kaspad RPC first, falls back to public REST API.

Usage:
  python3 get_utxos.py kaspatest:qq... --network testnet
"""

import argparse
import asyncio
import json
import sys
import urllib.request


def get_utxos_rest(address: str, network: str = "testnet") -> dict:
    """Get UTXOs via public REST API (no kaspad needed)."""
    base = "https://api-tn10.kaspa.org" if network == "testnet" else "https://api.kaspa.org"
    url = f"{base}/addresses/{address}/utxos"
    
    req = urllib.request.Request(url, headers={
        "Accept": "application/json",
        "User-Agent": "KaspaTelecom/1.0",
    })
    with urllib.request.urlopen(req, timeout=10) as resp:
        entries = json.loads(resp.read())
    
    return {
        "success": True,
        "address": address,
        "utxo_count": len(entries),
        "entries": entries,
        "source": "rest-api",
    }


async def get_utxos_rpc(address: str, network: str = "testnet") -> dict:
    """Get UTXOs via kaspad RPC (requires local node)."""
    from kaspa import RpcClient, Resolver
    
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
            "source": "rpc",
        }
    finally:
        await client.disconnect()


def main():
    parser = argparse.ArgumentParser(description="Get UTXOs for a Kaspa address")
    parser.add_argument("address", help="Kaspa address")
    parser.add_argument("--network", choices=["mainnet", "testnet"], default="testnet")
    parser.add_argument("--rest", action="store_true", help="Force REST API (no kaspad needed)")
    args = parser.parse_args()

    try:
        if args.rest:
            result = get_utxos_rest(args.address, args.network)
        else:
            # Try RPC first, fall back to REST
            try:
                result = asyncio.run(get_utxos_rpc(args.address, args.network))
            except Exception:
                result = get_utxos_rest(args.address, args.network)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
