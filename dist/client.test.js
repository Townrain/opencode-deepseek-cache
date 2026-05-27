import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBalance, pickPrimaryBalance } from './client.js';
describe('pickPrimaryBalance', () => {
    it('returns null for empty array', () => {
        expect(pickPrimaryBalance([])).toBeNull();
    });
    it('returns the single item for array of one', () => {
        const info = { currency: 'USD', total_balance: '10.00' };
        expect(pickPrimaryBalance([info])).toBe(info);
    });
    it('picks the balance with largest total_balance', () => {
        const low = { currency: 'USD', total_balance: '5.00' };
        const high = { currency: 'USD', total_balance: '42.50' };
        const mid = { currency: 'USD', total_balance: '20.00' };
        expect(pickPrimaryBalance([low, high, mid])).toBe(high);
    });
    it('handles string comparison correctly via Number conversion', () => {
        const a = { currency: 'USD', total_balance: '9.99' };
        const b = { currency: 'USD', total_balance: '100.00' };
        expect(pickPrimaryBalance([a, b])).toBe(b);
    });
    it('returns first item when all are equal', () => {
        const a = { currency: 'USD', total_balance: '10.00' };
        const b = { currency: 'CNY', total_balance: '10.00' };
        expect(pickPrimaryBalance([a, b])).toBe(a);
    });
});
describe('getBalance', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });
    it('returns balance info on success', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                is_available: true,
                balance_infos: [{ currency: 'USD', total_balance: '42.50' }],
            }),
        });
        const result = await getBalance('test-key');
        expect(result).toEqual({ currency: 'USD', total_balance: '42.50' });
        expect(globalThis.fetch).toHaveBeenCalledWith('https://api.deepseek.com/user/balance', expect.objectContaining({
            method: 'GET',
            headers: { Authorization: 'Bearer test-key' },
        }));
    });
    it('uses custom baseUrl', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                is_available: true,
                balance_infos: [{ currency: 'USD', total_balance: '10.00' }],
            }),
        });
        await getBalance('key', 'https://custom.api.com');
        expect(globalThis.fetch).toHaveBeenCalledWith('https://custom.api.com/user/balance', expect.anything());
    });
    it('returns null on non-ok response', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
        expect(await getBalance('bad-key')).toBeNull();
    });
    it('returns null when balance_infos is missing', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ is_available: true }),
        });
        expect(await getBalance('key')).toBeNull();
    });
    it('returns null when balance_infos is not an array', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ balance_infos: 'not-array' }),
        });
        expect(await getBalance('key')).toBeNull();
    });
    it('returns null on fetch error', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));
        expect(await getBalance('key')).toBeNull();
    });
    it('picks primary balance when multiple exist', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                is_available: true,
                balance_infos: [
                    { currency: 'USD', total_balance: '5.00' },
                    { currency: 'USD', total_balance: '99.00' },
                ],
            }),
        });
        const result = await getBalance('key');
        expect(result?.total_balance).toBe('99.00');
    });
});
//# sourceMappingURL=client.test.js.map