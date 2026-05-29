/**
 * Cache strategy layer — barrel export.
 *
 * Exposes the provider-agnostic CacheStrategy interface and all
 * built-in strategy constructors.
 */

export { createDeepSeekStrategy } from './deepseek.js'
export type { CacheContext, CacheStrategy, ModelInfo, ProviderOptions } from './types.js'
