/**
 * Fingerprint caching for system prompt stability — inspired by Reasonix ImmutablePrefix.
 * 
 * Tracks whether the system prompt has changed between turns.
 * When the fingerprint changes, it indicates a cache miss is likely.
 */

import { createHash } from "crypto"
import { FINGERPRINT_LENGTH } from "./constants.js"

export interface FingerprintResult {
  /** Current fingerprint hash */
  fingerprint: string
  /** Whether the fingerprint changed since last check */
  changed: boolean
  /** Previous fingerprint (null if first computation) */
  previous: string | null
}

/**
 * Memoized fingerprint tracker for system prompt stability.
 * 
 * Usage:
 * ```typescript
 * const tracker = createFingerprintTracker()
 * 
 * // In system.transform hook:
 * const result = tracker.compute(normalizedSystem)
 * if (result.changed) {
 *   log("Prefix changed — cache miss expected", { previous: result.previous })
 * }
 * ```
 */
export interface FingerprintTracker {
  compute(system: string): FingerprintResult
  getLastFingerprint(): string | null
  hasChanged(system: string): boolean
}

export function createFingerprintTracker(): FingerprintTracker {
  let lastFingerprint: string | null = null

  function computeHash(system: string): string {
    return createHash("sha256")
      .update(system)
      .digest("hex")
      .slice(0, FINGERPRINT_LENGTH)
  }

  return {
    compute(system: string): FingerprintResult {
      const current = computeHash(system)
      const changed = lastFingerprint !== null && lastFingerprint !== current
      const previous = lastFingerprint
      lastFingerprint = current
      return { fingerprint: current, changed, previous }
    },

    getLastFingerprint(): string | null {
      return lastFingerprint
    },

    hasChanged(system: string): boolean {
      const current = computeHash(system)
      return lastFingerprint !== null && lastFingerprint !== current
    }
  }
}

/**
 * Lightweight fingerprint for debugging — no state tracking.
 * Returns first N hex chars of SHA-256 hash.
 */
export function computeFingerprint(system: string): string {
  return createHash("sha256")
    .update(system)
    .digest("hex")
    .slice(0, FINGERPRINT_LENGTH)
}
