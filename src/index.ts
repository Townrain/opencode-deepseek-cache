import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { Plugin, PluginModule } from '@opencode-ai/plugin'
import { tool } from '@opencode-ai/plugin'
import type { Part } from '@opencode-ai/sdk'
import { getCacheReport, loadAllFromJsonl } from './cache-stats.js'
import { MAX_SESSION_BASELINES, SESSION_BASELINE_TTL_MS } from './constants.js'
import { EventHandler } from './event-handler.js'
import { findGitRoot, normalizeGitRoot } from './file-utils.js'
import { createFingerprintTracker } from './fingerprint.js'
import { dispose as disposeLogger, getLogPath, initLogger, log } from './logger.js'
import { isApplicableDeepSeek } from './model-filter.js'
import { PersistenceManager } from './persistence-manager.js'
import { SessionManager } from './session-manager.js'
import { StatsManager } from './stats-manager.js'
import { normalizeSystemPrompt } from './system-transform.js'

interface PluginConfig {
  command?: Record<string, { template: string; description?: string }>
}

const DeepSeekCachePlugin: Plugin = async (ctx) => {
  // JSONL file path in project's .opencode directory
  const projectPath = ctx.directory || process.cwd()
  const gitRoot = findGitRoot(projectPath)
  const jsonlPath = join(projectPath, '.opencode', 'deepseek-cache-usage.jsonl')

  // Initialize logger with project directory (was previously process.cwd() at import time)
  initLogger(projectPath)

  // M5 fix: Load all JSONL data in single pass (was 3-4 separate reads)
  const {
    stats,
    fingerprint: lastFp,
    model: lastModel,
    baselines: loadedBaselines,
  } = loadAllFromJsonl(jsonlPath)
  const fingerprintTracker = createFingerprintTracker(lastFp)

  const sessionManager = new SessionManager(MAX_SESSION_BASELINES, SESSION_BASELINE_TTL_MS)
  const persistenceManager = new PersistenceManager(jsonlPath)
  sessionManager.restoreFromMap(loadedBaselines)
  const statsManager = new StatsManager(stats, lastModel)

  const eventHandler = new EventHandler(
    ctx,
    sessionManager,
    statsManager,
    persistenceManager,
    fingerprintTracker,
    isApplicableDeepSeek,
  )

  // Bug fix #7: Disposed flag prevents hooks from running after plugin unload
  // Prevents stale closures from writing to disposed logger/corrupted state
  let pluginDisposed = false
  try {
    // Generate stable user_id from project path (SHA-256 for consistency with fingerprint.ts)
    const projectHash = createHash('sha256')
      .update(normalizeGitRoot(gitRoot || projectPath))
      .digest('hex')
      .slice(0, 16)
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
      // WHY: Direct output injection avoids an LLM round-trip for /cache-stats command.
      // SYMPTOM if broken: /cache-stats will trigger an LLM call instead of instant response.
      // DIAGNOSTIC: Check if /cache-stats response is instant (good) or has LLM delay (broken).
      'command.execute.before': async (input, output) => {
        try {
          if (pluginDisposed) return
          if (input.command === 'cache-stats') {
            log('Intercepted /cache-stats command')
            const currentFp = fingerprintTracker.getLastFingerprint()
            const report = getCacheReport(
              statsManager.getStats(),
              currentFp ?? undefined,
              statsManager.getCachedModelId() ?? undefined,
            )
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
      // WHY: Stable user_id enables cross-terminal KV Cache pooling (same project = same cache).
      // SYMPTOM if broken: Each terminal gets separate cache, hit rate drops ~20-30%.
      // DIAGNOSTIC: Compare /cache-stats across terminals — if hit rates diverge, user_id may not be forwarded.
      'chat.params': async (input, output) => {
        try {
          if (pluginDisposed) return
          // Only apply to DeepSeek models
          if (
            !isApplicableDeepSeek({
              apiUrl: input.model?.api?.url,
              providerID: input.provider?.info?.id,
            })
          ) {
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
          log('DEBUG: user_id injected — verify forwarding to DeepSeek', {
            user_id: stableUserId,
            note: 'Assumes OpenCode forwards output.options to provider',
          })
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
          if (pluginDisposed) return
          // Note: system.transform hook doesn't expose provider info (API limitation)
          // Only apiUrl is available for filtering in this hook
          if (!isApplicableDeepSeek({ apiUrl: _input.model?.api?.url })) return
          // Health check: track hook liveness for dashboard warning
          statsManager.incrementSystemTransformCount()

          const result = normalizeSystemPrompt(output.system)

          // Bug fix: Skip fingerprint computation for empty system prompts
          // Without this, empty system causes false 'prefix changed' warning
          if (!result.normalized) return

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
            const newPrefixChanges = statsManager.incrementPrefixChanges()
            persistenceManager.append(
              0,
              0,
              undefined,
              undefined,
              result.fingerprint,
              undefined,
              newPrefixChanges,
            )
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

      // Event handler: delegated to EventHandler class for cache statistics + balance refresh
      event: async ({ event }) => {
        try {
          if (pluginDisposed) return
          await eventHandler.handle(event)
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
              const report = getCacheReport(
                statsManager.getStats(),
                fingerprintTracker.getLastFingerprint() ?? undefined,
                statsManager.getCachedModelId() ?? undefined,
              )
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
        // Bug fix #7: Mark as disposed BEFORE closing logger to prevent
        // stale hook invocations from writing to disposed state
        pluginDisposed = true
        eventHandler.dispose()
        persistenceManager.dispose()
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
