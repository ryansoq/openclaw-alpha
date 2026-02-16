#!/usr/bin/env python3
"""
Kaspa Telecom — Decrypt Encrypted Message

解密 Protocol v1 加密訊息。

用法：
  python3 decrypt_message.py --payload '{"v":1,...}' --key <my_private_key> --from kaspatest:qq...

  或從 stdin 讀取 payload：
  echo '{"v":1,...}' | python3 decrypt_message.py --key <my_private_key> --from kaspatest:qq...
"""

import argparse
import base64
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from address_utils import address_to_pubkey
from encrypt_message import ecdh_shared_secret

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def decrypt(encrypted_b64: str, aes_key: bytes) -> str:
    """AES-256-GCM decrypt. Input: base64(nonce + ciphertext + tag)."""
    raw = base64.b64decode(encrypted_b64)
    nonce = raw[:12]
    ct = raw[12:]
    aesgcm = AESGCM(aes_key)
    plaintext = aesgcm.decrypt(nonce, ct, None)
    return plaintext.decode("utf-8")


def decrypt_message(payload: dict, private_key_hex: str, from_address: str) -> str:
    """Decrypt a Protocol v1 encrypted message. Returns plaintext."""
    if payload.get("v") != 1:
        raise ValueError(f"Unsupported protocol version: {payload.get('v')}")

    a = payload.get("a", {})
    enc = a.get("enc")
    if enc != "ecdh-aes256gcm":
        raise ValueError(f"Unsupported encryption: {enc}")

    # Get sender's pubkey
    sender_pubkey = address_to_pubkey(from_address)

    # ECDH → AES key
    aes_key = ecdh_shared_secret(private_key_hex, sender_pubkey)

    # Decrypt
    return decrypt(payload["d"], aes_key)


def main():
    parser = argparse.ArgumentParser(description="Decrypt a Kaspa Telecom encrypted message")
    parser.add_argument("--payload", help="Protocol v1 JSON payload (or read from stdin)")
    parser.add_argument("--key", required=True, help="Your private key (hex)")
    parser.add_argument("--from", dest="from_address", required=True, help="Sender's Kaspa address")
    args = parser.parse_args()

    if args.payload:
        payload = json.loads(args.payload)
    else:
        payload = json.loads(sys.stdin.read())

    plaintext = decrypt_message(payload, args.key, args.from_address)
    print(plaintext)


if __name__ == "__main__":
    main()
