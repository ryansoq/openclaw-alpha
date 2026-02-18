#!/usr/bin/env python3
"""
Office @mention listener — polls for mentions and writes wake files.
Each OpenClaw agent can pick up their wake file via heartbeat or file watcher.

Usage: python3 nami-listener.py
"""
import time, json, os, httpx

OFFICE_API = "http://127.0.0.1:18800"
POLL_INTERVAL = 15  # seconds
STATE_FILE = os.path.expanduser("~/clawd/memory/office-listener-state.json")
WAKE_DIR = "/tmp/openclaw-wake"

def load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except:
        return {"lastTs": 0}

def save_state(state):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)

def check_mentions(since_ts):
    """Check for new @mentions in office chat"""
    try:
        resp = httpx.get(f"{OFFICE_API}/api/events?since={since_ts}&limit=50", timeout=10)
        events = resp.json()
        if isinstance(events, dict):
            events = events.get("events", [])
        
        mentions = {}  # agentId -> latest mention text
        latest_ts = since_ts
        
        for e in events:
            if not isinstance(e, dict):
                continue
            ts = e.get("ts", e.get("timestamp", 0))
            if ts > latest_ts:
                latest_ts = ts
            
            if e.get("worldType") != "chat":
                continue
            
            text = e.get("text", "")
            sender = e.get("agentId", "")
            
            # Find @mentions
            import re
            found = re.findall(r"@([\w-]+)", text)
            for target in found:
                target = target.lower()
                if target != sender:  # don't self-notify
                    mentions[target] = {
                        "from": sender,
                        "text": text[:300],
                        "ts": ts,
                    }
        
        return mentions, latest_ts
    except Exception as ex:
        print(f"[listener] Error: {ex}")
        return {}, since_ts

def write_wake(agent_id, mention_info):
    """Write a wake file for the agent"""
    os.makedirs(WAKE_DIR, exist_ok=True)
    wake_file = os.path.join(WAKE_DIR, f"{agent_id}.json")
    with open(wake_file, "w") as f:
        json.dump(mention_info, f)
    print(f"[listener] Wake file written for {agent_id}: {mention_info['from']} said something")

def main():
    print(f"[listener] Starting Office @mention listener (poll every {POLL_INTERVAL}s)")
    state = load_state()
    
    while True:
        mentions, new_ts = check_mentions(state["lastTs"])
        
        if mentions:
            for agent_id, info in mentions.items():
                print(f"[listener] @{agent_id} mentioned by {info['from']}")
                write_wake(agent_id, info)
        
        if new_ts > state["lastTs"]:
            state["lastTs"] = new_ts
            save_state(state)
        
        time.sleep(POLL_INTERVAL)

if __name__ == "__main__":
    main()
