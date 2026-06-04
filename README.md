# opencode-deepseek-cache

> 💸 **DeepSeek API 缓存优化 + 成本追踪插件 | Cache optimizer & cost tracker for DeepSeek**
> 
> 通过 SHA-256 指纹追踪和动态内容正则替换，稳定 DeepSeek 前缀缓存。跨终端共享 KV Cache，提升缓存命中。财务级成本面板。

---

SHA-256 fingerprint tracking + dynamic regex replacement to stabilize DeepSeek's prefix cache. Cross-terminal KV Cache pooling. Financial-grade cost dashboard.

---

> ⚠️ **Honest Disclaimer | 诚信声明**
> 
> DeepSeek 原生缓存优化已能达到 **95-98%** 命中率。本插件的系统提示归一化功能依赖 OpenCode 的 experimental hook (`system.transform`)，增量改善约为 **1-4 个百分点**。主要价值在多终端场景下避免重复预热。
> 
> DeepSeek's built-in cache optimization already achieves **95-98%** hit rates. This plugin's system prompt normalization relies on OpenCode's experimental `system.transform` hook, adding **1-4 percentage points** incrementally. Primary value is avoiding redundant pre-warming across multiple terminals.


## 🔧 核心功能 | Core Features

### 1. 🔧 (Experimental) 系统提示归一化 | System Prompt Normalization

**灵感来源 | Inspiration**: Reasonix 的 `ImmutablePrefix` 机制

DeepSeek 的前缀缓存是**字节级匹配**的——哪怕 System Prompt 中有一个时间戳不同，整个前缀缓存就会失效。缓存命中与未命中的价差巨大：

| 模型 | 缓存命中 | 缓存未命中 | 价差 |
|------|---------|-----------|------|
| deepseek-v4-flash / deepseek-chat | ¥0.02/1M | ¥1/1M | 50x |
| deepseek-v4-pro | ¥0.025/1M | ¥3/1M | 120x |

*(价差基于 DeepSeek 官方定价。缓存命中率取决于前缀稳定性，DeepSeek 原生缓存已达 95-98%，本插件在此基础上有 1-4 个百分点的增量改善。注意：DeepSeek 不收取缓存写入/存储费用。)*
*(Price ratio based on official DeepSeek pricing. Cache hit rate depends on prefix stability; DeepSeek's native cache already achieves 95-98%, with this plugin providing 1-4 percentage points incremental improvement. Note: DeepSeek does NOT charge for cache writes/storage.)*

DeepSeek's prefix cache uses **byte-level matching** — if even one timestamp differs in the System Prompt, the entire prefix cache is invalidated.

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

**价值 | Value**: 当 experimental hook (`system.transform`) 激活时，本插件将 system prompt 中的动态内容归一化，使前缀在多次请求间保持一致。增量改善约 **1-4 个百分点**，大部分缓存节省来自 DeepSeek 原生优化。

When the experimental `system.transform` hook is active, this plugin normalizes dynamic content in the system prompt, keeping the prefix consistent across requests. Incremental improvement is about **1-4 percentage points**; most cache savings come from DeepSeek's native optimization.

> **注意 | Note**: 本插件仅归一化 system prompt 中的动态内容。tool 定义或消息内容中的动态元素不会被替换。OpenCode 插件架构未在 hook 中暴露 tools 定义，因此无法在插件层面覆盖完整前缀。
> This plugin only normalizes dynamic content in the system prompt. Dynamic elements in tool definitions or message content are NOT replaced.

---

### 2. 🔗 跨终端缓存共享 | Cross-Terminal Cache Sharing

```typescript
// 基于项目路径生成确定性 user_id
const projectHash = createHash("sha256").update(gitRoot).digest("hex").slice(0, 16)
const stableUserId = `opencode-${projectHash}`
```

DeepSeek 的 `user_id` 参数用于 KVCache 隔离：同一 `user_id` 的请求共享缓存池，不同 `user_id` 的请求隔离缓存。通过为同一项目的所有终端生成相同的 `user_id`，这些终端可以共享缓存。

DeepSeek's `user_id` parameter is used for KVCache isolation: requests with the same `user_id` share a cache pool, while requests with different `user_id`s have isolated caches. By generating the same `user_id` for all terminals of the same project, these terminals can share the cache.

**重要说明 | Important Notes**:
- 缓存系统是「尽力而为」，不保证 100% 命中率 | Cache system is "best-effort", no 100% guarantee
- 缓存 TTL 为数小时到数天，长时间不使用会自动清除 | Cache TTL is hours to days, auto-cleared after inactivity
- 同一 `user_id` 共享并发限制 | Same `user_id` shares concurrency limits

**价值 | Value**: 多任务并发场景下，避免重复预热缓存。

In multi-task scenarios, avoid redundant cache pre-warming.

---

### 3. 📊 (Stable) 实时成本追踪面板 | Real-time Cost Tracking Dashboard

通过**「实际花费 vs 无缓存花费」**的对比，直观展示缓存带来的成本差异。

Compare **actual cost vs hypothetical cost without cache** to see the cost difference caching provides.

```text
### 📊 DeepSeek Cache Dashboard

| 核心指标 | 状态 |
| :--- | :--- |
| **缓存命中率** | 🟢 **96.2%** |
| **命中 Tokens** | `20,480,000` |
| **未命中 Tokens** | `800,000` |
| **实际花费** | ¥1.21 |
| **无缓存花费** | ¥21.28 |
| **节省金额** | 💰 **¥20.07** |
| **节省比例** | 94.3% |
| **前缀变化** | 0 次 |
| **当前指纹** | `0f1fb57ba7f88088` |
```

*(以上为插件用户典型数据。DeepSeek 原生缓存占大头；插件归一化贡献约 1-4 个百分点。)*
*(Example from typical plugin user. DeepSeek native cache handles the bulk; plugin normalization adds ~1-4 percentage points.)*

**价值 | Value**: 展示缓存命中率和反事实成本对比。大部分节省来自 DeepSeek 原生缓存优化，插件的增量贡献约为 1-4 个百分点。

Shows cache hit rate and counterfactual cost comparison. Most savings come from DeepSeek's native cache optimization; this plugin contributes an incremental 1-4 percentage points.

### 真实改善幅度 | Real-World Improvement

DeepSeek 官方自身的缓存优化已经非常优秀——什么插件都不装，日常命中率也能达到 **95%-98%**。本插件的增量改善约为 **1-4 个百分点**。

DeepSeek's built-in cache optimization is already excellent — even without any plugin, daily hit rates reach **95-98%**. This plugin adds **1-4 percentage points** incrementally.

**插件的主要价值**：消除 session 重启时因时间戳/UUID 变化导致的缓存失效。多终端场景下，跨终端缓存池化（同一 `user_id`）可避免重复预热，但该功能依赖 DeepSeek 对 `user_id` 的 KVCache 隔离策略，未经独立验证。

**Primary value**: Prevents cache invalidation on session restart caused by timestamp/UUID changes. Cross-terminal cache pooling (same `user_id`) can avoid redundant pre-warming, but this depends on DeepSeek's KVCache isolation strategy for `user_id` and has not been independently verified.

---

## ⚠️ 我们不做什么 | What We Don't Do

**本插件不包含任何「滑动窗口」、「消息截断」或「自动折叠」功能。**

**This plugin does NOT include any "sliding window", "message truncation", or "auto-compaction" features.**

OpenCode 原生的 Compaction 机制已经足够优秀。我们不教 OpenCode 做事。Messages 的管理完全信任宿主。

OpenCode's native Compaction mechanism is already excellent. We don't teach OpenCode how to work. Messages management is fully entrusted to the host.

**Hook 可靠性说明 | Hook Reliability**: 系统提示归一化依赖 OpenCode 的 experimental hook (`system.transform`)。该 hook 可能在未来版本中变更或移除。Dashboard 中的「规范化 Hook」指示器会实时显示 hook 是否正常工作。如果指示器显示 ❌，归一化未生效，但不影响其他功能。

**Hook Reliability**: System prompt normalization depends on OpenCode's experimental `system.transform` hook, which may change or be removed in future versions. The dashboard's "Normalization Hook" indicator shows real-time hook status. If it shows ❌, normalization is inactive but other features are unaffected.

---

## 📋 功能状态矩阵 | Feature Status Matrix

| 功能 | 状态 | 说明 |
| :--- | :--- | :--- |
| **跨终端缓存池化** | ✅ Stable | 基于 git root 生成确定性 `user_id`，多终端共享 KV Cache |
| **实时成本追踪** | ✅ Stable | `/cache-stats` 面板 + JSONL 持久化，仅记录官方 DeepSeek 端点 |
| **系统提示归一化** | 🔧 Experimental | 依赖 `system.transform` hook，归一化时间戳/UUID/日期等动态内容 |
| **前缀指纹追踪** | 🔧 Experimental | SHA-256 指纹检测，变化时日志警告 |
| **JSONL 持久化** | ✅ Stable | 每次 `session.idle` 追加记录，10MB 自动轮转 |

| Feature | Status | Description |
| :--- | :--- | :--- |
| **Cross-terminal Pooling** | ✅ Stable | Deterministic `user_id` from git root, shared KV Cache across terminals |
| **Real-time Cost Tracking** | ✅ Stable | `/cache-stats` dashboard + JSONL persistence, official DeepSeek endpoints only |
| **System Prompt Normalization** | 🔧 Experimental | Depends on `system.transform` hook, normalizes timestamps/UUIDs/dates |
| **Prefix Fingerprint Tracking** | 🔧 Experimental | SHA-256 fingerprint detection, log warning on change |
| **JSONL Persistence** | ✅ Stable | Appends per `session.idle`, auto-rotates at 10MB |

### 验证指南 | Verification Guide

**跨终端池化验证** | Verify Cross-terminal Pooling:
1. 在两个终端中分别运行同一项目的 OpenCode
2. 第一个终端发送请求后，检查第二个终端的缓存命中率
3. **成功信号**: 第二个终端命中率接近 100% | **失败信号**: 两个终端命中率独立

**成本追踪验证** | Verify Cost Tracking:
1. 发送几条消息后输入 `/cache-stats`
2. 检查命中 Tokens 和实际花费是否合理
3. **成功信号**: 面板显示数据，JSONL 文件有记录 | **失败信号**: 面板为空或 JSONL 无记录

**系统提示归一化验证** | Verify System Prompt Normalization:
1. 启用 debug 日志，观察 `system.transform` hook 是否被调用
2. 连续发送两条消息，检查日志中是否有 `⚠️ Prefix fingerprint changed` 警告
3. **成功信号**: 无指纹变化警告 | **失败信号**: 每次请求都报告指纹变化

> **注意**: 此功能依赖 experimental hook。如果 hook 未激活，归一化不会执行，但不影响其他功能。
> **Note**: This feature depends on an experimental hook. If the hook is not active, normalization won't run, but other features remain unaffected.

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

### system.transform Hook 可靠性 | Hook Reliability

**Status: ✅ 已验证 (Verified)** — 基于 JSONL 生产数据，`experimental.chat.system.transform` hook 在 OpenCode 当前版本中正常触发。插件通过调用计数器 (`systemTransformCallCount`) 自监控，并在 Dashboard 中展示 hook 活跃状态。若 hook 未激活，系统提示归一化功能将不生效，但成本追踪和跨终端池化仍正常工作。

**Status: ✅ Verified** — Based on JSONL production data, the `experimental.chat.system.transform` hook fires correctly in the current OpenCode version. The plugin self-monitors via an invocation counter (`systemTransformCallCount`) and displays hook liveness in the Dashboard. If the hook is not active, system prompt normalization is disabled, but cost tracking and cross-terminal pooling remain unaffected.

### 已知但不修 | Won't Fix

- `output.parts` 赋值依赖 OpenCode 未文档行为（HACK comment 标注）
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
- 缓存命中率依赖完整的请求前缀稳定性。本插件仅归一化 system prompt 中的动态内容。tool 定义或消息内容发生变化时，缓存仍可能失效。OpenCode 插件架构未在 `chat.params` hook 中暴露 `tools` 定义，因此无法在插件层面检测 tool 变更。

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

### v2.1.6 → v2.1.7

v2.1.7 是基于全面代码审查的 bug 修复版本，修复了数据完整性、防御性编码和代码质量问题。

#### 🐛 Bug 修复

- 🐛 **B16: cachedModelId 非 DeepSeek 模型覆盖修复** — 修复 `cachedModelId` 在 `isApplicableDeepSeek` 检查之前被更新的问题。之前非 DeepSeek 模型的 ID 会覆盖缓存的模型 ID，导致成本报告使用错误的定价。现在 `cachedModelId` 仅在确认为官方 DeepSeek 模型后才更新。
- 🐛 **B17: addDynamicPattern 误导注释修复** — 修复 `addDynamicPattern()` 函数注释错误声称「创建新数组」的问题。实际上该函数通过类型断言直接修改共享的 `DYNAMIC_PATTERNS` 数组。现在注释准确描述了实际行为（就地修改），并说明了使用 `getDynamicPatterns()` 获取副本进行测试隔离。
- 🐛 **B18: JSONL 轮转文件排序修复** — 修复 `forEachJsonlRecord` 中轮转文件使用字典序排序的问题。虽然对于 `Date.now()` 时间戳（固定 13 位数字）字典序排序恰好正确，但使用数字排序更健壮。现在使用 `Number(a.split('.').pop()) - Number(b.split('.').pop()))` 进行数字排序。
- 🐛 **B19: JSONL 负数 token 值验证修复** — 修复 `loadStatsFromJsonl` 中加载的 token 计数未验证非负值的问题。损坏的 JSONL 数据中的负数 token 计数会被添加到统计中。现在使用 `Math.max(0, ...)` 确保加载的值为非负数。
- 🐛 **B20: LRU 淘汰无限循环防护** — 修复 LRU 淘汰 while 循环中缺少 `break` 防护的问题。虽然理论上 `Date.now()` 不会返回 `Infinity`，但如果 `oldestSession` 为 `null`，循环会无限运行。现在添加 `if (!oldestSession) break` 防护。
- 🐛 **B21: SESSION_BASELINE_TTL_MS 取整修复** — 修复 `SESSION_BASELINE_TTL_MS` 未使用 `Math.floor()` 的问题。其他环境变量配置的常量（`MAX_JSONL_SIZE`、`MAX_LOG_SIZE`、`MAX_SESSION_BASELINES`）都使用了 `Math.floor()`，但 `SESSION_BASELINE_TTL_MS` 没有，导致浮点数环境变量（如 `1.5`）被接受为 `1.5ms` 而不是被取整为 `1`。
- 🐛 **B22: 日志缓冲区溢出警告** — 修复写入缓冲区超过 `MAX_WRITE_BUFFER`（50 行）时最旧行被静默丢弃的问题。现在在丢弃旧行时输出 `console.warn` 警告，使该行为可观察。
- 🐛 **B23: 孤立重试状态清理一致性修复** — 修复孤立重试状态清理（`sessionRetryState`）不清理对应的 `lastBaselineWrite` 条目的问题。TTL 清理会清理 `lastBaselineWrite`，但孤立清理不会——这是一个不一致性。现在孤立清理也会清理 `lastBaselineWrite`。
- 🐛 **B24: prefixChanges pc 字段覆盖修复** — 修复 `loadStatsFromJsonl` 中 `pc` 字段覆盖基于比较的 `prefixChanges` 计数的问题。在 JSONL 损坏的情况下，`pc` 字段可能不准确。现在使用 `Math.max(stats.prefixChanges, r.pc)` 取较大值，保留基于比较的计数。

#### 🔍 验证

- ✅ 所有 194 个测试通过
- ✅ TypeScript 类型检查通过
- ✅ Biome 代码风格检查通过
- ✅ DeepSeek API 定价验证（2026年5月）

### v2.1.5 → v2.1.6

v2.1.6 是基于 Hyperplan 对抗性团队全面分析的 bug 修复版本，修复了日志缓冲区丢失、配置验证和数据类型安全问题。

#### 🐛 Bug 修复

- 🐛 **B10: 日志缓冲区轮转丢失修复** — 修复 `checkRotation()` 在背压期间轮转时丢失缓冲日志行的问题。之前轮转会结束旧流并创建新流，但不刷新 `writeBuffer`，导致缓冲的日志行永久丢失。现在在结束旧流之前先通过 cork/uncork 批量刷新缓冲区。
- 🐛 **B11: 空系统提示假指纹变化修复** — 修复 `system.transform` 钩子在系统提示为空时计算空字符串的 SHA-256 指纹，导致假「前缀已变化」警告的问题。现在在 `result.normalized` 为空时提前返回，跳过指纹计算。
- 🐛 **B12: SESSION_BASELINE_TTL_MS 零值修复** — 修复 `SESSION_BASELINE_TTL_MS` 环境变量设为 `0` 时破坏基线机制的问题。之前 `0 ?? 86400000` 返回 `0`，导致所有基线立即过期。现在使用 `Math.max(1, ...)` 确保最小值为 1ms。
- 🐛 **B13: 配置值浮点数修复** — 修复 `MAX_SESSION_BASELINES`、`MAX_JSONL_SIZE`、`MAX_LOG_SIZE` 接受浮点值的问题。现在使用 `Math.floor()` 确保这些配置值为整数。
- 🐛 **B14: sessionID 类型验证修复** — 修复 `loadBaselinesFromJsonl` 中 `record.sessionID as string` 未进行类型验证的问题。现在添加 `typeof record.sessionID === 'string'` 检查，防止损坏的 JSONL 记录创建无效的 Map 条目。
- 🐛 **B15: addDynamicPattern 共享状态修复** — 修复 `addDynamicPattern()` 直接修改模块级 `DYNAMIC_PATTERNS` 常量数组的问题。现在添加类型断言以明确修改意图，并添加注释说明风险。

#### 📝 已知限制

- 📝 **system.transform 钩子无法检查 providerID** — OpenCode 的 `experimental.chat.system.transform` 钩子输入类型不包含 `provider` 属性，因此无法像 `chat.params` 钩子那样同时检查 apiUrl 和 providerID。这是插件 API 的固有限制。

#### 🔍 验证

- ✅ 所有 194 个测试通过
- ✅ TypeScript 类型检查通过
- ✅ DeepSeek API 定价验证（2026年5月）
- ✅ 跨平台路径一致性验证

### v2.1.4 → v2.1.5

v2.1.5 是基于 Hyperplan 对抗性团队全面分析的 bug 修复版本，修复了数据验证和时间戳处理问题。

#### 🐛 Bug 修复

- 🐛 **B8: Token 验证缺口修复** — 修复事件处理器中 `writeTokens` 和 `outputTokens` 未被验证的问题。之前只检查 `hitTokens` 和 `missTokens` 是否为 NaN/负数，导致 `writeTokens` 或 `outputTokens` 为 NaN 时传播到统计计算中。现在所有 4 种 token 类型都被验证。
- 🐛 **B9: firstRequestTime 纪元零值修复** — 修复 `loadStatsFromJsonl` 中 `firstRequestTime` 被设置为 0（Unix 纪元）的问题。当 JSONL 记录的时间戳缺失或损坏时，`t` 被设为 0，导致会话时长计算产生巨大数值。现在跳过 `t === 0` 的记录，避免损坏的时长计算。

#### 🔍 验证

- ✅ 所有 194 个测试通过
- ✅ TypeScript 类型检查通过
- ✅ DeepSeek API 定价验证（2026年5月）
- ✅ 跨平台路径一致性验证
### v2.1.3 → v2.1.4

v2.1.4 是基于 Hyperplan 对抗性团队分析的 bug 修复版本，修复了定价精度和数据验证问题。

#### 🐛 Bug 修复

- 🐛 **B1: 幻影 cacheWrite 定价修复** — DeepSeek 官方不收取缓存写入费用，但插件错误地为 flash 和 pro 模型分别收取 ¥0.5/1M 和 ¥1.5/1M 的缓存写入费用。现已将 `cacheWrite` 价格设为 0，与官方定价一致。
- 🐛 **B2: NaN 基线时间戳修复** — 修复 `loadBaselinesFromJsonl` 中 NaN/Infinity 时间戳被替换为 `Date.now()` 导致损坏的基线看起来是新鲜的问题。现在 NaN 时间戳被设为 0，会被 TTL 过滤器正确排除。
- 🐛 **B3: 负 delta 警告** — 新增警告日志，当 `session.tokens` 减少（如上下文压缩后）时记录负 delta 值，使该行为可观察。负 delta 被钳制为 0，防止 token 计数变为负数。

#### 📝 文档更新

- 📝 **user_id 行为澄清** — 更新文档说明 `user_id` 参数用于 KVCache 隔离（隐私管理），而非跨终端缓存池化。同一 `user_id` 的请求共享缓存，不同 `user_id` 的请求隔离缓存。
- 📝 **定价验证** — 验证插件的 CNY 定价与 DeepSeek 官方定价一致（2026年5月）。
- 📝 **缓存写入费用说明** — 明确说明 DeepSeek 不收取缓存写入/存储费用。

### v2.1.4 (additional fixes)

v2.1.4 additional fixes based on comprehensive project analysis and hyperplan adversarial team review.

#### 🐛 Bug 修复

- 🐛 **B4: firstRequestTime 零值覆盖修复** — 修复 `loadStatsFromJsonl` 中 `firstRequestTime` 被错误设置为 0 的问题。当 JSONL 记录的时间戳为 0（NaN 修复后）时，`!stats.firstRequestTime` 条件为真，导致 `firstRequestTime` 被重复覆盖。现在使用 `stats.firstRequestTime === null` 条件，确保只设置一次。
- 🐛 **B5: response.data 类型验证** — 在事件处理器中添加 `Array.isArray(response.data)` 检查，防止 API 返回意外形状时 `.filter()` 方法抛出错误。
- 🐛 **B6: parseEnvNumber 负值验证** — 修复 `parseEnvNumber` 函数接受负值的问题。现在只接受非负数值，防止环境变量配置错误导致的意外行为。
- 🐛 **B7: 版本号同步** — 将 `package.json` 版本号从 2.1.3 更新为 2.1.4，与代码变更保持一致。

#### 🔍 验证

- ✅ 所有 194 个测试通过
- ✅ DeepSeek API 定价验证（2026年5月）
- ✅ OpenCode 插件架构兼容性验证
- ✅ 跨平台路径一致性验证
### v2.1.2 → v2.1.3

v2.1.3 是 Hyperplan 对抗性团队分析驱动的 bug 修复版本，修复了 4 个数据精度和内存泄漏问题。

#### 🐛 Bug 修复

- 🐛 **B1: 基线记录 output 字段膨胀修复** — 修复 `loadStatsFromJsonl` 中基线记录的 `output` 字段被错误地累加到 `totalOutputTokens` 的问题。现在基线和指纹记录被完全排除在 token 统计之外。
- 🐛 **B2: JSONL 文件排序顺序修复** — 修复 `forEachJsonlRecord` 中当前文件（最新）在轮转文件（旧）之前被处理的问题。现在按时间顺序处理：轮转文件从旧到新，当前文件最后，确保指纹追踪正确恢复最新状态。
- 🐛 **B3: 过期基线 TTL 过滤** — 修复 `loadBaselinesFromJsonl` 中不检查基线年龄的问题。现在跳过超过 `SESSION_BASELINE_TTL_MS`（默认 24h）的过期基线，防止重启后首次请求的 delta 计算膨胀。
- 🐛 **B4: NaN lastAccess 验证** — 修复 NaN/Infinity 时间戳被替换为 `Date.now()` 导致过期基线看起来是新鲜的问题。现在 NaN 时间戳被设为 0，会被 B3 的 TTL 过滤器正确排除。
- 🐛 **B5: 孤立 sessionRetryState 清理** — 修复 `sessionRetryState` 条目在会话永久退避但从未创建基线时不被清理的内存泄漏问题。现在在基线扫描循环后添加孤立重试状态清理。

#### 🧹 维护

- 🧹 通过 Hyperplan 对抗性团队协作分析（bug-finder, solution-innovator, structure-analyst, deep-researcher, quality-checker）
- 🧹 更新测试以使用最近时间戳，适配 B3 TTL 过滤逻辑

v2.1.0 是实验驱动的 bug 修复 + 文档诚信升级版本。

#### 🐛 Bug 修复

- 🐛 **跨平台 user_id 一致性（B3）** — 新增 `normalizeGitRoot()` 函数，统一 Windows native (`D:\foo`)、WSL2 (`/mnt/d/foo`)、macOS、Linux 路径格式，使同一项目在不同操作系统下生成**相同** user_id。跨终端缓存池化现在**真正跨平台生效**。
- 🐛 **event hook stats 失效修复** — 从 `ctx.client.session.get` 改为 `ctx.client.session.messages`，解决 `session.tokens` 字段不存在导致 stats 永远为空的问题。
- 🐛 **`cacheStats` tool fingerprint 显示** — 修复 tool 调用时 Dashboard 缺失当前指纹行。
- 🐛 **savedCost 成本计算** — 现正确扣除写入和输出 token 成本。
- 🐛 **index.test.ts R2 测试匿名监听器泄漏** — 修复测试资源泄漏。
- 🐛 **event handler 重试风暴** — 新增 per-session 指数退避（1s/2s/4s/永久），防止 API 错误或 JSONL 损坏导致无限重试循环。
- 🐛 **logger 背压处理** — 新增写入缓冲区（最多 50 行），在 stream.write 返回 false 时缓冲日志并在 drain 事件时刷新，防止高负载下日志丢失。
- 🐛 **插件卸载后悬空钩子** — 新增 `pluginDisposed` 标志，所有钩子执行前检查此标志，防止卸载后写入已释放的 logger 或损坏状态。
- 🐛 **LRU 淘汰策略** — 将会话基线淘汰从 FIFO（最早插入）改为 LRU（最近最少访问），确保活跃会话不被淘汰。
- 🐛 **JSONL 旋转时序** — 将文件旋转检查移到追加写入之前，防止写入错误文件。
- 🐛 **类型安全改进** — `logger.ts` 中 `any` → `unknown`，`loadStatsFromJsonl` 增加 `Number.isFinite` 检查，防止 NaN/Infinity 污染统计。
- 🐛 **logger dispose 背压修复** — `dispose()` 使用 `cork/uncork` 批量刷新缓冲写入，防止关闭时数据丢失。
- 🐛 **rotateFileIfNeeded 测试覆盖** — 新增 7 个测试覆盖文件旋转逻辑，包括跳过计数器、大小阈值、旧文件清理和错误处理。
- 🐛 **测试隔离改进** — 新增 `resetSkipCounters()` 函数，确保测试之间状态隔离。

#### 🧪 实验验证

通过对照实验严格验证了插件功能：

- 🧪 **实验 A（P1 系统提示归一化）**：static vs dynamic system prompt，**Δ = 88.2%**
- 🧪 **实验 B（P2 跨终端池化）**：same-user vs diff-user，**Δ = 100%**

#### 📝 文档诚信改进

- 📝 顶部添加「⚠️ Honest Disclaimer」banner（中英双语）
- 📝 §1 标注 (Experimental)，§3 用真实数据 96.2%
- 📝 删除「98% 折扣」、「防 cache 雪崩」等夸大宣传
- 📝 新增「功能状态矩阵」+「验证指南」（中英双语）
- 📝 新增「Hook 可靠性说明」

#### 🧹 维护

- 🧹 Biome 3 文件格式修复

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

详见 git log。

---

## 🛠️ 使用 | Usage


安装后插件会在后台静默工作 | Once installed, the plugin works silently:

- ✅ 注入稳定的 `user_id`（v2: Git Root 感知，monorepo 安全） | Injects stable `user_id` (v2: Git-Root-aware)
- ✅ 替换时间戳/UUID/日期/版本/路径为占位符 | Replaces timestamps/UUIDs/dates/versions/paths with placeholders
- ✅ 追踪前缀指纹变化（v2: 持久化，重启不误报） | Tracks prefix fingerprint changes (v2: persisted across restarts)

输入 `/cache-stats` 查看成本对冲面板 | Type `/cache-stats` to view cost hedging dashboard:

> 📁 统计数据保存在 `.opencode/deepseek-cache-usage.jsonl`，重启不丢失。
> 
> Statistics are saved to `.opencode/deepseek-cache-usage.jsonl` and persist across restarts.

## 🧠 灵感来源 | Inspiration

本插件的「字节级前缀固化」机制，深度借鉴了 [Reasonix](https://github.com/esengine/DeepSeek-Reasonix) 框架在 DeepSeek 缓存优化上的卓越设计。

我们提取了 Reasonix 的核心灵魂——`ImmutablePrefix`（不可变前缀）——并将其适配到 OpenCode 插件架构中。

The "byte-level prefix stabilization" mechanism in this plugin is deeply inspired by [Reasonix](https://github.com/esengine/DeepSeek-Reasonix)'s excellent design for DeepSeek cache optimization.

We extracted Reasonix's core soul — `ImmutablePrefix` — and adapted it to the OpenCode plugin architecture.

本插件的 v2.1.0 观测增强功能（趋势追踪、双指标、3档定价、缓存写/输出 token 追踪）参考了 [opencode-visual-cache](https://github.com/Hotakus/opencode-visual-cache) 的可视化方案。

The v2.1.0 observation enhancement features (trend tracking, dual metrics, 3-tier pricing, cache write/output token tracking) are inspired by [opencode-visual-cache](https://github.com/Hotakus/opencode-visual-cache)'s visualization approach.

## License

MIT
