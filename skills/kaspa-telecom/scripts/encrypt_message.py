#!/usr/bin/env python3
"""
Kaspa Telecom — Encrypted Message

用對方的 Kaspa 地址（公鑰）加密訊息，只有對方的私鑰能解。

用法：
  python3 encrypt_message.py --to kaspatest:qq... --text "秘密訊息" --key <my_private_key>

輸出：Protocol v1 格式，t="msg"，d 欄位是加密後的 base64
  a 欄位包含 {"enc":"ecdh-aes256gcm","from":"<sender_address>"}

原理：
  1. 從 --to 地址 decode 出對方 x-only 公鑰 (32 bytes)
  2. 從 --key 私鑰算出自己的公鑰和地址
  3. ECDH：私鑰 × 對方公鑰 = 共享密鑰
  4. HKDF derive AES-256 key
  5. AES-256-GCM 加密
  6. 輸出 Protocol v1 JSON
"""

import argparse
import base64
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from address_utils import address_to_pubkey, privkey_to_pubkey, pubkey_to_address

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _xonly_to_ec_pubkey(xonly_bytes: bytes) -> ec.EllipticCurvePublicKey:
    """Convert 32-byte x-only pubkey to a full EC public key (assume even y)."""
    # SEC1 compressed format: 0x02 + x (even y)
    compressed = b'\x02' + xonly_bytes
    return ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256K1(), compressed)


def _privkey_to_ec(private_key_hex: str) -> ec.EllipticCurvePrivateKey:
    """Convert 32-byte hex private key to EC private key."""
    priv_int = int(private_key_hex, 16)
    return ec.derive_private_key(priv_int, ec.SECP256K1())


def ecdh_shared_secret(my_privkey_hex: str, their_xonly_pubkey: bytes) -> bytes:
    """Compute ECDH shared secret, then derive AES-256 key via HKDF."""
    my_ec_priv = _privkey_to_ec(my_privkey_hex)
    their_ec_pub = _xonly_to_ec_pubkey(their_xonly_pubkey)

    # ECDH
    shared = my_ec_priv.exchange(ec.ECDH(), their_ec_pub)

    # HKDF-SHA256 → 32-byte AES key
    aes_key = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"kaspa-telecom-v1",
        info=b"ecdh-aes256gcm",
    ).derive(shared)

    return aes_key


def encrypt(plaintext: str, aes_key: bytes) -> str:
    """AES-256-GCM encrypt. Returns base64(nonce + ciphertext + tag)."""
    nonce = os.urandom(12)  # 96-bit nonce
    aesgcm = AESGCM(aes_key)
    ct = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    # nonce (12) + ciphertext + tag (16) 
    return base64.b64encode(nonce + ct).decode("ascii")


def encrypt_message(to_address: str, text: str, private_key_hex: str, network: str = "testnet") -> dict:
    """Encrypt a message for a Kaspa address. Returns Protocol v1 dict."""
    # Get recipient's pubkey
    their_pubkey = address_to_pubkey(to_address)

    # Get sender's address
    my_pubkey = privkey_to_pubkey(private_key_hex)
    my_address = pubkey_to_address(my_pubkey, network)

    # ECDH → AES key
    aes_key = ecdh_shared_secret(private_key_hex, their_pubkey)

    # Encrypt
    encrypted_b64 = encrypt(text, aes_key)

    # Protocol v1
    return {
        "v": 1,
        "t": "msg",
        "d": encrypted_b64,
        "a": {
            "enc": "ecdh-aes256gcm",
            "from": my_address,
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Encrypt a message for a Kaspa address")
    parser.add_argument("--to", required=True, help="Recipient Kaspa address")
    parser.add_argument("--text", required=True, help="Message to encrypt")
    parser.add_argument("--key", required=True, help="Your private key (hex)")
    parser.add_argument("--network", default="testnet", choices=["testnet", "mainnet"])
    args = parser.parse_args()

    result = encrypt_message(args.to, args.text, args.key, args.network)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
