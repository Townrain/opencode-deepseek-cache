/**
 * Fingerprint caching for system prompt stability — inspired by Reasonix ImmutablePrefix.
 *
 * Tracks whether the system prompt has changed between turns.
 * When the fingerprint changes, it indicates a cache miss is likely.
 */
import { createHash } from "crypto";
import { FINGERPRINT_LENGTH } from "./constants.js";
export function createFingerprintTracker() {
    let lastFingerprint = null;
    function computeHash(system) {
        return createHash("sha256")
            .update(system)
            .digest("hex")
            .slice(0, FINGERPRINT_LENGTH);
    }
    return {
        compute(system) {
            const current = computeHash(system);
            const changed = lastFingerprint !== null && lastFingerprint !== current;
            const previous = lastFingerprint;
            lastFingerprint = current;
            return { fingerprint: current, changed, previous };
        },
        getLastFingerprint() {
            return lastFingerprint;
        },
        hasChanged(system) {
            const current = computeHash(system);
            return lastFingerprint !== null && lastFingerprint !== current;
        }
    };
}
/**
 * Lightweight fingerprint for debugging — no state tracking.
 * Returns first N hex chars of SHA-256 hash.
 */
export function computeFingerprint(system) {
    return createHash("sha256")
        .update(system)
        .digest("hex")
        .slice(0, FINGERPRINT_LENGTH);
}
//# sourceMappingURL=fingerprint.js.map