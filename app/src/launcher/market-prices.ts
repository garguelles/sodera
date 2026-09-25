export type MarketPrices = {
  bitcoin: { usd: number; change24h: number };
  ethereum: { usd: number; change24h: number };
  updatedAt: number;
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
