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
export interface NormalizationResult {
    /** Whether any replacements were made */
    changed: boolean;
    /** Number of replacements made */
    replacements: number;
    /** Fingerprint of the normalized system */
    fingerprint: string;
}
/**
 * Normalize system prompt by replacing dynamic content with stable placeholders.
 *
 * Replaces: ISO timestamps, UUIDs, date strings, version strings, temp paths, process IDs.
 * This maximizes prefix stability for DeepSeek's byte-level cache matching.
 */
export declare function normalizeSystemPrompt(system: string[]): NormalizationResult;
/**
 * Check if a system prompt needs normalization without modifying it.
 * Useful for debugging and metrics.
 */
export declare function needsNormalization(system: string[]): boolean;
//# sourceMappingURL=system-transform.d.ts.map