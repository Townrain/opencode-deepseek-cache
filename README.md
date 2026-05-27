# opencode-deepseek-cache

> 💸 **A production-grade "billing fuse" for DeepSeek API in OpenCode.**
> 
> 借鉴 [Reasonix](https://github.com/esengine/DeepSeek-Reasonix) 的「字节级稳定性」哲学，通过 SHA-256 指纹追踪和动态内容正则替换，死死锁住 DeepSeek 的严格前缀匹配。零计费副作用，纯收益。

---

Inspired by [Reasonix](https://github.com/esengine/DeepSeek-Reasonix)'s "byte-level stability" philosophy. Uses SHA-256 fingerprint tracking and dynamic content regex replacement to lock down DeepSeek's strict prefix matching. Zero billing side-effects, pure profit.

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

## 🔍 Official vs Third-Party Filtering | 官方与第三方过滤

### English

This plugin's **cost tracking** (cache hit/miss stats, `/cache-stats` dashboard) only records usage from official DeepSeek API endpoints. Third-party proxies and compatible providers are excluded from statistics to keep your cost data accurate.

**What still works for ALL models** (official and third-party):
- ✅ Cross-terminal `user_id` injection
- ✅ Balance refresh (when `DEEPSEEK_API_KEY` is set)

**What is filtered to official DeepSeek only**:
- ✅ System prompt normalization (timestamp/UUID/date replacement)
- ✅ Fingerprint tracking
- 📊 Cache hit/miss statistics tracking
- 📊 `/cache-stats` dashboard data
- 📊 JSONL usage persistence

**How filtering works**:
1. **Model ID check**: Model ID must match known DeepSeek models (`deepseek-chat`, `deepseek-reasoner`, etc.) or start with `deepseek-`
2. **Provider check** (when available): Provider must be `deepseek` (not `openai-compatible`, `openrouter`, etc.)

- If you use an `openai-compatible` provider with an official DeepSeek model ID and a third-party base URL, the plugin cannot distinguish this from a real DeepSeek endpoint via URL verification. Stats will be tracked (false positive). This is an inherent limitation of the plugin architecture.
- The plugin does not implement the `dispose` hook. On plugin reload, the debug log file handle may not be released until the process exits. Impact is negligible under normal usage.
- Cache hit rate depends on full request prefix stability. This plugin only normalizes dynamic content in the system prompt. Changes to tool definitions or message content can still cause cache misses. The OpenCode plugin architecture does not expose `tools` definitions in the `chat.params` hook, so plugin-level detection of tool changes is not possible.

### 中文

本插件的**成本追踪**（缓存命中/未命中统计、`/cache-stats` 面板）仅记录来自官方 DeepSeek API 端点的使用数据。第三方代理和兼容提供商的数据会被排除，以保持成本数据的准确性。

**所有模型（官方和第三方）均可用的功能**：
- ✅ 跨终端 `user_id` 注入
- ✅ 余额刷新（需设置 `DEEPSEEK_API_KEY`）

**仅限官方 DeepSeek 的功能**：
- ✅ 系统提示词规范化（时间戳/UUID/日期替换）
- ✅ 指纹追踪
- 📊 缓存命中/未命中统计追踪
- 📊 `/cache-stats` 面板数据
- 📊 JSONL 使用记录持久化

**过滤机制**：
1. **模型 ID 检查**：模型 ID 必须匹配已知的 DeepSeek 模型（`deepseek-chat`、`deepseek-reasoner` 等）或以 `deepseek-` 开头
2. **提供商检查**（可用时）：提供商必须是 `deepseek`（不是 `openai-compatible`、`openrouter` 等）

- 如果你使用 `openai-compatible` 提供商配合官方 DeepSeek 模型 ID 和第三方 base URL，插件无法通过 URL 验证将其与真正的 DeepSeek 端点区分开来。统计数据会被记录（误报）。这是插件架构的固有限制。
- 插件未实现 `dispose` hook。热重载时 debug 日志文件句柄可能不会立即释放，直到进程退出。正常使用下影响可以忽略。
- 缓存命中率依赖完整的请求前缀稳定性。本插件仅归一化 system prompt 中的动态内容。tool 定义或消息内容发生变化时，缓存仍可能失效。OpenCode 插件架构未在 `chat.params` hook 中暴露 `tools` 定义，因此无法在插件层面检测 tool 变更。

---
---

## 📦 安装 | Installation

```bash
npm install opencode-deepseek-cache
```

## ⚙️ 配置 | Configuration

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///D:/path/to/opencode-deepseek-cache"]
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
