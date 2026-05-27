/**
 * DeepSeek API client for balance queries.
 * Inspired by Reasonix's getBalance implementation.
 */
export interface BalanceInfo {
    currency: string;
    total_balance: string;
    granted_balance?: string;
    topped_up_balance?: string;
}
export interface UserBalance {
    is_available: boolean;
    balance_infos: BalanceInfo[];
}
/** Largest `total_balance` wins — the wallet the user actually paid for. */
export declare function pickPrimaryBalance(infos: ReadonlyArray<BalanceInfo>): BalanceInfo | null;
/**
 * Fetch user balance from DeepSeek API.
 * Returns null on failure so callers can degrade — session must keep working without balance UI.
 */
export declare function getBalance(apiKey: string, baseUrl?: string): Promise<BalanceInfo | null>;
//# sourceMappingURL=client.d.ts.map