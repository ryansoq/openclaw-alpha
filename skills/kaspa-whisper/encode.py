"""
Kaspa Whisper — encode

打包訊息（明文或密文），產出已簽名 TX。
可直接上鏈，或加 --raw 搭配 broadcast.py / Web API 使用。

Usage:
  python3 encode.py <to> "<message>" --key <privkey>              # 密文（預設）
  python3 encode.py <to> "<message>" --key <privkey> --plain      # 明文
  python3 encode.py <to> "<message>" --key <privkey> --raw        # 只產 TX，不上鏈
  python3 encode.py <to> "<message>" --from <name>                # 用通訊錄
"""
import asyncio, json, sys, os

sys.path.insert(0, '/home/ymchang/nami-backpack/projects/nami-kaspa-bot')

from ecies import encrypt
from kaspa import PrivateKey, Address, PaymentOutput, create_transaction, sign_transaction
from rpc_manager import get_utxos, submit_transaction

WHISPER_AMOUNT = 20000000  # 0.2 KAS
TX_FEE = 50000
CONTACTS_FILE = os.path.join(os.path.dirname(__file__), 'contacts.json')

def load_contacts():
    with open(CONTACTS_FILE) as f:
        return json.load(f)

async def encode(to_name: str, message: str, privkey_hex: str, from_addr: str,
                 plain: bool = False, raw_only: bool = False):
    contacts = load_contacts()
    to = contacts.get(to_name.lower())
    if not to:
        print(f"❌ 找不到 '{to_name}'，可用: {', '.join(contacts.keys())}")
        return

    if not to.get('pubkey'):
        print(f"❌ {to['name']} 沒有公鑰")
        return

    if plain:
        print(f"📤 明文 → {to['name']}")
        payload = json.dumps({
            "v": 1, "t": "message", "d": message,
            "a": {"from": from_addr}
        }, separators=(',', ':'), ensure_ascii=False).encode()
    else:
        print(f"🔐 密文 → {to['name']}")
        encrypted = encrypt(to['pubkey'], message.encode('utf-8'))
        print(f"   加密: {len(encrypted)} bytes")
        payload = json.dumps({
            "v": 1, "t": "whisper", "d": encrypted.hex(),
            "a": {"from": from_addr}
        }, separators=(',', ':'), ensure_ascii=False).encode()

    print(f"   Payload: {len(payload)} bytes")

    # Build TX
    pk = PrivateKey(privkey_hex)
    entries = await get_utxos(from_addr)
    if not entries:
        print("❌ 沒有餘額")
        return

    entries.sort(key=lambda e: e["utxoEntry"]["amount"], reverse=True)
    selected, total = [], 0
    for e in entries:
        selected.append(e)
        total += e["utxoEntry"]["amount"]
        if total >= WHISPER_AMOUNT + TX_FEE + 1000:
            break

    if total < WHISPER_AMOUNT + TX_FEE:
        print(f"❌ 餘額不足: {total/1e8:.4f} KAS")
        return

    change = total - WHISPER_AMOUNT - TX_FEE
    outputs = [PaymentOutput(Address(to['address']), WHISPER_AMOUNT)]
    if change > 0:
        outputs.append(PaymentOutput(Address(from_addr), change))

    tx = create_transaction(utxo_entry_source=selected, outputs=outputs,
                           priority_fee=TX_FEE, payload=payload)
    signed = sign_transaction(tx, [pk], False)

    if raw_only:
        print(f"\n📋 Signed TX:")
        print(signed.to_json())
        return

    tx_id = await submit_transaction(signed, allow_orphan=False)
    print(f"\n✅ TX: {tx_id}")
    print(f"   https://explorer-tn10.kaspa.org/txs/{tx_id}")
    print(f"\n   decode: python3 decode.py {tx_id} --key <私鑰>")

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print('Usage: python3 encode.py <to> "<message>" --key <privkey> [--plain] [--raw]')
        print(f"通訊錄: {', '.join(load_contacts().keys())}")
        sys.exit(1)

    to_name, message = sys.argv[1], sys.argv[2]
    plain = '--plain' in sys.argv
    raw_only = '--raw' in sys.argv
    args = [a for a in sys.argv[3:] if a not in ('--plain', '--raw')]

    contacts = load_contacts()
    if args[0] == '--key':
        privkey = args[1]
        pk = PrivateKey(privkey)
        addr = pk.to_public_key().to_address('testnet').to_string()
        asyncio.run(encode(to_name, message, privkey, addr, plain, raw_only))
    elif args[0] == '--from':
        c = contacts.get(args[1].lower())
        if not c or 'privkey' not in c:
            print(f"❌ '{args[1]}' 沒有私鑰"); sys.exit(1)
        asyncio.run(encode(to_name, message, c['privkey'], c['address'], plain, raw_only))
