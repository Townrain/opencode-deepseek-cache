export interface CacheStats {
    totalHitTokens: number;
    totalMissTokens: number;
    requestCount: number;
    /** Prefix fingerprint changes (cache misses due to prefix drift) */
    prefixChanges: number;
    /** Timestamp of first request */
    firstRequestTime: number | null;
    /** Timestamp of last request */
    lastRequestTime: number | null;
}
/**
 * Load historical stats from JSONL file
 */
export declare function loadStatsFromJsonl(jsonlPath: string): CacheStats;
/**
 * Append a usage record to JSONL file
 */
export declare function appendUsageToJsonl(jsonlPath: string, hitTokens: number, missTokens: number, fingerprint?: string): void;
export declare function createCacheStats(): CacheStats;
export declare function getCacheReport(stats: CacheStats, currentFingerprint?: string): string;
//# sourceMappingURL=cache-stats.d.ts.map