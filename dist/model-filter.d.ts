export { isOfficialDeepSeekEndpoint } from './constants.js';
/** Check if a provider ID indicates an official DeepSeek provider. */
export declare function isOfficialProvider(providerID: string): boolean;
/**
 * Check for the event hook — session API responses have providerID but no api.url.
 */
export declare function isOfficialDeepSeekProvider(providerID: string): boolean;
/**
 * Sanity check for cache token usage data.
 */
export declare function isValidCacheUsage(hitTokens: number, missTokens: number, totalInput: number): boolean;
//# sourceMappingURL=model-filter.d.ts.map