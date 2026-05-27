export { isOfficialDeepSeekEndpoint } from './constants.js';
/** Check if a provider ID indicates an official DeepSeek provider. */
export function isOfficialProvider(providerID) {
    return providerID === 'deepseek';
}
/**
 * Check for the event hook — session API responses have providerID but no api.url.
 */
export function isOfficialDeepSeekProvider(providerID) {
    return isOfficialProvider(providerID?.toLowerCase?.() ?? '');
}
/**
 * Sanity check for cache token usage data.
 */
export function isValidCacheUsage(hitTokens, missTokens, totalInput) {
    if (hitTokens < 0 || missTokens < 0)
        return false;
    if (totalInput < 0)
        return false;
    if (hitTokens + missTokens > totalInput * 1.1)
        return false;
    return true;
}
//# sourceMappingURL=model-filter.js.map