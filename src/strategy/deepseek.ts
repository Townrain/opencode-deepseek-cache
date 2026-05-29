/**
 * DeepSeek-specific cache strategy.
 *
 * DeepSeek's caching model:
 * - Byte-level prefix matching (64-token minimum)
 * - 50x price differential between cache miss and cache hit (¥1.0 vs ¥0.02 per 1M tokens for flash)
 * - Optional user_id field for cross-session cache pooling
 *
 * Key optimizations:
 * - Dynamic content normalization (timestamps/UUIDs/dates/versions/paths)
 * - Stable user_id derived from project path (SHA-256 hash)
 * - Applicability filter: only applies to official DeepSeek endpoints
 */

import { createHash } from 'node:crypto'
import { computeFingerprint } from '../fingerprint.js'
import { isOfficialDeepSeekEndpoint, isOfficialDeepSeekProvider } from '../model-filter.js'
import { normalizeSystemPrompt } from '../system-transform.js'
import type { CacheContext, CacheStrategy, ModelInfo, ProviderOptions } from './types.js'

/**
 * Create a CacheStrategy configured for DeepSeek.
 *
 * @param projectPath - Project directory; used to derive stable user_id.
 *                      The hash is deterministic (SHA-256, first 16 hex chars),
 *                      so the same project always produces the same user_id.
 */
export function createDeepSeekStrategy(projectPath: string): CacheStrategy {
  const projectHash = createHash('sha256').update(projectPath).digest('hex').slice(0, 16)
  const stableUserId = `opencode-${projectHash}`

  return {
    name: 'deepseek',

    normalizeSystem(system) {
      return normalizeSystemPrompt(system)
    },

    computeFingerprint(system) {
      return computeFingerprint(system)
    },

    getProviderOptions(_context?: CacheContext): ProviderOptions | undefined {
      // GDPR opt-out: respect environment variable
      if (process.env.DEEPSEEK_CACHE_NO_USER_ID === 'true') {
        return undefined
      }
      return { user_id: stableUserId }
    },

    isApplicable(model: ModelInfo): boolean {
      // Primary path: hook-based invocations have apiUrl
      if (isOfficialDeepSeekEndpoint(model.apiUrl ?? '')) return true
      // Fallback path: event handler has providerID but no apiUrl
      if (model.providerId && isOfficialDeepSeekProvider(model.providerId)) return true
      return false
    },
  }
}
