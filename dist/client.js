/**
 * DeepSeek API client for balance queries.
 * Inspired by Reasonix's getBalance implementation.
 */
/** Largest `total_balance` wins — the wallet the user actually paid for. */
export function pickPrimaryBalance(infos) {
    if (infos.length === 0)
        return null;
    let best = infos[0];
    for (let i = 1; i < infos.length; i++) {
        if (Number(infos[i]?.total_balance) > Number(best.total_balance))
            best = infos[i];
    }
    return best;
}
/**
 * Fetch user balance from DeepSeek API.
 * Returns null on failure so callers can degrade — session must keep working without balance UI.
 */
export async function getBalance(apiKey, baseUrl = 'https://api.deepseek.com') {
    try {
        const resp = await fetch(`${baseUrl}/user/balance`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!resp.ok)
            return null;
        const data = (await resp.json());
        if (!data || !Array.isArray(data.balance_infos))
            return null;
        return pickPrimaryBalance(data.balance_infos);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=client.js.map