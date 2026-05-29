import { describe, expect, it } from 'vitest'
import { computeFingerprint, createFingerprintTracker } from './fingerprint.js'

describe('computeFingerprint', () => {
  it('returns a hex string of FINGERPRINT_LENGTH (16)', () => {
    const fp = computeFingerprint('hello world')
    expect(fp).toHaveLength(16)
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
  })

  it('returns deterministic output for same input', () => {
    const a = computeFingerprint('test string')
    const b = computeFingerprint('test string')
    expect(a).toBe(b)
  })

  it('returns different output for different inputs', () => {
    const a = computeFingerprint('hello')
    const b = computeFingerprint('world')
    expect(a).not.toBe(b)
  })

  it('returns empty string hash for empty input', () => {
    const fp = computeFingerprint('')
    expect(fp).toHaveLength(16)
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('createFingerprintTracker', () => {
  it('starts with null lastFingerprint', () => {
    const tracker = createFingerprintTracker()
    expect(tracker.getLastFingerprint()).toBeNull()
  })

  it('initializes with persisted fingerprint', () => {
    const tracker = createFingerprintTracker('abc123def4567890')
    expect(tracker.getLastFingerprint()).toBe('abc123def4567890')
    const result = tracker.compute('some system prompt')
    expect(result.previous).toBe('abc123def4567890')
  })

  it('initializes with null (backward compatible)', () => {
    const tracker = createFingerprintTracker(null)
    expect(tracker.getLastFingerprint()).toBeNull()
    const result = tracker.compute('test')
    expect(result.changed).toBe(false)
  })

  describe('compute', () => {
    it('returns changed=false on first call', () => {
      const tracker = createFingerprintTracker()
      const result = tracker.compute('system prompt')
      expect(result.changed).toBe(false)
      expect(result.previous).toBeNull()
      expect(result.fingerprint).toHaveLength(16)
    })

    it('returns changed=false for same input', () => {
      const tracker = createFingerprintTracker()
      tracker.compute('system prompt')
      const result = tracker.compute('system prompt')
      expect(result.changed).toBe(false)
      expect(result.previous).toBe(result.fingerprint)
    })

    it('returns changed=true for different input', () => {
      const tracker = createFingerprintTracker()
      const first = tracker.compute('prompt A')
      const second = tracker.compute('prompt B')
      expect(second.changed).toBe(true)
      expect(second.previous).toBe(first.fingerprint)
      expect(second.fingerprint).not.toBe(first.fingerprint)
    })

    it('updates lastFingerprint after compute', () => {
      const tracker = createFingerprintTracker()
      const result = tracker.compute('test')
      expect(tracker.getLastFingerprint()).toBe(result.fingerprint)
    })

  it('compute receives raw text, not hex fingerprint', () => {
    const tracker = createFingerprintTracker()
    // First call with raw text — should work normally
    const first = tracker.compute('hello world')
    expect(first.changed).toBe(false)
    expect(first.fingerprint).toHaveLength(16)

    // Second call with different raw text — should detect change
    const second = tracker.compute('goodbye world')
    expect(second.changed).toBe(true)
    expect(second.fingerprint).not.toBe(first.fingerprint)
    expect(second.previous).toBe(first.fingerprint)

    // Verify the hash is from raw text, not double-hashed
    // computeFingerprint('hello world') should equal computeFingerprint('hello world')
    // (deterministic), but computeFingerprint('a1b2c3...16hex') != computeFingerprint('hello world')
    const rawFp = computeFingerprint('hello world')
    expect(first.fingerprint).toBe(rawFp)
  })
  })
})
