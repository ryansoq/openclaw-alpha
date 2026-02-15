#!/usr/bin/env python3
"""Send an on-chain message to another Kaspa address via OP_RETURN.

Usage:
    python3 send_message.py --from <addr> --key <hex> --to <addr> --message "Hello!" --network testnet
    
The message is embedded in an OP_RETURN output.
A tiny amount (0.001 KAS) is sent to the recipient so the TX targets them.
"""

import argparse
import asyncio
import json
from kaspa import (
    RpcClient, Resolver, Generator, PaymentOutput,
    Address, PrivateKey, ScriptBuilder, Opcodes,
    TransactionOutput, ScriptPublicKey
)


async def send_message(
    sender_address: str,
    private_key_hex: str,
    recipient_address: str,
    message: str,
    network: str = "testnet"
) -> dict:
    """Send an on-chain message via OP_RETURN.
    
    Args:
        sender_address: Sender's Kaspa address
        private_key_hex: Sender's private key (hex)
        recipient_address: Recipient's Kaspa address
        message: Message text (max ~200 bytes)
        network: "mainnet" or "testnet"
        
    Returns:
        dict with transaction info
    """
    msg_bytes = message.encode('utf-8')
    if len(msg_bytes) > 200:
        raise ValueError(f"Message too long: {len(msg_bytes)} bytes (max 200)")
    
    # Tiny amount to send to recipient (so TX targets them)
    amount_sompi = 100_000  # 0.001 KAS
    
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
        
        # Create transaction with payment to recipient
        generator = Generator(
            network_id=network,
            entries=utxos["entries"],
            change_address=sender,
            outputs=[PaymentOutput(recipient, amount_sompi)],
            sig_op_count=1,
            priority_fee=0,
        )
        
        # Build, sign and submit
        # Note: OP_RETURN output added after generation
        tx_ids = []
        for pending_tx in generator:
            # Add OP_RETURN output with message
            script = ScriptBuilder()
            script.add_op(Opcodes.OpReturn)
            script.add_data(msg_bytes)
            script_bytes = script.drain()
            
            # Get the inner transaction and add OP_RETURN output
            tx = pending_tx.get_transaction()
            op_return_output = TransactionOutput(
                value=0,
                script_public_key=ScriptPublicKey(0, bytes(script_bytes, 'utf-8') if isinstance(script_bytes, str) else script_bytes)
            )
            
            # Add to outputs
            outputs = list(tx.outputs)
            outputs.append(op_return_output)
            tx.outputs = outputs
            
            pending_tx.sign([private_key])
            tx_id = await pending_tx.submit(client)
            tx_ids.append(str(tx_id))
        
        return {
            "success": True,
            "tx_ids": tx_ids,
            "recipient": recipient_address,
            "message": message,
            "message_bytes": len(msg_bytes),
        }
        
    finally:
        await client.disconnect()


async def read_messages(
    address: str,
    network: str = "testnet",
    limit: int = 10
) -> list:
    """Read incoming messages from recent transactions.
    
    Args:
        address: Your Kaspa address to check
        network: "mainnet" or "testnet"
        limit: Max messages to return
        
    Returns:
        list of message dicts
    """
    client = RpcClient(resolver=Resolver(), network_id=network)
    await client.connect()
    
    try:
        # Get recent transactions
        utxos = await client.get_utxos_by_addresses({
            "addresses": [address]
        })
        
        # TODO: Use indexer or get_transactions to find OP_RETURN payloads
        # For now, return placeholder
        return []
        
    finally:
        await client.disconnect()


def main():
    parser = argparse.ArgumentParser(description="Send on-chain Kaspa message")
    sub = parser.add_subparsers(dest="action", required=True)
    
    # Send
    send_p = sub.add_parser("send", help="Send a message")
    send_p.add_argument("--from", dest="sender", required=True, help="Sender address")
    send_p.add_argument("--key", required=True, help="Sender private key (hex)")
    send_p.add_argument("--to", dest="recipient", required=True, help="Recipient address")
    send_p.add_argument("--message", "-m", required=True, help="Message text (max 200 bytes)")
    send_p.add_argument("--network", choices=["mainnet", "testnet"], default="testnet")
    send_p.add_argument("--json", action="store_true", help="JSON output")
    
    # Read
    read_p = sub.add_parser("read", help="Read incoming messages")
    read_p.add_argument("--address", required=True, help="Your address")
    read_p.add_argument("--network", choices=["mainnet", "testnet"], default="testnet")
    read_p.add_argument("--limit", type=int, default=10)
    read_p.add_argument("--json", action="store_true", help="JSON output")
    
    args = parser.parse_args()
    
    if args.action == "send":
        try:
            result = asyncio.run(send_message(
                args.sender, args.key, args.recipient,
                args.message, args.network
            ))
            if args.json:
                print(json.dumps(result, indent=2))
            else:
                print(f"✅ Message sent!")
                print(f"   To: {args.recipient}")
                print(f"   Message: {args.message}")
                print(f"   Size: {result['message_bytes']} bytes")
                for tx_id in result['tx_ids']:
                    print(f"   TX: {tx_id}")
        except Exception as e:
            if args.json:
                print(json.dumps({"success": False, "error": str(e)}))
            else:
                print(f"❌ Error: {e}")
            exit(1)
    
    elif args.action == "read":
        messages = asyncio.run(read_messages(
            args.address, args.network, args.limit
        ))
        if args.json:
            print(json.dumps(messages, indent=2))
        else:
            if not messages:
                print("📭 No messages yet")
            for msg in messages:
                print(f"📨 From {msg.get('from', '?')}: {msg.get('text', '?')}")


if __name__ == "__main__":
    main()
