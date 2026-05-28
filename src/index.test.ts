import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies BEFORE imports
vi.mock('./logger.js', () => ({
  log: vi.fn(),
  getLogPath: vi.fn(() => '/fake/debug.log'),
  initLogger: vi.fn(),
}))

vi.mock('./cache-stats.js', () => ({
  loadStatsFromJsonl: vi.fn(() => ({
    totalHitTokens: 0, totalMissTokens: 0, requestCount: 0,
    prefixChanges: 0, firstRequestTime: null, lastRequestTime: null,
  })),
  appendUsageToJsonl: vi.fn(),
  getCacheReport: vi.fn(() => '# Report'),
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
}))

vi.mock('./system-transform.js', () => ({
  normalizeSystemPrompt: vi.fn(() => ({ changed: false, replacements: 0, fingerprint: 'abc123' })),
}))

vi.mock('@opencode-ai/plugin', () => ({ tool: vi.fn((o: any) => o) }))

const pm = await import('./index.js')
const { log, initLogger } = await import('./logger.js')
const { loadStatsFromJsonl, appendUsageToJsonl } = await import('./cache-stats.js')
const { isOfficialDeepSeekEndpoint, isOfficialDeepSeekProvider } = await import('./model-filter.js')

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
})

describe('chat.params hook', () => {
  it('injects user_id for DeepSeek models', async () => {
    vi.mocked(isOfficialDeepSeekEndpoint).mockReturnValue(true)
    const hooks = await initPlugin()
    const output: any = { options: {} }
    await hooks['chat.params']({ model: { api: { url: 'https://api.deepseek.com' }, id: 'deepseek-chat' }, provider: { info: { id: 'deepseek' } } }, output)
    expect(output.options.user_id).toBeDefined()
    expect(output.options.user_id).toMatch(/^opencode-/)
  })

  it('skips non-DeepSeek models', async () => {
    vi.mocked(isOfficialDeepSeekEndpoint).mockReturnValue(false)
    const hooks = await initPlugin()
    const output: any = { options: {} }
    await hooks['chat.params']({ model: { api: { url: 'https://api.openai.com' } } }, output)
    expect(output.options.user_id).toBeUndefined()
  })

  it('skips when DEEPSEEK_CACHE_NO_USER_ID is set', async () => {
    vi.mocked(isOfficialDeepSeekEndpoint).mockReturnValue(true)
    process.env.DEEPSEEK_CACHE_NO_USER_ID = 'true'
    const hooks = await initPlugin()
    const output: any = { options: {} }
    await hooks['chat.params']({ model: { api: { url: 'https://api.deepseek.com' } } }, output)
    delete process.env.DEEPSEEK_CACHE_NO_USER_ID
    expect(output.options.user_id).toBeUndefined()
  })

  it('logs warning when output.options is missing', async () => {
    vi.mocked(isOfficialDeepSeekEndpoint).mockReturnValue(true)
    const hooks = await initPlugin()
    const output: any = {}
    await hooks['chat.params']({ model: { api: { url: 'https://api.deepseek.com' } } }, output)
    expect(vi.mocked(log)).toHaveBeenCalled()
  })
})

describe('event handler', () => {
  it('records deltas on session.idle', async () => {
    vi.mocked(isOfficialDeepSeekProvider).mockReturnValue(true)
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
    vi.mocked(isOfficialDeepSeekProvider).mockReturnValue(false)
    const hooks = await initPlugin()
    await hooks.event({ event: { type: 'session.idle' as any, properties: { sessionID: 's1' } } })
    expect(appendUsageToJsonl).not.toHaveBeenCalled()
  })
})

describe('cacheStats tool', () => {
  it('returns a string report', async () => {
    const hooks = await initPlugin()
    const result = await hooks.tool.cacheStats.execute()
    expect(typeof result).toBe('string')
    expect(result).toContain('Report')
  })
})
