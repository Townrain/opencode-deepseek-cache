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

// Mock file-utils module before importing logger
vi.mock('./file-utils.js', () => ({
  rotateFileIfNeeded: vi.fn().mockReturnValue(false),
}))

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
const { initLogger, log, getLogPath, dispose } = await import('./logger.js')

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

  it('writes to new stream after rotation', async () => {
    const fs = await import('node:fs')
    const { rotateFileIfNeeded } = await import('./file-utils.js')

    // The mock createWriteStream always returns the same object — call it to get the reference
    const stream1 = vi.mocked(fs.createWriteStream)('/noop') as any

    // Create stream2 as a distinct mock stream
    const stream2 = {
      write: vi.fn().mockReturnValue(true),
      end: vi.fn(),
      on: vi.fn(),
    }

    // Next call to createWriteStream must return stream2
    vi.mocked(fs.createWriteStream).mockReturnValueOnce(stream2 as any)

    // Make rotation happen
    vi.mocked(rotateFileIfNeeded).mockReturnValue(true)

    // Call log — should rotate the old stream and write to stream2
    log('test after rotation')

    // Old stream must be ended by rotation
    expect(stream1.end).toHaveBeenCalled()
    // New stream must receive the write (NOT stream1)
    expect(stream2.write).toHaveBeenCalled()
    expect(stream2.write).toHaveBeenCalledWith(expect.stringContaining('test after rotation'))
  })
})

describe('dispose', () => {
  it('closes the log stream', async () => {
    const fs = await import('node:fs')
    // Dispose first to null the stream, then re-init to create a fresh one
    dispose()
    initLogger('/test/project')
    const mockStream = vi.mocked(fs.createWriteStream).mock.results[0]?.value
    expect(mockStream).toBeDefined()
    dispose()
    expect(mockStream.end).toHaveBeenCalled()
  })

  it('sets stream to null so next log creates new stream', async () => {
    const fs = await import('node:fs')
    initLogger('/test/project')
    dispose()
    // After dispose, calling log should create a new stream
    const newStream = {
      write: vi.fn().mockReturnValue(true),
      end: vi.fn(),
      on: vi.fn(),
    }
    vi.mocked(fs.createWriteStream).mockReturnValueOnce(newStream as any)
    log('after dispose')
    expect(newStream.write).toHaveBeenCalled()
  })
})

describe('rotation', () => {
  it('preserves all written data across rotation', async () => {
    const fs = await import('node:fs')
    const { rotateFileIfNeeded } = await import('./file-utils.js')

    // Write first message
    log('first message')
    const stream1 = vi.mocked(fs.createWriteStream).mock.results[0]?.value

    // Create a second stream for rotation
    const stream2 = {
      write: vi.fn().mockReturnValue(true),
      end: vi.fn(),
      on: vi.fn(),
    }
    vi.mocked(fs.createWriteStream).mockReturnValueOnce(stream2 as any)
    vi.mocked(rotateFileIfNeeded).mockReturnValue(true)

    // Write second message — should trigger rotation then write to new stream
    log('second message')

    // Both streams should have received writes
    expect(stream1.write).toHaveBeenCalledWith(expect.stringContaining('first message'))
    expect(stream2.write).toHaveBeenCalledWith(expect.stringContaining('second message'))
    // Old stream should be ended
    expect(stream1.end).toHaveBeenCalled()
  })
})

describe('backpressure', () => {
  it('calls console.error when write returns false', async () => {
    const fs = await import('node:fs')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      // Dispose first to null the stream, then re-init to create a fresh one
      dispose()
      initLogger('/test/project')
      const mockStream = vi.mocked(fs.createWriteStream).mock.results[0]?.value
      if (mockStream) {
        mockStream.write.mockReturnValue(false)
      }
      log('backpressure test')
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Backpressure')
      )
    } finally {
      consoleSpy.mockRestore()
    }
  })
})
