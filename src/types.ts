/**
 * Shared type definitions for the token cache system.
 * Centralized here to break circular dependencies and provide
 * a single source of truth for interfaces used across modules.
 */

/** Cached token usage entry per session. */
export interface BaselineEntry {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  lastAccess: number
}

/** Tracks retry attempts with backoff timing. */
export interface RetryState {
  count: number
  nextRetryAt: number
}

/** Aggregate cache statistics for the current period. */
export interface CacheStats {
  totalOutputTokens: number
  totalHitTokens: number
  totalMissTokens: number
  totalWriteTokens: number
  requestCount: number
  prefixChanges: number
  firstRequestTime: number | null
  lastRequestTime: number | null
  previousHitRate: number | null
  lastMessageStats?: MessageStats
  systemTransformCallCount: number
  lastSystemTransformTime: number | null
}

/** Per-message token usage breakdown. */
export interface MessageStats {
  hitTokens: number
  missTokens: number
  writeTokens: number
  outputTokens: number
}

/** Single usage record written to the history log. */
export interface UsageRecord {
  t: number
  hit: number
  miss: number
  write?: number
  output?: number
  fp?: string
  model?: string
  type?: 'fingerprint' | 'usage' | 'baseline'
  pc?: number
}

/** Baseline record persisted per session. */
export interface BaselineRecord {
  t: number
  type: 'baseline'
  sessionID: string
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  fp?: string
}
