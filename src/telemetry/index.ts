/**
 * Telemetry schema — barrel export.
 *
 * No collection implementation. This module only exposes type definitions
 * and schema constants that future opt-in telemetry must conform to.
 */

export type {
  FingerprintTelemetryPayload,
  NormalizationEffectivenessSignal,
  PrefixReuseSignal,
  PrefixStabilitySignal,
} from './schema.js'
export {
  NOT_COLLECTED,
  TELEMETRY_SCHEMA_VERSION,
} from './schema.js'
