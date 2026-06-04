# Refactoring Implementation Plan — v2.1.7

> **Status**: Ready to Execute
> **Date**: 2026-06-04
> **Addresses**: 4 FATAL + 5 CRITICAL issues from adversarial review

---

## Executive Summary

Wave-based execution with 4 parallel tracks. Each wave completes before the next begins. Total estimated effort: ~3,500 lines of new/modified code + tests.

**Bottom Line**: The refactoring is safe because we lock behavior with contract tests FIRST, then extract modules behind those tests. Every intermediate state passes all tests.

---

## Pre-Flight: Verify Current State

```bash
# Run BEFORE starting any work
npm test                    # All 202 tests must pass
npx tsc --noEmit            # Zero type errors
npx biome ci .              # Zero lint issues
```

---

## Wave 0: Foundation (No Dependencies — Can Parallelize)

### T0.1: Extract Type Definitions
**File**: `src/types.ts` (~80 lines)
**Addresses**: F1 (circular dependency prevention), shared types
**Effort**: Quick

**What to extract**:
```typescript
// From index.ts closure types
export interface BaselineEntry {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  lastAccess: number
}

export interface RetryState {
  count: number
  nextRetryAt: number
}

// From cache-stats.ts
export interface CacheStats {
  totalOutputTokens: number
  totalHitTokens: number
  totalMissTokens: number
  totalWriteTokens: number
  requestCount: number
  prefixChanges: number
  firstRequestTime: number | null
  lastRequestTime: number | null
  previousHitRate: number | null
  lastMessageStats?: MessageStats
  systemTransformCallCount: number
  lastSystemTransformTime: number | null
}

export interface MessageStats {
  hitTokens: number
  missTokens: number
  writeTokens: number
  outputTokens: number
}

export interface UsageRecord {
  t: number
  hit: number
  miss: number
  write?: number
  output?: number
  fp?: string
  model?: string
  type?: 'fingerprint' | 'usage' | 'baseline'
  pc?: number
}

export interface BaselineRecord {
  t: number
  type: 'baseline'
  sessionID: string
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  fp?: string
}

// Repository interface (F1: breaks circular dependency)
export interface IBaselineRepository {
  load(): Map<string, BaselineEntry>
  save(sessionId: string, entry: BaselineEntry): void
}

export interface IUsageRepository {
  append(hit: number, miss: number, write?: number, output?: number, fp?: string, model?: string, pc?: number): void
  loadStats(): CacheStats
  loadLastFingerprint(): { fingerprint: string | null; model: string | null }
}
```

**TDD Scenarios**:
- RED: Import types from `./types.js` in existing modules → compile error (types don't exist yet)
- GREEN: Create `src/types.ts` with all exports
- SURFACE: `npx tsc --noEmit` passes, existing tests unchanged

**Verification**:
- [ ] `npx tsc --noEmit` passes
- [ ] All 202 tests pass (no behavioral change)
- [ ] `src/types.ts` exports all shared interfaces

---

### T0.2: Extract Type Guards Utility
**File**: `src/utils/type-guards.ts` (~30 lines)
**Addresses**: C4 (test fixtures), code deduplication
**Effort**: Quick

**What to extract** (currently duplicated 4x in `cache-stats.ts:126-130`):
```typescript
export function parseNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

export function parseOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function isValidTokenValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
```

**TDD Scenarios**:
```typescript
// RED: Use parseNonNegativeNumber in cache-stats.ts → import fails
// GREEN: Create utils/type-guards.ts
// SURFACE:

describe('parseNonNegativeNumber', () => {
  it('returns 0 for undefined', () => expect(parseNonNegativeNumber(undefined)).toBe(0))
  it('returns 0 for NaN', () => expect(parseNonNegativeNumber(NaN)).toBe(0))
  it('returns 0 for Infinity', () => expect(parseNonNegativeNumber(Infinity)).toBe(0))
  it('returns 0 for negative', () => expect(parseNonNegativeNumber(-5)).toBe(0))
  it('returns value for positive', () => expect(parseNonNegativeNumber(42)).toBe(42))
  it('returns 0 for zero', () => expect(parseNonNegativeNumber(0)).toBe(0))
})
```

**Verification**:
- [ ] New test file `src/utils/type-guards.test.ts` passes
- [ ] All 202 existing tests pass

---

### T0.3: Create Compatibility Contract Tests
**File**: `src/__tests__/compatibility-contract.test.ts` (~200 lines)
**Addresses**: C1 (50% regression risk), C3 (baseline migration)
**Effort**: Medium

**Purpose**: Lock external behavior BEFORE any refactoring. These tests must pass at every commit.

```typescript
describe('Compatibility Contract — External API Surface', () => {
  // Contract 1: Plugin module exports
  it('exports PluginModule with id "deepseek-cache"', () => { ... })
  it('server is an async function', () => { ... })

  // Contract 2: Hook signatures
  it('returns object with config hook', () => { ... })
  it('returns object with chat.params hook', () => { ... })
  it('returns object with event hook', () => { ... })
  it('returns object with tool.cacheStats', () => { ... })
  it('returns object with dispose hook', () => { ... })

  // Contract 3: JSONL format compatibility
  it('appendUsageToJsonl writes valid JSON lines', () => { ... })
  it('saveBaselineToJsonl writes type:"baseline" records', () => { ... })
  it('JSONL records have required fields: t, hit, miss', () => { ... })

  // Contract 4: Report format
  it('getCacheReport returns markdown with "DeepSeek Cache Dashboard"', () => { ... })
  it('getCacheReport includes hit rate percentage', () => { ... })

  // Contract 5: Baseline migration (C3)
  it('loadBaselinesFromJsonl handles v2.1.7 format', () => { ... })
  it('loadBaselinesFromJsonl skips expired baselines', () => { ... })
  it('loadBaselinesFromJsonl handles corrupted timestamps', () => { ... })
})

describe('Compatibility Contract — Behavioral Invariants', () => {
  // Invariant 1: Delta tracking never double-counts
  it('reload + same session produces zero delta', () => { ... })

  // Invariant 2: Non-DeepSeek models don't pollute stats
  it('non-DeepSeek tokens are bounded, not cumulative', () => { ... })

  // Invariant 3: LRU eviction preserves active sessions
  it('LRU evicts oldest-accessed, not oldest-inserted', () => { ... })
})
```

**Verification**:
- [ ] All contract tests pass on CURRENT codebase
- [ ] Contract tests serve as regression gate for all subsequent waves

---

### T0.4: Create Test Fixtures Library
**File**: `src/__tests__/fixtures.ts` (~150 lines)
**Addresses**: C4 (test fixtures insufficient — need 20+ scenarios)
**Effort**: Medium

```typescript
export const FIXTURES = {
  // Session message responses
  messages: {
    deepseek_basic: { data: [{ info: { role: 'assistant', tokens: { cache: { read: 500 }, input: 100 }, modelID: 'deepseek-chat', providerID: 'deepseek' } }] },
    deepseek_with_write: { data: [{ info: { role: 'assistant', tokens: { cache: { read: 500, write: 50 }, input: 100, output: 200 }, modelID: 'deepseek-chat', providerID: 'deepseek' } }] },
    deepseek_no_cache_read: { data: [{ info: { role: 'assistant', tokens: { input: 200 }, modelID: 'deepseek-chat', providerID: 'deepseek' } }] },
    non_deepseek: { data: [{ info: { role: 'assistant', tokens: { input: 300 }, modelID: 'gpt-4', providerID: 'openai' } }] },
    empty_data: { data: [] },
    error_response: { error: 'API error' },
    null_tokens: { data: [{ info: { role: 'assistant', tokens: null } }] },
    negative_tokens: { data: [{ info: { role: 'assistant', tokens: { cache: { read: -1 }, input: -5 } } }] },
    nan_tokens: { data: [{ info: { role: 'assistant', tokens: { cache: { read: NaN }, input: Infinity } } }] },
  },

  // JSONL records
  jsonl: {
    usage_basic: '{"t":1000,"hit":500,"miss":100}\n',
    usage_with_write: '{"t":1000,"hit":500,"miss":100,"write":50,"output":200}\n',
    baseline: '{"t":1000,"type":"baseline","sessionID":"s1","input":100,"cacheRead":500}\n',
    fingerprint: '{"t":1000,"hit":0,"miss":0,"fp":"abc123","type":"fingerprint","pc":3}\n',
    corrupted: 'NOT JSON\n{"t":1000,"hit":100}\n',
    expired_baseline: `{"t":${Date.now() - 90000000},"type":"baseline","sessionID":"old","input":100,"cacheRead":500}\n`,
  },

  // Edge cases
  edge: {
    max_session_id: 's'.repeat(1000),
    unicode_session_id: '会话-🔑',
    zero_tokens: { cache: { read: 0 }, input: 0, output: 0 },
    very_large_tokens: { cache: { read: 999999999 }, input: 999999999 },
  },
}
```

**Verification**:
- [ ] `src/__tests__/fixtures.ts` exports 20+ fixture objects
- [ ] Fixtures are used in at least 5 existing test files

---

## Wave 1: Core Class Extraction (Depends on Wave 0)

### T1.1: Extract SessionManager Class
**File**: `src/session-manager.ts` (~120 lines)
**Addresses**: F1 (circular dependency), mutable state elimination
**Effort**: Medium
**Blocked by**: T0.1 (types)

**What moves from `index.ts`**:
- `sessionBaselines` Map → `SessionManager.baselines`
- `lastBaselineWrite` Map → `SessionManager.lastWrites`
- `sessionRetryState` Map → `SessionManager.retryStates`
- LRU eviction logic (lines 399-412)
- TTL sweep logic (lines 358-364)
- Orphan cleanup logic (lines 366-371)

```typescript
export class SessionManager {
  private baselines = new Map<string, BaselineEntry>()
  private lastWrites = new Map<string, { input: number; cacheRead: number; cacheWrite: number; output: number }>()
  private retryStates = new Map<string, RetryState>()

  constructor(
    private maxBaselines: number,
    private baselineTtlMs: number,
  ) {}

  getBaseline(sessionId: string): BaselineEntry | undefined { ... }
  setBaseline(sessionId: string, entry: BaselineEntry): void { ... }
  updateBaselineFromTokens(sessionId: string, tokens: TokenSnapshot): void { ... }

  shouldSkipDueToRetry(sessionId: string): boolean { ... }
  recordRetryFailure(sessionId: string, maxRetries: number, baseBackoffMs: number): void { ... }
  clearRetryState(sessionId: string): void { ... }

  sweepExpired(): void { ... }
  evictLRU(): void { ... }
  sweepOrphanedRetries(): void { ... }

  shouldPersistBaseline(sessionId: string, tokens: TokenSnapshot): boolean { ... }
  markBaselinePersisted(sessionId: string, tokens: TokenSnapshot): void { ... }

  restoreFromMap(baselines: Map<string, BaselineEntry>): void { ... }
}
```

**F1 Fix — Repository Pattern**:
```typescript
// SessionManager depends on IBaselineRepository (from types.ts)
// PersistenceManager implements IBaselineRepository
// This breaks the circular dependency:
//   SessionManager → IBaselineRepository ← PersistenceManager
```

**TDD Scenarios** (20+ tests):
```typescript
describe('SessionManager', () => {
  describe('baseline management', () => {
    it('setBaseline stores entry with lastAccess', () => { ... })
    it('getBaseline returns undefined for unknown session', () => { ... })
    it('getBaseline returns entry for known session', () => { ... })
    it('updateBaselineFromTokens updates existing baseline', () => { ... })
    it('restoreFromMap merges without overwriting existing', () => { ... })
  })

  describe('retry management', () => {
    it('shouldSkipDueToRetry returns false for unknown session', () => { ... })
    it('shouldSkipDueToRetry returns true when within backoff window', () => { ... })
    it('shouldSkipDueToRetry returns false when backoff expired', () => { ... })
    it('recordRetryFailure increments count and sets backoff', () => { ... })
    it('recordRetryFailure sets permanent backoff after max retries', () => { ... })
    it('clearRetryState removes entry', () => { ... })
  })

  describe('eviction', () => {
    it('sweepExpired removes entries older than TTL', () => { ... })
    it('sweepExpired also cleans up lastWrites and retryStates', () => { ... })
    it('evictLRU removes oldest-accessed entry', () => { ... })
    it('evictLRU does nothing when under capacity', () => { ... })
    it('sweepOrphanedRetries removes retries without baselines', () => { ... })
  })

  describe('persistence dedup', () => {
    it('shouldPersistBaseline returns true for new session', () => { ... })
    it('shouldPersistBaseline returns false when values unchanged', () => { ... })
    it('shouldPersistBaseline returns true when values changed', () => { ... })
    it('markBaselinePersisted updates lastWrites', () => { ... })
  })
})
```

**Verification**:
- [ ] `src/session-manager.test.ts` — 20+ tests pass
- [ ] All 202 existing tests pass
- [ ] No circular imports in dependency graph

---

### T1.2: Extract StatsManager Class
**File**: `src/stats-manager.ts` (~80 lines)
**Addresses**: Mutable state elimination, single responsibility
**Effort**: Quick
**Blocked by**: T0.1 (types)

**What moves from `index.ts`**:
- `stats` object mutation (lines 454-476)
- `cachedModelId` variable

```typescript
export class StatsManager {
  private stats: CacheStats
  private cachedModelId: string | null

  constructor(initialStats: CacheStats, initialModelId: string | null) { ... }

  recordDelta(delta: DeltaTokens): void { ... }
  getStats(): Readonly<CacheStats> { ... }
  getCachedModelId(): string | null { ... }
  setCachedModelId(modelId: string | null): void { ... }
  incrementSystemTransformCount(): void { ... }
}
```

**TDD Scenarios** (12+ tests):
```typescript
describe('StatsManager', () => {
  it('initializes with provided stats', () => { ... })
  it('recordDelta adds to totals', () => { ... })
  it('recordDelta increments requestCount', () => { ... })
  it('recordDelta updates lastMessageStats', () => { ... })
  it('recordDelta updates hit rate trend', () => { ... })
  it('recordDelta sets firstRequestTime on first call', () => { ... })
  it('recordDelta always updates lastRequestTime', () => { ... })
  it('getStats returns readonly copy', () => { ... })
  it('cachedModelId tracks model changes', () => { ... })
  it('incrementSystemTransformCount increments counter', () => { ... })
})
```

**Verification**:
- [ ] `src/stats-manager.test.ts` — 12+ tests pass
- [ ] All 202 existing tests pass

---

### T1.3: Refactor Logger to Class
**File**: `src/logger.ts` (refactor ~210 lines → class ~180 lines)
**Addresses**: Module-level mutable state elimination (5 variables)
**Effort**: Medium
**Blocked by**: None (can run in parallel with T1.1, T1.2)

**Current state** (5 module-level mutable variables):
```typescript
let LOG_DIR = ''           // → constructor param
let LOG_FILE = ''          // → constructor param
let stream = null          // → this.stream
let writeBuffer: string[] = []  // → this.writeBuffer
let draining = false       // → this.draining
```

**Target**:
```typescript
export class Logger {
  private stream: ReturnType<typeof createWriteStream> | null = null
  private writeBuffer: string[] = []
  private draining = false

  constructor(
    private logDir: string,
    private logFile: string,
    private maxLogSize: number,
  ) {
    this.ensureDirectory()
    this.ensureStream()
  }

  log(message: string, data?: unknown): void { /* existing logic */ }
  getLogPath(): string { return this.logFile }
  dispose(): void { /* existing logic */ }

  private ensureStream(): ReturnType<typeof createWriteStream> | null { ... }
  private flushBuffer(s: NonNullable<typeof stream>): void { ... }
  private checkRotation(): void { ... }
}

// Backward-compatible exports (thin wrappers for existing callers)
let _instance: Logger | null = null
export function initLogger(directory: string): void { _instance = new Logger(...) }
export function log(message: string, data?: unknown): void { _instance?.log(message, data) }
export function dispose(): void { _instance?.dispose() }
export function getLogPath(): string { return _instance?.getLogPath() ?? '' }
```

**TDD Scenarios** (15+ tests):
```typescript
describe('Logger class', () => {
  it('creates log directory on construction', () => { ... })
  it('creates write stream on construction', () => { ... })
  it('log writes timestamped message', () => { ... })
  it('log handles data parameter', () => { ... })
  it('log handles circular data', () => { ... })
  it('dispose flushes buffer and closes stream', () => { ... })
  it('log buffers writes under backpressure', () => { ... })
  it('log drops oldest line when buffer full', () => { ... })
  it('checkRotation rotates when file exceeds maxLogSize', () => { ... })
  it('checkRotation flushes buffer before rotation', () => { ... })
  it('getLogPath returns correct path', () => { ... })
  it('multiple dispose calls are safe', () => { ... })
  it('log after dispose creates new stream', () => { ... })
})

describe('Logger backward-compatible exports', () => {
  it('initLogger creates instance', () => { ... })
  it('log delegates to instance', () => { ... })
  it('dispose delegates to instance', () => { ... })
})
```

**Verification**:
- [ ] `src/logger.test.ts` — all tests pass (refactored to use class)
- [ ] All 202 existing tests pass
- [ ] No module-level mutable variables in logger.ts

---

### T1.4: Refactor Fingerprint to Class
**File**: `src/fingerprint.ts` (refactor ~65 lines → class ~50 lines)
**Effort**: Quick
**Blocked by**: None

**Current**: Factory function returning object with closures
**Target**: Simple class

```typescript
export class FingerprintTracker {
  private lastFingerprint: string | null

  constructor(initialFingerprint?: string | null) {
    this.lastFingerprint = initialFingerprint ?? null
  }

  compute(system: string): FingerprintResult { ... }
  getLastFingerprint(): string | null { ... }
}

// Backward-compatible factory
export function createFingerprintTracker(initial?: string | null): FingerprintTracker {
  return new FingerprintTracker(initial)
}
```

**TDD**: Existing tests continue to pass. Add 3 class-specific tests.

---

## Wave 2: Integration Layer (Depends on Wave 1)

### T2.1: Extract PersistenceManager Class
**File**: `src/persistence-manager.ts` (~130 lines)
**Addresses**: F1 (circular dependency via Repository pattern), F3 (WAL pattern)
**Effort**: Medium
**Blocked by**: T0.1 (types), T0.2 (type guards)

**F3 Fix — Write-Ahead Log Pattern**:
```typescript
export class PersistenceManager implements IUsageRepository, IBaselineRepository {
  private writeQueue: Array<{ type: 'usage' | 'baseline'; record: unknown }> = []
  private flushing = false

  constructor(private jsonlPath: string) {}

  // IUsageRepository implementation
  append(hit: number, miss: number, write?: number, output?: number, fp?: string, model?: string, pc?: number): void {
    const record = this.buildUsageRecord(hit, miss, write, output, fp, model, pc)
    this.enqueueWrite('usage', record)
  }

  loadStats(): CacheStats { ... }  // delegates to existing loadStatsFromJsonl
  loadLastFingerprint(): { fingerprint: string | null; model: string | null } { ... }

  // IBaselineRepository implementation
  load(): Map<string, BaselineEntry> { ... }  // delegates to existing loadBaselinesFromJsonl
  save(sessionId: string, entry: BaselineEntry): void {
    const record = this.buildBaselineRecord(sessionId, entry)
    this.enqueueWrite('baseline', record)
  }

  // F3: WAL pattern — enqueue then flush
  private enqueueWrite(type: 'usage' | 'baseline', record: unknown): void {
    this.writeQueue.push({ type, record })
    this.flushQueue()
  }

  private flushQueue(): void {
    if (this.flushing) return
    this.flushing = true
    try {
      this.ensureDirectory()
      checkJsonlRotation(this.jsonlPath)
      while (this.writeQueue.length > 0) {
        const item = this.writeQueue.shift()!
        appendFileSync(this.jsonlPath, `${JSON.stringify(item.record)}\n`, 'utf-8')
      }
    } catch (err) {
      log('ERROR: Persistence flush failed', { error: String(err) })
    } finally {
      this.flushing = false
    }
  }

  private ensureDirectory(): void { ... }
  private buildUsageRecord(...): UsageRecord { ... }
  private buildBaselineRecord(...): BaselineRecord { ... }
}
```

**TDD Scenarios** (15+ tests):
```typescript
describe('PersistenceManager', () => {
  describe('IUsageRepository', () => {
    it('append writes usage record to JSONL', () => { ... })
    it('append creates directory if needed', () => { ... })
    it('append includes fingerprint when provided', () => { ... })
    it('append marks fingerprint-only records', () => { ... })
    it('loadStats delegates to loadStatsFromJsonl', () => { ... })
    it('loadLastFingerprint delegates correctly', () => { ... })
  })

  describe('IBaselineRepository', () => {
    it('save writes baseline record to JSONL', () => { ... })
    it('load delegates to loadBaselinesFromJsonl', () => { ... })
  })

  describe('WAL pattern (F3)', () => {
    it('enqueues writes in order', () => { ... })
    it('flushes queue synchronously on append', () => { ... })
    it('handles flush errors gracefully', () => { ... })
    it('rotation check happens before write', () => { ... })
  })
})
```

**Verification**:
- [ ] `src/persistence-manager.test.ts` — 15+ tests pass
- [ ] No circular imports: `SessionManager → IBaselineRepository ← PersistenceManager`
- [ ] All 202 existing tests pass

---

### T2.2: Extract EventHandler Class
**File**: `src/event-handler.ts` (~200 lines)
**Addresses**: Core split — 290-line function → class with small methods
**Effort**: Large
**Blocked by**: T1.1 (SessionManager), T1.2 (StatsManager), T2.1 (PersistenceManager)

**F4 Fix — Always Update Baseline**:
```typescript
// BEFORE (F4 bug): Zero delta → return without updating baseline
if (clampedHit === 0 && clampedMiss === 0 && clampedWrite === 0 && clampedOutput === 0)
  return  // ← baseline NOT updated, stale forever

// AFTER: Update baseline FIRST, then check delta for stats
this.sessionManager.updateBaselineFromTokens(sessionId, tokens)
if (delta.isZero) return  // ← baseline IS updated, stats skipped
```

**Target structure**:
```typescript
export class EventHandler {
  constructor(
    private ctx: PluginContext,
    private sessionManager: SessionManager,
    private statsManager: StatsManager,
    private persistenceManager: PersistenceManager,
    private fingerprintTracker: FingerprintTracker,
    private isApplicableDeepSeek: (check: { apiUrl?: string; providerID?: string }) => boolean,
  ) {}

  async handle(event: { type: string; properties?: unknown }): Promise<void> {
    if (!this.shouldHandle(event)) return

    const sessionID = this.extractSessionID(event)
    if (!sessionID) return

    if (this.sessionManager.shouldSkipDueToRetry(sessionID)) return

    const response = await this.fetchSessionMessages(sessionID)
    if (!response) return

    const tokens = this.extractTokens(response)
    if (!tokens) return

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
    this.statsManager.setCachedModelId(tokens.modelID)

    // Calculate and record delta
    const delta = this.calculateDelta(prev, tokens)
    if (delta.isZero) return

    this.statsManager.recordDelta(delta)
    this.persistUsage(delta)
  }

  private shouldHandle(event: unknown): boolean { ... }  // 5 lines
  private extractSessionID(event: unknown): string | null { ... }  // 10 lines
  private async fetchSessionMessages(sessionID: string): Promise<Response | null> { ... }  // 25 lines
  private extractTokens(response: Response): TokenSnapshot | null { ... }  // 20 lines
  private calculateDelta(prev: BaselineEntry | undefined, tokens: TokenSnapshot): DeltaTokens { ... }  // 15 lines
  private persistBaselineIfNeeded(sessionID: string, tokens: TokenSnapshot): void { ... }  // 10 lines
  private persistUsage(delta: DeltaTokens): void { ... }  // 10 lines
}
```

**TDD Scenarios** (25+ tests):
```typescript
describe('EventHandler', () => {
  describe('shouldHandle', () => {
    it('returns true for session.idle events', () => { ... })
    it('returns false for other event types', () => { ... })
    it('returns false when pluginDisposed', () => { ... })
  })

  describe('extractSessionID', () => {
    it('returns sessionID from valid properties', () => { ... })
    it('returns null for missing properties', () => { ... })
    it('returns null for non-object properties', () => { ... })
    it('returns null for missing sessionID', () => { ... })
  })

  describe('fetchSessionMessages', () => {
    it('returns response on success', () => { ... })
    it('returns null on API error', () => { ... })
    it('returns null on timeout', () => { ... })
    it('clears timer on success', () => { ... })
    it('handles dangling promise rejection', () => { ... })
  })

  describe('extractTokens', () => {
    it('extracts all token types', () => { ... })
    it('returns null for missing tokens', () => { ... })
    it('returns null for NaN tokens', () => { ... })
    it('returns null for negative tokens', () => { ... })
    it('handles undefined cache.read', () => { ... })
  })

  describe('F4: baseline always updated', () => {
    it('updates baseline even when delta is zero', () => { ... })
    it('updates baseline even for non-DeepSeek models', () => { ... })
    it('updates baseline even when cache.read undefined', () => { ... })
  })

  describe('delta calculation', () => {
    it('clamps negative deltas to 0', () => { ... })
    it('returns zero delta for first session (no previous)', () => { ... })
    it('calculates correct delta with previous baseline', () => { ... })
  })

  describe('retry management', () => {
    it('resets retry state on success', () => { ... })
    it('increments retry count on failure', () => { ... })
    it('sets permanent backoff after max retries', () => { ... })
  })
})
```

**Verification**:
- [ ] `src/event-handler.test.ts` — 25+ tests pass
- [ ] All 202 existing tests pass
- [ ] EventHandler.handle() is <50 lines
- [ ] No method exceeds 25 lines
- [ ] Cyclomatic complexity <15 per method

---

### T2.3: Wire Up Dependency Injection in index.ts
**File**: `src/index.ts` (refactor 576 lines → ~150 lines)
**Effort**: Large
**Blocked by**: T1.1, T1.2, T1.3, T1.4, T2.1, T2.2

**Target**:
```typescript
import type { Plugin, PluginModule } from '@opencode-ai/plugin'
import { tool } from '@opencode-ai/plugin'
import { EventHandler } from './event-handler.js'
import { FingerprintTracker } from './fingerprint.js'
import { Logger } from './logger.js'
import { isApplicableDeepSeek } from './model-filter.js'
import { PersistenceManager } from './persistence-manager.js'
import { SessionManager } from './session-manager.js'
import { StatsManager } from './stats-manager.js'
import { normalizeSystemPrompt } from './system-transform.js'
import { findGitRoot, normalizeGitRoot } from './file-utils.js'
import { MAX_SESSION_BASELINES, SESSION_BASELINE_TTL_MS, MAX_LOG_SIZE } from './constants.js'
import { loadStatsFromJsonl, getLastFingerprintFromJsonl } from './cache-stats.js'

const DeepSeekCachePlugin: Plugin = async (ctx) => {
  const projectPath = ctx.directory || process.cwd()
  const gitRoot = findGitRoot(projectPath)
  const jsonlPath = join(projectPath, '.opencode', 'deepseek-cache-usage.jsonl')

  // DI: Create instances
  const logger = new Logger(
    join(projectPath, '.opencode', 'deepseek-cache-logs'),
    'debug.log',
    MAX_LOG_SIZE,
  )
  const persistenceManager = new PersistenceManager(jsonlPath)
  const sessionManager = new SessionManager(MAX_SESSION_BASELINES, SESSION_BASELINE_TTL_MS)
  const statsManager = new StatsManager(
    loadStatsFromJsonl(jsonlPath),
    getLastFingerprintFromJsonl(jsonlPath).model,
  )
  const fingerprintTracker = new FingerprintTracker(
    getLastFingerprintFromJsonl(jsonlPath).fingerprint,
  )

  // Restore baselines
  sessionManager.restoreFromMap(persistenceManager.loadBaselines())

  // Create event handler
  const eventHandler = new EventHandler(
    ctx, sessionManager, statsManager, persistenceManager,
    fingerprintTracker, isApplicableDeepSeek,
  )

  // Generate stable user_id
  const stableUserId = generateStableUserId(gitRoot || projectPath)

  logger.log('=== Plugin Loaded ===', { projectPath, gitRoot, stableUserId })

  let pluginDisposed = false

  return {
    config: async (config) => { /* 10 lines */ },
    'command.execute.before': async (input, output) => { /* 10 lines */ },
    'tool.definition': async (input, output) => { /* 10 lines */ },
    'tool.execute.after': async (input, output) => { /* 10 lines */ },
    'chat.params': async (input, output) => { /* 20 lines — user_id injection */ },
    'experimental.chat.system.transform': async (_input, output) => { /* 25 lines — normalization + fingerprint */ },
    event: async ({ event }) => { eventHandler.handle(event) },
    tool: { cacheStats: tool({ ... }) },
    dispose: () => { pluginDisposed = true; logger.dispose() },
  }
}
```

**Verification**:
- [ ] `src/index.ts` is <200 lines
- [ ] All 202 existing tests pass
- [ ] No module-level mutable variables (except `pluginDisposed` in closure)
- [ ] Compatibility contract tests pass

---

## Wave 3: Module Split (Depends on Wave 2)

### T3.1: Split cache-stats.ts into jsonl/ Module
**Files**:
- `src/jsonl/types.ts` (~30 lines) — re-exports from `../types.ts`
- `src/jsonl/reader.ts` (~80 lines) — `forEachJsonlRecord`, `loadStatsFromJsonl`, etc.
- `src/jsonl/writer.ts` (~60 lines) — `appendUsageToJsonl`, `saveBaselineToJsonl`
- `src/jsonl/index.ts` (~20 lines) — barrel export
**Effort**: Medium
**Blocked by**: T0.1 (types), T0.2 (type guards)

**Key**: `cache-stats.ts` becomes a thin re-export wrapper for backward compatibility:
```typescript
// src/cache-stats.ts — backward compatibility wrapper
export { forEachJsonlRecord, loadStatsFromJsonl, getLastFingerprintFromJsonl, loadBaselinesFromJsonl } from './jsonl/reader.js'
export { appendUsageToJsonl, saveBaselineToJsonl } from './jsonl/writer.js'
export { createCacheStats, getCacheReport } from './stats/report.js'
export type { CacheStats } from './types.js'
```

**Verification**:
- [ ] All 202 existing tests pass (zero import changes needed)
- [ ] `cache-stats.ts` exports are identical
- [ ] `src/jsonl/*.test.ts` tests pass

---

### T3.2: Split cache-stats.ts into stats/ Module
**Files**:
- `src/stats/loader.ts` (~50 lines) — `loadStatsFromJsonl`
- `src/stats/report.ts` (~120 lines) — `getCacheReport`, `createCacheStats`
- `src/stats/index.ts` (~15 lines) — barrel export
**Effort**: Medium
**Blocked by**: T3.1

**Verification**:
- [ ] All 202 existing tests pass
- [ ] Report format unchanged (contract tests verify)

---

## Wave 4: Performance & Polish (Depends on Wave 3)

### T4.1: Async File I/O Investigation
**Addresses**: F2 (async contamination)
**Effort**: Medium (investigation + conditional implementation)

**F2 Fix — Verify OpenCode Hook API**:
```typescript
// STEP 1: Check if OpenCode hooks support async return
// Current evidence: All hooks use `async` keyword → likely supported
// But: `event` hook calls `ctx.client.session.messages` with await → confirmed async

// STEP 2: If hooks are sync-only, keep sync I/O
// If hooks support async, convert to fs/promises

// STEP 3: Test with actual OpenCode runtime
// Create integration test that runs plugin in OpenCode-like environment
```

**Decision tree**:
```
IF OpenCode hooks support async:
  → Convert appendFileSync → appendFile (fs/promises)
  → Convert readFileSync → readFile (fs/promises)
  → Update PersistenceManager to async methods
  → Update EventHandler.handle() to await persistence
ELSE:
  → Keep sync I/O (current behavior)
  → Document limitation in ARCHITECTURE.md
```

**Verification**:
- [ ] Decision documented with evidence
- [ ] If async: all tests pass with async I/O
- [ ] If sync: no code changes, just documentation

---

### T4.2: Performance Benchmark Tests
**File**: `src/__tests__/performance.test.ts` (~100 lines)
**Addresses**: C5 (performance tests missing)
**Effort**: Medium

```typescript
describe('Performance Benchmarks', () => {
  it('event handler processes session.idle in <10ms', () => {
    const start = performance.now()
    // ... process event
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(10)
  })

  it('LRU eviction of 1000 entries completes in <5ms', () => { ... })
  it('JSONL load of 10,000 records completes in <100ms', () => { ... })
  it('report generation completes in <5ms', () => { ... })
  it('fingerprint computation completes in <1ms', () => { ... })
  it('1000 sequential event handlers do not leak memory', () => { ... })
})
```

**Verification**:
- [ ] All performance tests pass
- [ ] No performance regression vs baseline

---

## Execution Order Summary

```
Wave 0 (Parallel):
  T0.1 ──┐
  T0.2 ──┤
  T0.3 ──┤
  T0.4 ──┘

Wave 1 (Parallel after Wave 0):
  T1.1 (SessionManager) ───┐
  T1.2 (StatsManager) ─────┤
  T1.3 (Logger class) ─────┤
  T1.4 (Fingerprint class) ┘

Wave 2 (Sequential after Wave 1):
  T2.1 (PersistenceManager)
  T2.2 (EventHandler) ─── depends on T1.1, T1.2, T2.1
  T2.3 (Wire DI in index.ts) ─── depends on all Wave 1 + T2.1, T2.2

Wave 3 (After Wave 2):
  T3.1 (jsonl/ module split)
  T3.2 (stats/ module split)

Wave 4 (After Wave 3):
  T4.1 (Async I/O investigation)
  T4.2 (Performance tests)
```

---

## Risk Mitigation Matrix

| Issue | Risk | Mitigation | Verification |
|-------|------|------------|-------------|
| F1: Circular dep | SessionManager ↔ PersistenceManager | Repository pattern (IBaselineRepository interface) | `madge --circular src/` |
| F2: Async contamination | OpenCode may not support async hooks | Decision tree: test first, convert conditionally | Integration test with OpenCode runtime |
| F3: Persistence order | Writes may interleave | WAL pattern: enqueue → flush queue atomically | Test concurrent writes |
| F4: Zero delta skip | Baseline never updates | Always update baseline BEFORE checking delta | Test: zero delta still updates baseline |
| C1: 50% regression | Refactoring breaks behavior | Compatibility contract tests gate every commit | All contract tests green at every commit |
| C2: Test order undefined | Flaky tests | Each test creates fresh instances, no shared state | Run tests 10x with --shuffle |
| C3: Baseline migration | Old format incompatible | Migration tests with v2.1.7 JSONL fixtures | Test loadBaselinesFromJsonl with real data |
| C4: Fixtures insufficient | Edge cases missed | 20+ fixtures covering all edge cases | Fixture count verification |
| C5: Performance missing | Regression undetected | Benchmark tests with thresholds | All perf tests pass |

---

## File Change Summary

### New Files (14)
| File | Lines | Wave |
|------|-------|------|
| `src/types.ts` | ~80 | 0 |
| `src/utils/type-guards.ts` | ~30 | 0 |
| `src/__tests__/compatibility-contract.test.ts` | ~200 | 0 |
| `src/__tests__/fixtures.ts` | ~150 | 0 |
| `src/session-manager.ts` | ~120 | 1 |
| `src/stats-manager.ts` | ~80 | 1 |
| `src/persistence-manager.ts` | ~130 | 2 |
| `src/event-handler.ts` | ~200 | 2 |
| `src/jsonl/types.ts` | ~30 | 3 |
| `src/jsonl/reader.ts` | ~80 | 3 |
| `src/jsonl/writer.ts` | ~60 | 3 |
| `src/jsonl/index.ts` | ~20 | 3 |
| `src/stats/loader.ts` | ~50 | 3 |
| `src/stats/report.ts` | ~120 | 3 |

### Modified Files (6)
| File | Change | Wave |
|------|--------|------|
| `src/index.ts` | 576→~150 lines | 2 |
| `src/cache-stats.ts` | 407→~30 lines (re-export wrapper) | 3 |
| `src/logger.ts` | 210→~180 lines (class) | 1 |
| `src/fingerprint.ts` | 65→~50 lines (class) | 1 |
| `src/session-manager.test.ts` | New (~200 lines) | 1 |
| `src/event-handler.test.ts` | New (~300 lines) | 2 |

### New Test Files (8)
| File | Tests | Wave |
|------|-------|------|
| `src/__tests__/compatibility-contract.test.ts` | ~25 | 0 |
| `src/utils/type-guards.test.ts` | ~10 | 0 |
| `src/session-manager.test.ts` | ~20 | 1 |
| `src/stats-manager.test.ts` | ~12 | 1 |
| `src/persistence-manager.test.ts` | ~15 | 2 |
| `src/event-handler.test.ts` | ~25 | 2 |
| `src/jsonl/reader.test.ts` | ~15 | 3 |
| `src/__tests__/performance.test.ts` | ~6 | 4 |

**Total new tests**: ~128 (bringing total from 202 to ~330)

---

## Commit Strategy

```
Wave 0: 4 commits (one per task)
Wave 1: 4 commits (one per class extraction)
Wave 2: 3 commits (persistence, event handler, DI wiring)
Wave 3: 2 commits (jsonl split, stats split)
Wave 4: 2 commits (async investigation, perf tests)
Total: 15 commits
```

Each commit:
1. Passes all existing tests
2. Passes compatibility contract tests
3. Passes TypeScript strict mode
4. Passes Biome formatting
5. Has descriptive commit message: `refactor(wave-N): T{X}.{Y} — {description}`

---

## Success Criteria

- [ ] All 202+ existing tests pass
- [ ] All 128+ new tests pass
- [ ] Compatibility contract tests pass
- [ ] Zero module-level mutable state (except `pluginDisposed` closure)
- [ ] `index.ts` < 200 lines
- [ ] No function > 50 lines
- [ ] No cyclomatic complexity > 15
- [ ] No circular dependencies
- [ ] `npx tsc --noEmit` passes
- [ ] `npx biome ci .` passes
- [ ] Performance benchmarks within thresholds
