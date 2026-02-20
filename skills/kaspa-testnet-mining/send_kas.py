#!/usr/bin/env python3
"""
🌊 Kaspa 發送交易腳本
by Nami (波浪)

用法:
  python3 send_kas.py --wallet wallet.json --to kaspatest:qq... --amount 10
"""

import asyncio
import argparse
import json
import sys

async def send_transaction(
    wallet_file: str,
    to_address: str,
    amount_kas: float,
    fee: int = 10000
):
    try:
        from kaspa import Wallet, RpcClient, Resolver, NetworkType
    except ImportError:
        print("❌ 請先安裝 kaspa SDK:")
        print("   pip install kaspa")
        return
    
    # 載入錢包
    print(f"🔐 載入錢包: {wallet_file}")
    with open(wallet_file, 'r') as f:
        wallet_data = json.load(f)
    
    mnemonic = wallet_data['mnemonic']
    network_name = wallet_data.get('network', 'testnet')
    
    network = NetworkType.MAINNET if network_name == 'mainnet' else NetworkType.TESTNET
    network_id = "mainnet" if network_name == 'mainnet' else "testnet-10"
    
    wallet = Wallet.from_mnemonic(mnemonic, network)
    from_address = str(wallet.receive_address())
    
    print(f"""
╔═══════════════════════════════════════════════════════════════╗
║  🌊 Kaspa 交易確認                                            ║
╠═══════════════════════════════════════════════════════════════╣
║  從: {from_address[:30]}...
║  到: {to_address[:30]}...
║  金額: {amount_kas} {'tKAS' if 'testnet' in network_id else 'KAS'}
║  手續費: {fee / 100_000_000:.8f} {'tKAS' if 'testnet' in network_id else 'KAS'}
╚═══════════════════════════════════════════════════════════════╝
""")
    
    confirm = input("確認發送? (y/N): ")
    if confirm.lower() != 'y':
        print("❌ 已取消")
        return
    
    print("📤 正在發送...")
    
    try:
        resolver = Resolver()
        client = RpcClient(resolver=resolver, network_id=network_id)
        await client.connect()
        
        amount_sompi = int(amount_kas * 100_000_000)
        
        tx = await wallet.send(
            client,
            to_address,
            amount_sompi,
            priority_fee=fee
        )
        
        print(f"""
✅ 交易已發送！

🔗 TX ID: {tx.id}

交易通常在幾秒內確認 (Kaspa 很快！)
""")
        
        await client.disconnect()
        
    except Exception as e:
        print(f"❌ 發送失敗: {e}")

def main():
    parser = argparse.ArgumentParser(description='發送 Kaspa')
    parser.add_argument('--wallet', '-w', required=True, help='錢包 JSON 檔案')
    parser.add_argument('--to', '-t', required=True, help='目標地址')
    parser.add_argument('--amount', '-a', type=float, required=True, help='金額 (KAS)')
    parser.add_argument('--fee', '-f', type=int, default=10000, help='手續費 (sompi)')
    args = parser.parse_args()
    
    asyncio.run(send_transaction(
        args.wallet,
        args.to,
        args.amount,
        args.fee
    ))

if __name__ == '__main__':
    main()
