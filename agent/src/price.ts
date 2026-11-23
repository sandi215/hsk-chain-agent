/**
 * Reference price for HSK/USD, from public no-key APIs.
 * Primary: CoinGecko simple price (id: hashkey-ecopoints).
 * Fallback: MEXC public ticker (HSKUSDT).
 * Returns the price in 6-decimal units (e.g. 80000 = $0.08).
 */

export interface ReferencePrice {
  price6: bigint;
  source: string;
}

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=hashkey-ecopoints&vs_currencies=usd';
const MEXC_URL = 'https://api.mexc.com/api/v3/ticker/price?symbol=HSKUSDT';

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

function toPrice6(price: number): bigint {
  if (!Number.isFinite(price) || price <= 0) throw new Error(`bad price ${price}`);
  return BigInt(Math.round(price * 1e6));
}

export async function getReferencePrice(): Promise<ReferencePrice> {
  try {
    const data = (await fetchJson(COINGECKO_URL)) as {
      'hashkey-ecopoints'?: { usd?: number };
    };
    const usd = data['hashkey-ecopoints']?.usd;
    if (usd === undefined) throw new Error('no usd field');
    return { price6: toPrice6(usd), source: 'coingecko' };
  } catch (err) {
    // Fall back to MEXC before failing the whole loop tick.
    const data = (await fetchJson(MEXC_URL)) as { price?: string };
    if (!data.price) throw new Error(`reference price unavailable: ${String(err)}`);
    return { price6: toPrice6(Number(data.price)), source: 'mexc' };
  }
}
