/** Sliding window size — conservative value 12 */
export declare const SLIDING_WINDOW_SIZE = 12;
/** Max messages for summary extraction */
export declare const SUMMARY_MAX_MESSAGES = 12;
/** Max length for plain text in summary */
export declare const SUMMARY_MAX_LENGTH = 500;
/** Max length for text without code blocks */
export declare const SUMMARY_TEXT_WITHOUT_CODE_MAX_LENGTH = 300;
/** Max length per code block in summary */
export declare const SUMMARY_CODE_BLOCK_MAX_LENGTH = 800;
/** Max number of code blocks to preserve */
export declare const SUMMARY_MAX_CODE_BLOCKS = 3;
/** Summary markers — short fixed prefix, cache-friendly */
export declare const SUMMARY_HEADER = "[SUMMARY]";
export declare const SUMMARY_FOOTER = "[/SUMMARY]";
/** Dynamic content replacement patterns — enhanced from Reasonix ImmutablePrefix */
export declare const DYNAMIC_PATTERNS: [RegExp, string][];
/** DeepSeek prices (USD per 1M tokens) */
export declare const DEEPSEEK_PRICES: {
    readonly cacheMiss: 0.14;
    readonly cacheHit: 0.0028;
};
/** Debug environment variable name */
export declare const DEBUG_ENV = "DEEPSEEK_CACHE_DEBUG";
/** Fingerprint cache settings */
export declare const FINGERPRINT_LENGTH = 16;
//# sourceMappingURL=constants.d.ts.map