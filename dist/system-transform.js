/**
 * System prompt normalization — inspired by Reasonix ImmutablePrefix.
 *
 * Replaces dynamic content (timestamps, UUIDs, dates, versions, paths) with
 * stable placeholders for better cache hit rates.
 *
 * This function modifies the system array IN-PLACE (Mode B behavior).
 * Note: In-place mutation is acceptable here because experimental.chat.system.transform
 * is designed for this purpose — OpenCode expects the array to be modified.
 */
import { DYNAMIC_PATTERNS } from "./constants.js";
import { computeFingerprint } from "./fingerprint.js";
/**
 * Normalize system prompt by replacing dynamic content with stable placeholders.
 *
 * Replaces: ISO timestamps, UUIDs, date strings, version strings, temp paths, process IDs.
 * This maximizes prefix stability for DeepSeek's byte-level cache matching.
 */
export function normalizeSystemPrompt(system) {
    // Guard against null/undefined system parameter
    if (!Array.isArray(system) || system.length === 0) {
        return { changed: false, replacements: 0, fingerprint: "" };
    }
    let totalReplacements = 0;
    const before = system.join("");
    for (let i = 0; i < system.length; i++) {
        if (typeof system[i] !== "string")
            continue;
        for (const [pattern, replacement] of DYNAMIC_PATTERNS) {
            // Reset regex lastIndex for global patterns
            pattern.lastIndex = 0;
            const matches = system[i].match(pattern);
            if (matches) {
                totalReplacements += matches.length;
                system[i] = system[i].replace(pattern, replacement);
            }
        }
    }
    const after = system.join("");
    const changed = before !== after;
    const fingerprint = computeFingerprint(after);
    return { changed, replacements: totalReplacements, fingerprint };
}
/**
 * Check if a system prompt needs normalization without modifying it.
 * Useful for debugging and metrics.
 */
export function needsNormalization(system) {
    if (!Array.isArray(system) || system.length === 0)
        return false;
    const combined = system.join("");
    for (const [pattern] of DYNAMIC_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(combined))
            return true;
    }
    return false;
}
//# sourceMappingURL=system-transform.js.map