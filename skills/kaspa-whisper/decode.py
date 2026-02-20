"""
Kaspa Whisper — decode

解密訊息（明文/密文）+ 已讀回執 + 返還 0.2 KAS，一條龍。

Usage:
  python3 decode.py <tx_id> --key <privkey>
  python3 decode.py <tx_id> <name>              # 用通訊錄
"""
import asyncio, json, sys, os, time

sys.path.insert(0, '/home/ymchang/nami-backpack/projects/nami-kaspa-bot')

from ecies import decrypt
from kaspa import PrivateKey, Address, PaymentOutput, create_transaction, sign_transaction
from rpc_manager import get_utxos, submit_transaction

TX_FEE = 50000
REFUND_AMOUNT = 20000000  # 0.2 KAS
CONTACTS_FILE = os.path.join(os.path.dirname(__file__), 'contacts.json')

def load_contacts():
    with open(CONTACTS_FILE) as f:
        return json.load(f)

async def decode(tx_id: str, privkey_hex: str, my_addr: str = None):
    # 1. Fetch TX
    print(f"🔍 TX: {tx_id}")
    import httpx
    async with httpx.AsyncClient() as http:
        resp = await http.get(f"https://api-tn10.kaspa.org/transactions/{tx_id}")
        tx = resp.json()

    payload_hex = tx.get('payload', '')
    if not payload_hex:
        print("❌ 沒有 payload")
        return

    payload = json.loads(bytes.fromhex(payload_hex))
    msg_type = payload.get('type') or payload.get('t')
    if msg_type not in ('whisper', 'message'):
        print(f"❌ 不支援的類型: {msg_type}")
        return

    sender = payload.get('from') or payload.get('a', {}).get('from', '')
    contacts = load_contacts()
    sender_name = sender
    for name, info in contacts.items():
        if info['address'] == sender:
            sender_name = info['name']
            break

    print(f"📤 來自: {sender_name}")

    # 2. Read message
    raw_d = payload.get('enc') or payload.get('d', '')

    if msg_type == 'whisper':
        encrypted = bytes.fromhex(raw_d)
        try:
            message = decrypt(privkey_hex, encrypted).decode('utf-8')
            print(f"\n🔐💌 密語: {message}\n")
        except Exception as e:
            print(f"❌ 解密失敗: {e}")
            return
    else:
        message = raw_d
        print(f"\n📨 訊息: {message}\n")

    # 3. Refund 0.2 KAS + ack
    if not sender:
        print("⚠️ 無發送者地址，跳過退款")
        return

    if not my_addr:
        pk = PrivateKey(privkey_hex)
        my_addr = pk.to_public_key().to_address('testnet').to_string()

    print(f"💸 返還 0.2 KAS → {sender_name}")
    entries = await get_utxos(my_addr)
    entries.sort(key=lambda e: e["utxoEntry"]["amount"], reverse=True)

    selected, total = [], 0
    for e in entries:
        selected.append(e)
        total += e["utxoEntry"]["amount"]
        if total >= REFUND_AMOUNT + TX_FEE + 1000:
            break

    if total < REFUND_AMOUNT + TX_FEE:
        print(f"❌ 餘額不足: {total/1e8:.4f} KAS")
        return

    change = total - REFUND_AMOUNT - TX_FEE
    outputs = [PaymentOutput(Address(sender), REFUND_AMOUNT)]
    if change > 0:
        outputs.append(PaymentOutput(Address(my_addr), change))

    ack_payload = json.dumps({
        "v": 1, "t": "ack", "d": tx_id,
        "a": {"time": int(time.time())}
    }, separators=(',', ':')).encode()

    pk_obj = PrivateKey(privkey_hex)
    rtx = create_transaction(utxo_entry_source=selected, outputs=outputs,
                            priority_fee=TX_FEE, payload=ack_payload)
    signed = sign_transaction(rtx, [pk_obj], False)
    refund_tx = await submit_transaction(signed, allow_orphan=False)

    print(f"✅ 已讀 + 返還！TX: {refund_tx}")
    print(f"   https://explorer-tn10.kaspa.org/txs/{refund_tx}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 decode.py <tx_id> --key <privkey>")
        sys.exit(1)

    tx_id = sys.argv[1]

    if sys.argv[2] == '--key':
        asyncio.run(decode(tx_id, sys.argv[3]))
    else:
        name = sys.argv[2].lower()
        contacts = load_contacts()
        if name not in contacts or 'privkey' not in contacts[name]:
            print(f"❌ '{name}' 找不到或沒私鑰"); sys.exit(1)
        c = contacts[name]
        asyncio.run(decode(tx_id, c['privkey'], c['address']))
