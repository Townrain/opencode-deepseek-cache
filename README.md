# opencode-deepseek-cache

> 💸 **DeepSeek API 缓存优化 + 成本追踪插件 | Cache optimizer & cost tracker for DeepSeek**
> 
> 通过 SHA-256 指纹追踪和动态内容正则替换，稳定 DeepSeek 前缀缓存。跨终端共享 KV Cache，防缓存雪崩。财务级成本面板。

---

SHA-256 fingerprint tracking + dynamic regex replacement to stabilize DeepSeek's prefix cache. Cross-terminal KV Cache pooling. Financial-grade cost dashboard.

---

## 🎯 核心卖点 | Core Value Propositions

### 1. 🛡️ 字节级前缀固化 | Byte-level Prefix Stabilization

**灵感来源 | Inspiration**: Reasonix 的 `ImmutablePrefix` 机制

DeepSeek 的前缀缓存是**字节级匹配**的——哪怕 System Prompt 中有一个时间戳不同，整个前缀缓存就会失效。缓存命中与未命中的价差巨大：

| 模型 | 缓存命中 | 缓存未命中 | 价差 |
|------|---------|-----------|------|
| deepseek-v4-flash / deepseek-chat | ¥0.02/1M | ¥1/1M | 50x |
| deepseek-v4-pro | ¥0.025/1M | ¥3/1M | 120x |

DeepSeek's prefix cache uses **byte-level matching** — if even one timestamp differs in the System Prompt, the entire prefix cache is invalidated:

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

**价值 | Value**: 无论重启多少次、跨多少天，发给 DeepSeek 的 **System Prompt 前缀**永远字节级一致。保住每次重启时基础工具定义缓存的 **98% 折扣**。

No matter how many restarts or days pass, the **system prompt prefix** sent to DeepSeek is **always byte-identical**. Preserves the **98% discount** on base tool definitions every restart.

> **注意 | Note**: 本插件仅归一化 system prompt 中的动态内容。tool 定义或消息内容中的动态元素不会被替换。OpenCode 插件架构未在 hook 中暴露 tools 定义，因此无法在插件层面覆盖完整前缀。
> This plugin only normalizes dynamic content in the system prompt. Dynamic elements in tool definitions or message content are NOT replaced.

---

### 2. 🔗 跨终端缓存池化 | Cross-Terminal Cache Pooling

```typescript
// 基于项目路径生成确定性 user_id
const projectHash = createHash("sha256").update(gitRoot).digest("hex").slice(0, 16)
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
| **实际花费** | ¥0.35 |
| **无缓存花费** | ¥13.07 |
| **节省金额** | 💰 **¥12.72** |
| **节省比例** | 97.3% |
| **前缀变化** | 0 次 |
| **当前指纹** | `a1b2c3d4e5f67890` |
```

**价值 | Value**: 用真实数据告诉用户：「如果没有这个插件，你本来要花 ¥13.07，现在只花了 ¥0.35」。

Tell users with real data: "Without this plugin, you would have spent ¥13.07. Now you only spent ¥0.35."

### 真实改善幅度 | Real-World Improvement

DeepSeek 官方自身的缓存优化已经非常优秀——什么插件都不装，日常命中率也能达到 **95%-98%**。本插件的增量改善约为 **1-4 个百分点**。

DeepSeek's built-in cache optimization is already excellent — even without any plugin, daily hit rates reach **95-98%**. This plugin adds **1-4 percentage points** incrementally.

**1% 在 1 亿 token 下 = ¥3**。对高频用户来说，积少成多。但插件的真正价值不在日常，而在**防灾难**——某天 OpenCode 升级插入了新时间戳变量，没有插件可能从 98% 暴跌到 20%。

**1% at 100M tokens = ¥3**. For heavy users, it adds up. But the real value is **catastrophe prevention** — the day OpenCode injects a new timestamp variable, without this plugin you could drop from 98% to 20% overnight.

---

## ⚠️ 我们不做什么 | What We Don't Do

**本插件不包含任何「滑动窗口」、「消息截断」或「自动折叠」功能。**

**This plugin does NOT include any "sliding window", "message truncation", or "auto-compaction" features.**

OpenCode 原生的 Compaction 机制已经足够优秀。我们不教 OpenCode 做事。Messages 的管理完全信任宿主。

OpenCode's native Compaction mechanism is already excellent. We don't teach OpenCode how to work. Messages management is fully entrusted to the host.

---

## 🐛 已知限制与隐患 | Known Limitations & Bugs

### Token 统计精度 | Token Stat Accuracy

**跨模型切换时 token 统计存在有界泄漏。** OpenCode 的 `session.tokens` 是单一累加器，不区分模型。插件通过 delta 追踪将误差从「累积型」降为「区间有界型」，但在同一 session 内切换过模型时仍可能有少量非 DeepSeek token 被计入。

**Bounded cross-model token leakage.** OpenCode's `session.tokens` is a single accumulator across all models. Delta tracking bounds the error to the interval between same-model checks, but cannot eliminate it. A `chat.response` hook exposing raw provider `usage` would fully resolve this.

### 定价匹配 | Pricing Accuracy

定价基于模型 ID 正则匹配（`v4-pro` → ¥3/¥0.025，其余 → flash ¥1/¥0.02）。DeepSeek 调整价格时需手动更新 `DEEPSEEK_PRICING_MAP`。

Pricing is based on model ID regex matching. Manual update of `DEEPSEEK_PRICING_MAP` is required when DeepSeek changes pricing.

### JSONL 文件增长 | JSONL Growth

每次 `session.idle` 追加一条记录（~80 字节）。文件超过 10MB 自动轮转，旧文件保留最近 3 个。长期高频使用建议定期清理 `.opencode/deepseek-cache-usage.jsonl*`。

One record (~80 bytes) per `session.idle`. Auto-rotates at 10MB, keeping last 3. Recommend periodic cleanup for heavy long-term use.

### 已知但不修 | Won't Fix

- `output.parts` 赋值依赖 OpenCode 未文档行为（HACK comment 标注）
- 跨平台路径（Windows/WSL2）产生不同 `user_id`，缓存池不共享
- 无 `chat.response` hook，无法获取 per-request 原始 token 数据
- ⚠️ v1.2 起：日志目录从 `.deepseek-cache-logs/` 迁移到 `.opencode/deepseek-cache-logs/`（首次启动自动提示，旧日志保留不删除）

---
## 🔍 Official vs Third-Party Filtering | 官方与第三方过滤

### English

This plugin's **cost tracking** (cache hit/miss stats, `/cache-stats` dashboard) only records usage from official DeepSeek API endpoints. Third-party proxies and compatible providers are excluded from statistics to keep your cost data accurate.

**What is filtered to official DeepSeek only**:
- ✅ Cross-terminal `user_id` injection
- ✅ GDPR opt-out via `DEEPSEEK_CACHE_NO_USER_ID=true` env var
- ✅ System prompt normalization (timestamp/UUID/date replacement)
- ✅ Fingerprint tracking
- 📊 Cache hit/miss statistics tracking
- 📊 `/cache-stats` dashboard data
- 📊 JSONL usage persistence

**How filtering works**:
1. **Endpoint URL check**: URL hostname must match `api.deepseek.com`, `*.deepseek.com`, or `*.deepseek.com.cn`
2. **Provider check** (when available): Provider must be `deepseek` (not `openai-compatible`, `openrouter`, etc.)

- If you use an `openai-compatible` provider with an official DeepSeek model ID and a third-party base URL, the plugin cannot distinguish this from a real DeepSeek endpoint via URL verification. Stats will be tracked (false positive). This is an inherent limitation of the plugin architecture.
- ⚠️ Since v1.2: debug logs moved from `.deepseek-cache-logs/` to `.opencode/deepseek-cache-logs/`. A one-time migration notice is shown on first start. Old logs are kept but no longer written to.
- Cache hit rate depends on full request prefix stability. This plugin only normalizes dynamic content in the system prompt. Changes to tool definitions or message content can still cause cache misses. The OpenCode plugin architecture does not expose `tools` definitions in the `chat.params` hook, so plugin-level detection of tool changes is not possible.

### 中文

本插件的**成本追踪**（缓存命中/未命中统计、`/cache-stats` 面板）仅记录来自官方 DeepSeek API 端点的使用数据。第三方代理和兼容提供商的数据会被排除，以保持成本数据的准确性。


**仅限官方 DeepSeek 的功能**：
- ✅ 跨终端 `user_id` 注入
- ✅ GDPR opt-out 通过 `DEEPSEEK_CACHE_NO_USER_ID=true` 环境变量
- ✅ 系统提示词规范化（时间戳/UUID/日期替换）
- ✅ 指纹追踪
- 📊 缓存命中/未命中统计追踪
- 📊 `/cache-stats` 面板数据
- 📊 JSONL 使用记录持久化

**过滤机制**：
1. **Endpoint URL 检查**：API URL 的 hostname 必须匹配 `api.deepseek.com`、`*.deepseek.com` 或 `*.deepseek.com.cn`
2. **提供商检查**（可用时）：提供商必须是 `deepseek`（不是 `openai-compatible`、`openrouter` 等）

- 如果你使用 `openai-compatible` 提供商配合官方 DeepSeek API URL 和第三方 base URL，插件无法通过 URL 验证将其与真正的 DeepSeek 端点区分开来。统计数据会被记录（误报）。这是插件架构的固有限制。
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

## 🔄 更新 | Upgrade

### 查看当前版本 | Check Version

```bash
# npm 用户
npm list opencode-deepseek-cache

# 或直接看 package.json
node -e "console.log(require('./node_modules/opencode-deepseek-cache/package.json').version)"
```

### npm 安装用户 | npm Users

```bash
npm update opencode-deepseek-cache
# 或指定版本
npm install opencode-deepseek-cache@2.0.0
```

### 本地路径引用用户 | Local Path Users

如果你的 `opencode.json` 使用 `file://` 路径引用插件（如下方配置示例）：
If your `opencode.json` references the plugin via `file://` path (as in the config example below):

```bash
# 进入插件目录
cd D:/path/to/opencode-deepseek-cache

# 拉取最新代码
git pull

# 安装依赖并构建
npm install
npm run build

# 验证版本
node -e "console.log(require('./package.json').version)"
```

## 📋 变更记录 | Changelog

### v1.2.1 → v2.0.0

v2 是累积性大版本，整合了多轮研究和超平面规划的成果。

| 类型 | 变更 |
|------|------|
| **✨ New** | **Git-Root-Aware User ID** — `findGitRoot()` 向上查找 `.git/` 根目录，解决 monorepo 多目录缓存碎片化 |
| **✨ New** | **Fingerprint 持久化** — 指纹追踪器从 JSONL 历史恢复状态，重启后不再误报「前缀已变化」 |
| **✨ New** | [深度技术指南](./DEEPSEEK_CACHE_GUIDE.md) — 基于两波爬取 30+ 页面、10+ 开源项目的缓存优化文档 |
| **📊 研究** | 确认生态空白：awesome-deepseek-integration 中 ZERO 工具显式做前缀缓存优化 |
| **📊 研究** | 分析了 Reasonix（99.82% 命中率）、NanoBot（43k stars，8 层缓存优化）、京东云（集群级 KV Cache 路由）等案例 |
| **📊 研究** | 识别了 6 大缓存破坏模式（动态前缀注入、全量重发、工具变化、Agent 重建、Lookback 超限、跨实例不共享） |
| **🐛 Fix** | 成本计算表数量级错误修正 |
| **🧹 Doc** | README 重写为插件介绍导向（技术细节移至深度指南） |

### 1.1.0 → 1.2.0 变更

---

## 🛠️ 使用 | Usage


安装后插件会在后台静默工作 | Once installed, the plugin works silently:

- ✅ 注入稳定的 `user_id` | Injects stable `user_id`
- ✅ 替换时间戳/UUID/日期/版本/路径为占位符 | Replaces timestamps/UUIDs/dates/versions/paths with placeholders
- ✅ 追踪前缀指纹变化 | Tracks prefix fingerprint changes

输入 `/cache-stats` 查看成本对冲面板 | Type `/cache-stats` to view cost hedging dashboard:

> 📁 统计数据保存在 `.opencode/deepseek-cache-usage.jsonl`，重启不丢失。
> 
> Statistics are saved to `.opencode/deepseek-cache-usage.jsonl` and persist across restarts.

## 🧠 灵感来源 | Inspiration

本插件的「字节级前缀固化」机制，深度借鉴了 [Reasonix](https://github.com/esengine/DeepSeek-Reasonix) 框架在 DeepSeek 缓存优化上的卓越设计。

我们提取了 Reasonix 的核心灵魂——`ImmutablePrefix`（不可变前缀）——并将其适配到 OpenCode 插件架构中。

The "byte-level prefix stabilization" mechanism in this plugin is deeply inspired by [Reasonix](https://github.com/esengine/DeepSeek-Reasonix)'s excellent design for DeepSeek cache optimization.

We extracted Reasonix's core soul — `ImmutablePrefix` — and adapted it to the OpenCode plugin architecture.

## License

MIT
