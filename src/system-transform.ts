import { DYNAMIC_PATTERNS } from "./constants.js"

/**
 * Normalize system prompt by replacing dynamic content (timestamps, UUIDs)
 * with stable placeholders for better cache hit rates.
 *
 * This function modifies the system array IN-PLACE (Mode B behavior).
 */
export function normalizeSystemPrompt(system: string[]): void {
  // Fix: Guard against null/undefined system parameter
  if (!Array.isArray(system) || system.length === 0) return

  for (let i = 0; i < system.length; i++) {
    if (typeof system[i] !== "string") continue

    for (const [pattern, replacement] of DYNAMIC_PATTERNS) {
      system[i] = system[i].replace(pattern, replacement)
    }
  }
}
