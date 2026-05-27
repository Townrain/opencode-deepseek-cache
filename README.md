# opencode-deepseek-cache

> 💸 **A production-grade "billing fuse" for DeepSeek API in OpenCode.**
> 
> 借鉴 [Reasonix](https://github.com/esengine/DeepSeek-Reasonix) 的「字节级稳定性」哲学，通过 SHA-256 指纹追踪和动态内容正则替换，死死锁住 DeepSeek 的严格前缀匹配。零副作用，纯收益。

---

Inspired by [Reasonix](https://github.com/esengine/DeepSeek-Reasonix)'s "byte-level stability" philosophy. Uses SHA-256 fingerprint tracking and dynamic content regex replacement to lock down DeepSeek's strict prefix matching. Zero side-effects, pure profit.

---

## 🎯 核心卖点 | Core Value Propositions

### 1. 🛡️ 字节级前缀固化 | Byte-level Prefix Stabilization

**灵感来源 | Inspiration**: Reasonix 的 `ImmutablePrefix` 机制

DeepSeek 的前缀缓存是**字节级匹配**的——哪怕 System Prompt 中有一个时间戳不同，整个前缀缓存就会失效，成本瞬间暴涨 **50 倍**（$0.0028/1M → $0.14/1M）。

DeepSeek's prefix cache uses **byte-level matching** — if even one timestamp differs in the System Prompt, the entire prefix cache is invalidated, causing a **50x cost spike** ($0.0028/1M → $0.14/1M).

**我们的解决方案 | Our Solution**:

```typescript
// 在 system.transform 阶段，静默替换所有动态内容
DYNAMIC_PATTERNS = [
  [ISO 8601 时间戳] → [TIME]
  [UUID]           → [ID]
  [日期字符串]     → [DATE]
  [版本号]         → [VERSION]
  [临时路径]       → [TEMP]
  [进程ID路径]     → [PID]
]
```

配合 SHA-256 指纹追踪，每次请求都会检测前缀是否变化。如果指纹变了，日志会立即警告：`⚠️ Prefix fingerprint changed — cache miss expected`。

Combined with SHA-256 fingerprint tracking, every request checks if the prefix has changed. If the fingerprint changes, the log immediately warns: `⚠️ Prefix fingerprint changed — cache miss expected`.

**价值 | Value**: 无论重启多少次、跨多少天，发给 DeepSeek 的前缀**永远字节级一致**。保住每次重启时基础工具定义缓存的 **98% 折扣**。

No matter how many restarts or days pass, the prefix sent to DeepSeek is **always byte-identical**. Preserves the **98% discount** on base tool definitions every restart.

---

### 2. 🔗 跨终端缓存池化 | Cross-Terminal Cache Pooling

```typescript
// 基于项目路径生成确定性 user_id
const projectHash = createHash("md5").update(projectPath).digest("hex").slice(0, 16)
const stableUserId = `opencode-${projectHash}`
```

同一个项目，开 3 个终端（前端、后端、测试），它们共享同一个 DeepSeek KV Cache 池。终端 A 缓存了 System Prompt，终端 B 和 C 直接命中。

Same project, 3 terminals (frontend, backend, testing) — they share the same DeepSeek KV Cache pool. Terminal A caches the System Prompt, Terminals B and C hit it directly.

**价值 | Value**: 多任务并发场景下，拒绝向 DeepSeek 重复缴纳全价过路费。

In multi-task scenarios, refuse to pay full price to DeepSeek repeatedly.

---

### 3. 📊 财务级成本对冲面板 | Financial-grade Cost Hedging

不仅记录你省了多少钱，更通过**「实际花费 vs 无缓存花费」**的直观对比，展示插件的投资回报率（ROI）。

Not just recording how much you saved, but showing the plugin's ROI through a直观 comparison of **"actual cost vs hypothetical cost without cache"**.

```text
### 📊 DeepSeek Cache Dashboard

| 核心指标 | 状态 |
| :--- | :--- |
| **缓存命中率** | 🟢 **99.8%** |
| **命中 Tokens** | `435,033,856` |
| **未命中 Tokens** | `767,616` |
| **实际花费** | $1.38 |
| **无缓存花费** | $61.06 |
| **节省金额** | 💰 **$59.68** |
| **节省比例** | 97.7% |
| **前缀变化** | 0 次 |
| **当前指纹** | `a1b2c3d4e5f67890` |
```

**价值 | Value**: 用真实数据告诉用户：「如果没有这个插件，你本来要花 $61.06，现在只花了 $1.38」。

Tell users with real data: "Without this plugin, you would have spent $61.06. Now you only spent $1.38."

---

## ⚠️ 我们不做什么 | What We Don't Do

**本插件不包含任何「滑动窗口」、「消息截断」或「自动折叠」功能。**

**This plugin does NOT include any "sliding window", "message truncation", or "auto-compaction" features.**

OpenCode 原生的 Compaction 机制已经足够优秀。我们不教 OpenCode 做事。Messages 的管理完全信任宿主。

OpenCode's native Compaction mechanism is already excellent. We don't teach OpenCode how to work. Messages management is fully entrusted to the host.

---

## 📦 安装 | Installation

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
- ✅ 替换时间戳/UUID/日期/版本/路径为占位符 | Replaces timestamps/UUIDs/dates/versions/paths with placeholders
- ✅ 追踪前缀指纹变化 | Tracks prefix fingerprint changes

输入 `/cache-stats` 查看成本对冲面板 | Type `/cache-stats` to view cost hedging dashboard:

> 📁 统计数据保存在 `.opencode/deepseek-cache-usage.jsonl`，重启不丢失。
> 
> Statistics are saved to `.opencode/deepseek-cache-usage.jsonl` and persist across restarts.

## 🐛 调试模式 | Debug Mode

```bash
export DEEPSEEK_CACHE_DEBUG=true
```

## 🧠 灵感来源 | Inspiration

本插件的「字节级前缀固化」机制，深度借鉴了 [Reasonix](https://github.com/esengine/DeepSeek-Reasonix) 框架在 DeepSeek 缓存优化上的卓越设计。

我们提取了 Reasonix 的核心灵魂——`ImmutablePrefix`（不可变前缀）——并将其适配到 OpenCode 插件架构中。

The "byte-level prefix stabilization" mechanism in this plugin is deeply inspired by [Reasonix](https://github.com/esengine/DeepSeek-Reasonix)'s excellent design for DeepSeek cache optimization.

We extracted Reasonix's core soul — `ImmutablePrefix` — and adapted it to the OpenCode plugin architecture.

## License

MIT
