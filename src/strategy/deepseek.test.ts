import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock logger
vi.mock('../logger.js', () => ({
  log: vi.fn(),
  getLogPath: vi.fn(() => '/fake/debug.log'),
}))

// Import after mock setup
const { createDeepSeekStrategy } = await import('./deepseek.js')

const PROJECT_PATH = '/fake/project'

function hashProjectPath(p: string): string {
  return createHash('sha256').update(p).digest('hex').slice(0, 16)
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.DEEPSEEK_CACHE_NO_USER_ID
})

describe('createDeepSeekStrategy', () => {
  it('returns strategy with name deepseek', () => {
    const strategy = createDeepSeekStrategy(PROJECT_PATH)
    expect(strategy.name).toBe('deepseek')
  })

  describe('isApplicable', () => {
    it('returns true for official DeepSeek API URL', () => {
      const strategy = createDeepSeekStrategy(PROJECT_PATH)
      expect(strategy.isApplicable({ apiUrl: 'https://api.deepseek.com/v1' })).toBe(true)
    })

    it('returns true for DeepSeek subdomain URLs', () => {
      const strategy = createDeepSeekStrategy(PROJECT_PATH)
      expect(strategy.isApplicable({ apiUrl: 'https://chat.deepseek.com' })).toBe(true)
      expect(strategy.isApplicable({ apiUrl: 'https://api.deepseek.com.cn' })).toBe(true)
    })

    it('returns false for non-DeepSeek URLs', () => {
      const strategy = createDeepSeekStrategy(PROJECT_PATH)
      expect(strategy.isApplicable({ apiUrl: 'https://api.openai.com/v1' })).toBe(false)
      expect(strategy.isApplicable({ apiUrl: 'https://api.anthropic.com' })).toBe(false)
    })

    it('returns false for empty/undefined URLs', () => {
      const strategy = createDeepSeekStrategy(PROJECT_PATH)
      expect(strategy.isApplicable({})).toBe(false)
      expect(strategy.isApplicable({ apiUrl: '' })).toBe(false)
      expect(strategy.isApplicable({ apiUrl: undefined })).toBe(false)
    })

    it('returns true when providerId is deepseek (event handler fallback)', () => {
      const strategy = createDeepSeekStrategy(PROJECT_PATH)
      expect(strategy.isApplicable({ providerId: 'deepseek' })).toBe(true)
    })

    it('returns false for non-deepseek providerId', () => {
      const strategy = createDeepSeekStrategy(PROJECT_PATH)
      expect(strategy.isApplicable({ providerId: 'openai' })).toBe(false)
      expect(strategy.isApplicable({ providerId: 'anthropic' })).toBe(false)
    })
  })

  describe('normalizeSystem', () => {
    it('delegates to normalizeSystemPrompt', () => {
      const strategy = createDeepSeekStrategy(PROJECT_PATH)
      const result = strategy.normalizeSystem(['text'])
      expect(result).toHaveProperty('changed')
      expect(result).toHaveProperty('replacements')
      expect(result).toHaveProperty('fingerprint')
    })

    it('normalizes dynamic content', () => {
      const strategy = createDeepSeekStrategy(PROJECT_PATH)
      const system = ['Time: 2025-01-15T10:30:00Z']
      const result = strategy.normalizeSystem(system)
      expect(result.changed).toBe(true)
      expect(system[0]).toContain('[TIME]')
    })

    it('returns unchanged=false for static content', () => {
      const strategy = createDeepSeekStrategy(PROJECT_PATH)
      const system = ['Static text']
      const result = strategy.normalizeSystem(system)
      expect(result.changed).toBe(false)
    })
  })

  describe('computeFingerprint', () => {
    it('returns deterministic hex fingerprint', () => {
      const strategy = createDeepSeekStrategy(PROJECT_PATH)
      const a = strategy.computeFingerprint('test')
      const b = strategy.computeFingerprint('test')
      expect(a).toBe(b)
      expect(a).toMatch(/^[0-9a-f]{16}$/)
    })

    it('returns different fingerprints for different inputs', () => {
      const strategy = createDeepSeekStrategy(PROJECT_PATH)
      expect(strategy.computeFingerprint('a')).not.toBe(strategy.computeFingerprint('b'))
    })
  })

  describe('getProviderOptions', () => {
    it('returns stable user_id derived from project path', () => {
      const strategy = createDeepSeekStrategy(PROJECT_PATH)
      const options = strategy.getProviderOptions?.({ projectPath: PROJECT_PATH })
      expect(options?.user_id).toBe(`opencode-${hashProjectPath(PROJECT_PATH)}`)
    })

    it('returns same user_id for same project path', () => {
      const strategy = createDeepSeekStrategy(PROJECT_PATH)
      const a = strategy.getProviderOptions?.({ projectPath: PROJECT_PATH })
      const b = strategy.getProviderOptions?.({ projectPath: PROJECT_PATH })
      expect(a?.user_id).toBe(b?.user_id)
    })

    it('returns different user_id for different project paths', () => {
      const a = createDeepSeekStrategy('/project/a')
      const b = createDeepSeekStrategy('/project/b')
      expect(a.getProviderOptions?.({ projectPath: '/project/a' })?.user_id).not.toBe(
        b.getProviderOptions?.({ projectPath: '/project/b' })?.user_id,
      )
    })

    it('returns undefined when DEEPSEEK_CACHE_NO_USER_ID is set', () => {
      process.env.DEEPSEEK_CACHE_NO_USER_ID = 'true'
      const strategy = createDeepSeekStrategy(PROJECT_PATH)
      const options = strategy.getProviderOptions?.({ projectPath: PROJECT_PATH })
      expect(options).toBeUndefined()
    })

    it('respects GDPR opt-out env var (case-sensitive)', () => {
      process.env.DEEPSEEK_CACHE_NO_USER_ID = 'TRUE'
      const strategy = createDeepSeekStrategy(PROJECT_PATH)
      // should NOT match — only 'true' is accepted
      const options = strategy.getProviderOptions?.({ projectPath: PROJECT_PATH })
      expect(options?.user_id).toBeDefined()
    })
  })
})
