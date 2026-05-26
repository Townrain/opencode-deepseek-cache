import { createHash } from "crypto"
import { join } from "path"
import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { log, getLogPath } from "./logger.js"
import { normalizeSystemPrompt } from "./system-transform.js"
import { loadStatsFromJsonl, appendUsageToJsonl, getCacheReport } from "./cache-stats.js"

const DeepSeekCachePlugin: Plugin = async (ctx) => {
  // JSONL file path in project's .opencode directory
  const projectPath = ctx.directory || process.cwd()
  const jsonlPath = join(projectPath, ".opencode", "deepseek-cache-usage.jsonl")

  // Load historical stats from JSONL (survives restarts)
  const stats = loadStatsFromJsonl(jsonlPath)

  try {
    // Generate stable user_id from project path
    const projectHash = createHash("md5").update(projectPath).digest("hex").slice(0, 16)
    const stableUserId = `opencode-${projectHash}`

    log("=== Plugin Loaded ===", { projectPath, stableUserId, logPath: getLogPath() })

    return {
      // Register custom command /cache-stats
      config: async (config: any) => {
        try {
          config.command = config.command || {}
          config.command["cache-stats"] = {
            template: "Show DeepSeek cache statistics",
            description: "显示 DeepSeek 缓存命中统计面板",
          }
          log("Registered /cache-stats command")
        } catch (err) {
          log("ERROR in config hook", { error: String(err) })
        }
      },

      // Intercept /cache-stats command execution
      "command.execute.before": async (input, output) => {
        try {
          if (input.command === "cache-stats") {
            log("Intercepted /cache-stats command")
            const report = getCacheReport(stats)
            output.parts = [{
              type: "text",
              text: report,
            }] as any[]
            log("Returned cache stats directly")
          }
        } catch (err) {
          log("ERROR in command.execute.before", { error: String(err) })
        }
      },

      // Core 1: Inject stable user_id for cross-terminal cache pooling
      "chat.params": async (input, output) => {
        try {
          // Only apply to DeepSeek models
          if (!input.model?.id?.toLowerCase()?.includes("deepseek")) {
            return
          }

          // Inject stable user_id for cache isolation
          if (output && output.options) {
            output.options.user_id = stableUserId
            log("Injected user_id", { stableUserId, model: input.model?.id })
          }
        } catch (err) {
          log("ERROR in chat.params", { error: String(err) })
        }
      },

      // Core 2: System prompt normalization to prevent cache avalanche
      "experimental.chat.system.transform": async (_input, output) => {
        try {
          normalizeSystemPrompt(output.system)
          log("system.transform completed")
        } catch (err) {
          log("ERROR in system.transform", { error: String(err) })
        }
      },

      // NOTE: messages.transform is intentionally NOT used
      // OpenCode's native Compaction mechanism handles context management
      // Our sliding window would conflict with it

      // Event handler for cache statistics
      event: async ({ event }) => {
        try {
          if (event.type !== "session.idle") return

          const sessionID = (event as any).properties?.sessionID
          if (!sessionID) return

          // Fetch session data with timeout
          const timeout = 5000
          const response = await Promise.race([
            ctx.client.session.get({ path: { id: sessionID } }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("session.get timeout")), timeout)
            ),
          ]) as any

          if (response.error || !response.data) return

          const session = response.data as any
          
          // Only collect stats for DeepSeek models
          const modelID = session.model?.id?.toLowerCase?.() ?? ""
          if (!modelID.includes("deepseek")) return

          const tokens = session.tokens
          if (!tokens) return

          const hitTokens = tokens.cache?.read ?? 0
          // tokens.input is already pure miss tokens (non-cached input)
          // OpenCode's getUsage() subtracts cache tokens from inputTokens
          const missTokens = tokens.input ?? 0

          if (hitTokens === 0 && missTokens === 0) return

          // Record usage (in-memory)
          stats.totalHitTokens += hitTokens
          stats.totalMissTokens += missTokens
          stats.requestCount++

          // Persist to JSONL (survives restarts)
          appendUsageToJsonl(jsonlPath, hitTokens, missTokens)

          log("Recorded usage", {
            hitTokens,
            missTokens,
            requests: stats.requestCount,
            rate: ((stats.totalHitTokens / (stats.totalHitTokens + stats.totalMissTokens)) * 100).toFixed(1) + "%"
          })
        } catch (err) {
          log("ERROR in event handler", { error: String(err) })
        }
      },

      // Custom tool for cache statistics dashboard (AI-callable)
      tool: {
        cacheStats: tool({
          description: "查看 DeepSeek 上下文缓存命中统计面板",
          args: {},
          async execute() {
            try {
              return getCacheReport(stats)
            } catch (err) {
              log("ERROR in cacheStats", { error: String(err) })
              return "Error generating report"
            }
          },
        }),
      },
    }
  } catch (err) {
    log("FATAL ERROR in plugin initialization", { error: String(err) })
    return {}
  }
}

// Export as PluginModule (V1 format) with id and server
const pluginModule: PluginModule = {
  id: "deepseek-cache",
  server: DeepSeekCachePlugin,
}

export default pluginModule
