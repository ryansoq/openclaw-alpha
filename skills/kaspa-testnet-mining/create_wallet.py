#!/usr/bin/env python3
"""
🌊 Kaspa Testnet 錢包創建腳本
by Nami (波浪)

用法:
  python3 create_wallet.py
  python3 create_wallet.py --mainnet  # 主網錢包
  python3 create_wallet.py --verbose  # 顯示地址創造過程
"""

import json
import argparse
import secrets
from pathlib import Path
from datetime import datetime

def show_address_creation_process(private_key_hex: str, network: str):
    """
    展示地址創造的完整過程
    
    地址創造流程：
    1. 私鑰 (256-bit 隨機數)
    2. 公鑰 (secp256k1 橢圓曲線)
    3. 公鑰 Hash (BLAKE2b)
    4. Payload (version + pubkey_hash)
    5. Bech32 編碼
    6. 加 prefix + checksum
    """
    from kaspa import PrivateKey
    
    print("""
╔═══════════════════════════════════════════════════════════════╗
║  🔍 地址創造過程詳解                                          ║
╚═══════════════════════════════════════════════════════════════╝
""")
    
    # 步驟 1: 私鑰
    print("步驟 1: 私鑰 (256-bit 隨機數)")
    print("━" * 50)
    print(f"  {private_key_hex[:32]}...")
    print(f"  長度: {len(private_key_hex)} hex = {len(private_key_hex)//2} bytes")
    print()
    
    # 步驟 2: 公鑰
    pk = PrivateKey(private_key_hex)
    pubkey = pk.to_public_key()
    pubkey_str = pubkey.to_string()
    
    print("步驟 2: 公鑰 (secp256k1 橢圓曲線)")
    print("━" * 50)
    print(f"  私鑰 × G (生成點) = 公鑰")
    print(f"  {pubkey_str[:40]}...")
    print()
    
    # 步驟 3-5: 地址生成 (SDK 內部處理)
    print("步驟 3-5: BLAKE2b hash → 加版本號 → Bech32 編碼")
    print("━" * 50)
    print("  公鑰 → blake2b(32 bytes) → version + hash → bech32")
    print()
    
    # 步驟 6: 完整地址
    mainnet_addr = pubkey.to_address('mainnet').to_string()
    testnet_addr = pubkey.to_address('testnet').to_string()
    
    print("步驟 6: 加 prefix + checksum")
    print("━" * 50)
    
    # 分解地址結構
    m_prefix, m_rest = mainnet_addr.split(':')
    t_prefix, t_rest = testnet_addr.split(':')
    m_payload, m_checksum = m_rest[:-8], m_rest[-8:]
    t_payload, t_checksum = t_rest[:-8], t_rest[-8:]
    
    print(f"""
  Mainnet 地址:
  ┌─────────┬──────────────────────────────────┬──────────┐
  │ kaspa   │ {m_payload[:30]}... │ {m_checksum} │
  │ prefix  │ payload (公鑰編碼)               │ checksum │
  └─────────┴──────────────────────────────────┴──────────┘

  Testnet 地址:
  ┌────────────┬──────────────────────────────────┬──────────┐
  │ kaspatest  │ {t_payload[:30]}... │ {t_checksum} │
  │ prefix     │ payload (相同!)                  │ checksum │
  └────────────┴──────────────────────────────────┴──────────┘

  💡 注意: payload 相同，但 checksum 不同！
     因為 checksum = hash(prefix + payload)
     prefix 不同 → checksum 不同
""")
    
    print("🔑 同一私鑰可以控制兩個網路上的地址！")
    print()


def main():
    parser = argparse.ArgumentParser(description='創建 Kaspa 錢包')
    parser.add_argument('--mainnet', action='store_true', help='創建主網錢包')
    parser.add_argument('--output', '-o', type=str, help='輸出檔案路徑')
    parser.add_argument('--verbose', '-v', action='store_true', help='顯示地址創造過程')
    args = parser.parse_args()
    
    try:
        from kaspa import PrivateKey
    except ImportError:
        print("❌ 請先安裝 kaspa SDK:")
        print("   pip install kaspa")
        return
    
    # 選擇網路
    network = 'mainnet' if args.mainnet else 'testnet'
    
    print(f"""
╔═══════════════════════════════════════════════════════════════╗
║  🌊 Kaspa 錢包創建工具                                        ║
║  Network: {network.upper():<10}                                    ║
╚═══════════════════════════════════════════════════════════════╝
""")
    
    # 創建錢包 (生成隨機私鑰)
    print("🔐 正在創建錢包...")
    private_key_hex = secrets.token_hex(32)
    
    # 從私鑰產生地址
    pk = PrivateKey(private_key_hex)
    pubkey = pk.to_public_key()
    address = pubkey.to_address(network).to_string()
    
    # 如果 verbose，顯示創造過程
    if args.verbose:
        show_address_creation_process(private_key_hex, network)
    
    print(f"""
✅ 錢包創建成功！

📍 地址:
   {address}

🔑 私鑰 (請務必安全備份！):
   {private_key_hex}

⚠️  警告: 
   - 私鑰是恢復錢包的唯一方式
   - 請勿洩露給任何人！
   - 建議保存到安全的離線位置
""")
    
    # 同時顯示另一個網路的地址
    other_network = 'testnet' if args.mainnet else 'mainnet'
    other_address = pubkey.to_address(other_network).to_string()
    print(f"""💡 同一私鑰在 {other_network} 的地址:
   {other_address}
""")
    
    # 保存到檔案
    output_path = args.output or f"kaspa-{network}-wallet.json"
    wallet_data = {
        'name': f'Kaspa {network.title()} Wallet',
        'network': network,
        'address': address,
        'privateKey': private_key_hex,
        'created': datetime.now().isoformat(),
        'note': f'同一私鑰在 {other_network} 的地址: {other_address}',
    }
    
    with open(output_path, 'w') as f:
        json.dump(wallet_data, f, indent=2)
    
    print(f"💾 已保存到: {output_path}")
    print(f"\n🎉 完成！現在可以開始挖礦了～")


if __name__ == '__main__':
    main()
