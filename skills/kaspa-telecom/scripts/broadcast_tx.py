#!/usr/bin/env python3
"""
Kaspa Telecom — Broadcast a signed TX via kaspad wRPC.

Accepts serialize_to_dict() output directly.
Connects to local kaspad wRPC (ws://127.0.0.1:17210).

Usage:
  # From build_and_sign.py output
  python3 build_and_sign.py ... | python3 broadcast_tx.py

  # Direct dict input
  echo '{"transaction": {...}}' | python3 broadcast_tx.py

  # With custom wRPC endpoint
  python3 broadcast_tx.py --rpc ws://127.0.0.1:17210
"""

import argparse
import asyncio
import json
import sys

try:
    import websockets
except ImportError:
    print(json.dumps({"success": False, "error": "websockets not installed. pip install websockets"}))
    sys.exit(1)


def convert_to_rpc_format(tx_dict: dict) -> dict:
    """Convert serialize_to_dict() output to kaspad submitTransaction format."""
    inputs = []
    for inp in tx_dict.get("inputs", []):
        rpc_input = {
            "previousOutpoint": {
                "transactionId": inp["transactionId"],
                "index": inp["index"],
            },
            "signatureScript": inp.get("signatureScript", ""),
            "sequence": inp.get("sequence", 0),
            "sigOpCount": inp.get("sigOpCount", 1),
        }
        inputs.append(rpc_input)

    outputs = []
    for out in tx_dict.get("outputs", []):
        rpc_output = {
            "amount": out["value"],
            "scriptPublicKey": {
                "version": 0,
                "scriptPublicKey": out["scriptPublicKey"],
            },
        }
        # If scriptPublicKey is already a dict with version
        if isinstance(out.get("scriptPublicKey"), dict):
            rpc_output["scriptPublicKey"] = out["scriptPublicKey"]
        outputs.append(rpc_output)

    return {
        "version": tx_dict.get("version", 0),
        "inputs": inputs,
        "outputs": outputs,
        "lockTime": tx_dict.get("lockTime", 0),
        "subnetworkId": tx_dict.get("subnetworkId", "0000000000000000000000000000000000000000"),
        "gas": tx_dict.get("gas", 0),
        "payload": tx_dict.get("payload", ""),
    }


async def broadcast(tx_dict: dict, rpc_url: str = "ws://127.0.0.1:17210") -> dict:
    """Broadcast a signed transaction via kaspad wRPC."""
    rpc_tx = convert_to_rpc_format(tx_dict)

    request = {
        "id": 1,
        "method": "submitTransaction",
        "params": {
            "transaction": rpc_tx,
            "allowOrphan": False,
        },
    }

    async with websockets.connect(rpc_url, open_timeout=10) as ws:
        await ws.send(json.dumps(request))
        response = json.loads(await ws.recv())

    if "error" in response and response["error"]:
        return {"success": False, "error": str(response["error"])}

    tx_id = response.get("result", {}).get("transactionId", response.get("result", ""))
    return {
        "success": True,
        "tx_id": tx_id if isinstance(tx_id, str) else str(tx_id),
    }


def parse_input(raw: str) -> dict:
    """Parse input: build_and_sign output, transaction dict, etc."""
    data = json.loads(raw)

    # build_and_sign.py output
    if "signed_txs" in data:
        return data["signed_txs"][0]
    # Wrapped in transaction key
    if "transaction" in data and isinstance(data["transaction"], dict):
        return data["transaction"]
    # Direct tx dict
    if "inputs" in data or "version" in data:
        return data
    raise ValueError("Unrecognized TX format")


def main():
    parser = argparse.ArgumentParser(description="Broadcast signed TX via kaspad wRPC")
    parser.add_argument("--rpc", default="ws://127.0.0.1:17210", help="kaspad wRPC URL")
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
        result = asyncio.run(broadcast(tx_dict, args.rpc))
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
