#!/usr/bin/env python3
"""
Kaspa Telecom Protocol v1 — Message Decoder

Decodes a Kaspa TX payload back into structured message.

Usage:
  python3 decode_message.py '{"v":1,"t":"msg","d":"Hello!","a":{}}'
  echo '{"v":1,"t":"msg","d":"Hi!","a":{}}' | python3 decode_message.py

Output: Parsed message fields
"""

import json
import sys


def decode(payload: str) -> dict | None:
    """Decode a Protocol v1 payload. Returns parsed dict or None if invalid."""
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return None

    if not isinstance(data, dict):
        return None

    # Validate required fields
    required = {"v", "t", "d", "a"}
    if not required.issubset(data.keys()):
        missing = required - set(data.keys())
        print(f"⚠️  Missing fields: {missing}", file=sys.stderr)
        return None

    if data["v"] != 1:
        print(f"⚠️  Unknown protocol version: {data['v']}", file=sys.stderr)
        return None

    if not isinstance(data["a"], dict):
        print(f"⚠️  Field 'a' must be object, got {type(data['a']).__name__}", file=sys.stderr)
        return None

    return data


def main():
    # Read from argument or stdin
    if len(sys.argv) > 1:
        payload = sys.argv[1]
    else:
        payload = sys.stdin.read().strip()

    if not payload:
        print("Usage: decode_message.py '<json_payload>'", file=sys.stderr)
        sys.exit(1)

    result = decode(payload)
    if result is None:
        print("❌ Invalid Protocol v1 payload", file=sys.stderr)
        sys.exit(1)

    print(f"✅ Protocol v1 Message")
    print(f"   Version:    {result['v']}")
    print(f"   Type:       {result['t']}")
    print(f"   Data:       {result['d']}")
    print(f"   Additional: {json.dumps(result['a'], ensure_ascii=False)}")


if __name__ == "__main__":
    main()
