import { isOfficialDeepSeekEndpoint } from './constants.js'
export { isOfficialDeepSeekEndpoint }

/** Check if a provider ID indicates an official DeepSeek provider. */
export function isOfficialProvider(providerID: string): boolean {
  return providerID === 'deepseek'
}

/**
 * Check for the event hook — session API responses have providerID but no api.url.
 */
export function isOfficialDeepSeekProvider(providerID: string): boolean {
  return isOfficialProvider(providerID?.toLowerCase?.() ?? '')
}
/**
 * Unified check: is this request targeting an official DeepSeek endpoint?
 * Combines URL check and provider check for convenience.
 */
export function isApplicableDeepSeek(check: { apiUrl?: string; providerID?: string }): boolean {
  if (check.apiUrl && isOfficialDeepSeekEndpoint(check.apiUrl)) return true
  if (check.providerID && isOfficialDeepSeekProvider(check.providerID)) return true
  return false
}

