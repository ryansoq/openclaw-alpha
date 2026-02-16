#!/usr/bin/env python3
"""
Kaspa Address Utilities

Kaspa 地址 ↔ 公鑰轉換。
Kaspa P2PK 地址直接包含 32-byte Schnorr 公鑰 (secp256k1 x-only)。

依賴：kaspa SDK (pip install kaspa)
"""

from kaspa import Address, XOnlyPublicKey, PrivateKey


def address_to_pubkey(address: str) -> bytes:
    """從 Kaspa 地址解出 x-only 公鑰 (32 bytes)。

    >>> address_to_pubkey("kaspatest:qqxhwz070a3tpmz57alnc3zp67uqrw8ll7rdws9nqp8nsvptarw3jl87m5j2m").hex()
    '0d7709fe7f62b0ec54f77f3c4441d7b801b8ffff86d740b3004f38302be8dd19'
    """
    addr = Address(address)
    xonly = XOnlyPublicKey.from_address(addr)
    return bytes.fromhex(xonly.to_string())


def pubkey_to_address(pubkey: bytes, network: str = "testnet") -> str:
    """公鑰 (32 bytes x-only) 轉 Kaspa 地址。

    >>> pubkey_to_address(bytes.fromhex("0d7709fe7f62b0ec54f77f3c4441d7b801b8ffff86d740b3004f38302be8dd19"))
    'kaspatest:qqxhwz070a3tpmz57alnc3zp67uqrw8ll7rdws9nqp8nsvptarw3jl87m5j2m'
    """
    xonly = XOnlyPublicKey(pubkey.hex())
    return xonly.to_address(network).to_string()


def privkey_to_pubkey(private_key_hex: str) -> bytes:
    """私鑰 (32 bytes hex) → x-only 公鑰 (32 bytes)。"""
    pk = PrivateKey(private_key_hex)
    return bytes.fromhex(pk.to_public_key().to_x_only_public_key().to_string())


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        addr = sys.argv[1]
        pk = address_to_pubkey(addr)
        print(f"Address: {addr}")
        print(f"Pubkey:  {pk.hex()}")
        network = "testnet" if addr.startswith("kaspatest") else "mainnet"
        rt = pubkey_to_address(pk, network)
        print(f"Round-trip: {rt}")
        print(f"Match: {rt == addr}")
