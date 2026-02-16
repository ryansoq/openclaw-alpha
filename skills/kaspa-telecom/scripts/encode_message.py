#!/usr/bin/env python3
"""
Kaspa Telecom Protocol v1 — Message Encoder

Encodes a message into Protocol v1 format for Kaspa TX payload.

Protocol v1 (IMMUTABLE):
  {"v":1,"t":"<type>","d":"<data>","a":{<additional>}}

Usage:
  python3 encode_message.py --type msg --data "Hello Bob!"
  python3 encode_message.py --type msg --data "Hi!" --additional '{"grp":"dev"}'
  python3 encode_message.py --type ack --data "txid_here"

Output: JSON string ready to embed as TX payload
"""

import argparse
import json
import sys

PROTOCOL_VERSION = 1

VALID_TYPES = {"msg", "ack", "ping", "card", "grp", "register"}


def encode(t: str, d: str, a: dict | None = None) -> str:
    """Encode a Protocol v1 message payload."""
    if t not in VALID_TYPES:
        print(f"⚠️  Unknown type '{t}' (known: {', '.join(sorted(VALID_TYPES))})", file=sys.stderr)

    payload = {
        "v": PROTOCOL_VERSION,
        "t": t,
        "d": d,
        "a": a if a is not None else {},
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def main():
    parser = argparse.ArgumentParser(description="Kaspa Telecom Protocol v1 Encoder")
    parser.add_argument("--type", "-t", required=True, help="Message type (msg/ack/ping/card/grp)")
    parser.add_argument("--data", "-d", required=True, help="Message data (text, txid, etc)")
    parser.add_argument("--additional", "-a", default="{}", help="Additional JSON object (default: {})")
    parser.add_argument("--bytes", action="store_true", help="Show byte size")
    args = parser.parse_args()

    try:
        additional = json.loads(args.additional)
        if not isinstance(additional, dict):
            print("Error: --additional must be a JSON object {}", file=sys.stderr)
            sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: invalid JSON in --additional: {e}", file=sys.stderr)
        sys.exit(1)

    encoded = encode(args.type, args.data, additional)
    print(encoded)

    if args.bytes:
        size = len(encoded.encode("utf-8"))
        print(f"({size} bytes)", file=sys.stderr)


if __name__ == "__main__":
    main()
