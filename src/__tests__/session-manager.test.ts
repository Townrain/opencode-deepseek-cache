import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionManager } from '../session-manager.js'

describe('SessionManager — Defect Fixes', () => {
  let manager: SessionManager

  beforeEach(() => {
    manager = new SessionManager(1000, 86400000) // maxBaselines=1000, ttlMs=24h
  })

  describe('M6: evictLRU cleans retryStates', () => {
    it('removes retry state when evicting session', () => {
      // Fill to capacity
      for (let i = 0; i < 1000; i++) {
        manager.setBaseline(`session-${i}`, {
          input: 100,
          cacheRead: 500,
          cacheWrite: 0,
          output: 200,
          lastAccess: Date.now() - i * 1000,
        })
      }

      // Add retry state for session-999 (oldest)
      manager.recordRetryFailure('session-999', 3, 1000)

      // Trigger eviction by adding new session and calling evictLRU
      manager.setBaseline('session-new', {
        input: 100,
        cacheRead: 500,
        cacheWrite: 0,
        output: 200,
        lastAccess: Date.now(),
      })
      manager.evictLRU()

      // session-999 should be evicted, including its retry state
      expect(manager.getBaseline('session-999')).toBeUndefined()
      // Verify retry state was also cleaned (shouldSkipDueToRetry should return false)
      expect(manager.shouldSkipDueToRetry('session-999')).toBe(false)
    })
  })

  describe('M13: restoreFromMap populates lastWrites', () => {
    it('shouldPersistBaseline returns false for unchanged tokens after restore', () => {
      const baselines = new Map([
        [
          'session-1',
          { input: 100, cacheRead: 500, cacheWrite: 0, output: 200, lastAccess: Date.now() },
        ],
      ])

      manager.restoreFromMap(baselines)

      // Same tokens — should not need persistence
      const result = manager.shouldPersistBaseline('session-1', {
        input: 100,
        cacheRead: 500,
        cacheWrite: 0,
        output: 200,
      })

      expect(result).toBe(false)
    })
  })

  describe('M14: permanently backed-off entries expire', () => {
    it('cleans up permanently backed-off entries after TTL', () => {
      // Record max retries to trigger permanent backoff
      manager.recordRetryFailure('session-1', 3, 1000)
      manager.recordRetryFailure('session-1', 3, 1000)
      manager.recordRetryFailure('session-1', 3, 1000)
      manager.recordRetryFailure('session-1', 3, 1000) // exceeds maxRetries=3

      // Should be permanently backed off
      expect(manager.shouldSkipDueToRetry('session-1')).toBe(true)

      // Fast-forward past TTL (24h)
      vi.useFakeTimers()
      vi.advanceTimersByTime(86400001) // 24h + 1ms

      // sweepExpired should clean it up
      manager.sweepExpired()

      expect(manager.shouldSkipDueToRetry('session-1')).toBe(false)
      vi.useRealTimers()
    })
  })
})
