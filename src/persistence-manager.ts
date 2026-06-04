// Named import handles vitest mocks that don't include getLastCacheWriteFailedAndReset
// (the import resolves to undefined rather than throwing)
import {
  getLastCacheWriteFailedAndReset as _gcfwfar,
  appendUsageToJsonl,
  getLastFingerprintFromJsonl,
  loadBaselinesFromJsonl,
  loadStatsFromJsonl,
  saveBaselineToJsonl,
} from './cache-stats.js'
import type { BaselineEntry, CacheStats } from './types.js'

const checkWriteFailed: () => boolean = typeof _gcfwfar === 'function' ? _gcfwfar : () => false

type QueuedWrite = () => void

export class PersistenceManager {
  private writeQueue: QueuedWrite[] = []
  private flushing = false

  constructor(private jsonlPath: string) {}

  // Usage tracking — delegates to cache-stats for test mock compatibility
  append(
    hit: number,
    miss: number,
    write?: number,
    output?: number,
    fp?: string,
    model?: string,
    pc?: number,
  ): void {
    this.enqueue(() => {
      appendUsageToJsonl(this.jsonlPath, hit, miss, write, output, fp, model, pc)
    })
  }

  // Baseline persistence — delegates to cache-stats for test mock compatibility
  saveBaseline(sessionId: string, entry: BaselineEntry, fp?: string): void {
    this.enqueue(() => {
      saveBaselineToJsonl(
        this.jsonlPath,
        sessionId,
        entry.input,
        entry.cacheRead,
        entry.cacheWrite,
        entry.output,
        fp,
      )
    })
  }

  loadStats(): CacheStats {
    return loadStatsFromJsonl(this.jsonlPath)
  }

  loadLastFingerprint(): { fingerprint: string | null; model: string | null } {
    return getLastFingerprintFromJsonl(this.jsonlPath)
  }

  loadBaselines(): Map<string, BaselineEntry> {
    return loadBaselinesFromJsonl(this.jsonlPath)
  }

  /** Flush pending writes and release resources. */
  dispose(): void {
    this.flushQueue()
  }

  // WAL pattern: enqueue then flush atomically.
  // Uses lastCacheWriteFailed flag from cache-stats to detect write failures
  // (since appendUsageToJsonl/saveBaselineToJsonl swallow exceptions internally).
  private enqueue(fn: QueuedWrite): void {
    this.writeQueue.push(fn)
    this.flushQueue()
  }

  private flushQueue(): void {
    if (this.flushing) return
    this.flushing = true
    // Drain stale failure flag from previous flush cycles or cross-test contamination
    checkWriteFailed()
    let written = 0
    try {
      while (written < this.writeQueue.length) {
        this.writeQueue[written]()
        if (checkWriteFailed()) {
          // Write failed — leave current + remaining items in queue for retry
          break
        }
        written++
      }
      this.writeQueue.splice(0, written)
    } finally {
      this.flushing = false
    }
  }
}
