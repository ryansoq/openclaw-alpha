#!/usr/bin/env python3
"""Send KAS to a recipient address."""

import argparse
import asyncio
import json
from kaspa import (
    RpcClient, Resolver, Generator, PaymentOutput,
    Address, PrivateKey
)


async def send_kas(
    sender_address: str,
    private_key_hex: str,
    recipient_address: str,
    amount_kas: float,
    network: str = "mainnet"
) -> dict:
    """Send KAS to a recipient.
    
    Args:
        sender_address: Sender's Kaspa address
        private_key_hex: Sender's private key (hex)
        recipient_address: Recipient's Kaspa address
        amount_kas: Amount to send in KAS
        network: "mainnet" or "testnet"
        
    Returns:
        dict with transaction info
    """
    amount_sompi = int(amount_kas * 100_000_000)
    
    private_key = PrivateKey(private_key_hex)
    sender = Address(sender_address)
    recipient = Address(recipient_address)
    
    client = RpcClient(resolver=Resolver(), network_id=network)
    await client.connect()
    
    try:
        # Get UTXOs
        utxos = await client.get_utxos_by_addresses({
            "addresses": [sender_address]
        })
        
        if not utxos["entries"]:
            raise ValueError("No UTXOs found - insufficient balance")
        
        # Create transaction generator
        generator = Generator(
            network_id=network,
            entries=utxos["entries"],
            change_address=sender,
            outputs=[PaymentOutput(recipient, amount_sompi)],
            sig_op_count=1,
            priority_fee=0,
        )
        
        # Sign and submit
        tx_ids = []
        for pending_tx in generator:
            pending_tx.sign([private_key])
            tx_id = await pending_tx.submit(client)
            tx_ids.append(str(tx_id))
        
        return {
            "success": True,
            "tx_ids": tx_ids,
            "amount_kas": amount_kas,
            "recipient": recipient_address,
        }
        
    finally:
        await client.disconnect()


def main():
    parser = argparse.ArgumentParser(description="Send KAS transaction")
    parser.add_argument("--from", dest="sender", required=True,
                        help="Sender address")
    parser.add_argument("--key", required=True,
                        help="Sender private key (hex)")
    parser.add_argument("--to", dest="recipient", required=True,
                        help="Recipient address")
    parser.add_argument("--amount", type=float, required=True,
                        help="Amount in KAS")
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
    
    try:
        result = asyncio.run(send_kas(
            args.sender,
            args.key,
            args.recipient,
            args.amount,
            args.network
        ))
        
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print("✅ Transaction submitted!")
            print(f"   Amount: {result['amount_kas']} KAS")
            print(f"   To: {result['recipient']}")
            for tx_id in result['tx_ids']:
                print(f"   TX ID: {tx_id}")
                
    except Exception as e:
        if args.json:
            print(json.dumps({"success": False, "error": str(e)}, indent=2))
        else:
            print(f"❌ Error: {e}")
        exit(1)


if __name__ == "__main__":
    main()
