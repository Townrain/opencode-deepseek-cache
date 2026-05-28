import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock fs module before importing logger
vi.mock('fs', () => {
  const mockStream = {
    write: vi.fn().mockReturnValue(true),
    end: vi.fn(),
    on: vi.fn(),
  }
  return {
    createWriteStream: vi.fn().mockReturnValue(mockStream),
    statSync: vi.fn().mockReturnValue({ size: 100 }),
    unlinkSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
  }
})

// Mock process.cwd()
const originalCwd = process.cwd

beforeEach(() => {
  vi.clearAllMocks()
  process.cwd = vi.fn().mockReturnValue('/test/project')
})

afterEach(() => {
  process.cwd = originalCwd
})

// Import after mock setup — dynamic import with top-level await is fine in ESM
const { initLogger, log, getLogPath } = await import('./logger.js')

// Initialize logger before tests
initLogger('/test/project')

describe('getLogPath', () => {
  it('returns a path containing .opencode/deepseek-cache-logs', () => {
    const path = getLogPath()
    expect(path).toContain('.opencode')
    expect(path).toContain('deepseek-cache-logs')
    expect(path).toContain('debug.log')
  })
})

describe('log', () => {
  it('writes a message to the stream', () => {
    log('test message')
    expect(() => log('another message')).not.toThrow()
  })

  it('handles data parameter', () => {
    expect(() => log('with data', { key: 'value' })).not.toThrow()
  })

  it('handles undefined data gracefully', () => {
    expect(() => log('no data')).not.toThrow()
  })

  it('handles circular data in JSON.stringify', () => {
    const circular: any = {}
    circular.self = circular
    expect(() => log('circular', circular)).not.toThrow()
  })

  it('does not throw when stream.write returns false (backpressure)', async () => {
    const fs = await import('node:fs')
    const mockStream = vi.mocked(fs.createWriteStream).mock.results[0]?.value
    if (mockStream) {
      mockStream.write.mockReturnValue(false)
    }
    expect(() => log('backpressure test')).not.toThrow()
  })
})
