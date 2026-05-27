/**
 * Fingerprint caching for system prompt stability — inspired by Reasonix ImmutablePrefix.
 *
 * Tracks whether the system prompt has changed between turns.
 * When the fingerprint changes, it indicates a cache miss is likely.
 */
export interface FingerprintResult {
    /** Current fingerprint hash */
    fingerprint: string;
    /** Whether the fingerprint changed since last check */
    changed: boolean;
    /** Previous fingerprint (null if first computation) */
    previous: string | null;
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
    compute(system: string): FingerprintResult;
    getLastFingerprint(): string | null;
    hasChanged(system: string): boolean;
}
export declare function createFingerprintTracker(): FingerprintTracker;
/**
 * Lightweight fingerprint for debugging — no state tracking.
 * Returns first N hex chars of SHA-256 hash.
 */
export declare function computeFingerprint(system: string): string;
//# sourceMappingURL=fingerprint.d.ts.map