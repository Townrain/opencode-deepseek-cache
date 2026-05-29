/**
 * Provider-agnostic cache optimization strategy interface.
 *
 * Each LLM provider has subtly different cache semantics (prefix matching rules,
 * cache hit/miss pricing, provider-specific options like user_id).
 * A CacheStrategy encapsulates the provider-specific logic so that the
 * orchestration layer (plugin lifecycle hooks) stays provider-agnostic.
 *
 * Currently only DeepSeek is implemented. The interface exists to make the
 * core cache intelligence independently testable and to enable future
 * multi-provider support without rewriting the orchestration layer.
 */

import type { NormalizationResult } from '../system-transform.js'

/** Context passed to getProviderOptions, if needed by a strategy. */
export interface CacheContext {
  /** Project directory path (some strategies derive stable IDs from it) */
  projectPath: string
  /** Model ID being invoked */
  modelId?: string
  /** Provider ID from the plugin context */
  providerId?: string
}

/** Provider-specific options to merge into the outgoing LLM call. */
export interface ProviderOptions {
  /** Stable user identifier for provider-side cache isolation */
  user_id?: string
  /** Catch-all for future provider-specific fields */
  [key: string]: unknown
}

/** Minimal model description needed to decide applicability. */
export interface ModelInfo {
  /** Model identifier (e.g., "deepseek-chat", "deepseek-v4-pro") */
  id?: string
  /** API endpoint URL */
  apiUrl?: string
  /** Provider identifier (e.g., "deepseek") */
  providerId?: string
}

/**
 * CacheStrategy — provider-agnostic interface for cache-related concerns.
 *
 * Implementations must provide:
 * - normalizeSystem: provider-aware system prompt normalization
 * - computeFingerprint: stable hash of normalized system content
 * - isApplicable: filter to decide whether to apply for a given model
 *
 * Implementations may optionally provide:
 * - getProviderOptions: extra options to inject into the API call
 */
export interface CacheStrategy {
  /** Display name for logs and diagnostics */
  name: string
  /** Normalize the system prompt array in-place, return normalization metadata. */
  normalizeSystem(system: string[]): NormalizationResult
  /** Compute a stable fingerprint of the (already normalized) system string. */
  computeFingerprint(system: string): string
  /**
   * Return provider-specific options to inject into the LLM call
   * (e.g., user_id for DeepSeek cache isolation).
   * Return undefined if no options should be injected.
   */
  getProviderOptions?(context: CacheContext): ProviderOptions | undefined
  /**
   * Filter: should this strategy apply to the given model invocation?
   * Return false to skip cache optimization for this call.
   */
  isApplicable(model: ModelInfo): boolean
}
