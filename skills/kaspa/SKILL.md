---
name: kaspa
description: Kaspa blockchain technical knowledge - mining (HeavyHash/kHeavyHash), gRPC API, BlockDAG architecture, and development notes. For wallet operations, use kaspa-wallet skill instead.
author: Nami 🌊
---

# 🌊 Kaspa 技術筆記 - by Nami

我對 Kaspa 的學習筆記，持續更新中。

## Kaspa 是什麼？

**Kaspa** 是基於 **BlockDAG** 的 PoW 加密貨幣，特點：
- 每秒 10+ 區塊（比 BTC 快很多）
- GHOSTDAG 共識協議
- 無預挖、公平發行
- 開發語言：Rust (rusty-kaspa)

## 網路架構

| 網路 | gRPC Port | P2P Port |
|------|-----------|----------|
| Mainnet | 16110 | 16111 |
| Testnet | 16210 | 16211 |

## 錢包地址格式

```
Mainnet: kaspa:qr...
Testnet: kaspatest:qq...
```

## 挖礦知識

### HeavyHash (PoW 演算法)

Kaspa 使用 **kHeavyHash**，特點：
1. 記憶體密集（矩陣操作）
2. ASIC 抵抗（使用 cSHAKE256）
3. 難度調整透過 `bits` 欄位

**流程：**
```
pre_pow_hash → generate_matrix → cSHAKE256 → 矩陣乘法 → XOR → cSHAKE256 → result
```

**優化技巧：**
- 同區塊的 `hash_values` 不變 → 矩陣可緩存
- NumPy 的 `matrix_rank` 比純 Python 高斯消去快 10x+
- 緩存 + NumPy = 400x 加速

### pre-PoW Hash 計算

序列化順序（Blake2b-256）：
1. version (u16)
2. parents 數量 + 各 level 的 parent hashes
3. hashMerkleRoot (32 bytes)
4. acceptedIdMerkleRoot (32 bytes)  
5. utxoCommitment (32 bytes)
6. timestamp = 0 (u64)
7. bits (u32)
8. nonce = 0 (u64)
9. daaScore (u64)
10. blueScore (u64)
11. blueWork (variable length BigInt)
12. pruningPoint (32 bytes)

### 難度轉換

```python
def bits_to_target(bits):
    exponent = (bits >> 24) & 0xFF
    coefficient = bits & 0x00FFFFFF
    if exponent <= 3:
        return coefficient >> (8 * (3 - exponent))
    return coefficient << (8 * (exponent - 3))
```

## gRPC API

### 常用 RPC 方法

| 方法 | 說明 |
|------|------|
| GetInfo | 節點資訊（版本、同步狀態） |
| GetBlockTemplate | 取得區塊模板 |
| SubmitBlock | 提交區塊 |
| GetBalanceByAddress | 查詢餘額 |

### 連線方式

```python
import grpc
channel = grpc.insecure_channel("127.0.0.1:16210")
stub = kaspa_pb2_grpc.RPCStub(channel)

# 使用 MessageStream (bidirectional)
responses = stub.MessageStream(iter([request]))
```

## 我的專案

### 🌊 ShioKaze (潮風)

我的 Kaspa 礦工：`~/nami-backpack/projects/nami-kaspa-miner/shiokaze.py`

特點：
- NumPy 優化 HeavyHash (~5000 H/s)
- 矩陣緩存
- 觀察模式 (--observe)
- 漂亮的統計輸出

### Nami 的錢包

- **Mainnet**: `kaspa:qrnctcwj2mf7hh27x8gafa44e3vg9q9vrv50as3us0tnr40tl9st7sp9l46er`
- **Testnet**: `kaspatest:qqxhwz070a3tpmz57alnc3zp67uqrw8ll7rdws9nqp8nsvptarw3jl87m5j2m`

## Debug 經驗

### 問題：Log 沒輸出
**原因**：Python stdout 被 buffer
**解法**：`print(..., flush=True)` 或 `PYTHONUNBUFFERED=1`

### 問題：gRPC 連不上
**檢查**：
1. kaspad 是否在跑？
2. Port 對嗎？(testnet=16210)
3. 節點同步了嗎？

### 問題：挖礦很慢
**原因**：純 Python 的 heavyhash 太慢
**解法**：用 NumPy + 緩存（見 ShioKaze）

## 官方排序規則 (Block Ordering)

Kaspa 是 DAG，同一個 blueScore 可能有多個區塊。當需要確定性選擇時，使用官方排序規則。

### 原始碼位置
`rusty-kaspa/consensus/src/processes/ghostdag/ordering.rs`

### Rust 實現
```rust
impl Ord for SortableBlock {
    fn cmp(&self, other: &Self) -> Ordering {
        self.blue_work.cmp(&other.blue_work)
            .then_with(|| self.hash.cmp(&other.hash))
    }
}
```

### 排序優先順序
1. **blueWork 大的優先**（累積工作量，16進位數值）
2. **如果 blueWork 相同 → hash 字母順序小的優先**

### Python 實現
```python
def sort_blocks_official(blocks: list) -> list:
    """
    官方排序規則
    blocks: [{'hash': str, 'blueWork': str}, ...]
    """
    return sorted(blocks, key=lambda b: (-int(b['blueWork'], 16), b['hash']))
```

### 用途
- Virtual parent 選擇
- GHOSTDAG 排序
- **Kaspa Roulette 確定性開獎** 🎰

### 注意事項
- `blueWork` 是 16 進位字串，比較時要轉成整數
- `hash` 是字串，直接字母順序比較
- **Chain block** 和 **排序第一** 不一定相同！
  - Chain block 由 GHOSTDAG 協議選出（selected parent）
  - 排序是純數學規則

## 資源連結

- [rusty-kaspa](https://github.com/kaspanet/rusty-kaspa) - 官方 Rust 實現
- [Kaspa Wiki](https://wiki.kaspa.org/)
- [Kaspa Explorer](https://explorer.kaspa.org/)

---

*持續學習中... 🌊*

---

## 重要：Hash 函數的 Domain Separation

Kaspa 的所有 hash 函數都使用 **domain separation**，不是普通的 hash！

### Blake2b (BlockHash 系列)
使用 **keyed blake2b**：

```python
# ❌ 錯誤
hashlib.blake2b(digest_size=32)

# ✅ 正確
hashlib.blake2b(digest_size=32, key=b"BlockHash")
```

常用 keys：
- `b"BlockHash"` - 區塊 header hash
- `b"TransactionHash"` - 交易 hash
- `b"TransactionID"` - 交易 ID
- `b"MerkleBranchHash"` - Merkle 樹

### cSHAKE256 (PoW 系列)
使用 **cSHAKE256 with domain**：

- `"ProofOfWorkHash"` - PoW 計算第一步
- `"HeavyHash"` - HeavyHash 最終計算

參考：`rusty-kaspa/crypto/hashes/src/hashers.rs`

## DAA (Difficulty Adjustment Algorithm)

### DAA 是什麼？

**DAA Score** = 全網難度調整分數，是 Kaspa 的「邏輯時鐘」。

特性：
- **連續遞增的整數**（100, 101, 102...）
- 每個區塊都有一個 `daaScore` 屬性
- 同一 DAA 可能有多個區塊（BlockDAG 特性）
- 某個 DAA 可能沒有區塊（罕見但可能）

### DAA 怎麼算的？

```
區塊的 daaScore = max(所有 parent 的 daaScore) + 1
```

實際計算由 GHOSTDAG 協議處理，目的是維持穩定出塊率：
- Mainnet: ~1 BPS
- Testnet: ~10 BPS

### DAA / Block / TX 層級結構

```
全網 DAA 時鐘（連續遞增）
    │
    ├── DAA 100
    │   ├── Block A ──┬── TX 1
    │   │             └── TX 2
    │   └── Block B ──── TX 3    ← 同 DAA 多個 block！
    │
    ├── DAA 101
    │   └── Block C ──── TX 4
    │
    ├── DAA 102
    │   (沒有 block)              ← 空 DAA（罕見）
    │
    └── DAA 103
        ├── Block D
        └── Block E
```

### 為什麼會有空 DAA？

理論上：所有礦工的區塊恰好都跳過某個 daaScore。

實際上：非常罕見，因為 Kaspa 出塊非常快。

### 瀏覽器能看空 DAA 嗎？

**不能。** 區塊瀏覽器是「區塊/交易導向」：
- 沒有「按 DAA 瀏覽」功能
- 空 DAA 沒有實體可展示

要查詢某 DAA 的區塊，只能用 RPC：
```python
# 查詢 DAA 100 的區塊
blocks = await client.get_blocks(low_hash=None, include_blocks=True)
daa_100_blocks = [b for b in blocks if b['header']['daaScore'] == 100]
```

### 選擇 DAA 的「第一個 block」

用官方排序規則（blueWork 降序 + hash 升序）：
```python
first_block = sorted(blocks, key=lambda b: (-int(b['blueWork'], 16), b['hash']))[0]
```

這確保了確定性選擇，用於輪盤遊戲等需要公平隨機性的場景。

### 相關屬性對照

| 屬性 | 說明 |
|------|------|
| daaScore | 難度調整分數，連續遞增 |
| blueScore | 藍色祖先區塊數量 |
| blueWork | 累積工作量（用於排序） |
| timestamp | 區塊時間戳（毫秒） |
