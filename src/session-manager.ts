/**
 * Session state manager for token baselines, retry backoff, and LRU eviction.
 * Extracted from index.ts to provide a standalone, testable session lifecycle.
 */
import type { BaselineEntry, RetryState } from './types.js'

/** Snapshot of token usage for a single request. */
export interface TokenSnapshot {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

/**
 * Manages per-session baselines, retry states, and LRU eviction.
 *
 * Responsibilities:
 * - Track token baselines per session for delta computation
 * - Manage exponential backoff retry states
 * - Evict least-recently-used sessions when capacity is exceeded
 * - Sweep expired baselines and orphaned retry states
 */
export class SessionManager {
  private baselines = new Map<string, BaselineEntry>()
  private lastWrites = new Map<string, TokenSnapshot>()
  private retryStates = new Map<string, RetryState>()

  constructor(
    private maxBaselines: number,
    private baselineTtlMs: number,
  ) {}

  /** Retrieve the baseline entry for a session, or undefined if none exists. */
  getBaseline(sessionId: string): BaselineEntry | undefined {
    return this.baselines.get(sessionId)
  }

  /** Store a baseline entry for a session. */
  setBaseline(sessionId: string, entry: BaselineEntry): void {
    this.baselines.set(sessionId, entry)
  }

  /** Update baseline from a token snapshot, setting lastAccess to now. */
  updateBaselineFromTokens(sessionId: string, tokens: TokenSnapshot): void {
    this.baselines.set(sessionId, {
      input: tokens.input,
      cacheRead: tokens.cacheRead,
      cacheWrite: tokens.cacheWrite,
      output: tokens.output,
      lastAccess: Date.now(),
    })
  }

  /** Check whether a session should be skipped due to active retry backoff. */
  shouldSkipDueToRetry(sessionId: string): boolean {
    const state = this.retryStates.get(sessionId)
    if (!state) return false
    return Date.now() < state.nextRetryAt
  }

  /**
   * Record a retry failure with exponential backoff.
   * Once maxRetries is exceeded, the session is permanently backed off.
   */
  recordRetryFailure(sessionId: string, maxRetries: number, baseBackoffMs: number): void {
    const prev = this.retryStates.get(sessionId) ?? { count: 0, nextRetryAt: 0 }
    const count = prev.count + 1
    if (count > maxRetries) {
      this.retryStates.set(sessionId, { count, nextRetryAt: Number.MAX_SAFE_INTEGER })
      return
    }
    const backoff = baseBackoffMs * 2 ** (count - 1)
    this.retryStates.set(sessionId, { count, nextRetryAt: Date.now() + backoff })
  }

  /** Clear retry state for a session, allowing immediate retry. */
  clearRetryState(sessionId: string): void {
    this.retryStates.delete(sessionId)
  }

  /** Remove baselines and associated state that have exceeded the TTL.
   * Also cleans up permanently backed-off retry states that are orphaned. */
  sweepExpired(): void {
    const now = Date.now()
    for (const [sid, entry] of this.baselines) {
      if (now - entry.lastAccess > this.baselineTtlMs) {
        this.baselines.delete(sid)
        this.lastWrites.delete(sid)
        this.retryStates.delete(sid)
      }
    }
    // Also clean up permanently backed-off orphan retry states
    for (const [sid, state] of this.retryStates) {
      if (state.nextRetryAt === Number.MAX_SAFE_INTEGER && !this.baselines.has(sid)) {
        this.retryStates.delete(sid)
        this.lastWrites.delete(sid)
      }
    }
  }

  /** Remove retry states whose baseline no longer exists (orphaned entries). */
  sweepOrphanedRetries(): void {
    for (const [sid] of this.retryStates) {
      if (!this.baselines.has(sid)) {
        this.retryStates.delete(sid)
        this.lastWrites.delete(sid)
      }
    }
  }

  /** Evict least-recently-used baselines until within maxBaselines capacity. */
  evictLRU(): void {
    while (this.baselines.size > this.maxBaselines) {
      let oldestSession: string | null = null
      let oldestAccess = Infinity
      for (const [sid, entry] of this.baselines) {
        if (entry.lastAccess < oldestAccess) {
          oldestAccess = entry.lastAccess
          oldestSession = sid
        }
      }
      if (!oldestSession) break
      this.baselines.delete(oldestSession)
      this.lastWrites.delete(oldestSession)
      this.retryStates.delete(oldestSession)
    }
  }

  /**
   * Check whether the baseline should be persisted (i.e., tokens differ from last write).
   * Returns true if no prior write exists or if any token field changed.
   */
  shouldPersistBaseline(sessionId: string, tokens: TokenSnapshot): boolean {
    const lastWrite = this.lastWrites.get(sessionId)
    if (!lastWrite) return true
    return (
      lastWrite.input !== tokens.input ||
      lastWrite.cacheRead !== tokens.cacheRead ||
      lastWrite.cacheWrite !== tokens.cacheWrite ||
      lastWrite.output !== tokens.output
    )
  }

  /** Record that a baseline was persisted with the given token snapshot. */
  markBaselinePersisted(sessionId: string, tokens: TokenSnapshot): void {
    this.lastWrites.set(sessionId, { ...tokens })
  }

  /** Restore baselines from a deserialized map (e.g., loaded from JSONL). */
  restoreFromMap(baselines: Map<string, BaselineEntry>): void {
    for (const [key, val] of baselines) {
      if (!this.baselines.has(key)) {
        this.baselines.set(key, { ...val, lastAccess: val.lastAccess ?? Date.now() })
        this.lastWrites.set(key, {
          input: val.input,
          cacheRead: val.cacheRead,
          cacheWrite: val.cacheWrite,
          output: val.output,
        })
      }
    }
  }
}
