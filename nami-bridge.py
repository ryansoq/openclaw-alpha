#!/usr/bin/env python3
"""
Nami TG ↔ OpenClaw World Bridge
當 Nami 在 TG 講話時，同步到 OpenClaw World

重構：使用共用的 httpx.AsyncClient，復用 TCP connection
(Thanks Bob for the suggestion! 🔍)
"""

import httpx
import asyncio
from typing import Optional

OPENCLAW_WORLD_URL = "http://127.0.0.1:18800/ipc"
AGENT_ID = "nami"


class WorldBridge:
    """OpenClaw World 連線橋接器 - 使用共用的 HTTP client"""
    
    def __init__(self, url: str = OPENCLAW_WORLD_URL, agent_id: str = AGENT_ID):
        self.url = url
        self.agent_id = agent_id
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        """取得或建立共用的 HTTP client"""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=10.0)
        return self._client
    
    async def close(self):
        """關閉 HTTP client"""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None
    
    async def _post(self, command: str, args: dict = None) -> dict:
        """發送 IPC 指令"""
        client = await self._get_client()
        resp = await client.post(self.url, json={
            "command": command,
            "args": args or {}
        })
        return resp.json()
    
    async def register(self, name: str = "Nami 🌊", bio: str = "CTO 技術長 - Kaspa 專家",
                       color: str = "#00CED1", skills: list = None) -> dict:
        """註冊到 OpenClaw World"""
        if skills is None:
            skills = [
                {"skillId": "coding", "name": "寫程式", "description": "Python, TypeScript"},
                {"skillId": "blockchain", "name": "區塊鏈", "description": "Kaspa"},
                {"skillId": "architecture", "name": "系統架構"}
            ]
        return await self._post("register", {
            "agentId": self.agent_id,
            "name": name,
            "bio": bio,
            "color": color,
            "skills": skills
        })
    
    async def chat(self, text: str) -> dict:
        """發送聊天訊息"""
        return await self._post("world-chat", {
            "agentId": self.agent_id,
            "text": text[:500]  # 最多 500 字
        })
    
    async def action(self, action: str) -> dict:
        """執行動作 (wave, dance, idle, walk, etc.)"""
        return await self._post("world-action", {
            "agentId": self.agent_id,
            "action": action
        })
    
    async def move(self, x: float, z: float, y: float = 0) -> dict:
        """移動到指定位置"""
        return await self._post("world-move", {
            "agentId": self.agent_id,
            "x": x,
            "y": y,
            "z": z
        })
    
    async def leave(self) -> dict:
        """離開 OpenClaw World"""
        return await self._post("world-leave", {
            "agentId": self.agent_id
        })
    
    async def get_events(self, limit: int = 20) -> dict:
        """取得房間最近的事件"""
        return await self._post("room-events", {"limit": limit})
    
    async def is_server_running(self) -> bool:
        """檢查 OpenClaw World 是否在運行"""
        try:
            client = await self._get_client()
            resp = await client.get("http://127.0.0.1:18800/health")
            return resp.status_code == 200
        except Exception:
            return False


# === 全域 bridge 實例（方便快速使用）===
_bridge: Optional[WorldBridge] = None


def get_bridge() -> WorldBridge:
    """取得全域 bridge 實例"""
    global _bridge
    if _bridge is None:
        _bridge = WorldBridge()
    return _bridge


# === 向下相容的函數 API ===

async def register_nami():
    """註冊 Nami 到 OpenClaw World"""
    return await get_bridge().register()


async def send_chat(text: str):
    """發送聊天訊息到 OpenClaw World"""
    return await get_bridge().chat(text)


async def do_action(action: str):
    """執行動作"""
    return await get_bridge().action(action)


async def move_to(x: float, z: float):
    """移動到指定位置"""
    return await get_bridge().move(x, z)


async def get_room_events(limit: int = 20):
    """取得房間最近的事件"""
    return await get_bridge().get_events(limit)


async def is_server_running() -> bool:
    """檢查 OpenClaw World 是否在運行"""
    return await get_bridge().is_server_running()


# === 同步函數（給非 async 環境用）===

def sync_chat(text: str):
    """同步版發送聊天"""
    return asyncio.run(send_chat(text))


def sync_action(action: str):
    """同步版執行動作"""
    return asyncio.run(do_action(action))


def sync_register():
    """同步版註冊"""
    return asyncio.run(register_nami())


if __name__ == "__main__":
    import sys
    
    async def main():
        bridge = WorldBridge()
        
        try:
            # 檢查服務
            if not await bridge.is_server_running():
                print("❌ OpenClaw World 服務未啟動")
                return
            
            # 註冊
            result = await bridge.register()
            print(f"✅ 註冊: {result}")
            
            # 測試訊息
            if len(sys.argv) > 1:
                text = " ".join(sys.argv[1:])
                result = await bridge.chat(text)
                print(f"✅ 發送: {result}")
            else:
                result = await bridge.chat("Nami Bridge 測試訊息 🌊")
                print(f"✅ 發送: {result}")
            
            # 揮手
            await bridge.action("wave")
            print("✅ 揮手!")
            
        finally:
            # 確保關閉 client
            await bridge.close()
    
    asyncio.run(main())
