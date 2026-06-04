import { describe, expect, it } from 'vitest'
import { sanitizeLogMessage, sanitizeSessionId } from '../utils/type-guards.js'

describe('Input Validation', () => {
  describe('sanitizeSessionId', () => {
    it('removes path traversal sequences', () => {
      expect(sanitizeSessionId('abc../def')).toBe('abcdef')
    })
    it('removes null bytes', () => {
      expect(sanitizeSessionId('session\x00id')).toBe('sessionid')
    })
    it('removes control characters', () => {
      expect(sanitizeSessionId('session\nid')).toBe('sessionid')
    })
    it('preserves valid session IDs', () => {
      expect(sanitizeSessionId('session-123_abc')).toBe('session-123_abc')
    })
    it('limits length to 128 chars', () => {
      const long = 'a'.repeat(200)
      expect(sanitizeSessionId(long).length).toBe(128)
    })
    it('handles empty string', () => {
      expect(sanitizeSessionId('')).toBe('')
    })
  })

  describe('sanitizeLogMessage', () => {
    it('replaces newlines with spaces', () => {
      expect(sanitizeLogMessage('line1\nline2')).toBe('line1 line2')
    })
    it('replaces carriage returns', () => {
      expect(sanitizeLogMessage('line1\rline2')).toBe('line1 line2')
    })
    it('replaces null bytes', () => {
      expect(sanitizeLogMessage('msg\x00text')).toBe('msg text')
    })
    it('preserves normal text', () => {
      expect(sanitizeLogMessage('normal log message')).toBe('normal log message')
    })
    it('limits length to 1000 chars', () => {
      const long = 'a'.repeat(1500)
      expect(sanitizeLogMessage(long).length).toBe(1000)
    })
  })
})
