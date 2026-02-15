#!/usr/bin/env python3
"""Get transaction history for a Kaspa address, including sender info."""

import argparse
import asyncio
import json
import urllib.request
from kaspa import RpcClient, Resolver


KASPA_API = "https://api.kaspa.org"


def fetch_transaction(tx_id: str) -> dict:
    """Fetch transaction details from Kaspa block explorer API."""
    url = f"{KASPA_API}/transactions/{tx_id}"
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; KaspaWallet/1.0)",
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode())


def find_sender_address(tx_data: dict, my_address: str) -> str | None:
    """Find the sender address from transaction outputs (change address)."""
    for output in tx_data.get("outputs", []):
        addr = output.get("script_public_key_address", "")
        if addr and addr != my_address:
            return addr
    return None


async def get_transactions(address: str, network: str = "mainnet") -> list[dict]:
    """Get transaction history for an address.
    
    Args:
        address: Kaspa address
        network: "mainnet" or "testnet"
        
    Returns:
        List of transaction info dicts
    """
    # Map short names to full network IDs
    network_map = {"testnet": "testnet-10", "mainnet": "mainnet"}
    net_id = network_map.get(network, network)
    client = RpcClient(resolver=Resolver(), network_id=net_id)
    await client.connect()
    
    try:
        # Get UTXOs (current unspent outputs)
        result = await client.get_utxos_by_addresses({"addresses": [address]})
        
        transactions = []
        for entry in result.get("entries", []):
            tx_id = entry["outpoint"]["transactionId"]
            amount_sompi = entry["utxoEntry"]["amount"]
            amount_kas = amount_sompi / 100_000_000
            
            # Fetch full transaction details
            try:
                tx_data = fetch_transaction(tx_id)
                sender = find_sender_address(tx_data, address)
                block_time = tx_data.get("block_time")
                
                transactions.append({
                    "tx_id": tx_id,
                    "amount_kas": amount_kas,
                    "amount_sompi": amount_sompi,
                    "sender": sender,
                    "block_time": block_time,
                    "is_accepted": tx_data.get("is_accepted", False),
                })
            except Exception as e:
                transactions.append({
                    "tx_id": tx_id,
                    "amount_kas": amount_kas,
                    "amount_sompi": amount_sompi,
                    "sender": None,
                    "error": str(e),
                })
        
        return transactions
        
    finally:
        await client.disconnect()


def main():
    parser = argparse.ArgumentParser(
        description="Get transaction history for a Kaspa address"
    )
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
    
    transactions = asyncio.run(get_transactions(args.address, args.network))
    
    if args.json:
        print(json.dumps(transactions, indent=2))
    else:
        print(f"📜 Transaction History for {args.address[:20]}...\n")
        print("-" * 60)
        
        for tx in transactions:
            print(f"TX: {tx['tx_id'][:16]}...")
            print(f"   💰 Amount: {tx['amount_kas']} KAS")
            if tx.get("sender"):
                print(f"   👤 From: {tx['sender'][:30]}...")
            if tx.get("error"):
                print(f"   ⚠️  Error: {tx['error']}")
            print()


if __name__ == "__main__":
    main()
