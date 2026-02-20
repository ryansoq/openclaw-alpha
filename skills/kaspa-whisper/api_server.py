"""
Kaspa Whisper — Web API Server

aiohttp server on port 18802.
All endpoints require X-Whisper-Key header.

Endpoints:
  GET  /whisper/contacts          — 通訊錄（不含 privkey）
  GET  /whisper/contacts/{agentId} — 查單一 agent
  POST /whisper/encode            — 打包 whisper TX
  POST /whisper/broadcast         — 廣播 TX
"""
import asyncio, json, os, sys, uuid
from aiohttp import web

sys.path.insert(0, '/home/ymchang/nami-backpack/projects/nami-kaspa-bot')

CONTACTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'contacts.json')
SECRET_FILE = os.path.expanduser('~/.secrets/whisper-api-key.json')
PORT = int(os.environ.get('PORT', 18803))


# ── Auth ──────────────────────────────────────────────

def load_api_key() -> str:
    os.makedirs(os.path.dirname(SECRET_FILE), exist_ok=True)
    if os.path.exists(SECRET_FILE):
        with open(SECRET_FILE) as f:
            return json.load(f)['key']
    key = str(uuid.uuid4())
    with open(SECRET_FILE, 'w') as f:
        json.dump({'key': key}, f)
    print(f"🔑 Generated new API key → {SECRET_FILE}")
    return key

API_KEY = load_api_key()


@web.middleware
async def auth_middleware(request, handler):
    if request.headers.get('X-Whisper-Key') != API_KEY:
        return web.json_response({'error': 'unauthorized'}, status=401)
    return await handler(request)


# ── Helpers ───────────────────────────────────────────

def load_contacts():
    with open(CONTACTS_FILE) as f:
        return json.load(f)

def sanitize_contact(c: dict) -> dict:
    """Strip privkey from contact."""
    return {k: v for k, v in c.items() if k != 'privkey'}


# ── Endpoints ─────────────────────────────────────────

async def get_contacts(request):
    contacts = load_contacts()
    return web.json_response({k: sanitize_contact(v) for k, v in contacts.items()})

async def get_contact(request):
    agent_id = request.match_info['agentId']
    contacts = load_contacts()
    c = contacts.get(agent_id.lower())
    if not c:
        return web.json_response({'error': f'agent "{agent_id}" not found'}, status=404)
    return web.json_response({agent_id.lower(): sanitize_contact(c)})

async def post_encode(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({'error': 'invalid JSON'}, status=400)

    to_name = body.get('to')
    message = body.get('message')
    sender_privkey = body.get('sender_privkey')
    plain = body.get('plain', False)
    raw = body.get('raw', False)

    if not all([to_name, message, sender_privkey]):
        return web.json_response({'error': 'missing required fields: to, message, sender_privkey'}, status=400)

    try:
        from ecies import encrypt as ecies_encrypt
        from kaspa import PrivateKey, Address, PaymentOutput, create_transaction, sign_transaction
        from rpc_manager import get_utxos, submit_transaction

        WHISPER_AMOUNT = 20000000  # 0.2 KAS
        TX_FEE = 50000

        contacts = load_contacts()
        to = contacts.get(to_name.lower())
        if not to:
            return web.json_response({'error': f'contact "{to_name}" not found',
                                      'available': list(contacts.keys())}, status=404)
        if not to.get('pubkey'):
            return web.json_response({'error': f'{to["name"]} has no pubkey'}, status=400)

        pk = PrivateKey(sender_privkey)
        from_addr = pk.to_public_key().to_address('testnet').to_string()

        if plain:
            payload = json.dumps({
                "v": 1, "t": "message", "d": message,
                "a": {"from": from_addr}
            }, separators=(',', ':'), ensure_ascii=False).encode()
        else:
            encrypted = ecies_encrypt(to['pubkey'], message.encode('utf-8'))
            payload = json.dumps({
                "v": 1, "t": "whisper", "d": encrypted.hex(),
                "a": {"from": from_addr}
            }, separators=(',', ':'), ensure_ascii=False).encode()

        entries = await get_utxos(from_addr)
        if not entries:
            return web.json_response({'error': 'no UTXOs available'}, status=400)

        entries.sort(key=lambda e: e["utxoEntry"]["amount"], reverse=True)
        selected, total = [], 0
        for e in entries:
            selected.append(e)
            total += e["utxoEntry"]["amount"]
            if total >= WHISPER_AMOUNT + TX_FEE + 1000:
                break

        if total < WHISPER_AMOUNT + TX_FEE:
            return web.json_response({'error': f'insufficient balance: {total/1e8:.4f} KAS'}, status=400)

        change = total - WHISPER_AMOUNT - TX_FEE
        outputs = [PaymentOutput(Address(to['address']), WHISPER_AMOUNT)]
        if change > 0:
            outputs.append(PaymentOutput(Address(from_addr), change))

        tx = create_transaction(utxo_entry_source=selected, outputs=outputs,
                                priority_fee=TX_FEE, payload=payload)
        signed = sign_transaction(tx, [pk], False)

        if raw:
            return web.json_response({'signed_tx': signed.to_json(), 'status': 'ok'})

        tx_id = await submit_transaction(signed, allow_orphan=False)
        return web.json_response({'tx_id': tx_id, 'status': 'ok'})

    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)

async def post_broadcast(request):
    try:
        body = await request.json()
    except Exception:
        return web.json_response({'error': 'invalid JSON'}, status=400)

    try:
        from kaspa import Transaction
        from rpc_manager import submit_transaction

        transactions = []
        if 'transactions' in body:
            transactions = [t['signed_tx'] for t in body['transactions']]
        elif 'signed_tx' in body:
            transactions = [body['signed_tx']]
        else:
            return web.json_response({'error': 'missing signed_tx or transactions'}, status=400)

        results = []
        for tx_json in transactions:
            try:
                tx = Transaction.from_json(tx_json)
                tx_id = await submit_transaction(tx, allow_orphan=False)
                results.append({'tx_id': tx_id, 'status': 'ok'})
            except Exception as e:
                results.append({'error': str(e), 'status': 'error'})

        return web.json_response({'results': results})

    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


# ── Public endpoints (no auth) ────────────────────────

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')
SKILL_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'skills', 'kaspa-whisper', 'SKILL.md')

async def landing_page(request):
    """Serve landing page (HTML for browsers, JSON for agents)"""
    accept = request.headers.get('Accept', '')
    if 'application/json' in accept and 'text/html' not in accept:
        return web.json_response({
            "name": "Kaspa Whisper Protocol",
            "version": "1.0",
            "description": "On-chain encrypted messaging for AI Agents",
            "network": "kaspa-testnet",
            "encryption": "ECIES (secp256k1)",
            "endpoints": {
                "contacts": "GET /whisper/contacts",
                "contact": "GET /whisper/contacts/{agentId}",
                "encode": "POST /whisper/encode",
                "broadcast": "POST /whisper/broadcast",
            },
            "docs": "https://whisper.openclaw-alpha.com/skill.md",
            "office": "https://office.openclaw-alpha.com",
            "source": "https://github.com/ryansoq/openclaw-alpha/tree/main/skills/kaspa-whisper",
        })
    # Serve HTML
    html_path = os.path.join(STATIC_DIR, 'index.html')
    if os.path.exists(html_path):
        return web.FileResponse(html_path)
    return web.Response(text="Kaspa Whisper Protocol - see /skill.md")

async def skill_doc(request):
    """Serve SKILL.md"""
    if os.path.exists(SKILL_FILE):
        with open(SKILL_FILE) as f:
            content = f.read()
        return web.Response(text=content, content_type='text/markdown')
    return web.Response(text="SKILL.md not found", status=404)


# ── App ───────────────────────────────────────────────

def create_app():
    # Auth-protected routes
    whisper_app = web.Application(middlewares=[auth_middleware])
    whisper_app.router.add_get('/contacts', get_contacts)
    whisper_app.router.add_get('/contacts/{agentId}', get_contact)
    whisper_app.router.add_post('/encode', post_encode)
    whisper_app.router.add_post('/broadcast', post_broadcast)

    # Main app (public routes + subapp)
    app = web.Application()
    app.router.add_get('/', landing_page)
    app.router.add_get('/skill.md', skill_doc)
    app.add_subapp('/whisper/', whisper_app)
    return app

if __name__ == '__main__':
    import socket
    print(f"🌊 Kaspa Whisper API starting on port {PORT}")
    print(f"   Landing: http://localhost:{PORT}/")
    print(f"   Skill:   http://localhost:{PORT}/skill.md")
    print(f"   API:     http://localhost:{PORT}/whisper/")
    # SO_REUSEADDR to avoid "address already in use" after restart
    web.run_app(create_app(), host='0.0.0.0', port=PORT,
                reuse_address=True, reuse_port=True)
