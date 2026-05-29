import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock logger module before importing cache-stats
vi.mock('./logger.js', () => ({
  log: vi.fn(),
  getLogPath: vi.fn(() => '/fake/debug.log'),
}))

// Mock fs module before importing cache-stats
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []) as any,
  openSync: vi.fn(() => 99),
  closeSync: vi.fn(),
  renameSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 0 })),
  unlinkSync: vi.fn(),
}))

// Import after mock setup
const fs = await import('node:fs')
const {
  loadStatsFromJsonl,
  appendUsageToJsonl,
  createCacheStats,
  getCacheReport,
  getLastFingerprintFromJsonl,
  saveBaselineToJsonl,
  loadBaselinesFromJsonl,
} = await import('./cache-stats.js')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createCacheStats', () => {
  it('returns zeroed stats with null timestamps', () => {
    const stats = createCacheStats()
    expect(stats).toEqual({
      totalHitTokens: 0,
      totalMissTokens: 0,
      requestCount: 0,
      prefixChanges: 0,
      firstRequestTime: null,
      lastRequestTime: null,
    })
  })
})

describe('loadStatsFromJsonl', () => {
  it('returns empty stats when file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const stats = loadStatsFromJsonl('/fake/path.jsonl')
    expect(stats).toEqual(createCacheStats())
    expect(fs.readFileSync).not.toHaveBeenCalled()
  })

  it('parses JSONL records correctly', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['path.jsonl'] as any)
    vi.mocked(fs.readFileSync).mockReturnValue(
      '{"t":1000,"hit":500,"miss":100}\n{"t":2000,"hit":300,"miss":50}\n',
    )
    const stats = loadStatsFromJsonl('/fake/path.jsonl')
    expect(stats.totalHitTokens).toBe(800)
    expect(stats.totalMissTokens).toBe(150)
    expect(stats.requestCount).toBe(2)
    expect(stats.firstRequestTime).toBe(1000)
    expect(stats.lastRequestTime).toBe(2000)
  })

  it('handles empty file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['path.jsonl'] as any)
    vi.mocked(fs.readFileSync).mockReturnValue('')
    const stats = loadStatsFromJsonl('/fake/path.jsonl')
    expect(stats.requestCount).toBe(0)
  })

  it('skips malformed lines', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['path.jsonl'] as any)
    vi.mocked(fs.readFileSync).mockReturnValue(
      '{"t":1000,"hit":500,"miss":100}\nNOT JSON\n{"t":2000,"hit":200,"miss":50}\n',
    )
    const stats = loadStatsFromJsonl('/fake/path.jsonl')
    expect(stats.requestCount).toBe(2)
    expect(stats.totalHitTokens).toBe(700)
  })

  it('tracks prefix fingerprint changes', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['path.jsonl'] as any)
    vi.mocked(fs.readFileSync).mockReturnValue(
      '{"t":1000,"hit":100,"miss":0,"fp":"aaa"}\n{"t":2000,"hit":200,"miss":0,"fp":"bbb"}\n{"t":3000,"hit":300,"miss":0,"fp":"bbb"}\n',
    )
    const stats = loadStatsFromJsonl('/fake/path.jsonl')
    expect(stats.prefixChanges).toBe(1)
  })

  it('returns empty stats on read error', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['path.jsonl'] as any)
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('read error')
    })
    const stats = loadStatsFromJsonl('/fake/path.jsonl')
    expect(stats).toEqual(createCacheStats())
  })

  it('handles records with missing timestamp gracefully', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['path.jsonl'] as any)
    vi.mocked(fs.readFileSync).mockReturnValue('{"hit":100,"miss":50}\n')
    const stats = loadStatsFromJsonl('/fake/path.jsonl')
    expect(stats.requestCount).toBe(1)
    expect(stats.firstRequestTime).not.toBeNull()
  })

  it('does not count fingerprint-only records in requestCount', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['path.jsonl'] as any)
    vi.mocked(fs.readFileSync).mockReturnValue(
      '{"t":1000,"hit":0,"miss":0,"fp":"aaa","type":"fingerprint"}\n',
    )
    const stats = loadStatsFromJsonl('/fake/path.jsonl')
    expect(stats.requestCount).toBe(0)
    expect(stats.totalHitTokens).toBe(0)
    expect(stats.totalMissTokens).toBe(0)
  })

  it('counts usage records normally', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['path.jsonl'] as any)
    vi.mocked(fs.readFileSync).mockReturnValue(
      '{"t":1000,"hit":500,"miss":100,"type":"usage"}\n',
    )
    const stats = loadStatsFromJsonl('/fake/path.jsonl')
    expect(stats.requestCount).toBe(1)
    expect(stats.totalHitTokens).toBe(500)
    expect(stats.totalMissTokens).toBe(100)
  })
})

describe('appendUsageToJsonl', () => {
  it('creates directory if it does not exist and appends record', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.appendFileSync).mockImplementation(() => {})

    appendUsageToJsonl('/fake/dir/file.jsonl', 500, 100, 'abc123')

    expect(fs.mkdirSync).toHaveBeenCalledWith('/fake/dir', { recursive: true })
    expect(fs.appendFileSync).toHaveBeenCalledTimes(1)
    const [path, content] = vi.mocked(fs.appendFileSync).mock.calls[0]!
    expect(path).toBe('/fake/dir/file.jsonl')
    const record = JSON.parse((content as string).trim())
    expect(record.hit).toBe(500)
    expect(record.miss).toBe(100)
    expect(record.fp).toBe('abc123')
  })

  it('skips directory creation when it exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.appendFileSync).mockImplementation(() => {})

    appendUsageToJsonl('/fake/dir/file.jsonl', 100, 50)

    expect(fs.mkdirSync).not.toHaveBeenCalled()
    const record = JSON.parse(vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string)
    expect(record.fp).toBeUndefined()
  })

  it('silently ignores write errors', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.appendFileSync).mockImplementation(() => {
      throw new Error('write failed')
    })

    expect(() => appendUsageToJsonl('/fake/file.jsonl', 100, 50)).not.toThrow()
  })
})

describe('getCacheReport', () => {
  it('generates report with zero stats', () => {
    const stats = createCacheStats()
    const report = getCacheReport(stats)
    expect(report).toContain('DeepSeek Cache Dashboard')
    expect(report).toContain('0.0%')
    expect(report).toContain('0.0000')
  })

  it('generates report with data', () => {
    const stats = {
      totalHitTokens: 900000,
      totalMissTokens: 100000,
      requestCount: 50,
      prefixChanges: 2,
      firstRequestTime: 1000000,
      lastRequestTime: 2000000,
    }
    const report = getCacheReport(stats, 'abcdef1234567890')
    expect(report).toContain('90.0%')
    expect(report).toContain('🟢')
    expect(report).toContain('abcdef1234567890')
    expect(report).toContain('前缀变化')
  })

  it('does not include balance info (removed feature)', () => {
    const stats = createCacheStats()
    const report = getCacheReport(stats)
    expect(report).not.toContain('账户余额')
  })

  it('shows yellow icon for medium hit rate', () => {
    const stats = {
      totalHitTokens: 500000,
      totalMissTokens: 500000,
      requestCount: 10,
      prefixChanges: 0,
      firstRequestTime: 1000,
      lastRequestTime: 2000,
    }
    const report = getCacheReport(stats)
    expect(report).toContain('🟡')
  })

  it('shows red icon for low hit rate', () => {
    const stats = {
      totalHitTokens: 100000,
      totalMissTokens: 900000,
      requestCount: 10,
      prefixChanges: 0,
      firstRequestTime: 1000,
      lastRequestTime: 2000,
    }
    const report = getCacheReport(stats)
    expect(report).toContain('🔴')
  })
  it('shows seconds for sessions under 60s', () => {
    const stats = {
      totalHitTokens: 100000,
      totalMissTokens: 50000,
      requestCount: 5,
      prefixChanges: 0,
      firstRequestTime: 1000000,
      lastRequestTime: 1030000, // 30 seconds
    }
    const report = getCacheReport(stats)
    expect(report).toContain('30 秒')
    expect(report).not.toContain('分钟')
  })

  it('shows minutes for sessions over 60s', () => {
    const stats = {
      totalHitTokens: 100000,
      totalMissTokens: 50000,
      requestCount: 5,
      prefixChanges: 0,
      firstRequestTime: 1000000,
      lastRequestTime: 1070000, // 70 seconds
    }
    const report = getCacheReport(stats)
    expect(report).toContain('1 分钟')
  })

  it('includes multi-model warning', () => {
    const stats = createCacheStats()
    const report = getCacheReport(stats)
    expect(report).toContain('多模型混用时，成本为近似值')
  })
})

describe('getLastFingerprintFromJsonl', () => {
  it('returns null when file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const result = getLastFingerprintFromJsonl('/fake/path.jsonl')
    expect(result.fingerprint).toBeNull()
  })

  it('returns last fingerprint from JSONL records', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['path.jsonl'] as any)
    vi.mocked(fs.readFileSync).mockReturnValue(
      '{"t":1000,"hit":100,"miss":50,"fp":"aaa"}\n{"t":2000,"hit":200,"miss":50,"fp":"bbb"}\n',
    )
    const result = getLastFingerprintFromJsonl('/fake/path.jsonl')
    expect(result.fingerprint).toBe('bbb')
  })

  it('returns null when no records have fp field', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['path.jsonl'] as any)
    vi.mocked(fs.readFileSync).mockReturnValue('{"t":1000,"hit":100}\n{"t":2000,"hit":200}\n')
    const result = getLastFingerprintFromJsonl('/fake/path.jsonl')
    expect(result.fingerprint).toBeNull()
  })

  it('handles multiple rotated files correctly', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue([
      'path.jsonl',
      'path.jsonl.123',
      'path.jsonl.456',
    ] as any)
    // sorted order: path.jsonl, path.jsonl.123, path.jsonl.456
    // loadStatsFromJsonl reads in sorted order, so last file wins
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce('{"t":1000,"hit":100,"fp":"first"}\n')
      .mockReturnValueOnce('{"t":2000,"hit":200,"fp":"second"}\n')
      .mockReturnValueOnce('{"t":3000,"hit":300,"fp":"third"}\n')
    const result = getLastFingerprintFromJsonl('/fake/path.jsonl')
    expect(result.fingerprint).toBe('third')
  })

  it('returns last model from JSONL records', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['path.jsonl'] as any)
    vi.mocked(fs.readFileSync).mockReturnValue(
      '{"t":1000,"hit":100,"miss":50,"fp":"aaa","model":"deepseek-chat"}\n{"t":2000,"hit":200,"miss":50,"fp":"bbb","model":"deepseek-reasoner"}\n',
    )
    const result = getLastFingerprintFromJsonl('/fake/path.jsonl')
    expect(result.fingerprint).toBe('bbb')
    expect(result.model).toBe('deepseek-reasoner')
  })

  it('returns null model when no records have model field', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['path.jsonl'] as any)
    vi.mocked(fs.readFileSync).mockReturnValue('{"t":1000,"hit":100,"fp":"aaa"}\n')
    const result = getLastFingerprintFromJsonl('/fake/path.jsonl')
    expect(result.model).toBeNull()
  })

  it('returns null model when file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const result = getLastFingerprintFromJsonl('/fake/path.jsonl')
    expect(result.model).toBeNull()
  })
})

describe('saveBaselineToJsonl', () => {
  it('creates directory if needed and writes baseline record', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.appendFileSync).mockImplementation(() => {})

    saveBaselineToJsonl('/fake/dir/file.jsonl', 'session-1', 100, 500, 'fp123')

    expect(fs.mkdirSync).toHaveBeenCalledWith('/fake/dir', { recursive: true })
    expect(fs.appendFileSync).toHaveBeenCalledTimes(1)
    const [path, content] = vi.mocked(fs.appendFileSync).mock.calls[0]!
    expect(path).toBe('/fake/dir/file.jsonl')
    const record = JSON.parse((content as string).trim())
    expect(record.type).toBe('baseline')
    expect(record.sessionID).toBe('session-1')
    expect(record.input).toBe(100)
    expect(record.cacheRead).toBe(500)
    expect(record.fp).toBe('fp123')
    expect(record.t).toBeTypeOf('number')
  })

  it('works without fingerprint', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.appendFileSync).mockImplementation(() => {})

    saveBaselineToJsonl('/fake/file.jsonl', 's2', 200, 800)

    const record = JSON.parse(vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string)
    expect(record.type).toBe('baseline')
    expect(record.fp).toBeUndefined()
  })

  it('silently ignores write errors', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.appendFileSync).mockImplementation(() => {
      throw new Error('write failed')
    })
    expect(() => saveBaselineToJsonl('/fake/file.jsonl', 's1', 100, 500)).not.toThrow()
  })
})

describe('loadBaselinesFromJsonl', () => {
  it('returns empty map when file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const result = loadBaselinesFromJsonl('/fake/path.jsonl')
    expect(result.size).toBe(0)
  })

  it('loads baseline records from JSONL', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['path.jsonl'] as any)
    vi.mocked(fs.readFileSync).mockReturnValue(
      '{"t":1000,"type":"baseline","sessionID":"s1","input":100,"cacheRead":500}\n' +
        '{"t":2000,"type":"baseline","sessionID":"s2","input":200,"cacheRead":800}\n',
    )
    const result = loadBaselinesFromJsonl('/fake/path.jsonl')
    expect(result.size).toBe(2)
    expect(result.get('s1')).toEqual({ input: 100, cacheRead: 500 })
    expect(result.get('s2')).toEqual({ input: 200, cacheRead: 800 })
  })

  it('keeps latest baseline per sessionID', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['path.jsonl'] as any)
    vi.mocked(fs.readFileSync).mockReturnValue(
      '{"t":1000,"type":"baseline","sessionID":"s1","input":100,"cacheRead":500}\n' +
        '{"t":2000,"type":"baseline","sessionID":"s1","input":300,"cacheRead":900}\n',
    )
    const result = loadBaselinesFromJsonl('/fake/path.jsonl')
    expect(result.size).toBe(1)
    expect(result.get('s1')).toEqual({ input: 300, cacheRead: 900 })
  })

  it('ignores non-baseline records', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['path.jsonl'] as any)
    vi.mocked(fs.readFileSync).mockReturnValue(
      '{"t":1000,"hit":500,"miss":100}\n' +
        '{"t":2000,"type":"baseline","sessionID":"s1","input":100,"cacheRead":500}\n',
    )
    const result = loadBaselinesFromJsonl('/fake/path.jsonl')
    expect(result.size).toBe(1)
    expect(result.has('s1')).toBe(true)
  })

  it('skips malformed lines', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['path.jsonl'] as any)
    vi.mocked(fs.readFileSync).mockReturnValue(
      'NOT JSON\n{"t":2000,"type":"baseline","sessionID":"s1","input":100,"cacheRead":500}\n',
    )
    const result = loadBaselinesFromJsonl('/fake/path.jsonl')
    expect(result.size).toBe(1)
    expect(result.get('s1')).toEqual({ input: 100, cacheRead: 500 })
  })
})

describe('loadStatsFromJsonl baseline exclusion', () => {
  it('does not count baseline records in requestCount', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['path.jsonl'] as any)
    vi.mocked(fs.readFileSync).mockReturnValue(
      '{"t":1000,"type":"baseline","sessionID":"s1","input":100,"cacheRead":500}\n' +
        '{"t":2000,"hit":300,"miss":50}\n',
    )
    const stats = loadStatsFromJsonl('/fake/path.jsonl')
    expect(stats.requestCount).toBe(1)
    expect(stats.totalHitTokens).toBe(300)
    expect(stats.totalMissTokens).toBe(50)
  })
})

describe('appendUsageToJsonl prefixChanges', () => {
  it('includes pc field on fingerprint records when prefixChanges provided', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.appendFileSync).mockImplementation(() => {})

    appendUsageToJsonl('/fake/file.jsonl', 0, 0, 'fp123', undefined, 5)

    const record = JSON.parse(vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string)
    expect(record.type).toBe('fingerprint')
    expect(record.pc).toBe(5)
  })

  it('does not include pc field on usage records', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.appendFileSync).mockImplementation(() => {})

    appendUsageToJsonl('/fake/file.jsonl', 100, 50, 'fp123', undefined, 5)

    const record = JSON.parse(vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string)
    expect(record.type).toBeUndefined()
    expect(record.pc).toBeUndefined()
  })
})

describe('loadStatsFromJsonl prefixChanges restoration', () => {
  it('restores prefixChanges from pc field on fingerprint records', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readdirSync).mockReturnValue(['path.jsonl'] as any)
    vi.mocked(fs.readFileSync).mockReturnValue(
      '{"t":1000,"hit":0,"miss":0,"fp":"aaa","type":"fingerprint","pc":3}\n',
    )
    const stats = loadStatsFromJsonl('/fake/path.jsonl')
    expect(stats.prefixChanges).toBe(3)
  })
})
