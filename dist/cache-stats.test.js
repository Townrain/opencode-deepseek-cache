import { beforeEach, describe, expect, it, vi } from 'vitest';
// Mock logger module before importing cache-stats
vi.mock('./logger.js', () => ({
    log: vi.fn(),
    getLogPath: vi.fn(() => '/fake/debug.log'),
}));
// Mock fs module before importing cache-stats
vi.mock('fs', () => ({
    readFileSync: vi.fn(),
    appendFileSync: vi.fn(),
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
}));
// Import after mock setup
const fs = await import('node:fs');
const { loadStatsFromJsonl, appendUsageToJsonl, createCacheStats, getCacheReport } = await import('./cache-stats.js');
beforeEach(() => {
    vi.clearAllMocks();
});
describe('createCacheStats', () => {
    it('returns zeroed stats with null timestamps', () => {
        const stats = createCacheStats();
        expect(stats).toEqual({
            totalHitTokens: 0,
            totalMissTokens: 0,
            requestCount: 0,
            prefixChanges: 0,
            firstRequestTime: null,
            lastRequestTime: null,
        });
    });
});
describe('loadStatsFromJsonl', () => {
    it('returns empty stats when file does not exist', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        const stats = loadStatsFromJsonl('/fake/path.jsonl');
        expect(stats).toEqual(createCacheStats());
        expect(fs.readFileSync).not.toHaveBeenCalled();
    });
    it('parses JSONL records correctly', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue('{"t":1000,"hit":500,"miss":100}\n{"t":2000,"hit":300,"miss":50}\n');
        const stats = loadStatsFromJsonl('/fake/path.jsonl');
        expect(stats.totalHitTokens).toBe(800);
        expect(stats.totalMissTokens).toBe(150);
        expect(stats.requestCount).toBe(2);
        expect(stats.firstRequestTime).toBe(1000);
        expect(stats.lastRequestTime).toBe(2000);
    });
    it('handles empty file', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue('');
        const stats = loadStatsFromJsonl('/fake/path.jsonl');
        expect(stats.requestCount).toBe(0);
    });
    it('skips malformed lines', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue('{"t":1000,"hit":500,"miss":100}\nNOT JSON\n{"t":2000,"hit":200,"miss":50}\n');
        const stats = loadStatsFromJsonl('/fake/path.jsonl');
        expect(stats.requestCount).toBe(2);
        expect(stats.totalHitTokens).toBe(700);
    });
    it('tracks prefix fingerprint changes', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue('{"t":1000,"hit":100,"miss":0,"fp":"aaa"}\n{"t":2000,"hit":200,"miss":0,"fp":"bbb"}\n{"t":3000,"hit":300,"miss":0,"fp":"bbb"}\n');
        const stats = loadStatsFromJsonl('/fake/path.jsonl');
        expect(stats.prefixChanges).toBe(1);
    });
    it('returns empty stats on read error', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockImplementation(() => {
            throw new Error('read error');
        });
        const stats = loadStatsFromJsonl('/fake/path.jsonl');
        expect(stats).toEqual(createCacheStats());
    });
    it('handles records with missing timestamp gracefully', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue('{"hit":100,"miss":50}\n');
        const stats = loadStatsFromJsonl('/fake/path.jsonl');
        expect(stats.requestCount).toBe(1);
        expect(stats.firstRequestTime).not.toBeNull();
    });
});
describe('appendUsageToJsonl', () => {
    it('creates directory if it does not exist and appends record', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(fs.appendFileSync).mockImplementation(() => { });
        appendUsageToJsonl('/fake/dir/file.jsonl', 500, 100, 'abc123');
        expect(fs.mkdirSync).toHaveBeenCalledWith('/fake/dir', { recursive: true });
        expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
        const [path, content] = vi.mocked(fs.appendFileSync).mock.calls[0];
        expect(path).toBe('/fake/dir/file.jsonl');
        const record = JSON.parse(content.trim());
        expect(record.hit).toBe(500);
        expect(record.miss).toBe(100);
        expect(record.fp).toBe('abc123');
    });
    it('skips directory creation when it exists', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.appendFileSync).mockImplementation(() => { });
        appendUsageToJsonl('/fake/dir/file.jsonl', 100, 50);
        expect(fs.mkdirSync).not.toHaveBeenCalled();
        const record = JSON.parse(vi.mocked(fs.appendFileSync).mock.calls[0]?.[1]);
        expect(record.fp).toBeUndefined();
    });
    it('silently ignores write errors', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.appendFileSync).mockImplementation(() => {
            throw new Error('write error');
        });
        expect(() => appendUsageToJsonl('/fake/file.jsonl', 100, 50)).not.toThrow();
    });
});
describe('getCacheReport', () => {
    it('generates report with zero stats', () => {
        const stats = createCacheStats();
        const report = getCacheReport(stats);
        expect(report).toContain('DeepSeek Cache Dashboard');
        expect(report).toContain('0.0%');
        expect(report).toContain('0.0000');
    });
    it('generates report with data', () => {
        const stats = {
            totalHitTokens: 900000,
            totalMissTokens: 100000,
            requestCount: 50,
            prefixChanges: 2,
            firstRequestTime: 1000000,
            lastRequestTime: 2000000,
        };
        const report = getCacheReport(stats, 'abcdef1234567890');
        expect(report).toContain('90.0%');
        expect(report).toContain('🟢');
        expect(report).toContain('abcdef1234567890');
        expect(report).toContain('前缀变化');
    });
    it('includes balance info when provided', () => {
        const stats = createCacheStats();
        const balance = { currency: 'USD', total_balance: '42.50' };
        const report = getCacheReport(stats, undefined, balance);
        expect(report).toContain('¥42.50');
        expect(report).toContain('USD');
    });
    it('shows yellow icon for medium hit rate', () => {
        const stats = {
            totalHitTokens: 500000,
            totalMissTokens: 500000,
            requestCount: 10,
            prefixChanges: 0,
            firstRequestTime: 1000,
            lastRequestTime: 2000,
        };
        const report = getCacheReport(stats);
        expect(report).toContain('🟡');
    });
    it('shows red icon for low hit rate', () => {
        const stats = {
            totalHitTokens: 100000,
            totalMissTokens: 900000,
            requestCount: 10,
            prefixChanges: 0,
            firstRequestTime: 1000,
            lastRequestTime: 2000,
        };
        const report = getCacheReport(stats);
        expect(report).toContain('🔴');
    });
});
//# sourceMappingURL=cache-stats.test.js.map