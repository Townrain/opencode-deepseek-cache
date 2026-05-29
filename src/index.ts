import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { Plugin, PluginModule } from '@opencode-ai/plugin'
import { tool } from '@opencode-ai/plugin'
import type { Part } from '@opencode-ai/sdk'
import {
  appendUsageToJsonl,
  getCacheReport,
  getLastFingerprintFromJsonl,
  loadBaselinesFromJsonl,
  loadStatsFromJsonl,
  saveBaselineToJsonl,
} from './cache-stats.js'
import { findGitRoot } from './file-utils.js'
import {
  MAX_SESSION_BASELINES,
  SESSION_BASELINE_TTL_MS,
} from './constants.js'
import { createFingerprintTracker } from './fingerprint.js'
import { dispose as disposeLogger, getLogPath, initLogger, log } from './logger.js'
import { isApplicableDeepSeek } from './model-filter.js'
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
  const gitRoot = findGitRoot(projectPath)
  const jsonlPath = join(projectPath, '.opencode', 'deepseek-cache-usage.jsonl')

  // Initialize logger with project directory (was previously process.cwd() at import time)
  initLogger(projectPath)

  // Load historical stats from JSONL (survives restarts)
  const stats = loadStatsFromJsonl(jsonlPath)

  // Fingerprint tracker for prefix stability monitoring (restore from history if available)
  const { fingerprint: lastFp, model: lastModel } = getLastFingerprintFromJsonl(jsonlPath)
  const fingerprintTracker = createFingerprintTracker(lastFp)

  // M5: Cached model ID — initialized from JSONL history so /cache-stats shows correct model
  // even before first session.idle event. Updated on each session.idle.
  let cachedModelId: string | null = lastModel

  // Delta tracking: session.tokens aggregates ALL models. We track increments
  // so tokens from non-DeepSeek models between checks are bounded, not cumulative.
  type BaselineEntry = { input: number; cacheRead: number; lastAccess: number }
  const sessionBaselines = new Map<string, BaselineEntry>()
  // Restore baselines from JSONL (prevents double-counting on reload)
  const loadedBaselines = loadBaselinesFromJsonl(jsonlPath)
  loadedBaselines.forEach((val, key) => {
    if (!sessionBaselines.has(key)) sessionBaselines.set(key, { ...val, lastAccess: Date.now() })
  })
  try {
    // Generate stable user_id from project path (SHA-256 for consistency with fingerprint.ts)
    const projectHash = createHash('sha256').update(gitRoot || projectPath).digest('hex').slice(0, 16)
    const stableUserId = `opencode-${projectHash}`

    log('=== Plugin Loaded ===', { projectPath, gitRoot, stableUserId, logPath: getLogPath() })
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
      // Defensive: if output.parts assignment fails, the LLM will handle cache-stats via the tool instead
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
            } else {
              log(
                'WARNING: output or output.parts unavailable — /cache-stats command may not short-circuit LLM call',
              )
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
          if (!isApplicableDeepSeek({ apiUrl: input.model?.api?.url, providerID: input.provider?.info?.id })) {
            return
          }
          // GDPR opt-out: skip user_id injection when DEEPSEEK_CACHE_NO_USER_ID is set
          if (process.env.DEEPSEEK_CACHE_NO_USER_ID?.toLowerCase() === 'true') {
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
          log('DEBUG: user_id injected — verify forwarding to DeepSeek', { user_id: stableUserId, note: 'Assumes OpenCode forwards output.options to provider' })
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
          if (!isApplicableDeepSeek({ apiUrl: _input.model?.api?.url })) return

          const result = normalizeSystemPrompt(output.system)

          const fpResult = fingerprintTracker.compute(result.normalized)

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
            appendUsageToJsonl(jsonlPath, 0, 0, result.fingerprint, undefined, stats.prefixChanges)
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
          let timer: ReturnType<typeof setTimeout> | undefined
          try {
            const sessionP = ctx.client.session.get({ path: { id: sessionID } })
            sessionP.catch(() => {}) // prevent UnhandledPromiseRejection if timeout fires first
            const timerP = new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('session.get timeout')), timeout)
            })
            const response = (await Promise.race([sessionP, timerP])) as SessionResponse

            if (response.error || !response.data) return

            const session = response.data as SessionData

            const tokens = session.tokens
            if (!tokens) return

            const providerID = session.model?.providerID?.toLowerCase?.() ?? ''

            // Cache model ID for pricing-aware reports
            cachedModelId = session.model?.id ?? null

            // M6: Distinguish cache.read undefined (API didn't report) from 0
            const cacheRead = tokens.cache?.read
            const hitTokens = cacheRead ?? 0
            const missTokens = tokens.input ?? 0
            if (!Number.isFinite(hitTokens) || !Number.isFinite(missTokens) || hitTokens < 0 || missTokens < 0) {
              log('WARNING: Invalid token values, skipping record', { hitTokens, missTokens, sessionID })
              return
            }

            // Per-session delta tracking: each session has its own baseline
            const prev = sessionBaselines.get(sessionID)

            // M6: If cache.read is undefined (API didn't report it), update baseline but skip stats
            if (cacheRead === undefined) {
              log('DEBUG: cache.read unavailable — baseline updated, stats skipped', { sessionID, modelID: session.model?.id })
              sessionBaselines.set(sessionID, { input: missTokens, cacheRead: prev?.cacheRead ?? 0, lastAccess: Date.now() })
              return
            }

            // H3: Always update baselines to track cumulative tokens across all models
            sessionBaselines.set(sessionID, { input: missTokens, cacheRead: hitTokens, lastAccess: Date.now() })
            // Sweep expired baselines before size check
            for (const [sid, entry] of sessionBaselines) {
              if (Date.now() - entry.lastAccess > SESSION_BASELINE_TTL_MS) {
                sessionBaselines.delete(sid)
              }
            }
            // Persist baseline to JSONL (prevents double-counting on reload)
            const currentFpForBaseline = fingerprintTracker.getLastFingerprint()
            saveBaselineToJsonl(jsonlPath, sessionID, missTokens, hitTokens, currentFpForBaseline ?? undefined)
            if (sessionBaselines.size > MAX_SESSION_BASELINES) {
              const oldest = sessionBaselines.keys().next().value
              if (oldest) sessionBaselines.delete(oldest)
            }

            // Only record delta for official DeepSeek models
            if (!isApplicableDeepSeek({ providerID })) {
              log('Stats skipped — non-official model (baseline updated)', {
                id: session.model?.id,
                providerID,
              })
              return
            }

            const deltaHit = Math.max(0, hitTokens - (prev?.cacheRead ?? 0))
            const deltaMiss = Math.max(0, missTokens - (prev?.input ?? 0))

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
            appendUsageToJsonl(
              jsonlPath,
              deltaHit,
              deltaMiss,
              currentFp ?? undefined,
              cachedModelId ?? undefined,
            )

            // Avoid NaN% when both hit and miss are 0
            const total = stats.totalHitTokens + stats.totalMissTokens
            const rate =
              total > 0 ? `${((stats.totalHitTokens / total) * 100).toFixed(1)}%` : '0.0%'
            log('Recorded usage', {
              deltaHit,
              deltaMiss,
              requests: stats.requestCount,
              rate,
              fingerprint: currentFp,
            })
          } finally {
            if (timer) clearTimeout(timer)
          }
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
      // Dispose hook: close log stream on plugin unload
      dispose: () => {
        disposeLogger()
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
