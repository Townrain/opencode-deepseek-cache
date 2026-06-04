import type { CacheStats, MessageStats } from './types.js'

/**
 * Token delta values for a single request.
 * Used to update aggregate statistics incrementally.
 */
export interface DeltaTokens {
  /** Tokens served from cache (cache hit) */
  hit: number
  /** Tokens requiring computation (cache miss) */
  miss: number
  /** Tokens written to cache */
  write: number
  /** Tokens in the response output */
  output: number
}

/**
 * Manages cache statistics and related state.
 *
 * Encapsulates the stats object mutation logic previously spread
 * across the main index.ts file, providing a clean interface for
 * recording token deltas and tracking model state.
 *
 * @example
 * ```typescript
 * const stats = new StatsManager(initialStats, null)
 * stats.recordDelta({ hit: 1000, miss: 50, write: 0, output: 200 })
 * console.log(stats.getStats().requestCount) // 1
 * ```
 */
export class StatsManager {
  private stats: CacheStats
  private cachedModelId: string | null

  /**
   * Create a new StatsManager instance.
   *
   * @param initialStats - Initial cache statistics (typically loaded from JSONL)
   * @param initialModelId - Initial cached model ID, or null if unknown
   */
  constructor(initialStats: CacheStats, initialModelId: string | null) {
    this.stats = { ...initialStats }
    this.cachedModelId = initialModelId
  }

  /**
   * Record a token delta from a single request.
   *
   * Updates aggregate statistics including total tokens, request count,
   * last message stats, hit rate calculation, and timing information.
   *
   * @param delta - Token counts for this request
   */
  recordDelta(delta: DeltaTokens): void {
    this.stats.totalHitTokens += delta.hit
    this.stats.totalMissTokens += delta.miss
    this.stats.totalWriteTokens += delta.write
    this.stats.totalOutputTokens += delta.output
    this.stats.requestCount++

    this.stats.lastMessageStats = {
      hitTokens: delta.hit,
      missTokens: delta.miss,
      writeTokens: delta.write,
      outputTokens: delta.output,
    }

    const cumulativeTotal = this.stats.totalHitTokens + this.stats.totalMissTokens
    this.stats.previousHitRate =
      cumulativeTotal > 0 ? (this.stats.totalHitTokens / cumulativeTotal) * 100 : 0

    const now = Date.now()
    if (!this.stats.firstRequestTime) this.stats.firstRequestTime = now
    this.stats.lastRequestTime = now
  }

  /**
   * Get a copy of the current cache statistics.
   *
   * @returns A shallow copy of the stats object
   */
  getStats(): Readonly<CacheStats> {
    return { ...this.stats }
  }

  /**
   * Get the currently cached model ID.
   *
   * @returns The model ID string, or null if not yet set
   */
  getCachedModelId(): string | null {
    return this.cachedModelId
  }

  /**
   * Set the cached model ID.
   *
   * @param modelId - The model ID to cache, or null to clear
   */
  setCachedModelId(modelId: string | null): void {
    this.cachedModelId = modelId
  }

  /**
   * Get the per-message stats from the last recorded request.
   *
   * @returns The last message stats, or undefined if no request has been recorded
   */
  getLastMessageStats(): MessageStats | undefined {
    return this.stats.lastMessageStats
  }

  /**
   * Increment the system transform call count and record the timestamp.
   *
   * Called when the system.transform hook is invoked to track
   * how many times system prompt normalization has been applied.
   */
  incrementSystemTransformCount(): void {
    this.stats.systemTransformCallCount++
    this.stats.lastSystemTransformTime = Date.now()
  }

  /**
   * Increment prefix change counter and return the new value.
   *
   * Called by system.transform hook when fingerprint changes.
   */
  incrementPrefixChanges(): number {
    this.stats.prefixChanges++
    return this.stats.prefixChanges
  }

  /**
   * Calculate the current cumulative cache hit rate as a percentage.
   *
   * @returns Hit rate in [0, 100], or 0 if no requests have been recorded
   */
  getHitRate(): number {
    const total = this.stats.totalHitTokens + this.stats.totalMissTokens
    return total > 0 ? (this.stats.totalHitTokens / total) * 100 : 0
  }
}
