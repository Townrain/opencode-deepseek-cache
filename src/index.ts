import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { Plugin, PluginModule } from '@opencode-ai/plugin'
import { tool } from '@opencode-ai/plugin'
import type { Part } from '@opencode-ai/sdk'
import { appendUsageToJsonl, getCacheReport, loadStatsFromJsonl } from './cache-stats.js'
import { createFingerprintTracker } from './fingerprint.js'
import { getLogPath, initLogger, log } from './logger.js'
import { isOfficialDeepSeekEndpoint, isOfficialDeepSeekProvider } from './model-filter.js'
import { normalizeSystemPrompt } from './system-transform.js'

interface PluginConfig {
  command?: Record<string, { template: string; description?: string }>
}

interface SessionResponse {
  error?: unknown
  data?: Record<string, unknown>
}

interface SessionData {
  tokens?: {
    cache?: { read?: number }
    input?: number
  }
  model?: {
    id?: string
    providerID?: string
  }
}

const DeepSeekCachePlugin: Plugin = async (ctx) => {
  // JSONL file path in project's .opencode directory
  const projectPath = ctx.directory || process.cwd()
  const jsonlPath = join(projectPath, '.opencode', 'deepseek-cache-usage.jsonl')

  // Initialize logger with project directory (was previously process.cwd() at import time)
  initLogger(projectPath)

  // Load historical stats from JSONL (survives restarts)
  const stats = loadStatsFromJsonl(jsonlPath)

  // Fingerprint tracker for prefix stability monitoring
  const fingerprintTracker = createFingerprintTracker()

  // Cached model ID (set on session.idle, used by /cache-stats and tool)
  let cachedModelId: string | null = null

  // Delta tracking: session.tokens aggregates ALL models. We track increments
  // so tokens from non-DeepSeek models between checks are bounded, not cumulative.
  const sessionBaselines = new Map<string, { input: number; cacheRead: number }>()
  try {
    // Generate stable user_id from project path (SHA-256 for consistency with fingerprint.ts)
    const projectHash = createHash('sha256').update(projectPath).digest('hex').slice(0, 16)
    const stableUserId = `opencode-${projectHash}`

    log('=== Plugin Loaded ===', { projectPath, stableUserId, logPath: getLogPath() })
    return {
      // Register custom command /cache-stats
      config: async (config: PluginConfig) => {
        try {
          config.command = config.command || {}
          config.command['cache-stats'] = {
            template: '调用 cacheStats 工具获取缓存统计，然后将返回的内容原样展示给用户',
            description: '显示 DeepSeek 缓存命中统计面板',
          }
          log('Registered /cache-stats command')
        } catch (err) {
          log('ERROR in config hook', { error: String(err) })
        }
      },

      // Intercept /cache-stats command execution
      // HACK: output.parts assignment relies on OpenCode's internal behavior.
      // The hook's type signature doesn't guarantee this will short-circuit the LLM call.
      // If OpenCode changes how command.execute.before handles output.parts, this will fail silently.
      'command.execute.before': async (input, output) => {
        try {
          if (input.command === 'cache-stats') {
            log('Intercepted /cache-stats command')
            const currentFp = fingerprintTracker.getLastFingerprint()
            const report = getCacheReport(stats, currentFp ?? undefined, cachedModelId ?? undefined)
            // Try to output directly via parts
            if (output && typeof output === 'object') {
              output.parts = [
                {
                  type: 'text',
                  text: report,
                },
              ] as Part[]
              log('Set output.parts for cache-stats')
            }
          }
        } catch (err) {
          log('ERROR in command.execute.before', { error: String(err) })
        }
      },

      // Core 1: Inject stable user_id for cross-terminal cache pooling
      // HACK: output.options.user_id relies on OpenCode passing this through to DeepSeek's API.
      // The hook's type signature shows output.options is Record<string, any>, but there's no
      // guarantee that OpenCode will forward user_id to the provider. If OpenCode changes how
      // it handles provider-specific options, this injection will fail silently.
      'chat.params': async (input, output) => {
        try {
          // Only apply to DeepSeek models
          if (!isOfficialDeepSeekEndpoint(input.model?.api?.url ?? '')) {
            return
          }
          // GDPR opt-out: skip user_id injection when DEEPSEEK_CACHE_NO_USER_ID is set
          if (process.env.DEEPSEEK_CACHE_NO_USER_ID === 'true') {
            log('user_id injection disabled (DEEPSEEK_CACHE_NO_USER_ID)')
            return
          }
          // Inject stable user_id for cache isolation
          if (!output?.options) {
            log(
              'WARNING: output.options unavailable — user_id injection skipped. OpenCode API may have changed.',
            )
            return
          }
          output.options.user_id = stableUserId
          log('Injected user_id', {
            stableUserId,
            model: input.model?.id,
            provider: input.provider?.info?.id,
          })
        } catch (err) {
          log('ERROR in chat.params', { error: String(err) })
        }
      },

      // Core 2: System prompt normalization to prevent cache avalanche
      // Enhanced from Reasonix ImmutablePrefix with fingerprint tracking
      'experimental.chat.system.transform': async (_input, output) => {
        try {
          if (!isOfficialDeepSeekEndpoint(_input.model?.api?.url ?? '')) return

          const result = normalizeSystemPrompt(output.system)

          const fpResult = fingerprintTracker.compute(result.fingerprint)

          if (result.changed) {
            log('System prompt normalized', {
              replacements: result.replacements,
              fingerprint: result.fingerprint,
              prefixChanged: fpResult.changed,
              previousFingerprint: fpResult.previous,
            })
          }

          if (fpResult.changed) {
            stats.prefixChanges++
            log('⚠️ Prefix fingerprint changed — cache miss expected', {
              previous: fpResult.previous,
              current: fpResult.fingerprint,
            })
          }
        } catch (err) {
          log('ERROR in system.transform', { error: String(err) })
        }
      },
      // NOTE: messages.transform is intentionally NOT used
      // OpenCode's native Compaction mechanism handles context management
      // Our sliding window would conflict with it

      // Event handler for cache statistics + balance refresh
      event: async ({ event }) => {
        try {
          if (event.type !== 'session.idle') return

          // TypeScript can narrow the type after the type check above
          // EventSessionIdle has properties.sessionID as required field
          const sessionID = (event as { type: string; properties?: { sessionID?: string } })
            .properties?.sessionID
          if (!sessionID) return

          // Fetch session data with timeout
          const timeout = 5000
          const response = (await Promise.race([
            ctx.client.session.get({ path: { id: sessionID } }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('session.get timeout')), timeout),
            ),
          ])) as SessionResponse

          if (response.error || !response.data) return

          const session = response.data as SessionData

          // Only collect stats for official DeepSeek models
          const providerID = session.model?.providerID?.toLowerCase?.() ?? ''
          if (!isOfficialDeepSeekProvider(providerID)) {
            log('Stats skipped — non-official model', {
              id: session.model?.id,
              providerID,
            })
            return
          }

          // Cache model ID for pricing-aware reports
          cachedModelId = session.model?.id ?? null

          const tokens = session.tokens
          if (!tokens) return

          const hitTokens = tokens.cache?.read ?? 0
          const missTokens = tokens.input ?? 0
          // Per-session delta tracking: each session has its own baseline
          const prev = sessionBaselines.get(sessionID)
          const deltaHit = Math.max(0, hitTokens - (prev?.cacheRead ?? 0))
          const deltaMiss = Math.max(0, missTokens - (prev?.input ?? 0))
          sessionBaselines.set(sessionID, { input: missTokens, cacheRead: hitTokens })

          if (deltaHit === 0 && deltaMiss === 0) return

          // Record usage (in-memory) — use deltas, not absolute session.tokens
          stats.totalHitTokens += deltaHit
          stats.totalMissTokens += deltaMiss
          stats.requestCount++

          // Update time tracking
          const now = Date.now()
          if (!stats.firstRequestTime) stats.firstRequestTime = now
          stats.lastRequestTime = now

          // Persist to JSONL with fingerprint (survives restarts)
          const currentFp = fingerprintTracker.getLastFingerprint()
          appendUsageToJsonl(jsonlPath, deltaHit, deltaMiss, currentFp ?? undefined, cachedModelId ?? undefined)

          // Avoid NaN% when both hit and miss are 0
          const total = stats.totalHitTokens + stats.totalMissTokens
          const rate = total > 0 ? `${((stats.totalHitTokens / total) * 100).toFixed(1)}%` : '0.0%'
          log('Recorded usage', {
            deltaHit,
            deltaMiss,
            requests: stats.requestCount,
            rate,
            fingerprint: currentFp,
          })
        } catch (err) {
          log('ERROR in event handler', { error: String(err) })
        }
      },

      // Custom tool for cache statistics dashboard (AI-callable)
      tool: {
        cacheStats: tool({
          description: '查看 DeepSeek 缓存命中统计面板，返回 Markdown 格式的报告。',
          args: {},
          async execute() {
            try {
              const report = getCacheReport(stats, undefined, cachedModelId ?? undefined)
              log('Generated cache report', { length: report.length })
              return report
            } catch (err) {
              log('ERROR in cacheStats', { error: String(err) })
              return 'Error generating report'
            }
          },
        }),
      },
    }
  } catch (err) {
    log('FATAL ERROR in plugin initialization', { error: String(err) })
    return {}
  }
}

// Export as PluginModule (V1 format) with id and server
const pluginModule: PluginModule = {
  id: 'deepseek-cache',
  server: DeepSeekCachePlugin,
}

export default pluginModule
