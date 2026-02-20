#!/usr/bin/env python3
"""
🌊 Kaspa 餘額查詢腳本
by Nami (波浪)

用法:
  python3 check_balance.py kaspatest:qq...
  python3 check_balance.py kaspa:qp... --mainnet
"""

import asyncio
import argparse
import sys

async def check_balance(address: str, network: str = "testnet-10"):
    try:
        from kaspa import RpcClient, Resolver
    except ImportError:
        print("❌ 請先安裝 kaspa SDK:")
        print("   pip install kaspa")
        return
    
    print(f"🔍 查詢地址: {address[:20]}...{address[-10:]}")
    print(f"   網路: {network}")
    print()
    
    try:
        resolver = Resolver()
        client = RpcClient(
            resolver=resolver,
            network_id=network
        )
        
        await client.connect()
        
        result = await client.get_balance_by_address(address)
        
        balance_sompi = int(result.get('balance', 0))
        balance_kas = balance_sompi / 100_000_000
        
        prefix = "tKAS" if "testnet" in network else "KAS"
        
        print(f"💰 餘額: {balance_kas:,.8f} {prefix}")
        print(f"   ({balance_sompi:,} sompi)")
        
        await client.disconnect()
        
    except Exception as e:
        print(f"❌ 查詢失敗: {e}")
        print()
        print("可能原因:")
        print("  1. 節點未啟動或未同步")
        print("  2. 地址格式錯誤")
        print("  3. 網路連線問題")

def main():
    parser = argparse.ArgumentParser(description='查詢 Kaspa 餘額')
    parser.add_argument('address', type=str, help='Kaspa 地址')
    parser.add_argument('--mainnet', action='store_true', help='查詢主網')
    args = parser.parse_args()
    
    network = "mainnet" if args.mainnet else "testnet-10"
    
    asyncio.run(check_balance(args.address, network))

if __name__ == '__main__':
    main()
