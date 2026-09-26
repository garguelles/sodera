export type MarketPrices = {
  bitcoin: { usd: number; change24h: number };
  ethereum: { usd: number; change24h: number };
  updatedAt: number;
};

export type MarketTrends = {
  bitcoin: number[] | null;
  ethereum: number[] | null;
};

const MARKET_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin%2Cethereum&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true';

export async function loadMarketPrices(signal?: AbortSignal): Promise<MarketPrices> {
  const response = await fetch(MARKET_URL, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Market prices returned HTTP ${response.status}`);

  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('bitcoin' in data) || !('ethereum' in data)) {
    throw new Error('Market prices returned invalid data');
  }

  const bitcoin = parsePrice(data.bitcoin);
  const ethereum = parsePrice(data.ethereum);
  if (!bitcoin || !ethereum) throw new Error('Market prices returned invalid data');

  return {
    bitcoin: { usd: bitcoin.usd, change24h: bitcoin.change24h },
    ethereum: { usd: ethereum.usd, change24h: ethereum.change24h },
    updatedAt: Math.min(bitcoin.updatedAt, ethereum.updatedAt) * 1000,
  };
}

export async function loadMarketTrends(signal?: AbortSignal): Promise<MarketTrends> {
  const trend = async (id: 'bitcoin' | 'ethereum') => {
    const response = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=1`, {
      signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('prices' in data) || !Array.isArray(data.prices)) return null;
    const values = data.prices.map((point) =>
      Array.isArray(point) && typeof point[1] === 'number' && Number.isFinite(point[1]) && point[1] > 0
        ? point[1] as number
        : null,
    );
    if (values.length < 2 || values.some((value) => value === null)) return null;
    return Array.from({ length: 24 }, (_, index) => values[Math.round(index * (values.length - 1) / 23)]!);
  };

  const [bitcoin, ethereum] = await Promise.all([
    trend('bitcoin').catch(() => null),
    trend('ethereum').catch(() => null),
  ]);
  return { bitcoin, ethereum };
}

function parsePrice(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const price = value as Record<string, unknown>;
  const usd = price.usd;
  const change24h = price.usd_24h_change;
  const updatedAt = price.last_updated_at;
  if (
    typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0 ||
    typeof change24h !== 'number' || !Number.isFinite(change24h) ||
    typeof updatedAt !== 'number' || !Number.isSafeInteger(updatedAt) || updatedAt <= 0
  ) return null;
  return { usd, change24h, updatedAt };
}
