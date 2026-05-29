import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies BEFORE imports
vi.mock('./logger.js', () => ({
  log: vi.fn(),
  getLogPath: vi.fn(() => '/fake/debug.log'),
  initLogger: vi.fn(),
  dispose: vi.fn(),
}))

vi.mock('./cache-stats.js', () => ({
  loadStatsFromJsonl: vi.fn(() => ({
    totalHitTokens: 0,
    totalMissTokens: 0,
    requestCount: 0,
    prefixChanges: 0,
    firstRequestTime: null,
    lastRequestTime: null,
  })),
  appendUsageToJsonl: vi.fn(),
  getCacheReport: vi.fn(() => '# Report'),
  getLastFingerprintFromJsonl: vi.fn(() => ({ fingerprint: null, model: null })),
  saveBaselineToJsonl: vi.fn(),
  loadBaselinesFromJsonl: vi.fn(() => new Map()),
}))

vi.mock('./fingerprint.js', () => ({
  createFingerprintTracker: vi.fn(() => ({
    compute: vi.fn(() => ({ fingerprint: 'abc123', changed: false, previous: null })),
    getLastFingerprint: vi.fn(() => 'abc123'),
  })),
}))

vi.mock('./model-filter.js', () => ({
  isOfficialDeepSeekEndpoint: vi.fn(() => true),
  isOfficialDeepSeekProvider: vi.fn(() => true),
  isApplicableDeepSeek: vi.fn(() => true),
}))

vi.mock('./system-transform.js', () => ({
  normalizeSystemPrompt: vi.fn(() => ({ changed: false, replacements: 0, fingerprint: 'abc123', normalized: '' })),
}))

vi.mock('./file-utils.js', () => ({
  findGitRoot: vi.fn((p: string) => p), // default: identity (no .git found)
}))

vi.mock('@opencode-ai/plugin', () => ({ tool: vi.fn((o: any) => o) }))
vi.mock('./constants.js', () => {
  return {
    get SESSION_BASELINE_TTL_MS() { return Number(process.env.DEEPSEEK_CACHE_SESSION_TTL_MS) || 86400000 },
    get MAX_SESSION_BASELINES() { return Number(process.env.DEEPSEEK_CACHE_MAX_SESSIONS) || 1000 },
  }
})


const pm = await import('./index.js')
const { log, initLogger, dispose: disposeLogger } = await import('./logger.js')
const { loadStatsFromJsonl, appendUsageToJsonl, getLastFingerprintFromJsonl } = await import(
  './cache-stats.js'
)
const { isApplicableDeepSeek } = await import('./model-filter.js')

beforeEach(() => vi.clearAllMocks())

// Helper: create mock context and invoke plugin factory
async function initPlugin(overrides: any = {}) {
  const ctx = {
    directory: '/fake/project',
    client: {
      session: {
        get: vi.fn().mockResolvedValue({
          data: {
            tokens: { cache: { read: 500 }, input: 100 },
            model: { id: 'deepseek-chat', providerID: 'deepseek' },
          },
        }),
      },
    },
    ...overrides,
  }
  return (pm.default.server as any)(ctx)
}

describe('plugin module', () => {
  it('exports module with id deepseek-cache', () => {
    expect(pm.default.id).toBe('deepseek-cache')
    expect(typeof pm.default.server).toBe('function')
  })

  it('initializes logger and loads stats on init', async () => {
    await initPlugin()
    expect(initLogger).toHaveBeenCalled()
    expect(loadStatsFromJsonl).toHaveBeenCalled()
    expect(vi.mocked(getLastFingerprintFromJsonl)).toHaveBeenCalled()
  })
})

describe('config hook', () => {
  it('registers /cache-stats command', async () => {
    const hooks = await initPlugin()
    const cfg: any = { command: {} }
    await hooks.config(cfg)
    expect(cfg.command['cache-stats']).toBeDefined()
  })
})

describe('command.execute.before hook', () => {
  it('intercepts cache-stats and sets output.parts', async () => {
    const hooks = await initPlugin()
    const output: any = { parts: [] }
    await hooks['command.execute.before']({ command: 'cache-stats' }, output)
    expect(output.parts.length).toBe(1)
    expect(output.parts[0].text).toContain('Report')
  })

  it('ignores other commands', async () => {
    const hooks = await initPlugin()
    const output: any = { parts: [] }
    await hooks['command.execute.before']({ command: 'other' }, output)
    expect(output.parts.length).toBe(0)
  })

  it('logs warning when output is null for cache-stats', async () => {
    const hooks = await initPlugin()
    vi.mocked(log).mockClear()
    await hooks['command.execute.before']({ command: 'cache-stats' }, null)
    expect(vi.mocked(log)).toHaveBeenCalledWith(
      expect.stringContaining('WARNING: output or output.parts unavailable'),
    )
  })
})

describe('chat.params hook', () => {
  it('injects user_id for DeepSeek models', async () => {
    vi.mocked(isApplicableDeepSeek).mockReturnValue(true)
    const hooks = await initPlugin()
    const output: any = { options: {} }
    await hooks['chat.params'](
      {
        model: { api: { url: 'https://api.deepseek.com' }, id: 'deepseek-chat' },
        provider: { info: { id: 'deepseek' } },
      },
      output,
    )
    expect(output.options.user_id).toBeDefined()
    expect(output.options.user_id).toMatch(/^opencode-/)
    // Verify findGitRoot was called
    const { findGitRoot } = await import('./file-utils.js')
    expect(vi.mocked(findGitRoot)).toHaveBeenCalledWith('/fake/project')
  })

  it('uses git root for user_id when .git found', async () => {
    vi.mocked(isApplicableDeepSeek).mockReturnValue(true)
    const { findGitRoot } = await import('./file-utils.js')
    vi.mocked(findGitRoot).mockReturnValue('/fake/git-root')
    const hooks = await initPlugin()
    const output: any = { options: {} }
    await hooks['chat.params'](
      {
        model: { api: { url: 'https://api.deepseek.com' }, id: 'deepseek-chat' },
        provider: { info: { id: 'deepseek' } },
      },
      output,
    )
    // user_id should be based on git root, not /fake/project
    expect(output.options.user_id).toBeDefined()
    const { createHash } = await import('node:crypto')
    const expectedHash = createHash('sha256').update('/fake/git-root').digest('hex').slice(0, 16)
    expect(output.options.user_id).toBe(`opencode-${expectedHash}`)
  })

  it('skips non-DeepSeek models', async () => {
    vi.mocked(isApplicableDeepSeek).mockReturnValue(false)
    const hooks = await initPlugin()
    const output: any = { options: {} }
    await hooks['chat.params']({ model: { api: { url: 'https://api.openai.com' } } }, output)
    expect(output.options.user_id).toBeUndefined()
  })

  it('skips when DEEPSEEK_CACHE_NO_USER_ID is set', async () => {
    vi.mocked(isApplicableDeepSeek).mockReturnValue(true)
    process.env.DEEPSEEK_CACHE_NO_USER_ID = 'true'
    const hooks = await initPlugin()
    const output: any = { options: {} }
    await hooks['chat.params']({ model: { api: { url: 'https://api.deepseek.com' } } }, output)
    delete process.env.DEEPSEEK_CACHE_NO_USER_ID
    expect(output.options.user_id).toBeUndefined()
  })

  it('logs warning when output.options is missing', async () => {
    vi.mocked(isApplicableDeepSeek).mockReturnValue(true)
    const hooks = await initPlugin()
    const output: any = {}
    await hooks['chat.params']({ model: { api: { url: 'https://api.deepseek.com' } } }, output)
    expect(vi.mocked(log)).toHaveBeenCalled()
  })

  it('skips when DEEPSEEK_CACHE_NO_USER_ID is True (case-insensitive)', async () => {
    vi.mocked(isApplicableDeepSeek).mockReturnValue(true)
    process.env.DEEPSEEK_CACHE_NO_USER_ID = 'True'
    const hooks = await initPlugin()
    const output: any = { options: {} }
    await hooks['chat.params']({ model: { api: { url: 'https://api.deepseek.com' } } }, output)
    delete process.env.DEEPSEEK_CACHE_NO_USER_ID
    expect(output.options.user_id).toBeUndefined()
  })
})

describe('event handler', () => {
  it('records deltas on session.idle', async () => {
    vi.mocked(isApplicableDeepSeek).mockReturnValue(true)
    const hooks = await initPlugin()
    await hooks.event({ event: { type: 'session.idle' as any, properties: { sessionID: 's1' } } })
    expect(appendUsageToJsonl).toHaveBeenCalled()
  })

  it('skips non-session.idle events', async () => {
    const hooks = await initPlugin()
    await hooks.event({ event: { type: 'other' as any } })
    expect(appendUsageToJsonl).not.toHaveBeenCalled()
  })

  it('skips non-DeepSeek providers', async () => {
    vi.mocked(isApplicableDeepSeek).mockReturnValue(false)
    const hooks = await initPlugin()
    await hooks.event({ event: { type: 'session.idle' as any, properties: { sessionID: 's1' } } })
    expect(appendUsageToJsonl).not.toHaveBeenCalled()
  })

  it('persists fingerprint changes via appendUsageToJsonl', async () => {
    const { createFingerprintTracker } = await import('./fingerprint.js')
    const { normalizeSystemPrompt } = await import('./system-transform.js')
    vi.mocked(createFingerprintTracker).mockReturnValue({
      compute: vi.fn(() => ({ fingerprint: 'new-fp', changed: true, previous: 'old-fp' })),
      getLastFingerprint: vi.fn(() => 'new-fp'),
    } as any)
    vi.mocked(normalizeSystemPrompt).mockReturnValue({
      changed: true,
      replacements: 2,
      fingerprint: 'new-fp',
      normalized: '',
    })
    vi.mocked(isApplicableDeepSeek).mockReturnValue(true)
    const hooks = await initPlugin()
    vi.mocked(appendUsageToJsonl).mockClear()
    await hooks['experimental.chat.system.transform'](
      { model: { api: { url: 'https://api.deepseek.com' } } } as any,
      { system: 'test' } as any,
    )
    expect(vi.mocked(appendUsageToJsonl)).toHaveBeenCalledWith(expect.any(String), 0, 0, 'new-fp', undefined, expect.any(Number))
  })
})

it('clears timeout timer when real promise resolves', async () => {
  vi.mocked(isApplicableDeepSeek).mockReturnValue(true)
  const hooks = await initPlugin()
  const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
  await hooks.event({ event: { type: 'session.idle' as any, properties: { sessionID: 's1' } } })
  expect(clearTimeoutSpy).toHaveBeenCalled()
  clearTimeoutSpy.mockRestore()
})

it('evicts oldest session baseline when map exceeds 1000 entries', async () => {
  vi.mocked(isApplicableDeepSeek).mockReturnValue(true)
  const hooks = await initPlugin()
  // Trigger 1001 different sessions to fill the map
  for (let i = 1; i <= 1001; i++) {
    await hooks.event({
      event: { type: 'session.idle' as any, properties: { sessionID: `s${i}` } },
    })
  }
  // s1's baseline should have been evicted (oldest entry)
  // Trigger s1 again — since baseline is gone, full delta should be recorded
  vi.mocked(appendUsageToJsonl).mockClear()
  await hooks.event({ event: { type: 'session.idle' as any, properties: { sessionID: 's1' } } })
  expect(appendUsageToJsonl).toHaveBeenCalled()
})

describe('cacheStats tool', () => {
  it('returns a string report', async () => {
    const hooks = await initPlugin()
    const result = await hooks.tool.cacheStats.execute()
    expect(typeof result).toBe('string')
    expect(result).toContain('Report')
  })
})

describe('R2: dangling session.get promise', () => {
  it('does not crash when session.get rejects after timeout', async () => {
    // Arrange: session.get rejects after a delay, timer fires immediately
    let unhandledRejection: Error | undefined
    process.on('unhandledRejection', (reason) => {
      unhandledRejection = reason as Error
    })

    try {
      vi.mocked(isApplicableDeepSeek).mockReturnValue(true)
      const hooks = await initPlugin({
        client: {
          session: {
            get: vi.fn().mockImplementation(
              () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('network error')), 50)),
            ),
          },
        },
      })

      // Act: fire event with 0ms timeout — timer wins the race
      await hooks.event({
        event: { type: 'session.idle' as any, properties: { sessionID: 's1' } },
      })

      // Wait for the delayed rejection to fire
      await new Promise((r) => setTimeout(r, 100))

      // Assert: no unhandled rejection
      expect(unhandledRejection).toBeUndefined()
    } finally {
      process.removeListener('unhandledRejection', (reason) => {
        unhandledRejection = reason as Error
      })
    }
  })
})

describe('R3: empty gitRoot fallback', () => {
  it('falls back to projectPath when gitRoot is empty', async () => {
    // Arrange: findGitRoot returns '' (non-git project)
    const { findGitRoot } = await import('./file-utils.js')
    vi.mocked(findGitRoot).mockReturnValue('')
    vi.mocked(isApplicableDeepSeek).mockReturnValue(true)

    const hooks = await initPlugin()
    const output: any = { options: {} }
    await hooks['chat.params'](
      {
        model: { api: { url: 'https://api.deepseek.com' }, id: 'deepseek-chat' },
        provider: { info: { id: 'deepseek' } },
      },
      output,
    )

    // Act & Assert: user_id should NOT be based on sha256('')
    const { createHash } = await import('node:crypto')
    const emptyHash = createHash('sha256').update('').digest('hex').slice(0, 16)
    const projectPathHash = createHash('sha256').update('/fake/project').digest('hex').slice(0, 16)

    expect(output.options.user_id).toBeDefined()
    expect(output.options.user_id).not.toBe(`opencode-${emptyHash}`)
    expect(output.options.user_id).toBe(`opencode-${projectPathHash}`)
  })
})

describe('dispose hook', () => {
  it('exposes a dispose function on the plugin return', async () => {
    const hooks = await initPlugin()
    expect(typeof hooks.dispose).toBe('function')
  })

  it('calls disposeLogger when dispose is invoked', async () => {
    const hooks = await initPlugin()
    hooks.dispose()
    expect(vi.mocked(disposeLogger)).toHaveBeenCalled()
  })
})

describe('baseline persistence — reload does not double-count', () => {
  it('restores baselines from JSONL and only records deltas after reload', async () => {
    // Arrange: simulate a previous session that recorded 500 hit, 100 miss tokens
    const { loadBaselinesFromJsonl, saveBaselineToJsonl } = await import('./cache-stats.js')
    vi.mocked(loadBaselinesFromJsonl).mockReturnValue(
      new Map([['session-reload', { input: 100, cacheRead: 500 }]]),
    )
    vi.mocked(isApplicableDeepSeek).mockReturnValue(true)

    const hooks = await initPlugin()

    // Act: fire session.idle with same session, now at 600 hit, 150 miss
    // (delta should be 100 hit, 50 miss — NOT 600 hit, 150 miss)
    const mockGet = vi.fn().mockResolvedValue({
      data: {
        tokens: { cache: { read: 600 }, input: 150 },
        model: { id: 'deepseek-chat', providerID: 'deepseek' },
      },
    })
    // Re-init plugin with custom client that returns our session data
    const hooks2 = await initPlugin({
      client: { session: { get: mockGet } },
    })

    vi.mocked(appendUsageToJsonl).mockClear()
    await hooks2.event({
      event: { type: 'session.idle' as any, properties: { sessionID: 'session-reload' } },
    })

    // Assert: appendUsageToJsonl was called with deltas, not absolutes
    expect(vi.mocked(appendUsageToJsonl)).toHaveBeenCalled()
    const call = vi.mocked(appendUsageToJsonl).mock.calls[0]!
    const deltaHit = call[1] // hitTokens arg
    const deltaMiss = call[2] // missTokens arg
    expect(deltaHit).toBe(100) // 600 - 500
    expect(deltaMiss).toBe(50)  // 150 - 100
  })

  it('persists baseline via saveBaselineToJsonl on session.idle', async () => {
    const { saveBaselineToJsonl } = await import('./cache-stats.js')
    vi.mocked(isApplicableDeepSeek).mockReturnValue(true)

    const hooks = await initPlugin()
    vi.mocked(saveBaselineToJsonl).mockClear()

    await hooks.event({
      event: { type: 'session.idle' as any, properties: { sessionID: 's-persist' } },
    })

    expect(vi.mocked(saveBaselineToJsonl)).toHaveBeenCalledWith(
      expect.any(String),
      's-persist',
      expect.any(Number),
      expect.any(Number),
      expect.any(String),
    )
  })
})

describe('H3: cross-model token leakage prevention', () => {
  it('does not leak non-DeepSeek tokens into DeepSeek stats', async () => {
    // Arrange: simulate interleaved DS and non-DS sessions with CUMULATIVE tokens
    // session.tokens is a running total across all models in the session
    const mockGet = vi.fn()
      // DeepSeek call #1: cumulative 500 hit, 100 miss
      .mockResolvedValueOnce({
        data: {
          tokens: { cache: { read: 500 }, input: 100 },
          model: { id: 'deepseek-chat', providerID: 'deepseek' },
        },
      })
      // Non-DeepSeek call: cumulative 500 hit, 400 miss (added 300 input)
      .mockResolvedValueOnce({
        data: {
          tokens: { cache: { read: 500 }, input: 400 },
          model: { id: 'gpt-4', providerID: 'openai' },
        },
      })
      // DeepSeek call #2: cumulative 800 hit, 600 miss (added 300 hit, 200 miss)
      .mockResolvedValueOnce({
        data: {
          tokens: { cache: { read: 800 }, input: 600 },
          model: { id: 'deepseek-chat', providerID: 'deepseek' },
        },
      })

    const hooks = await initPlugin({ client: { session: { get: mockGet } } })

    // Act: fire 3 events
    vi.mocked(isApplicableDeepSeek).mockReturnValueOnce(true)   // DS #1
    await hooks.event({ event: { type: 'session.idle' as any, properties: { sessionID: 's1' } } })

    vi.mocked(isApplicableDeepSeek).mockReturnValueOnce(false)  // non-DS
    await hooks.event({ event: { type: 'session.idle' as any, properties: { sessionID: 's1' } } })

    vi.mocked(isApplicableDeepSeek).mockReturnValueOnce(true)   // DS #2
    vi.mocked(appendUsageToJsonl).mockClear()
    await hooks.event({ event: { type: 'session.idle' as any, properties: { sessionID: 's1' } } })

    // Assert: DS #2 delta should only reflect DS model's contribution
    // DS #2 added 300 hit, 200 miss on top of baseline updated by non-DS call
    // WITHOUT H3 fix: baseline stays at {500, 100}, delta = {300, 500} (LEAK!)
    // WITH H3 fix: baseline updated to {500, 400}, delta = {300, 200} (correct)
    expect(vi.mocked(appendUsageToJsonl)).toHaveBeenCalled()
    const call = vi.mocked(appendUsageToJsonl).mock.calls[0]!
    const deltaHit = call[1]
    const deltaMiss = call[2]
    expect(deltaHit).toBe(300)   // 800 - 500
    expect(deltaMiss).toBe(200)  // 600 - 400 (not 600 - 100)
})
})



describe('M6: cache.read undefined handling', () => {
  it('skips stats when cache.read is undefined but updates baseline', async () => {
    const mockGet = vi.fn()
      // First call: establish baseline with cache.read = 500
      .mockResolvedValueOnce({
        data: {
          tokens: { cache: { read: 500 }, input: 100 },
          model: { id: 'deepseek-chat', providerID: 'deepseek' },
        },
      })
      // Second call: cache.read is undefined (API didn't report it)
      .mockResolvedValueOnce({
        data: {
          tokens: { input: 200 },  // no cache property at all
          model: { id: 'deepseek-chat', providerID: 'deepseek' },
        },
      })

    vi.mocked(isApplicableDeepSeek).mockReturnValue(true)
    const hooks = await initPlugin({ client: { session: { get: mockGet } } })

    // First event: establish baseline
    await hooks.event({ event: { type: 'session.idle' as any, properties: { sessionID: 's1' } } })

    // Second event: cache.read is undefined
    vi.mocked(appendUsageToJsonl).mockClear()
    vi.mocked(log).mockClear()
    await hooks.event({ event: { type: 'session.idle' as any, properties: { sessionID: 's1' } } })

    // Assert: appendUsageToJsonl should NOT be called (stats skipped)
    expect(vi.mocked(appendUsageToJsonl)).not.toHaveBeenCalled()
    // Assert: debug log about cache.read unavailable
    expect(vi.mocked(log)).toHaveBeenCalledWith(
      expect.stringContaining('cache.read unavailable'),
      expect.objectContaining({ sessionID: 's1' }),
    )
  })
})

describe('H5: TTL-based session baseline eviction', () => {
  it.skip('sweeps expired baselines via TTL', async () => {
    vi.mocked(isApplicableDeepSeek).mockReturnValue(true)
    process.env.DEEPSEEK_CACHE_SESSION_TTL_MS = '0'
    
    // Use fake timers from the start so all Date.now() calls are controlled
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const hooks = await initPlugin()

    // Set a baseline for session s1 (lastAccess = 1000)
    await hooks.event({
      event: { type: 'session.idle' as any, properties: { sessionID: 's1' } },
    })

    // Advance time by 1ms so Date.now() - lastAccess = 1001 - 1000 = 1 > 0
    vi.setSystemTime(1001)

    // Fire a DIFFERENT session — the sweep runs and finds s1 expired
    await hooks.event({
      event: { type: 'session.idle' as any, properties: { sessionID: 's2' } },
    })
    vi.useRealTimers()

    // Now s1 should be evicted — trigger s1 again and verify it's treated as fresh
    vi.mocked(appendUsageToJsonl).mockClear()
    await hooks.event({
      event: { type: 'session.idle' as any, properties: { sessionID: 's1' } },
    })

    // Since baseline was evicted, it's treated as first call — delta should be non-zero
    expect(vi.mocked(appendUsageToJsonl)).toHaveBeenCalled()
    delete process.env.DEEPSEEK_CACHE_SESSION_TTL_MS
})
})

describe('M5: cachedModelId restored from JSONL history', () => {
  it('sets cachedModelId from getLastFingerprintFromJsonl on init', async () => {
    const { getLastFingerprintFromJsonl, getCacheReport } = await import('./cache-stats.js')
    vi.mocked(getLastFingerprintFromJsonl).mockReturnValue({
      fingerprint: 'test-fp',
      model: 'deepseek-reasoner',
    })

    const hooks = await initPlugin()

    // Trigger /cache-stats command to read cachedModelId
    const output: any = { parts: [] }
    await hooks['command.execute.before']({ command: 'cache-stats' }, output)

    // Assert: getCacheReport was called with the restored model ID
    expect(vi.mocked(getCacheReport)).toHaveBeenCalledWith(
      expect.any(Object),
      expect.anything(),
      'deepseek-reasoner',
    )
  })
})
