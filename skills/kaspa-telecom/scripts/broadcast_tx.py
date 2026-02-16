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
        # Handle both flat and nested previousOutpoint formats
        if "previousOutpoint" in inp:
            po = inp["previousOutpoint"]
            tx_id = po["transactionId"]
            idx = po["index"]
        else:
            tx_id = inp["transactionId"]
            idx = inp["index"]
        outpoint = TransactionOutpoint(
            Hash(tx_id),
            idx,
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
        elif isinstance(spk_data, str) and len(spk_data) > 4:
            # serialize_to_dict format: first 4 hex chars = version (2 bytes LE)
            version = int(spk_data[:4], 16)
            script = spk_data[4:]
            spk = ScriptPublicKey(version, script)
        else:
            # scriptPublicKey hex format: [version:2bytes][script]
            # version is first 4 hex chars (2 bytes), extract it
            version = int(spk_data[:4], 16) if len(spk_data) >= 4 else 0
            script = spk_data[4:] if len(spk_data) > 4 else spk_data
            spk = ScriptPublicKey(version, script)
        amount = out.get("value") or out.get("amount", 0)
        to = TransactionOutput(amount, spk)
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


def normalize_for_rest_api(tx_dict: dict) -> dict:
    """Normalize serialize_to_dict() format to Kaspa REST API format."""
    inputs = []
    for inp in tx_dict.get("inputs", []):
        if "previousOutpoint" in inp:
            po = inp["previousOutpoint"]
        else:
            po = {"transactionId": inp["transactionId"], "index": inp["index"]}
        inputs.append({
            "previousOutpoint": po,
            "signatureScript": inp.get("signatureScript", ""),
            "sequence": inp.get("sequence", 0),
            "sigOpCount": inp.get("sigOpCount", 1),
        })
    
    outputs = []
    for out in tx_dict.get("outputs", []):
        amount = out.get("value") or out.get("amount", 0)
        spk = out.get("scriptPublicKey", "")
        if isinstance(spk, str):
            # Convert hex to {scriptPublicKey, version} dict
            version = int(spk[:4], 16) if len(spk) >= 4 else 0
            script = spk[4:] if len(spk) > 4 else spk
            spk = {"scriptPublicKey": script, "version": version}
        outputs.append({"amount": amount, "scriptPublicKey": spk})
    
    return {
        "version": tx_dict.get("version", 0),
        "inputs": inputs,
        "outputs": outputs,
        "lockTime": tx_dict.get("lockTime", 0),
        "subnetworkId": tx_dict.get("subnetworkId", "0000000000000000000000000000000000000000"),
        "payload": tx_dict.get("payload", ""),
    }


def broadcast_rest(tx_dict: dict, network: str = "testnet") -> dict:
    """Broadcast via public REST API (no kaspad needed)."""
    import urllib.request
    
    base = "https://api-tn10.kaspa.org" if network == "testnet" else "https://api.kaspa.org"
    url = f"{base}/transactions"
    
    normalized = normalize_for_rest_api(tx_dict)
    payload = json.dumps({"transaction": normalized}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={
        "Content-Type": "application/json",
        "User-Agent": "KaspaTelecom/1.0",
    })
    
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
            tx_id = result if isinstance(result, str) else result.get("transactionId", str(result))
            return {"success": True, "tx_id": tx_id, "network": network, "source": "rest-api"}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return {"success": False, "error": f"REST API {e.code}: {body[:200]}"}


async def broadcast_rpc(tx_dict: dict, network: str = "testnet") -> dict:
    """Broadcast via kaspad RPC (requires local node or resolver)."""
    net_map = {"testnet": "testnet-10", "mainnet": "mainnet"}
    net_id = net_map.get(network, network)

    tx = reconstruct_transaction(tx_dict)
    print(f"[broadcast] Reconstructed TX: {tx.id}", file=sys.stderr)

    client = RpcClient(resolver=Resolver(), network_id=net_id)
    await client.connect()

    try:
        result = await client.submit_transaction({
            "transaction": tx,
            "allow_orphan": False,
        })
        tx_id = result if isinstance(result, str) else str(result)
        return {"success": True, "tx_id": tx_id, "network": network, "source": "rpc"}
    finally:
        await client.disconnect()


def broadcast(tx_dict: dict, network: str = "testnet") -> dict:
    """Try REST API first (no reconstruct needed), fall back to RPC."""
    try:
        return broadcast_rest(tx_dict, network)
    except Exception as rest_err:
        print(f"[broadcast] REST failed ({rest_err}), trying RPC...", file=sys.stderr)
        return asyncio.run(broadcast_rpc(tx_dict, network))


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
        result = broadcast(tx_dict, args.network)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
