import type { Plugin } from "@opencode-ai/plugin"

/**
 * opencode-deepseek-cache
 *
 * A plugin to maximize DeepSeek API KV Cache hit rate in OpenCode.
 *
 * ## How DeepSeek Cache Works
 *
 * DeepSeek uses automatic disk-based KV caching. Cache prefix units are
 * persisted at:
 *   1. Request boundaries (end of user input & end of model output)
 *   2. Common prefix detection across multiple requests
 *   3. Fixed token intervals for long inputs
 *
 * A cache hit occurs when a subsequent request **fully matches** a previously
 * persisted cache prefix unit.
 *
 * ## What This Plugin Does
 *
 * 1. **user_id injection** — Injects a stable `user_id` into every DeepSeek
 *    API request. DeepSeek uses `user_id` for KVCache isolation, ensuring all
 *    your requests share the same cache namespace.
 *
 * 2. **Prefix optimization** — Normalizes system prompts by stripping dynamic
 *    content (timestamps, UUIDs, temp paths) that would otherwise break prefix
 *    matching.
 *
 * 3. **Cache analytics** — Tracks cache hit/miss tokens and displays real-time
 *    cache hit rate via TUI toasts and structured logging.
 *
 * ## Configuration
 *
 * Environment variables:
 *   DEEPSEEK_CACHE_DEBUG=true       Enable debug logging
 *   DEEPSEEK_CACHE_TOAST=true       Show cache stats in TUI (default: true)
 *   DEEPSEEK_CACHE_USER_ID_PREFIX=  Custom prefix for generated user_id
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CacheStats {
  hitTokens: number
  missTokens: number
  totalRequests: number
  lastHitRate: number
}

interface PluginConfig {
  debug: boolean
  toastEnabled: boolean
  userIdPrefix: string
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const stats: CacheStats = {
  hitTokens: 0,
  missTokens: 0,
  totalRequests: 0,
  lastHitRate: 0,
}

let config: PluginConfig = {
  debug: false,
  toastEnabled: true,
  userIdPrefix: "",
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a stable, cache-friendly user_id.
 *
 * DeepSeek uses user_id for KVCache isolation. By using the same user_id
 * across all requests from the same project, we ensure they share the same
 * cache namespace and maximize cache hit probability.
 */
function generateUserId(projectId: string): string {
  const prefix = config.userIdPrefix ? `${config.userIdPrefix}_` : ""
  // Only [a-zA-Z0-9\-_] allowed, max 512 chars
  const sanitized = projectId.replace(/[^a-zA-Z0-9\-_]/g, "-").slice(0, 64)
  return `${prefix}opencode_${sanitized}`
}

/**
 * Compute cache hit rate as a percentage string.
 */
function hitRate(hit: number, miss: number): string {
  const total = hit + miss
  if (total === 0) return "0.0%"
  return ((hit / total) * 100).toFixed(1) + "%"
}

/**
 * Conditionally log debug messages.
 */
function debugLog(message: string, data?: unknown) {
  if (config.debug) {
    console.log(`[deepseek-cache] ${message}`, data ?? "")
  }
}

// ---------------------------------------------------------------------------
// Plugin Entry
// ---------------------------------------------------------------------------

export const DeepSeekCachePlugin: Plugin = async (ctx) => {
  const projectId = ctx.project.id ?? "global"
  const userId = generateUserId(projectId)

  // Load config from environment variables
  config = {
    debug: process.env.DEEPSEEK_CACHE_DEBUG === "true",
    toastEnabled: process.env.DEEPSEEK_CACHE_TOAST !== "false",
    userIdPrefix: process.env.DEEPSEEK_CACHE_USER_ID_PREFIX ?? "",
  }

  debugLog(`Initialized for project=${projectId} user_id=${userId}`, config)

  return {
    // -----------------------------------------------------------------------
    // chat.params — Inject user_id into every DeepSeek API request
    //
    // DeepSeek uses user_id for KVCache isolation. Requests with the same
    // user_id share the same cache namespace → higher hit rate.
    // -----------------------------------------------------------------------
    "chat.params": async (
      { model, provider },
      output: {
        temperature?: number
        topP?: number
        options?: Record<string, unknown>
      },
    ) => {
      // Only activate for DeepSeek providers
      if (!provider || !provider.toLowerCase().includes("deepseek")) {
        return
      }

      if (!output.options) output.options = {}
      ;(output.options as Record<string, unknown>).user_id = userId

      debugLog(
        `Injected user_id=${userId} for provider=${provider} model=${model}`,
      )
    },

    // -----------------------------------------------------------------------
    // chat.message — Normalize system prompts to maximize prefix overlap
    //
    // Strips dynamic content (timestamps, UUIDs, temp paths) that would
    // otherwise prevent prefix matching across sessions.
    // -----------------------------------------------------------------------
    "chat.message": async (
      _input: { model?: string; provider?: string; message?: unknown },
      output: {
        message?: { role?: string; content?: string }
        parts?: unknown[]
      },
    ) => {
      if (!output.message) return
      if (output.message.role !== "system") return

      let content = output.message.content ?? ""
      if (typeof content !== "string") return

      const original = content

      // Remove ISO 8601 timestamps
      content = content.replace(
        /\b(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)\b/g,
        "[TIMESTAMP]",
      )

      // Remove UUIDs
      content = content.replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
        "[UUID]",
      )

      // Remove long hex IDs (16+ hex chars)
      content = content.replace(/\b[0-9a-f]{16,}\b/gi, "[HEXID]")

      // Remove temp paths like /tmp/opencode-xxxxx
      content = content.replace(
        /\/tmp\/[a-zA-Z0-9_\-./]+/g,
        "/tmp/[PATH]",
      )

      if (content !== original) {
        output.message.content = content
        debugLog("Normalized system prompt for cache prefix stability", {
          originalLen: original.length,
          normalizedLen: content.length,
        })
      }
    },

    // -----------------------------------------------------------------------
    // event — Track session and message events for cache analytics
    // -----------------------------------------------------------------------
    event: async ({ event }) => {
      // On session idle, display cumulative cache stats
      if (event.type === "session.idle") {
        const rate = hitRate(stats.hitTokens, stats.missTokens)
        stats.totalRequests++

        debugLog(`Session idle — cumulative cache hit rate: ${rate}`, {
          hitTokens: stats.hitTokens,
          missTokens: stats.missTokens,
          totalRequests: stats.totalRequests,
        })

        if (config.toastEnabled && stats.totalRequests > 0) {
          try {
            await ctx.client.tui.showToast({
              body: {
                message:
                  `🔷 DeepSeek Cache: ${rate} hit rate | ` +
                  `${stats.hitTokens.toLocaleString()} hit / ${stats.missTokens.toLocaleString()} miss tokens`,
                variant: stats.lastHitRate >= 50 ? "success" : "info",
              },
            })
          } catch {
            // Toast may fail in non-TUI mode — silently ignore
          }
        }

        // Structured logging via OpenCode SDK
        try {
          await ctx.client.app.log({
            body: {
              service: "deepseek-cache",
              level: "info",
              message: `Cache hit rate: ${rate}`,
              extra: {
                hitTokens: stats.hitTokens,
                missTokens: stats.missTokens,
                totalRequests: stats.totalRequests,
                hitRate: rate,
                userId,
              },
            },
          })
        } catch {
          // Log endpoint may be unavailable — silently ignore
        }
      }

      // Track message.updated events to extract cache usage from API response
      if (event.type === "message.updated") {
        const props = event.properties as Record<string, unknown> | undefined
        if (props?.usage) {
          const usage = props.usage as {
            prompt_cache_hit_tokens?: number
            prompt_cache_miss_tokens?: number
            prompt_tokens?: number
            completion_tokens?: number
          }
          if (typeof usage.prompt_cache_hit_tokens === "number") {
            stats.hitTokens += usage.prompt_cache_hit_tokens
          }
          if (typeof usage.prompt_cache_miss_tokens === "number") {
            stats.missTokens += usage.prompt_cache_miss_tokens
          }
          stats.lastHitRate =
            stats.hitTokens + stats.missTokens > 0
              ? (stats.hitTokens / (stats.hitTokens + stats.missTokens)) * 100
              : 0

          debugLog("Cache stats updated from message.updated event", {
            hit: usage.prompt_cache_hit_tokens,
            miss: usage.prompt_cache_miss_tokens,
            cumulativeRate: hitRate(stats.hitTokens, stats.missTokens),
          })
        }
      }
    },

    // -----------------------------------------------------------------------
    // tool.execute.before — Add cache-aware markers to sub-agent prompts
    //
    // When OpenCode invokes a sub-agent (the 'agent' tool), we prepend a
    // stable marker that helps DeepSeek's common-prefix detection across
    // multiple sub-agent invocations.
    // -----------------------------------------------------------------------
    "tool.execute.before": async (
      input: { tool?: string },
      output: { args?: Record<string, unknown> },
    ) => {
      if (input.tool === "agent" && output.args?.prompt) {
        const prompt = output.args.prompt as string
        // Prepend a stable cache-key marker (invisible to the model)
        if (!prompt.startsWith("<!-- ds-cache-v1 -->")) {
          output.args.prompt = `<!-- ds-cache-v1 -->\n${prompt}`
        }
      }
    },
  }
}

export default DeepSeekCachePlugin
