#!/usr/bin/env python3
"""
Kaspa Telecom — Broadcast a signed TX via kaspa SDK.

Accepts serialize_to_dict() JSON, reconstructs Transaction object,
and submits via SDK's submit_transaction.

Usage:
  python3 build_and_sign.py ... | python3 broadcast_tx.py --network testnet
  echo '{"transaction": {...}}' | python3 broadcast_tx.py --network testnet
"""

import argparse
import asyncio
import json
import sys

try:
    from kaspa import (
        RpcClient, Resolver, Hash,
        Transaction, TransactionInput, TransactionOutput,
        TransactionOutpoint, ScriptPublicKey,
    )
except ImportError:
    print(json.dumps({"success": False, "error": "kaspa SDK not installed"}))
    sys.exit(1)


def reconstruct_transaction(tx_dict: dict) -> Transaction:
    """Reconstruct a Transaction object from serialize_to_dict() output."""
    inputs = []
    for inp in tx_dict.get("inputs", []):
        outpoint = TransactionOutpoint(
            Hash(inp["transactionId"]),
            inp["index"],
        )
        ti = TransactionInput(
            outpoint,
            inp.get("signatureScript", ""),
            inp.get("sequence", 0),
            inp.get("sigOpCount", 1),
        )
        inputs.append(ti)

    outputs = []
    for out in tx_dict.get("outputs", []):
        spk_data = out.get("scriptPublicKey", "")
        if isinstance(spk_data, dict):
            spk = ScriptPublicKey(
                spk_data.get("version", 0),
                spk_data.get("scriptPublicKey", ""),
            )
        else:
            spk = ScriptPublicKey(0, spk_data)
        to = TransactionOutput(out["value"], spk)
        outputs.append(to)

    # subnetworkId is 20 bytes = 40 hex chars
    sub_id = tx_dict.get("subnetworkId", "0000000000000000000000000000000000000000")
    # Ensure 40 hex chars
    if len(sub_id) > 40:
        sub_id = sub_id[:40]

    # payload as hex string
    payload = tx_dict.get("payload", "")

    return Transaction(
        tx_dict.get("version", 0),
        inputs,
        outputs,
        tx_dict.get("lockTime", 0),
        sub_id,
        tx_dict.get("gas", 0),
        payload,
        tx_dict.get("mass", 0),
    )


async def broadcast(tx_dict: dict, network: str = "testnet") -> dict:
    """Reconstruct and broadcast a signed transaction."""
    net_map = {"testnet": "testnet-10", "mainnet": "mainnet"}
    net_id = net_map.get(network, network)

    tx = reconstruct_transaction(tx_dict)
    print(f"[broadcast] Reconstructed TX: {tx.id}", file=sys.stderr)

    client = RpcClient(resolver=Resolver(), network_id=net_id)
    await client.connect()

    try:
        result = await client.submit_transaction({
            "transaction": tx,
            "allowOrphan": False,
        })
        tx_id = result if isinstance(result, str) else str(result)
        return {"success": True, "tx_id": tx_id, "network": network}
    finally:
        await client.disconnect()


def parse_input(raw: str) -> dict:
    """Parse input: build_and_sign output or direct tx dict."""
    data = json.loads(raw)
    if "signed_txs" in data:
        return data["signed_txs"][0]
    if "transaction" in data and isinstance(data["transaction"], dict):
        return data["transaction"]
    if "inputs" in data or "version" in data:
        return data
    raise ValueError("Unrecognized TX format. Provide serialize_to_dict() output.")


def main():
    parser = argparse.ArgumentParser(description="Broadcast signed TX")
    parser.add_argument("--network", choices=["mainnet", "testnet"], default="testnet")
    args = parser.parse_args()

    stdin_data = sys.stdin.read().strip()
    if not stdin_data:
        print(json.dumps({"success": False, "error": "Pipe signed TX JSON to stdin"}))
        sys.exit(1)

    try:
        tx_dict = parse_input(stdin_data)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Parse error: {e}"}))
        sys.exit(1)

    try:
        result = asyncio.run(broadcast(tx_dict, args.network))
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
