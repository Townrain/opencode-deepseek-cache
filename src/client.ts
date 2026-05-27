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
export function pickPrimaryBalance(infos: ReadonlyArray<BalanceInfo>): BalanceInfo | null {
  if (infos.length === 0) return null;
  let best = infos[0]!;
  for (let i = 1; i < infos.length; i++) {
    if (Number(infos[i]!.total_balance) > Number(best.total_balance)) best = infos[i]!;
  }
  return best;
}

/**
 * Fetch user balance from DeepSeek API.
 * Returns null on failure so callers can degrade — session must keep working without balance UI.
 */
export async function getBalance(
  apiKey: string,
  baseUrl: string = "https://api.deepseek.com"
): Promise<BalanceInfo | null> {
  try {
    const resp = await fetch(`${baseUrl}/user/balance`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as UserBalance;
    if (!data || !Array.isArray(data.balance_infos)) return null;
    return pickPrimaryBalance(data.balance_infos);
  } catch {
    return null;
  }
}
