#!/usr/bin/env python3
"""Listen for new Kaspa transactions with message payloads on given addresses.
Outputs JSON lines to stdout for each new message found."""

import asyncio
import json
import sys
import time
from kaspa import RpcClient, Resolver


async def check_address(client, address: str, known_utxos: set) -> list:
    """Check for new UTXOs on an address, return new messages."""
    result = await client.get_utxos_by_addresses({'addresses': [address]})
    entries = result.get('entries', [])
    
    new_messages = []
    current_utxos = set()
    
    for entry in entries:
        outpoint = entry.get('outpoint', {})
        utxo_id = f"{outpoint.get('transactionId', '')}:{outpoint.get('index', 0)}"
        current_utxos.add(utxo_id)
        
        if utxo_id not in known_utxos:
            tx_id = outpoint.get('transactionId', '')
            amount = entry.get('utxoEntry', {}).get('amount', 0)
            # We found a new UTXO, report it
            new_messages.append({
                'tx_id': tx_id,
                'address': address,
                'amount_sompi': amount,
                'utxo_id': utxo_id,
            })
    
    return new_messages, current_utxos


async def main():
    if len(sys.argv) < 2:
        print("Usage: listen_messages.py <address1> [address2] ...", file=sys.stderr)
        sys.exit(1)
    
    addresses = sys.argv[1:]
    
    # Connect to local testnet node
    client = RpcClient(url='ws://127.0.0.1:17210')
    await client.connect()
    
    # Initialize known UTXOs
    known = {}
    for addr in addresses:
        result = await client.get_utxos_by_addresses({'addresses': [addr]})
        entries = result.get('entries', [])
        known[addr] = set()
        for entry in entries:
            outpoint = entry.get('outpoint', {})
            utxo_id = f"{outpoint.get('transactionId', '')}:{outpoint.get('index', 0)}"
            known[addr].add(utxo_id)
    
    print(json.dumps({"status": "ready", "addresses": len(addresses), "known_utxos": sum(len(v) for v in known.values())}), flush=True)
    
    # Poll loop
    while True:
        await asyncio.sleep(10)
        for addr in addresses:
            try:
                new_msgs, current = await check_address(client, addr, known[addr])
                known[addr] = current
                for msg in new_msgs:
                    print(json.dumps(msg), flush=True)
            except Exception as e:
                print(json.dumps({"error": str(e), "address": addr}), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
