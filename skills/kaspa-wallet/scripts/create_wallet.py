#!/usr/bin/env python3
"""Generate a new Kaspa wallet with mnemonic, address, and private key."""

import argparse
import json
from kaspa import Mnemonic, XPrv, PrivateKeyGenerator


def create_wallet(network: str = "mainnet") -> dict:
    """Create a new Kaspa wallet.
    
    Args:
        network: "mainnet" or "testnet"
        
    Returns:
        dict with mnemonic, address, and private_key
    """
    # Generate 24-word mnemonic
    mnemonic = Mnemonic.random()
    
    # Derive keys
    seed = mnemonic.to_seed()
    xprv = XPrv(seed)
    xprv_str = xprv.to_string()
    
    # Create key generator (account 0)
    key_gen = PrivateKeyGenerator(xprv_str, False, 0)
    
    # Get first receive address
    private_key = key_gen.receive_key(0)
    address = private_key.to_address(network)
    
    return {
        "network": network,
        "mnemonic": mnemonic.phrase,
        "address": address.to_string(),
        "private_key": private_key.to_string(),
    }


def main():
    parser = argparse.ArgumentParser(description="Generate a new Kaspa wallet")
    parser.add_argument(
        "--network", 
        choices=["mainnet", "testnet"], 
        default="mainnet",
        help="Network type (default: mainnet)"
    )
    parser.add_argument(
        "--json", 
        action="store_true",
        help="Output as JSON"
    )
    args = parser.parse_args()
    
    wallet = create_wallet(args.network)
    
    if args.json:
        print(json.dumps(wallet, indent=2))
    else:
        print("=" * 60)
        print("🌊 New Kaspa Wallet Generated")
        print("=" * 60)
        print()
        print(f"Network: {wallet['network']}")
        print()
        print("🔐 Mnemonic (24 words) - KEEP SECRET!")
        print(wallet['mnemonic'])
        print()
        print(f"📬 Address:\n   {wallet['address']}")
        print()
        print(f"🔑 Private Key:\n   {wallet['private_key']}")
        print()
        print("=" * 60)
        print("⚠️  Store mnemonic and private key securely!")
        print("⚠️  Anyone with these can access your funds!")
        print("=" * 60)


if __name__ == "__main__":
    main()
