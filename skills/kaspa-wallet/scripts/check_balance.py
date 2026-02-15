#!/usr/bin/env python3
"""Check balance of a Kaspa address."""

import argparse
import asyncio
import json
from kaspa import RpcClient, Resolver


async def check_balance(address: str, network: str = "mainnet") -> dict:
    """Check balance of a Kaspa address.
    
    Args:
        address: Kaspa address (kaspa:q...)
        network: "mainnet" or "testnet"
        
    Returns:
        dict with balance info
    """
    client = RpcClient(resolver=Resolver(), network_id=network)
    await client.connect()
    
    try:
        result = await client.get_balance_by_address({"address": address})
        balance_sompi = result.get("balance", 0)
        balance_kas = balance_sompi / 100_000_000
        
        return {
            "address": address,
            "balance_kas": balance_kas,
            "balance_sompi": balance_sompi,
        }
    finally:
        await client.disconnect()


def main():
    parser = argparse.ArgumentParser(description="Check Kaspa address balance")
    parser.add_argument("address", help="Kaspa address to check")
    parser.add_argument(
        "--network",
        choices=["mainnet", "testnet"],
        default="mainnet",
        help="Network type (default: mainnet)"
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output as JSON"
    )
    args = parser.parse_args()
    
    result = asyncio.run(check_balance(args.address, args.network))
    
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"💰 Balance: {result['balance_kas']} KAS")
        print(f"   ({result['balance_sompi']} sompi)")


if __name__ == "__main__":
    main()
