# opencode-deepseek-cache

OpenCode 插件：提升 DeepSeek API 的 KV Cache 命中率。

## 为什么需要这个插件？

DeepSeek 的 [Context Caching](https://api-docs.deepseek.com/guides/kv_cache) 是**自动**的磁盘缓存技术，但默认情况下：

- ❌ 没有 `user_id` 时，你的请求可能与其他用户的请求混在一起，缓存命中率不稳定
- ❌ 系统提示词中的动态内容（时间戳、临时路径等）会破坏前缀匹配
- ❌ 你无法知道自己实际享受了多少缓存优惠

**使用此插件后**：

- ✅ 自动注入稳定的 `user_id`，实现 KVCache 隔离，确保缓存一致性
- ✅ 自动规范化系统提示词，移除破坏前缀匹配的动态内容
- ✅ 实时显示缓存命中率，让你清楚知道节省了多少成本

## 工作原理

### DeepSeek KV Cache 机制

DeepSeek 的缓存系统会在以下时机自动持久化「缓存前缀单元」：

1. **请求边界** — 每个请求的用户输入结束位置和模型输出结束位置
2. **公共前缀检测** — 当系统检测到多个请求的公共前缀时
3. **固定 Token 间隔** — 长文本每隔固定 token 数量切分

后续请求**完全匹配**已持久化的缓存前缀单元时，即为一次 Cache Hit。

### 本插件的优化策略

| 策略 | 原理 | 效果 |
|------|------|------|
| `user_id` 注入 | DeepSeek 使用 `user_id` 做 KVCache 隔离 | 同用户请求共享缓存空间，提升命中率 |
| 系统提示词规范化 | 移除时间戳、UUID、临时路径等动态内容 | 确保不同 Session 的前缀可匹配 |
| 缓存统计 | 追踪 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` | 可视化缓存效果 |

## 安装

```bash
npm install opencode-deepseek-cache
# 或
bun install opencode-deepseek-cache
# 或
pnpm install opencode-deepseek-cache
```

## 配置

### 1. 在 `opencode.json` 中添加插件

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-deepseek-cache"]
}
```

### 2. （可选）设置环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `DEEPSEEK_CACHE_DEBUG` | 启用调试日志 | `false` |
| `DEEPSEEK_CACHE_TOAST` | 在 TUI 中显示缓存统计 | `true` |
| `DEEPSEEK_CACHE_USER_ID_PREFIX` | 自定义 user_id 前缀 | 空 |

```bash
export DEEPSEEK_CACHE_DEBUG=true
export DEEPSEEK_CACHE_USER_ID_PREFIX="my-team"
```

## 效果展示

在 OpenCode TUI 中，每次会话结束后会显示缓存统计：

```
🔷 DeepSeek Cache: 98.6% hit rate | 12,450 hit / 180 miss tokens
```

## 支持模型

- DeepSeek V4 Flash (`deepseek-v4-flash`)
- DeepSeek V4 Pro (`deepseek-v4-pro`)
- 以及未来所有 DeepSeek Chat 模型

## 注意事项

- DeepSeek 缓存是「尽力而为」的，不保证 100% 命中率
- 缓存构建需要几秒钟，初次请求可能无缓存命中
- 缓存闲置几小时到几天后会自动清除
- 本插件只对 DeepSeek provider 生效，不影响其他模型

## 参考

- [DeepSeek Context Caching 文档](https://api-docs.deepseek.com/guides/kv_cache)
- [DeepSeek API 参考](https://api-docs.deepseek.com/api/create-chat-completion)
- [OpenCode 插件文档](https://opencode.ai/docs/plugins/)

## 许可证

MIT
