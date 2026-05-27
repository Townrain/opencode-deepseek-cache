/** Dynamic content replacement patterns — enhanced from Reasonix ImmutablePrefix */
export declare const DYNAMIC_PATTERNS: [RegExp, string][];
/** DeepSeek prices (CNY per 1M tokens) */
export declare const DEEPSEEK_PRICES: {
    readonly cacheMiss: 3;
    readonly cacheHit: 0.025;
};
/** Fingerprint cache settings */
export declare const FINGERPRINT_LENGTH = 16;
/** Check if an API endpoint URL belongs to the official DeepSeek API. */
export declare function isOfficialDeepSeekEndpoint(apiUrl: string): boolean;
//# sourceMappingURL=constants.d.ts.map