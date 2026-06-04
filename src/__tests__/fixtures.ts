/**
 * Test fixtures for opencode-deepseek-cache tests.
 * Provides standardized test data for messages, JSONL records, and edge cases.
 */

export const FIXTURES = {
  // Session message responses
  messages: {
    deepseek_basic: {
      data: [
        {
          info: {
            role: 'assistant',
            tokens: { cache: { read: 500 }, input: 100 },
            modelID: 'deepseek-chat',
            providerID: 'deepseek',
          },
          parts: [],
        },
      ],
    },
    deepseek_with_write: {
      data: [
        {
          info: {
            role: 'assistant',
            tokens: { cache: { read: 500, write: 50 }, input: 100, output: 200 },
            modelID: 'deepseek-chat',
            providerID: 'deepseek',
          },
          parts: [],
        },
      ],
    },
    deepseek_no_cache_read: {
      data: [
        {
          info: {
            role: 'assistant',
            tokens: { input: 200 },
            modelID: 'deepseek-chat',
            providerID: 'deepseek',
          },
          parts: [],
        },
      ],
    },
    non_deepseek: {
      data: [
        {
          info: {
            role: 'assistant',
            tokens: { input: 300 },
            modelID: 'gpt-4',
            providerID: 'openai',
          },
          parts: [],
        },
      ],
    },
    empty_data: { data: [] },
    error_response: { error: 'API error' },
    null_tokens: {
      data: [
        {
          info: {
            role: 'assistant',
            tokens: null,
          },
          parts: [],
        },
      ],
    },
    negative_tokens: {
      data: [
        {
          info: {
            role: 'assistant',
            tokens: { cache: { read: -1 }, input: -5 },
          },
          parts: [],
        },
      ],
    },
    nan_tokens: {
      data: [
        {
          info: {
            role: 'assistant',
            tokens: { cache: { read: NaN }, input: Infinity },
          },
          parts: [],
        },
      ],
    },
  },

  // JSONL records
  jsonl: {
    usage_basic: '{"t":1000,"hit":500,"miss":100}\n',
    usage_with_write: '{"t":1000,"hit":500,"miss":100,"write":50,"output":200}\n',
    baseline: '{"t":1000,"type":"baseline","sessionID":"s1","input":100,"cacheRead":500}\n',
    fingerprint: '{"t":1000,"hit":0,"miss":0,"fp":"abc123","type":"fingerprint","pc":3}\n',
    corrupted: 'NOT JSON\n{"t":1000,"hit":100}\n',
    expired_baseline: `{"t":${Date.now() - 90000000},"type":"baseline","sessionID":"old","input":100,"cacheRead":500}\n`,
  },

  // Edge cases
  edge: {
    max_session_id: 's'.repeat(1000),
    unicode_session_id: '会话-🔑',
    zero_tokens: { cache: { read: 0 }, input: 0, output: 0 },
    very_large_tokens: { cache: { read: 999999999 }, input: 999999999 },
  },
} as const

/**
 * Helper to create a mock plugin context
 */
export function createMockContext(overrides: Record<string, unknown> = {}) {
  return {
    directory: '/tmp/test',
    client: {
      session: {
        messages: () => Promise.resolve(FIXTURES.messages.deepseek_basic),
      },
    },
    ...overrides,
  }
}

/**
 * Helper to create a CacheStats object with optional overrides
 */
export function createMockStats(overrides: Record<string, unknown> = {}) {
  return {
    totalHitTokens: 0,
    totalMissTokens: 0,
    totalWriteTokens: 0,
    totalOutputTokens: 0,
    requestCount: 0,
    prefixChanges: 0,
    firstRequestTime: null,
    lastRequestTime: null,
    previousHitRate: null,
    systemTransformCallCount: 0,
    lastSystemTransformTime: null,
    ...overrides,
  }
}
