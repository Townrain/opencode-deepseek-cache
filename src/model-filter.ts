export { isOfficialDeepSeekEndpoint } from './constants.js'

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
