import { loadMarketPrices, loadMarketTrends } from './market-prices';

describe('loadMarketPrices', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('loads USD prices, 24h changes, and the oldest quote timestamp', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        bitcoin: { usd: 84002, usd_24h_change: 0.2, last_updated_at: 1790319890 },
        ethereum: { usd: 2673.55, usd_24h_change: -0.3, last_updated_at: 1790319880 },
      }),
    });

    await expect(loadMarketPrices()).resolves.toEqual({
      bitcoin: { usd: 84002, change24h: 0.2 },
      ethereum: { usd: 2673.55, change24h: -0.3 },
      updatedAt: 1790319880000,
    });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('api.coingecko.com'), expect.any(Object));
  });

  it('does not show incomplete or invalid prices as live', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ bitcoin: { usd: 100 }, ethereum: { usd: 200 } }),
    });

    await expect(loadMarketPrices()).rejects.toThrow('invalid data');
  });

  it('reports upstream errors rather than presenting invented values', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });

    await expect(loadMarketPrices()).rejects.toThrow('HTTP 429');
  });

  it('uses price history for the sparklines and omits unavailable history', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ prices: [[1, 100], [2, 110], [3, 105]] }) })
      .mockResolvedValueOnce({ ok: false, status: 429 });

    const trends = await loadMarketTrends();

    expect(trends.bitcoin).toHaveLength(24);
    expect(trends.bitcoin?.[0]).toBe(100);
    expect(trends.bitcoin?.[23]).toBe(105);
    expect(trends.ethereum).toBeNull();
  });
});
