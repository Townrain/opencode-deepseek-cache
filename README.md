# opencode-deepseek-cache

> 💸 **A 100-line "billing fuse" for DeepSeek API in OpenCode.**
> 
> 这是一个仅有 100 行代码的"账单保险丝"。我们不干涉 OpenCode 优秀的原生上下文管理，我们只做一件事：**修复 OpenCode 动态 System Prompt 导致的 DeepSeek 缓存雪崩问题。**

[![GitHub](https://img.shields.io/badge/GitHub-Townrain%2Fopencode--deepseek--cache-blue)](https://github.com/Townrain/opencode-deepseek-cache)

---

A 100-line "billing fuse". We don't interfere with OpenCode's excellent native context management. We only do one thing: **fix the DeepSeek cache avalanche caused by OpenCode's dynamic System Prompt.**

## 🎯 这是什么？ | What Is This?

**零副作用的纯收益 (Zero Side-effect, Pure Profit)**

通过固化前缀和绑定 `user_id`，确保你的多终端、跨会话请求，永远享受 **$0.0028/1M** 的底价。附带本地持久化账单面板。

By stabilizing prefixes and binding `user_id`, ensure your multi-terminal, cross-session requests always enjoy the **$0.0028/1M** floor price. Includes a local persistent billing dashboard.

## 🚨 你会多花多少冤枉钱？ | How Much Are You Overpaying?

| 场景 | Scenario | 没插件 | Without Plugin | 有插件 | With Plugin |
|------|----------|--------|----------------|--------|-------------|
| 重启 OpenCode | Restart OpenCode | 几千 Token 缓存失效，按 $0.14/1M 全价重算 | Thousands of tokens cache miss, charged at $0.14/1M | 缓存命中，$0.0028/1M | Cache hit, $0.0028/1M |
| 开 3 个终端 | Open 3 terminals | 交 3 次全价 | Pay full price 3 times | 共享缓存池 | Share cache pool |

## ✨ 我们只做三件事 | We Only Do Three Things

### 1. 🛡️ 前缀防弹衣 | Prefix Stabilization

**核心资产 | Core Asset**

在 `system.transform` 阶段，用正则把时间戳静默替换为 `[TIME]`。无论你怎么重启，发给 DeepSeek 的前缀**永远一模一样**。

In the `system.transform` phase, silently replace timestamps with `[TIME]`. No matter how many times you restart, the prefix sent to DeepSeek is **always identical**.

**价值 | Value**: 保住每次重启时，基础工具定义缓存的 **98% 折扣**。防止单次请求成本瞬间暴涨 50 倍。

Preserve **98% discount** on base tool definitions every restart. Prevent 50x cost spikes on single requests.

### 2. 🔗 项目级缓存池 | Project-level Pooling

**锚点 | Anchor**

基于项目路径生成稳定的 `user_id`。终端 A、B、C 共享同一个 DeepSeek KV Cache 池。终端 A 缓存了 System Prompt，终端 B 直接白嫖。

Generate stable `user_id` based on project path. Terminals A, B, C share the same DeepSeek KV Cache pool. Terminal A caches System Prompt, Terminal B gets it for free.

**价值 | Value**: 多任务并发场景下，拒绝向 DeepSeek 重复缴纳全价过路费。

In multi-task scenarios, refuse to pay full price to DeepSeek repeatedly.

### 3. 📊 财务级账本 | Financial-grade Ledger

**账本 | Ledger**

本地 JSONL 持久化记录 `prompt_cache_hit_tokens`。重启 10 次，账本依然在累加。`/cache-stats` 面板让你清清楚楚看到："今天白嫖了 50 万 Token，省了 $0.07"。

Local JSONL persistent recording of `prompt_cache_hit_tokens`. Restart 10 times, ledger keeps accumulating. `/cache-stats` panel shows clearly: "Freed 500k tokens today, saved $0.07".

**价值 | Value**: 情绪价值 + 对账能力。

Emotional value + reconciliation capability.

## ⚠️ 我们不做什么 | What We Don't Do

**本插件不包含任何"滑动窗口"或"消息截断"功能。**

**This plugin does NOT include any "sliding window" or "message truncation" features.**

OpenCode 原生的 Compaction 机制已经足够优秀。我们不教 OpenCode 做事。

OpenCode's native Compaction mechanism is already excellent. We don't teach OpenCode how to work.

## 📦 安装 | Installation

### 方式 1：从 GitHub 安装（推荐）

```bash
# npm
npm install github:Townrain/opencode-deepseek-cache

# bun
bun install github:Townrain/opencode-deepseek-cache
```

### 方式 2：从 npm 安装（如果已发布）

```bash
npm install opencode-deepseek-cache
```

## ⚙️ 配置 | Configuration

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-deepseek-cache"]
}
```

## 🛠️ 使用 | Usage

安装后插件会在后台静默工作 | Once installed, the plugin works silently:

- ✅ 注入稳定的 `user_id` | Injects stable `user_id`
- ✅ 替换时间戳/UUID 为占位符 | Replaces timestamps/UUIDs with placeholders

输入 `/cache-stats` 查看账本 | Type `/cache-stats` to view ledger:

```text
### 📊 DeepSeek Cache Dashboard

| 核心指标 | 状态 |
| :--- | :--- |
| **缓存命中率** | 🟢 **82.3%** |
| **命中 Tokens** | `128,450` |
| **未命中 Tokens** | `27,600` |
| **累计请求数** | 47 |
| **预估节省** | 💰 **$0.017612** |
```

> 📁 统计数据保存在 `.opencode/deepseek-cache-usage.jsonl`，重启不丢失。
> 
> Statistics are saved to `.opencode/deepseek-cache-usage.jsonl` and persist across restarts.

## 🐛 调试模式 | Debug Mode

```bash
export DEEPSEEK_CACHE_DEBUG=true
```

## License

MIT

---

**GitHub**: https://github.com/Townrain/opencode-deepseek-cache
