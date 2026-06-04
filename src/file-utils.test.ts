import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock fs — only what findGitRoot needs
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
  renameSync: vi.fn(),
  readdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}))

const fs = await import('node:fs')
const { join } = await import('node:path')

import {
  findGitRoot,
  normalizeGitRoot,
  resetSkipCounters,
  rotateFileIfNeeded,
} from './file-utils.js'

describe('findGitRoot', () => {
  it('returns git root when .git found in ancestor', () => {
    // S1: Start deep in a monorepo, .git exists at project root
    const startDir = join('D:', 'home', 'user', 'monorepo', 'packages', 'frontend')
    const gitRoot = join('D:', 'home', 'user', 'monorepo')

    vi.mocked(fs.existsSync).mockImplementation((p: string) => {
      const str = typeof p === 'string' ? p : String(p)
      return str === join(gitRoot, '.git')
    })

    expect(findGitRoot(startDir)).toBe(gitRoot)
  })

  it('returns empty string when no .git found in ancestors', () => {
    // S2: No .git anywhere up to filesystem root → returns empty string
    const startDir = join('D:', 'home', 'user', 'orphan-project', 'src')

    vi.mocked(fs.existsSync).mockReturnValue(false)

    expect(findGitRoot(startDir)).toBe('')
  })

  it('stops at filesystem root and returns empty string when no .git', () => {
    // S3: Edge case — startDir is one level below root
    const startDir = join('D:', 'only-child')

    vi.mocked(fs.existsSync).mockReturnValue(false)

    expect(findGitRoot(startDir)).toBe('')
  })
})

describe('normalizeGitRoot', () => {
  it('converts Windows backslashes to forward slashes and lowercases path', () => {
    // Windows path: backslashes → forward slashes, preserve drive letter case
    expect(normalizeGitRoot('D:\\Foo\\Bar\\Baz')).toBe('D:/foo/bar/baz')
  })

  it('normalizes WSL2 /mnt/[drive]/ path to Windows drive letter form', () => {
    // WSL2 /mnt/d/... → D:/...
    expect(normalizeGitRoot('/mnt/d/openstack/deepseek')).toBe('D:/openstack/deepseek')
    expect(normalizeGitRoot('/mnt/c/Users/Townrain/project')).toBe('C:/users/townrain/project')
  })

  it('lowercases Unix paths completely', () => {
    // Unix path → all lowercase
    expect(normalizeGitRoot('/home/User/Projects/MyApp')).toBe('/home/user/projects/myapp')
  })

  it('produces identical output for case-insensitive Windows paths', () => {
    // D:\Foo == d:\foo after normalization
    const upper = normalizeGitRoot('D:\\Foo\\Bar')
    const lower = normalizeGitRoot('d:\\foo\\bar')
    expect(upper).toBe('D:/foo/bar')
    expect(lower).toBe('D:/foo/bar')
    expect(upper).toBe(lower)
  })

  it('produces identical output for Windows and WSL2 paths to same project', () => {
    // D:\openstack\deepseek and /mnt/d/openstack/deepseek → same normalized path
    const win = normalizeGitRoot('D:\\openstack\\deepseek')
    const wsl = normalizeGitRoot('/mnt/d/openstack/deepseek')
    expect(win).toBe('D:/openstack/deepseek')
    expect(wsl).toBe('D:/openstack/deepseek')
    expect(win).toBe(wsl)
  })

  it('handles empty string gracefully', () => {
    expect(normalizeGitRoot('')).toBe('')
  })
})

describe('rotateFileIfNeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSkipCounters()
  })

  it('returns false when file does not exist', () => {
    // S1: File doesn't exist → no rotation needed
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const result = rotateFileIfNeeded('/fake/file.log', 1024)
    expect(result).toBe(false)
    expect(fs.statSync).not.toHaveBeenCalled()
  })

  it('returns false when skip counter not at check point', () => {
    // S2: Skip counter not at 10th call → skip check
    vi.mocked(fs.existsSync).mockReturnValue(true)

    // Call 9 times (not 10th)
    for (let i = 0; i < 9; i++) {
      rotateFileIfNeeded('/fake/file.log', 1024)
    }

    expect(fs.statSync).not.toHaveBeenCalled()
  })

  it('checks file size on 10th call', () => {
    // S3: 10th call → check file size
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({ size: 500 } as any)

    // Call 10 times
    for (let i = 0; i < 10; i++) {
      rotateFileIfNeeded('/fake/file.log', 1024)
    }

    expect(fs.statSync).toHaveBeenCalledTimes(1)
  })

  it('returns false when file size below threshold', () => {
    // S4: File size < maxSize → no rotation
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({ size: 500 } as any)

    // Call 10 times to trigger check
    let result = false
    for (let i = 0; i < 10; i++) {
      result = rotateFileIfNeeded('/fake/file.log', 1024)
    }

    expect(result).toBe(false)
    expect(fs.renameSync).not.toHaveBeenCalled()
  })

  it('rotates file when size exceeds threshold', () => {
    // S5: File size >= maxSize → rotate
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({ size: 2048 } as any)
    vi.mocked(fs.readdirSync).mockReturnValue([])

    // Call 9 times to get counter to 9
    for (let i = 0; i < 9; i++) {
      rotateFileIfNeeded('/fake/file.log', 1024)
    }

    // 10th call should trigger rotation
    const result = rotateFileIfNeeded('/fake/file.log', 1024)

    expect(result).toBe(true)
    expect(fs.renameSync).toHaveBeenCalledTimes(1)
    // Use expect.any(String) to handle path separator differences
    expect(fs.renameSync).toHaveBeenCalledWith(
      '/fake/file.log',
      expect.stringMatching(/^[/\\]fake[/\\]file\.log\.\d+$/),
    )
  })

  it('cleans up old rotated files keeping latest keepCount', () => {
    // S6: Cleanup old rotated files
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({ size: 2048 } as any)
    vi.mocked(fs.readdirSync).mockReturnValue([
      'file.log.1000',
      'file.log.2000',
      'file.log.3000',
      'file.log.4000',
      'file.log.5000',
    ])

    // Call 10 times to trigger check
    for (let i = 0; i < 10; i++) {
      rotateFileIfNeeded('/fake/file.log', 1024, 3)
    }

    // Should delete 2 oldest files (5 - 3 = 2)
    expect(fs.unlinkSync).toHaveBeenCalledTimes(2)
    expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('file.log.1000'))
    expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('file.log.2000'))
  })

  it('returns false on error', () => {
    // S7: Error handling → return false
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw new Error('Permission denied')
    })

    // Call 10 times to trigger check
    let result = false
    for (let i = 0; i < 10; i++) {
      result = rotateFileIfNeeded('/fake/file.log', 1024)
    }

    expect(result).toBe(false)
  })
})
