"""
Kaspa Whisper — broadcast

廣播已簽名 TX 上鏈。搭配 encode.py --raw 使用。
也可透過 Web API: POST /whisper/broadcast

Usage:
  python3 broadcast.py <signed_tx_json>
  python3 broadcast.py --file <tx_file.json>
"""
import asyncio, json, sys, os

sys.path.insert(0, '/home/ymchang/nami-backpack/projects/nami-kaspa-bot')

from rpc_manager import submit_transaction
from kaspa import Transaction

async def broadcast(signed_tx_json: str):
    tx = Transaction.from_json(signed_tx_json)
    tx_id = await submit_transaction(tx, allow_orphan=False)
    print(f"✅ 廣播成功！TX: {tx_id}")
    print(f"   https://explorer-tn10.kaspa.org/txs/{tx_id}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 broadcast.py '<signed_tx_json>'")
        print("  python3 broadcast.py --file tx.json")
        sys.exit(1)

    if sys.argv[1] == '--file':
        with open(sys.argv[2]) as f:
            tx_json = f.read()
    else:
        tx_json = sys.argv[1]

    asyncio.run(broadcast(tx_json))
