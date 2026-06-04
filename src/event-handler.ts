import type { FingerprintTracker } from './fingerprint.js'
import { log } from './logger.js'
import type { PersistenceManager } from './persistence-manager.js'
import type { SessionManager, TokenSnapshot } from './session-manager.js'
import type { DeltaTokens, StatsManager } from './stats-manager.js'
import type { BaselineEntry } from './types.js'
import { sanitizeSessionId } from './utils/type-guards.js'

const MAX_EVENT_RETRIES = 3
const BASE_BACKOFF_MS = 1000

interface PluginContext {
  client: {
    session: {
      messages: (args: { path: { id: string } }) => Promise<unknown>
    }
  }
}

export class EventHandler {
  private disposed = false

  constructor(
    private ctx: PluginContext,
    private sessionManager: SessionManager,
    private statsManager: StatsManager,
    private persistenceManager: PersistenceManager,
    private fingerprintTracker: FingerprintTracker,
    private isApplicableDeepSeek: (check: { apiUrl?: string; providerID?: string }) => boolean,
  ) {}

  /** Mark as disposed to prevent stale hook invocations. */
  dispose(): void {
    this.disposed = true
  }

  async handle(event: { type: string; properties?: unknown }): Promise<void> {
    if (this.disposed) return
    if (!this.shouldHandle(event)) return

    const sessionID = this.extractSessionID(event)
    if (!sessionID) return

    if (this.sessionManager.shouldSkipDueToRetry(sessionID)) return

    const response = await this.fetchSessionMessages(sessionID)
    if (!response) return

    const tokens = this.extractTokens(response)
    if (!tokens) return

    // M6: If cache.read is undefined, update baseline preserving previous cacheRead, skip stats
    if (tokens.cacheReadMissing) {
      log('DEBUG: cache.read unavailable — baseline updated, stats skipped', {
        sessionID,
        modelID: tokens.modelID,
      })
      this.sessionManager.clearRetryState(sessionID)
      const prev = this.sessionManager.getBaseline(sessionID)
      this.sessionManager.setBaseline(sessionID, {
        input: tokens.input,
        cacheRead: prev?.cacheRead ?? 0,
        cacheWrite: tokens.cacheWrite,
        output: tokens.output,
        lastAccess: Date.now(),
      })
      return
    }

    // H1 FIX: Clear retry state on ANY successful fetch+extract
    this.sessionManager.clearRetryState(sessionID)

    // F4: Always update baseline (even for non-DeepSeek)
    const prev = this.sessionManager.getBaseline(sessionID)
    this.sessionManager.updateBaselineFromTokens(sessionID, tokens)

    // Housekeeping
    this.sessionManager.sweepExpired()
    this.sessionManager.sweepOrphanedRetries()
    this.sessionManager.evictLRU()

    // Persist baseline
    this.persistBaselineIfNeeded(sessionID, tokens)

    // Only record stats for official DeepSeek
    if (!this.isApplicableDeepSeek({ providerID: tokens.providerID })) return

    // Update cached model ID
    this.statsManager.setCachedModelId(tokens.modelID ?? null)

    // Calculate and record delta
    const delta = this.calculateDelta(prev, tokens)
    if (this.isZeroDelta(delta)) return

    this.statsManager.recordDelta(delta)
    this.persistUsage(delta)
  }

  private shouldHandle(event: { type: string }): boolean {
    return event.type === 'session.idle'
  }

  private extractSessionID(event: { properties?: unknown }): string | null {
    if (!event.properties || typeof event.properties !== 'object') return null
    const props = event.properties as Record<string, unknown>
    return typeof props.sessionID === 'string' ? sanitizeSessionId(props.sessionID) : null
  }

  private async fetchSessionMessages(sessionID: string): Promise<unknown | null> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const messagesP = this.ctx.client.session.messages({ path: { id: sessionID } })
      messagesP.catch(() => {}) // prevent UnhandledPromiseRejection
      const timerP = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('session.messages timeout')), 5000)
      })
      const response = await Promise.race([messagesP, timerP])
      return response
    } catch (err) {
      this.sessionManager.recordRetryFailure(sessionID, MAX_EVENT_RETRIES, BASE_BACKOFF_MS)
      log('ERROR in fetchSessionMessages', { error: String(err), sessionID })
      return null
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  private extractTokens(
    response: unknown,
  ):
    | (TokenSnapshot & { modelID?: string; providerID?: string; cacheReadMissing?: boolean })
    | null {
    if (!response || typeof response !== 'object') return null
    const res = response as { error?: unknown; data?: unknown }
    if (res.error || !res.data) return null
    if (!Array.isArray(res.data)) return null

    const messages = res.data as Array<{
      info: {
        role: string
        tokens?: { cache?: { read?: number; write?: number }; input?: number; output?: number }
        modelID?: string
        providerID?: string
      }
    }>
    const lastAssistant = messages
      .filter((m) => m.info?.role === 'assistant' && m.info?.tokens)
      .at(-1)
    if (!lastAssistant?.info?.tokens) return null

    const tokens = lastAssistant.info.tokens
    const cacheRead = tokens.cache?.read
    const hitTokens = cacheRead ?? 0
    const inputTokens = tokens.input ?? 0 // H2 FIX: renamed from missTokens
    const writeTokens = tokens.cache?.write ?? 0
    const outputTokens = tokens.output ?? 0

    if (
      !Number.isFinite(hitTokens) ||
      !Number.isFinite(inputTokens) ||
      !Number.isFinite(writeTokens) ||
      !Number.isFinite(outputTokens) ||
      hitTokens < 0 ||
      inputTokens < 0 ||
      writeTokens < 0 ||
      outputTokens < 0
    ) {
      log('WARNING: Invalid token values', { hitTokens, inputTokens, writeTokens, outputTokens })
      return null
    }

    return {
      input: inputTokens,
      cacheRead: hitTokens,
      cacheWrite: writeTokens,
      output: outputTokens,
      modelID: lastAssistant.info.modelID,
      providerID: lastAssistant.info.providerID?.toLowerCase?.() ?? '',
      cacheReadMissing: cacheRead === undefined,
    }
  }

  private calculateDelta(prev: BaselineEntry | undefined, tokens: TokenSnapshot): DeltaTokens {
    const deltaHit = tokens.cacheRead - (prev?.cacheRead ?? 0)
    const deltaMiss = tokens.input - (prev?.input ?? 0)
    const deltaWrite = tokens.cacheWrite - (prev?.cacheWrite ?? 0)
    const deltaOutput = tokens.output - (prev?.output ?? 0)

    if (deltaHit < 0 || deltaMiss < 0 || deltaWrite < 0 || deltaOutput < 0) {
      log('WARNING: negative delta clamped to 0', { deltaHit, deltaMiss, deltaWrite, deltaOutput })
    }

    return {
      hit: Math.max(0, deltaHit),
      miss: Math.max(0, deltaMiss),
      write: Math.max(0, deltaWrite),
      output: Math.max(0, deltaOutput),
    }
  }

  private isZeroDelta(delta: DeltaTokens): boolean {
    return delta.hit === 0 && delta.miss === 0 && delta.write === 0 && delta.output === 0
  }

  private persistBaselineIfNeeded(sessionID: string, tokens: TokenSnapshot): void {
    if (this.sessionManager.shouldPersistBaseline(sessionID, tokens)) {
      const fp = this.fingerprintTracker.getLastFingerprint() ?? undefined
      this.persistenceManager.saveBaseline(sessionID, { ...tokens, lastAccess: Date.now() }, fp)
      this.sessionManager.markBaselinePersisted(sessionID, tokens)
    }
  }

  private persistUsage(delta: DeltaTokens): void {
    const fp = this.fingerprintTracker.getLastFingerprint() ?? undefined
    const modelId = this.statsManager.getCachedModelId() ?? undefined
    this.persistenceManager.append(delta.hit, delta.miss, delta.write, delta.output, fp, modelId)
  }
}
