import { describe, expect, it } from 'vitest'

import {
  DEEPSEEK_PRICES,
  DYNAMIC_PATTERNS,
  FINGERPRINT_LENGTH,
  isOfficialDeepSeekEndpoint,
} from './constants.js'

describe('DYNAMIC_PATTERNS', () => {
  // Helper to test a pattern against input
  function matches(pattern: RegExp, input: string): boolean {
    pattern.lastIndex = 0
    return pattern.test(input)
  }

  function replace(pattern: RegExp, replacement: string, input: string): string {
    pattern.lastIndex = 0
    return input.replace(pattern, replacement)
  }

  describe('ISO timestamp pattern', () => {
    const pattern = DYNAMIC_PATTERNS[0]!

    it('matches UTC timestamp with Z', () => {
      expect(matches(pattern[0], '2025-01-15T10:30:00Z')).toBe(true)
    })

    it('matches timestamp with milliseconds', () => {
      expect(matches(pattern[0], '2025-01-15T10:30:00.123Z')).toBe(true)
    })

    it('matches timestamp with timezone offset', () => {
      expect(matches(pattern[0], '2025-01-15T10:30:00+08:00')).toBe(true)
      expect(matches(pattern[0], '2025-01-15T10:30:00+05:30')).toBe(true)
      expect(matches(pattern[0], '2025-01-15T10:30:00-05:00')).toBe(true)
    })

    it('matches timestamp without timezone', () => {
      expect(matches(pattern[0], '2025-01-15T10:30:00')).toBe(true)
    })

    it('replaces with [TIME]', () => {
      expect(replace(pattern[0], pattern[1], 'at 2025-01-15T10:30:00Z now')).toBe('at [TIME] now')
    })

    it('does not match plain date', () => {
      expect(matches(pattern[0], '2025-01-15')).toBe(false)
    })
  })

  describe('UUID pattern', () => {
    const pattern = DYNAMIC_PATTERNS[1]!

    it('matches lowercase UUID', () => {
      expect(matches(pattern[0], '550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    })

    it('matches uppercase UUID', () => {
      expect(matches(pattern[0], '550E8400-E29B-41D4-A716-446655440000')).toBe(true)
    })

    it('replaces with [ID]', () => {
      expect(replace(pattern[0], pattern[1], 'id=550e8400-e29b-41d4-a716-446655440000')).toBe(
        'id=[ID]',
      )
    })

    it('does not match non-UUID string', () => {
      expect(matches(pattern[0], 'not-a-uuid-at-all')).toBe(false)
    })
  })

  describe('Date string patterns (abbreviated day)', () => {
    const pattern = DYNAMIC_PATTERNS[2]!

    it('matches Mon Jan 01 2025', () => {
      expect(matches(pattern[0], 'Mon Jan 01 2025')).toBe(true)
    })

    it('matches Fri Dec 31 2024', () => {
      expect(matches(pattern[0], 'Fri Dec 31 2024')).toBe(true)
    })

    it('replaces with [DATE]', () => {
      expect(replace(pattern[0], pattern[1], 'on Mon Jan 01 2025')).toBe('on [DATE]')
    })
  })

  describe('Date string patterns (full month name)', () => {
    const pattern = DYNAMIC_PATTERNS[3]!

    it('matches January 01, 2025', () => {
      expect(matches(pattern[0], 'January 01, 2025')).toBe(true)
    })

    it('matches December 31 2024 (no comma)', () => {
      expect(matches(pattern[0], 'December 31 2024')).toBe(true)
    })

    it('replaces with [DATE]', () => {
      expect(replace(pattern[0], pattern[1], 'on January 15, 2025')).toBe('on [DATE]')
    })
  })

  describe('Version string pattern', () => {
    const pattern = DYNAMIC_PATTERNS[4]!

    it('matches v1.2.3', () => {
      expect(matches(pattern[0], 'v1.2.3')).toBe(true)
    })

    it('matches v1.2.3-beta.1', () => {
      expect(matches(pattern[0], 'v1.2.3-beta.1')).toBe(true)
    })

    it('replaces with [VERSION]', () => {
      expect(replace(pattern[0], pattern[1], 'using v2.0.1 now')).toBe('using [VERSION] now')
    })

    it('does not match incomplete version', () => {
      expect(matches(pattern[0], 'v1.2')).toBe(false)
    })
  })

  describe('Temp path pattern (Unix)', () => {
    const pattern = DYNAMIC_PATTERNS[5]!

    it('matches /tmp/ paths', () => {
      expect(matches(pattern[0], '/tmp/abc123')).toBe(true)
    })

    it('matches /temp/ paths', () => {
      expect(matches(pattern[0], '/temp/my-file')).toBe(true)
    })

    it('replaces with [TEMP]', () => {
      expect(replace(pattern[0], pattern[1], 'file at /tmp/abc123 end')).toBe('file at [TEMP] end')
    })
  })

  describe('Temp path pattern (Windows)', () => {
    const pattern = DYNAMIC_PATTERNS[6]!

    it('matches Windows temp paths', () => {
      expect(matches(pattern[0], 'C:\\Users\\john\\AppData\\Local\\Temp\\abc123')).toBe(true)
    })

    it('replaces with [TEMP]', () => {
      expect(
        replace(pattern[0], pattern[1], 'in C:\\Users\\john\\AppData\\Local\\Temp\\abc123 now'),
      ).toBe('in [TEMP] now')
    })
  })

  describe('Process ID pattern', () => {
    const pattern = DYNAMIC_PATTERNS[7]!

    it('matches /proc/ paths', () => {
      expect(matches(pattern[0], '/proc/12345')).toBe(true)
    })

    it('replaces with [PID]', () => {
      expect(replace(pattern[0], pattern[1], 'at /proc/12345')).toBe('at [PID]')
    })
  })

  it('has 8 patterns total', () => {
    expect(DYNAMIC_PATTERNS).toHaveLength(8)
  })
})

describe('DEEPSEEK_PRICES', () => {
  it('has correct cache miss price', () => {
    expect(DEEPSEEK_PRICES.cacheMiss).toBe(3.0)
  })

  it('has correct cache hit price', () => {
    expect(DEEPSEEK_PRICES.cacheHit).toBe(0.025)
  })

  it('cache hit is cheaper than cache miss', () => {
    expect(DEEPSEEK_PRICES.cacheHit).toBeLessThan(DEEPSEEK_PRICES.cacheMiss)
  })
})

describe('FINGERPRINT_LENGTH', () => {
  it('is 16', () => {
    expect(FINGERPRINT_LENGTH).toBe(16)
  })
})
describe('isOfficialDeepSeekEndpoint', () => {
  it('returns true for api.deepseek.com', () => {
    expect(isOfficialDeepSeekEndpoint('https://api.deepseek.com/v1/chat/completions')).toBe(true)
    expect(isOfficialDeepSeekEndpoint('https://api.deepseek.com')).toBe(true)
  })
  it('returns true for api.deepseek.com.cn (China node)', () => {
    expect(isOfficialDeepSeekEndpoint('https://api.deepseek.com.cn/v1')).toBe(true)
  })
  it('returns false for path-embedded deepseek URL', () => {
    expect(isOfficialDeepSeekEndpoint('https://evil.com/api.deepseek.com/v1')).toBe(false)
  })
  it('returns false for third-party endpoints', () => {
    expect(isOfficialDeepSeekEndpoint('https://api.siliconflow.cn/v1')).toBe(false)
    expect(isOfficialDeepSeekEndpoint('https://api.openrouter.ai')).toBe(false)
  })
  it('returns false for invalid URL', () => {
    expect(isOfficialDeepSeekEndpoint('')).toBe(false)
    expect(isOfficialDeepSeekEndpoint('not-a-url')).toBe(false)
  })
})
